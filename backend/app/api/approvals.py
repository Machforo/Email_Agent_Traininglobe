import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from bson import ObjectId

from app.core.database import get_database, serialize_doc
from app.core.security import get_user_scope_filter, require_permission
from app.models.email import (
    ApprovalQueueItem,
    DraftEditRequest,
    DraftRejectRequest,
    DraftRescheduleRequest,
    EmailResponse,
)
from app.services.delivery_service import send_approved_email
from app.services.ai_service import draft_first_email, draft_followup_email, draft_reply_email, generate_first_outreach_mock
from app.core.audit import log_audit_event
from app.services.reminder_service import (
    compute_reminder_at,
    cancel_pending_reminder,
    get_system_settings_dict,
)

router = APIRouter(prefix="/approvals", tags=["Approval Queue"])


@router.get("", response_model=List[ApprovalQueueItem])
async def get_approval_queue(
    current_user: Dict[str, Any] = Depends(require_permission("approvals:read"))
):
    """
    Fetch all email drafts currently awaiting human approval.
    Enforces RBAC: Admins only view drafts for their assigned leads.
    """
    db = get_database()
    lead_scope = get_user_scope_filter(current_user)

    # Find leads accessible via central scoping helper (all leads for both Super Admin and Staff Admin)
    accessible_leads = await db.leads.find(
        lead_scope,
        {"_id": 1, "name": 1, "email": 1, "company_name": 1, "company_website": 1, "owner_id": 1}
    ).to_list(500)
    lead_map = {str(l["_id"]): l for l in accessible_leads}

    if not lead_map:
        return []

    lead_ids = list(lead_map.keys())

    # Resolve owner names from users collection
    user_docs = await db.users.find({}, {"_id": 1, "name": 1}).to_list(200)
    user_name_map = {str(u["_id"]): u.get("name", "Unknown") for u in user_docs}

    # Find drafts in Draft Ready status
    drafts_cursor = db.emails.find({
        "lead_id": {"$in": lead_ids},
        "status": "Draft Ready"
    }).sort("created_at", -1)
    drafts = await drafts_cursor.to_list(100)

    queue_items = []
    for d in drafts:
        lead_id = d["lead_id"]
        lead_info = lead_map.get(lead_id, {})

        # Fetch company research
        research = await db.company_research.find_one({"lead_id": lead_id})
        research_summary = research.get("summary") if research else "No research summary available"
        sources = research.get("sources", []) if research else []

        # Fetch thread history
        thread_emails_cursor = db.emails.find({"lead_id": lead_id, "status": {"$ne": "Draft Ready"}}).sort("created_at", 1)
        thread_history = [serialize_doc(m) async for m in thread_emails_cursor]

        owner_id_val = str(lead_info.get("owner_id") or "")
        owner_name_val = user_name_map.get(owner_id_val, "Unassigned")
        approver_id_val = str(d.get("approved_by") or "")
        approver_name_val = d.get("approver_name") or user_name_map.get(approver_id_val)

        item = {
            "draft": serialize_doc(d),
            "lead_name": lead_info.get("name", "Unknown"),
            "lead_email": lead_info.get("email", ""),
            "company_name": lead_info.get("company_name", ""),
            "company_website": lead_info.get("company_website"),
            "owner_id": owner_id_val or None,
            "owner_name": owner_name_val,
            "approved_by": approver_id_val or None,
            "approver_name": approver_name_val,
            "research_summary": research_summary,
            "sources": sources,
            "thread_history": thread_history
        }
        queue_items.append(item)

    return queue_items


@router.post("/cancel-all-overdue")
async def cancel_all_overdue(
    current_user: Dict[str, Any] = Depends(require_permission("approvals:write"))
):
    """
    Super Admin only: Cancel all overdue scheduled deliveries.
    Moves overdue items from 'Scheduled' to 'Rejected' with audit trail.
    """
    if current_user.get("role") != "SUPER_ADMIN":
        raise HTTPException(status_code=403, detail="Super Admin role required to cancel all overdue emails")

    db = get_database()
    now = datetime.datetime.now(datetime.timezone.utc)

    # Find overdue scheduled emails (scheduled_for in the past)
    overdue_emails = await db.emails.find({
        "status": "Scheduled",
        "scheduled_for": {"$lt": now}
    }).to_list(300)

    cancelled_ids = []
    for item in overdue_emails:
        item_id = item["_id"]
        await db.emails.update_one(
            {"_id": item_id},
            {
                "$set": {
                    "status": "Rejected",
                    "rejection_reason": "Cancelled all overdue by Super Admin",
                    "updated_at": now
                }
            }
        )
        await cancel_pending_reminder(str(item_id), reason="cancelled_overdue")
        cancelled_ids.append(str(item_id))

    await log_audit_event(
        user=current_user,
        action="CANCEL_ALL_OVERDUE_EMAILS",
        entity_type="EMAIL_BATCH",
        entity_id="overdue_batch",
        details={
            "count": len(cancelled_ids),
            "cancelled_ids": cancelled_ids
        }
    )

    return {
        "success": True,
        "cancelled_count": len(cancelled_ids),
        "cancelled_ids": cancelled_ids,
        "message": f"Successfully cancelled {len(cancelled_ids)} overdue scheduled deliveries."
    }


@router.post("/{draft_id}/approve", response_model=EmailResponse)
async def approve_draft(
    draft_id: str,
    send_now: bool = Query(True),
    schedule_time: Optional[datetime.datetime] = None,
    current_user: Dict[str, Any] = Depends(require_permission("approvals:write"))
):
    """
    Mandatory Approval Action:
    Admin explicitly approves the draft. Can dispatch immediately or schedule.
    """
    db = get_database()
    draft = await db.emails.find_one({"_id": ObjectId(draft_id)})
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")

    # Scope check for regular Admin
    if current_user.get("role") != "SUPER_ADMIN":
        lead = await db.leads.find_one({"_id": ObjectId(draft["lead_id"])})
        if not lead or lead.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized to approve this lead's draft")

    # Hard guard: Never approve a draft with an empty body
    if not draft.get("body") or not draft.get("body").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot approve a draft with an empty body. Please edit or regenerate the draft content first."
        )

    # Disallow direct Send Now on already scheduled emails
    if draft.get("status") == "Scheduled" and send_now:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Direct 'Send Now' is disabled for scheduled deliveries. Scheduled emails are automatically dispatched at their scheduled time."
        )

    now = datetime.datetime.now(datetime.timezone.utc)

    if send_now:
        # Mark as approved with mandatory approver attribution
        await db.emails.update_one(
            {"_id": ObjectId(draft_id)},
            {
                "$set": {
                    "status": "Approved",
                    "approved_by": current_user["id"],
                    "approver_name": current_user["name"],
                    "approved_at": now
                }
            }
        )
        # Dispatch immediately through the delivery gatekeeper
        await cancel_pending_reminder(draft_id, reason="sent_now")
        try:
            sent_result = await send_approved_email(draft_id, current_user)
            return sent_result
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Email delivery error: {str(e)}")
    else:
        # Schedule for future delivery
        target_time = schedule_time or (now + datetime.timedelta(hours=2))
        config = await get_system_settings_dict()
        reminder_at, reminder_status = compute_reminder_at(
            target_time,
            lead_minutes=config.get("reminder_lead_minutes", 30),
            send_immediately_if_due=config.get("reminder_send_immediately_if_due", True)
        )
        await db.emails.update_one(
            {"_id": ObjectId(draft_id)},
            {
                "$set": {
                    "status": "Scheduled",
                    "approved_by": current_user["id"],
                    "approver_name": current_user["name"],
                    "approved_at": now,
                    "scheduled_for": target_time,
                    "reminder_at": reminder_at,
                    "reminder_status": reminder_status,
                    "reminder_sent_at": None,
                    "reminder_retry_count": 0,
                    "reminder_error": None
                }
            }
        )
        await log_audit_event(
            user=current_user,
            action="SCHEDULE_EMAIL",
            entity_type="EMAIL",
            entity_id=draft_id,
            details={
                "scheduled_for": target_time.isoformat(),
                "reminder_at": reminder_at.isoformat() if reminder_at else None,
                "reminder_status": reminder_status
            }
        )
        updated = await db.emails.find_one({"_id": ObjectId(draft_id)})
        return serialize_doc(updated)


@router.post("/{draft_id}/edit", response_model=EmailResponse)
async def edit_draft(
    draft_id: str,
    req: DraftEditRequest,
    current_user: Dict[str, Any] = Depends(require_permission("approvals:write"))
):
    """Admin edits draft content before or during approval."""
    db = get_database()
    draft = await db.emails.find_one({"_id": ObjectId(draft_id)})
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")

    old_subject = draft.get("subject", "")
    old_body = draft.get("body", "")

    if not req.body.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Draft body cannot be empty.")

    updates = {
        "subject": req.subject.strip(),
        "body": req.body.strip(),
    }

    await db.emails.update_one({"_id": ObjectId(draft_id)}, {"$set": updates})

    await log_audit_event(
        user=current_user,
        action="EDIT_DRAFT",
        entity_type="EMAIL",
        entity_id=draft_id,
        details={
            "old_subject": old_subject,
            "new_subject": req.subject.strip(),
            "body_edited": old_body != req.body.strip()
        }
    )

    if req.approve_now:
        return await approve_draft(
            draft_id=draft_id,
            send_now=True,
            current_user=current_user
        )

    updated = await db.emails.find_one({"_id": ObjectId(draft_id)})
    return serialize_doc(updated)


@router.post("/{draft_id}/reject", response_model=EmailResponse)
async def reject_draft(
    draft_id: str,
    req: DraftRejectRequest,
    current_user: Dict[str, Any] = Depends(require_permission("approvals:write"))
):
    """Admin rejects draft with reason; optionally regenerates with feedback."""
    db = get_database()
    draft = await db.emails.find_one({"_id": ObjectId(draft_id)})
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")

    now = datetime.datetime.now(datetime.timezone.utc)
    await cancel_pending_reminder(draft_id, reason="rejected_cancelled")

    await db.emails.update_one(
        {"_id": ObjectId(draft_id)},
        {
            "$set": {
                "status": "Rejected",
                "rejection_reason": req.reason,
                "updated_at": now
            }
        }
    )

    await log_audit_event(
        user=current_user,
        action="REJECT_DRAFT",
        entity_type="EMAIL",
        entity_id=draft_id,
        details={"reason": req.reason, "regenerate": req.regenerate}
    )

    if req.regenerate:
        # Trigger regeneration taking feedback into consideration
        lead = await db.leads.find_one({"_id": ObjectId(draft["lead_id"])})
        research = await db.company_research.find_one({"lead_id": draft["lead_id"]}) or {}
        new_draft_content = await draft_first_email(lead or {}, research)

        new_draft_doc = {
            "lead_id": draft["lead_id"],
            "thread_id": draft.get("thread_id", draft["lead_id"]),
            "message_id": None,
            "in_reply_to": None,
            "references": [],
            "direction": "OUTBOUND",
            "kind": draft.get("kind", "FIRST_TOUCH"),
            "stage": draft.get("stage", 0),
            "status": "Draft Ready",
            "subject": new_draft_content["subject"],
            "body": new_draft_content["body"],
            "confidence_score": new_draft_content.get("confidence_score", 0.92),
            "flagged_for_review": new_draft_content.get("flagged_for_review", False),
            "review_reason": new_draft_content.get("review_reason"),
            "service_line": new_draft_content.get("service_line"),
            "rejection_reason": None,
            "created_at": now
        }
        res = await db.emails.insert_one(new_draft_doc)
        new_draft_doc["_id"] = res.inserted_id
        return serialize_doc(new_draft_doc)

    updated = await db.emails.find_one({"_id": ObjectId(draft_id)})
    return serialize_doc(updated)


@router.post("/{draft_id}/reschedule", response_model=EmailResponse)
async def reschedule_draft(
    draft_id: str,
    req: DraftRescheduleRequest,
    current_user: Dict[str, Any] = Depends(require_permission("approvals:write"))
):
    """Change scheduled delivery time and recompute reminder."""
    db = get_database()
    draft = await db.emails.find_one({"_id": ObjectId(draft_id)})
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")

    config = await get_system_settings_dict()
    reminder_at, reminder_status = compute_reminder_at(
        req.scheduled_for,
        lead_minutes=config.get("reminder_lead_minutes", 30),
        send_immediately_if_due=config.get("reminder_send_immediately_if_due", True)
    )

    now = datetime.datetime.now(datetime.timezone.utc)
    try:
        draft_oid = ObjectId(draft_id)
        match_ids = [str(draft_id), draft_oid]
    except Exception:
        match_ids = [str(draft_id)]

    await db.notifications.update_many(
        {"scheduled_email_id": {"$in": match_ids}},
        {"$set": {"is_active": False, "dismissed_at": now}}
    )

    await db.emails.update_one(
        {"_id": ObjectId(draft_id)},
        {
            "$set": {
                "scheduled_for": req.scheduled_for,
                "status": "Scheduled",
                "reminder_at": reminder_at,
                "reminder_status": reminder_status,
                "reminder_sent_at": None,
                "reminder_retry_count": 0,
                "reminder_error": None
            }
        }
    )

    await log_audit_event(
        user=current_user,
        action="RESCHEDULE_EMAIL",
        entity_type="EMAIL",
        entity_id=draft_id,
        details={
            "new_scheduled_for": req.scheduled_for.isoformat(),
            "new_reminder_at": reminder_at.isoformat() if reminder_at else None,
            "reminder_status": reminder_status
        }
    )

    updated = await db.emails.find_one({"_id": ObjectId(draft_id)})
    return serialize_doc(updated)


@router.post("/{draft_id}/send-now")
async def scheduled_send_now_disabled(draft_id: str):
    """
    Direct Send Now on scheduled emails is permanently removed.
    Scheduled emails are automatically dispatched by the background worker at their scheduled time.
    """
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Direct 'Send Now' is disabled for scheduled deliveries. Scheduled emails are automatically dispatched at their scheduled time."
    )




