from typing import Any, Dict, List
from fastapi import APIRouter, Depends, Query
from app.core.database import get_database, serialize_doc
from app.core.security import require_permission

router = APIRouter(prefix="/audit", tags=["Audit Logs"])


@router.get("", response_model=List[Dict[str, Any]])
async def list_audit_logs(
    limit: int = Query(100, le=500),
    current_user: Dict[str, Any] = Depends(require_permission("audit:read"))
):
    """
    List audit logs.
    Super Admin sees all logs organization-wide.
    Staff Admin ONLY sees entries related to leads assigned to them.
    """
    db = get_database()
    query = {}

    if current_user.get("role") != "SUPER_ADMIN":
        # Find leads assigned to this Staff Admin
        accessible_leads = await db.leads.find({"owner_id": current_user["id"]}, {"_id": 1}).to_list(1000)
        lead_ids = [str(l["_id"]) for l in accessible_leads]

        # Find associated emails
        emails = await db.emails.find({"lead_id": {"$in": lead_ids}}, {"_id": 1}).to_list(5000) if lead_ids else []
        email_ids = [str(e["_id"]) for e in emails]

        query = {
            "$or": [
                {"lead_id": {"$in": lead_ids}},
                {"details.lead_id": {"$in": lead_ids}},
                {"entity_type": "LEAD", "entity_id": {"$in": lead_ids}},
                {"entity_type": "EMAIL", "entity_id": {"$in": email_ids}},
                {"user_id": current_user["id"]},
            ]
        }

    cursor = db.audit_logs.find(query).sort("timestamp", -1).limit(limit)
    logs = await cursor.to_list(limit)
    results = []
    for l in logs:
        doc = serialize_doc(l)
        if "timestamp" in doc and "created_at" not in doc:
            doc["created_at"] = doc["timestamp"]
        results.append(doc)
    return results

