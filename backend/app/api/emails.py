import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from bson import ObjectId

from app.core.database import get_database, serialize_doc
from app.core.security import get_user_scope_filter, require_permission
from app.models.email import EmailResponse, InboundEmailWebhook
from app.models.lead import LeadStatus
from app.services.ai_service import classify_reply_intent, draft_followup_email
from app.services.zoho_service import update_zoho_lead_status
from app.core.audit import log_audit_event

router = APIRouter(prefix="/emails", tags=["Emails & Threads"])


@router.get("/thread/{lead_id}", response_model=List[EmailResponse])
async def get_lead_thread(
    lead_id: str,
    current_user: Dict[str, Any] = Depends(require_permission("emails:read"))
):
    """Retrieve complete chronological conversation history for a lead."""
    db = get_database()
    scope = get_user_scope_filter(current_user)
    scope["_id"] = ObjectId(lead_id)

    lead = await db.leads.find_one(scope)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found or access denied")

    cursor = db.emails.find({"lead_id": lead_id}).sort("created_at", 1)
    emails = await cursor.to_list(100)
    return [serialize_doc(e) for e in emails]


@router.get("/scheduled", response_model=List[EmailResponse])
async def list_scheduled_emails(
    current_user: Dict[str, Any] = Depends(require_permission("emails:read"))
):
    """List all approved emails queued for future delivery."""
    db = get_database()
    lead_scope = get_user_scope_filter(current_user)

    accessible_leads = await db.leads.find(lead_scope, {"_id": 1}).to_list(500)
    lead_ids = [str(l["_id"]) for l in accessible_leads]

    cursor = db.emails.find({
        "lead_id": {"$in": lead_ids},
        "status": "Scheduled"
    }).sort("scheduled_for", 1)

    scheduled = await cursor.to_list(100)
    return [serialize_doc(s) for s in scheduled]


@router.post("/inbound/webhook")
async def handle_inbound_reply(
    payload: InboundEmailWebhook,
    current_user: Dict[str, Any] = Depends(require_permission("emails:write"))
):
    """
    Inbound reply handler / webhook:
    Matches reply to the correct lead and email thread, classifies intent,
    updates lead lifecycle, and generates next draft for mandatory approval.
    """
    db = get_database()
    sender_email = payload.from_email.strip().lower()

    # Thread matching strategy:
    # 1. Match by In-Reply-To or References matching prior Message-ID
    matched_prior_email = None
    if payload.in_reply_to:
        matched_prior_email = await db.emails.find_one({"message_id": payload.in_reply_to})
    if not matched_prior_email and payload.references:
        ref_tokens = payload.references.split()
        matched_prior_email = await db.emails.find_one({"message_id": {"$in": ref_tokens}})

    # 2. Fallback to matching by sender email
    if matched_prior_email:
        lead = await db.leads.find_one({"_id": ObjectId(matched_prior_email["lead_id"])})
        thread_id = matched_prior_email.get("thread_id", str(matched_prior_email["_id"]))
    else:
        lead = await db.leads.find_one({"email": sender_email})
        thread_id = payload.message_id

    if not lead:
        return {"success": False, "message": f"No lead found for sender {sender_email}"}

    lead_id = str(lead["_id"])
    now = datetime.datetime.now(datetime.timezone.utc)

    content_text = payload.body_text or payload.body or ""

    # 3. Classify reply intent
    intent_data = await classify_reply_intent(content_text)
    detected_intent = intent_data.get("intent", "Asks a question")
    confidence = intent_data.get("confidence", 0.85)
    preferred_date = intent_data.get("preferred_contact_date")

    # Record the incoming message in conversation history
    inbound_doc = {
        "lead_id": lead_id,
        "thread_id": thread_id,
        "message_id": payload.message_id,
        "in_reply_to": payload.in_reply_to,
        "references": payload.references.split() if payload.references else [],
        "direction": "INBOUND",
        "kind": "REPLY",
        "stage": lead.get("followup_count", 1),
        "status": "Delivered",
        "subject": payload.subject,
        "body": content_text,
        "confidence_score": confidence,
        "detected_intent": detected_intent,
        "created_at": now
    }
    await db.emails.insert_one(inbound_doc)

    # 4. Handle lifecycle transitions and opt-outs
    new_lead_status = lead.get("status")

    if detected_intent == "Not interested / asks to stop":
        new_lead_status = LeadStatus.OPTED_OUT.value
        # Add to opt-out suppression collection
        await db.opt_out_suppression.update_one(
            {"email": sender_email},
            {"$set": {"email": sender_email, "reason": "PROSPECT_UNSUBSCRIBE", "created_at": now}},
            upsert=True
        )
    elif detected_intent == "Agrees to collaborate":
        new_lead_status = LeadStatus.QUALIFIED.value
    elif detected_intent == "Contact me later" and preferred_date:
        new_lead_status = LeadStatus.FOLLOWUP_PENDING.value
        await db.leads.update_one(
            {"_id": lead["_id"]},
            {"$set": {"preferred_contact_date": preferred_date}}
        )
    else:
        new_lead_status = LeadStatus.ENGAGED.value

    # Update lead status
    await db.leads.update_one(
        {"_id": lead["_id"]},
        {"$set": {"status": new_lead_status, "updated_at": now}}
    )

    if lead.get("zoho_lead_id"):
        await update_zoho_lead_status(lead["zoho_lead_id"], new_lead_status)

    # 5. Draft next response (if not opted out)
    if new_lead_status != LeadStatus.OPTED_OUT.value:
        next_subject = payload.subject if payload.subject.lower().startswith("re:") else f"Re: {payload.subject}"
        next_body = (
            f"Hi {lead['name'].split()[0]},\n\n"
            f"Thank you for getting back to me regarding {detected_intent.lower()}.\n\n"
            f"We would be delighted to coordinate next steps. Would you have 15 minutes open later this week?\n\n"
            f"Best regards,\nTraininglobe Outreach Team"
        )

        next_draft_doc = {
            "lead_id": lead_id,
            "thread_id": thread_id,
            "message_id": None,
            "in_reply_to": payload.message_id,
            "references": [payload.message_id],
            "direction": "OUTBOUND",
            "kind": "REPLY",
            "stage": lead.get("followup_count", 0),
            "status": "Draft Ready",  # Mandatory human approval!
            "subject": next_subject,
            "body": next_body,
            "confidence_score": confidence,
            "detected_intent": detected_intent,
            "approved_by": None,
            "approved_at": None,
            "created_at": now
        }
        await db.emails.insert_one(next_draft_doc)

    return {
        "success": True,
        "matched_lead_id": lead_id,
        "detected_intent": detected_intent,
        "confidence": confidence,
        "new_lead_status": new_lead_status
    }
