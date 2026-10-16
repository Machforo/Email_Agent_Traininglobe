import datetime
from typing import Any, Dict, Optional
from app.core.database import get_database


async def log_audit_event(
    user: Dict[str, Any],
    action: str,
    entity_type: str,
    entity_id: str,
    details: Optional[Dict[str, Any]] = None,
    lead_id: Optional[str] = None
):
    """
    Record an immutable audit log entry.
    Actions: APPROVE_EMAIL, REJECT_EMAIL, EDIT_DRAFT, RESCHEDULE_EMAIL, SYNC_ZOHO, CSV_IMPORT, OPT_OUT, ACCESS_DENIED
    """
    db = get_database()
    if db is None:
        return

    det = details or {}
    resolved_lead_id = lead_id or det.get("lead_id")
    if not resolved_lead_id and entity_type == "LEAD" and entity_id != "bulk":
        resolved_lead_id = str(entity_id)

    entry = {
        "user_id": user.get("id"),
        "user_name": user.get("name", "Unknown"),
        "user_email": user.get("email"),
        "action": action,
        "entity_type": entity_type,
        "entity_id": str(entity_id),
        "lead_id": resolved_lead_id,
        "details": det,
        "timestamp": datetime.datetime.now(datetime.timezone.utc)
    }
    await db.audit_logs.insert_one(entry)
