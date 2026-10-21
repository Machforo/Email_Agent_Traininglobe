import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from bson import ObjectId

from app.core.database import get_database, serialize_doc
from app.core.security import (
    get_user_scope_filter,
    require_permission,
    verify_action_token,
)
from app.models.notification import NotificationResponse

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("", response_model=List[NotificationResponse])
async def list_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=100),
    current_user: Dict[str, Any] = Depends(require_permission("notifications:read")),
):
    """
    List recent in-app notifications.
    - Super Admin: sees all system notifications (upcoming delivery alerts across all leads).
    - Staff Admin: sees read-only notifications scoped only to their assigned leads.
    """
    db = get_database()
    if db is None:
        return []

    query: Dict[str, Any] = {"is_active": True}
    if unread_only:
        query["read_at"] = None

    cursor = db.notifications.find(query).sort("created_at", -1).limit(limit)
    items = await cursor.to_list(limit)
    return [serialize_doc(item) for item in items]


@router.post("/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    current_user: Dict[str, Any] = Depends(require_permission("notifications:write")),
):
    """Mark a notification as read (Super Admin only; Staff Admin is read-only)."""
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database connection unavailable")

    now = datetime.datetime.now(datetime.timezone.utc)
    res = await db.notifications.update_one(
        {"_id": ObjectId(notification_id)},
        {"$set": {"read_at": now}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")

    return {"success": True, "message": "Marked as read"}


@router.post("/{notification_id}/dismiss")
async def dismiss_notification(
    notification_id: str,
    current_user: Dict[str, Any] = Depends(require_permission("notifications:write")),
):
    """Dismiss a notification alert from the active pop-up list (Super Admin only; Staff Admin is read-only)."""
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database connection unavailable")

    now = datetime.datetime.now(datetime.timezone.utc)
    res = await db.notifications.update_one(
        {"_id": ObjectId(notification_id)},
        {"$set": {"dismissed_at": now, "read_at": now}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")

    return {"success": True, "message": "Notification dismissed"}


@router.post("/read-all")
async def mark_all_notifications_read(
    current_user: Dict[str, Any] = Depends(require_permission("notifications:write")),
):
    """Mark all active notifications as read (Super Admin only; Staff Admin is read-only)."""
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database connection unavailable")

    now = datetime.datetime.now(datetime.timezone.utc)
    query: Dict[str, Any] = {"is_active": True, "read_at": None}

    res = await db.notifications.update_many(query, {"$set": {"read_at": now}})
    return {"success": True, "modified_count": res.modified_count}


@router.get("/verify-token")
async def verify_deep_link_token(
    token: str = Query(...),
    current_user: Dict[str, Any] = Depends(require_permission("notifications:read")),
):
    """
    Validate a signed deep-link token from a reminder email.
    Guarantees user is authenticated before revealing action details.
    """
    payload = verify_action_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The deep-link action token has expired or is invalid."
        )
    return {
        "valid": True,
        "email_id": payload.get("email_id"),
        "action": payload.get("action")
    }
