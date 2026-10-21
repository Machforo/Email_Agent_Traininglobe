from typing import Any, Dict, List
from fastapi import APIRouter, Depends, Query
from app.core.database import get_database, serialize_doc
from app.core.security import get_user_scope_filter, require_permission

router = APIRouter(prefix="/audit", tags=["Audit Logs"])


@router.get("", response_model=List[Dict[str, Any]])
async def list_audit_logs(
    limit: int = Query(100, le=500),
    current_user: Dict[str, Any] = Depends(require_permission("audit:read"))
):
    """
    List audit logs.
    Super Admin and Staff Admin have identical full read visibility across the compliance ledger.
    """
    db = get_database()
    query = get_user_scope_filter(current_user)

    cursor = db.audit_logs.find(query).sort("timestamp", -1).limit(limit)
    logs = await cursor.to_list(limit)
    results = []
    for l in logs:
        doc = serialize_doc(l)
        if "timestamp" in doc and "created_at" not in doc:
            doc["created_at"] = doc["timestamp"]
        results.append(doc)
    return results

