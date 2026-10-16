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
from app.services.ai_service import draft_first_email
from app.core.audit import log_audit_event

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

    # Find leads owned by current user (or all if super admin)
    accessible_leads = await db.leads.find(lead_scope, {"_id": 1, "name": 1, "email": 1, "company_name": 1, "company_website": 1}).to_list(500)
    lead_map = {str(l["_id"]): l for l in accessible_leads}

    if not lead_map:
        return []

    lead_ids = list(lead_map.keys())

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

        item = {
            "draft": serialize_doc(d),
            "lead_name": lead_info.get("name", "Unknown"),
            "lead_email": lead_info.get("email", ""),
            "company_name": lead_info.get("company_name", ""),
            "company_website": lead_info.get("company_website"),
            "research_summary": research_summary,
            "sources": sources,
            "thread_history": thread_history
        }
        queue_items.append(item)

    return queue_items


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
        try:
            sent_result = await send_approved_email(draft_id, current_user)
            return sent_result
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Email delivery error: {str(e)}")
    else:
        # Schedule for future delivery
        target_time = schedule_time or (now + datetime.timedelta(hours=2))
        await db.emails.update_one(
            {"_id": ObjectId(draft_id)},
            {
                "$set": {
                    "status": "Scheduled",
                    "approved_by": current_user["id"],
                    "approver_name": current_user["name"],
                    "approved_at": now,
                    "scheduled_for": target_time
                }
            }
        )
        await log_audit_event(
            user=current_user,
            action="SCHEDULE_EMAIL",
            entity_type="EMAIL",
            entity_id=draft_id,
            details={"scheduled_for": target_time.isoformat()}
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
            "confidence_score": 0.92,
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
    """Change scheduled delivery time."""
    db = get_database()
    draft = await db.emails.find_one({"_id": ObjectId(draft_id)})
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")

    await db.emails.update_one(
        {"_id": ObjectId(draft_id)},
        {"$set": {"scheduled_for": req.scheduled_for, "status": "Scheduled"}}
    )

    await log_audit_event(
        user=current_user,
        action="RESCHEDULE_EMAIL",
        entity_type="EMAIL",
        entity_id=draft_id,
        details={"new_scheduled_for": req.scheduled_for.isoformat()}
    )

    updated = await db.emails.find_one({"_id": ObjectId(draft_id)})
    return serialize_doc(updated)
