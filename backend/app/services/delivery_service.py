import datetime
import uuid
from typing import Any, Dict
from bson import ObjectId

from app.core import database
from app.core.database import serialize_doc
from app.models.lead import LeadStatus, can_transition
from app.services.zoho_service import send_email_via_zoho, update_zoho_lead_status
from app.core.audit import log_audit_event


UNSUBSCRIBE_FOOTER = (
    "\n\n---\n"
    "If you prefer not to receive further updates or training insights from Traininglobe, "
    "reply with 'unsubscribe' or click here to opt out."
)


async def send_approved_email(draft_id: str, approver_user: Dict[str, Any]) -> Dict[str, Any]:
    """
    Mandatory Approval Gatekeeper:
    Refuses to dispatch any email that does not have:
      1. Explicit status == 'Approved'
      2. Non-null approved_by user ID
      3. Absence from opt_out_suppression list
      4. Idempotency validation
    """
    db = database.get_database()
    draft = await db.emails.find_one({"_id": ObjectId(draft_id)})
    if not draft:
        raise ValueError(f"Draft with ID {draft_id} not found.")

    # 1. HARD ENFORCEMENT: Idempotency Protection
    if draft.get("status") == "Sent":
        return serialize_doc(draft)

    # 2. HARD ENFORCEMENT: Status check
    if draft.get("status") != "Approved":
        raise PermissionError(
            f"SECURITY VIOLATION: Refusing to dispatch email {draft_id}. "
            f"Current status is '{draft.get('status')}', but must be 'Approved'."
        )

    # 3. HARD ENFORCEMENT: Approver ID check
    approver_id = draft.get("approved_by") or approver_user.get("id")
    if not approver_id:
        raise PermissionError(
            f"SECURITY VIOLATION: Refusing to dispatch email {draft_id}. "
            "Missing mandatory human approver ID."
        )

    # Get lead details
    lead = await db.leads.find_one({"_id": ObjectId(draft["lead_id"])})
    if not lead:
        raise ValueError(f"Lead {draft['lead_id']} associated with draft not found.")

    recipient_email = lead["email"].strip().lower()

    # 3. HARD ENFORCEMENT: Opt-Out Suppression List Check
    is_suppressed = await db.opt_out_suppression.find_one({"email": recipient_email})
    if is_suppressed:
        await db.emails.update_one(
            {"_id": ObjectId(draft_id)},
            {"$set": {"status": "Failed", "error_message": "Blocked: Recipient is in the opt-out suppression list."}}
        )
        await db.leads.update_one(
            {"_id": ObjectId(lead["_id"])},
            {"$set": {"status": LeadStatus.OPTED_OUT.value, "updated_at": datetime.datetime.now(datetime.timezone.utc)}}
        )
        raise PermissionError(
            f"DISPATCH BLOCKED: Recipient '{recipient_email}' is on the opt-out suppression list."
        )

    # 4. HARD ENFORCEMENT: Idempotency Protection
    if draft.get("status") == "Sent":
        return serialize_doc(draft)

    # Append compliant unsubscribe footer
    body_with_optout = draft["body"].strip()
    if "unsubscribe" not in body_with_optout.lower():
        body_with_optout += UNSUBSCRIBE_FOOTER

    # 5. Dispatch via Zoho (or Dry-Run simulated dispatch)
    send_result = await send_email_via_zoho(
        recipient_email=recipient_email,
        subject=draft["subject"],
        body_text=body_with_optout,
        in_reply_to=draft.get("in_reply_to")
    )

    if not send_result.get("success"):
        err_msg = send_result.get("error", "Unknown Zoho delivery error")
        await db.emails.update_one(
            {"_id": ObjectId(draft_id)},
            {"$set": {"status": "Failed", "error_message": err_msg}}
        )
        raise RuntimeError(f"Delivery failed: {err_msg}")

    now = datetime.datetime.now(datetime.timezone.utc)
    message_id = send_result.get("message_id", f"<{uuid.uuid4().hex}@traininglobe.com>")
    zoho_msg_id = send_result.get("zoho_message_id")

    # Update email record
    await db.emails.update_one(
        {"_id": ObjectId(draft_id)},
        {
            "$set": {
                "status": "Sent",
                "message_id": message_id,
                "zoho_message_id": zoho_msg_id,
                "sent_at": now,
                "approved_by": str(approver_id),
                "approver_name": approver_user.get("name", "Admin")
            }
        }
    )

    # Lead lifecycle progression
    current_status = lead.get("status", LeadStatus.NEW_LEAD.value)
    new_status = current_status
    if current_status in [LeadStatus.NEW_LEAD.value, LeadStatus.DRAFT_READY.value]:
        new_status = LeadStatus.CONTACTED.value
    elif current_status == LeadStatus.FOLLOWUP_PENDING.value:
        new_status = LeadStatus.CONTACTED.value

    followup_count = lead.get("followup_count", 0) + 1
    # Schedule next follow-up window (default 3 days if not configured)
    next_action_at = now + datetime.timedelta(days=3)

    await db.leads.update_one(
        {"_id": ObjectId(lead["_id"])},
        {
            "$set": {
                "status": new_status,
                "followup_count": followup_count,
                "next_action_at": next_action_at,
                "updated_at": now
            }
        }
    )

    # Sync status change to Zoho CRM
    if lead.get("zoho_lead_id"):
        await update_zoho_lead_status(lead["zoho_lead_id"], new_status)

    # Audit log
    await log_audit_event(
        user=approver_user,
        action="DISPATCH_APPROVED_EMAIL",
        entity_type="EMAIL",
        entity_id=draft_id,
        details={
            "recipient": recipient_email,
            "subject": draft["subject"],
            "message_id": message_id,
            "lead_id": str(lead["_id"]),
            "new_lead_status": new_status
        }
    )

    updated_draft = await db.emails.find_one({"_id": ObjectId(draft_id)})
    return serialize_doc(updated_draft)
