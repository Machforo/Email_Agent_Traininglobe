from typing import Any, Dict
from fastapi import APIRouter, Depends
from bson import ObjectId

from app.core.database import get_database
from app.core.security import get_user_scope_filter, require_permission
from app.models.lead import LeadStatus

router = APIRouter(prefix="/reports", tags=["Reports & Analytics"])


@router.get("/metrics")
async def get_dashboard_metrics(
    current_user: Dict[str, Any] = Depends(require_permission("dashboard:read"))
) -> Dict[str, Any]:
    """
    Get aggregated dashboard performance metrics and funnel breakdown.
    RBAC: Super Admin gets org-wide stats; Admin gets assigned stats.
    """
    db = get_database()
    scope = get_user_scope_filter(current_user)

    # 1. Total and Status Funnel
    total_leads = await db.leads.count_documents(scope)

    status_counts = {}
    for status_enum in LeadStatus:
        query = dict(scope)
        query["status"] = status_enum.value
        status_counts[status_enum.value] = await db.leads.count_documents(query)

    # 2. Email metrics for accessible leads
    leads_cursor = db.leads.find(scope, {"_id": 1})
    lead_ids = [str(l["_id"]) async for l in leads_cursor]

    total_emails_sent = await db.emails.count_documents({"lead_id": {"$in": lead_ids}, "status": "Sent"})
    total_delivered = await db.emails.count_documents({"lead_id": {"$in": lead_ids}, "status": {"$in": ["Sent", "Delivered"]}})
    total_bounced = await db.emails.count_documents({"lead_id": {"$in": lead_ids}, "status": "Bounced"})
    total_pending_approval = await db.emails.count_documents({"lead_id": {"$in": lead_ids}, "status": "Draft Ready"})
    total_scheduled = await db.emails.count_documents({"lead_id": {"$in": lead_ids}, "status": "Scheduled"})

    # 3. Inbound replies & Intent distribution
    replies_cursor = db.emails.find({"lead_id": {"$in": lead_ids}, "direction": "INBOUND"})
    intent_distribution = {}
    total_replies = 0

    async for rep in replies_cursor:
        total_replies += 1
        intent = rep.get("detected_intent", "Unclassified")
        intent_distribution[intent] = intent_distribution.get(intent, 0) + 1

    # 4. Rates
    reply_rate = round((total_replies / total_emails_sent * 100), 1) if total_emails_sent > 0 else 0.0
    converted_count = status_counts.get(LeadStatus.CONVERTED.value, 0)
    conversion_rate = round((converted_count / total_leads * 100), 1) if total_leads > 0 else 0.0

    return {
        "overview": {
            "total_leads": total_leads,
            "emails_sent": total_emails_sent,
            "total_replies": total_replies,
            "reply_rate_percent": reply_rate,
            "conversion_rate_percent": conversion_rate,
            "pending_approvals": total_pending_approval,
            "scheduled_deliveries": total_scheduled,
            "bounced_emails": total_bounced
        },
        "funnel": status_counts,
        "intent_distribution": intent_distribution
    }
