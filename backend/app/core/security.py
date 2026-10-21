import datetime
from typing import Any, Dict, Optional
import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from bson import ObjectId

from app.core.config import settings
from app.core.database import get_database, serialize_doc
from app.core.audit import log_audit_event

security_scheme = HTTPBearer()

PERMISSIONS_MAP = {
    "SUPER_ADMIN": [
        "dashboard:read",
        "leads:read",
        "leads:write",
        "approvals:read",
        "approvals:write",
        "emails:read",
        "emails:write",
        "knowledge:read",
        "knowledge:write",
        "settings:read",
        "settings:write",
        "audit:read",
        "users:read",
        "users:manage",
        "notifications:read",
        "notifications:write",
    ],
    "ADMIN": [
        "dashboard:read",
        "leads:read",
        "approvals:read",
        "emails:read",
        "knowledge:read",
        "settings:read",
        "audit:read",
        "users:read",
        "notifications:read",
    ],
    "STAFF_ADMIN": [
        "dashboard:read",
        "leads:read",
        "approvals:read",
        "emails:read",
        "knowledge:read",
        "settings:read",
        "audit:read",
        "users:read",
        "notifications:read",
    ],
}


def get_user_permissions(role: Optional[str]) -> list[str]:
    return PERMISSIONS_MAP.get(role or "ADMIN", PERMISSIONS_MAP["ADMIN"])


def is_role_read_only(role: Optional[str]) -> bool:
    return (role or "").upper() != "SUPER_ADMIN"


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False


def create_access_token(data: Dict[str, Any], expires_delta: Optional[datetime.timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.datetime.now(datetime.timezone.utc) + expires_delta
    else:
        expire = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security_scheme)) -> Dict[str, Any]:
    token = credentials.credentials
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except Exception:
        raise credentials_exception

    db = get_database()
    try:
        user = await db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        user = None

    if user is None:
        raise credentials_exception
    if not user.get("active", True):
        raise HTTPException(status_code=400, detail="Inactive user account")

    user_dict = serialize_doc(user)
    # Guarantee password hash is never exposed
    user_dict.pop("password_hash", None)
    role = user_dict.get("role", "ADMIN")
    user_dict["permissions"] = get_user_permissions(role)
    user_dict["is_read_only"] = is_role_read_only(role)
    return user_dict


def require_permission(required_perm: str, allow_read_only_post: bool = False):
    """
    Central Permission Enforcement Dependency.
    Checks the role & permissions from the verified JWT on every request.
    Enforces that Staff Admin (is_read_only=True) can only perform GET (read) actions,
    unless allow_read_only_post=True for read-like POST endpoints (such as preview generation).
    Every unauthorized write attempt returns 403.
    """
    async def permission_dependency(
        request: Request,
        current_user: Dict[str, Any] = Depends(get_current_user)
    ) -> Dict[str, Any]:
        user_perms = current_user.get("permissions", [])
        is_write = request.method in ["POST", "PUT", "PATCH", "DELETE"]
        if allow_read_only_post and request.method == "POST":
            is_write = False
        is_read_only = current_user.get("is_read_only", False)

        if (is_read_only and is_write) or (required_perm not in user_perms):
            await log_audit_event(
                user=current_user,
                action="ACCESS_DENIED",
                entity_type="ENDPOINT",
                entity_id=request.url.path,
                details={
                    "method": request.method,
                    "endpoint": request.url.path,
                    "required_permission": required_perm,
                    "user_role": current_user.get("role")
                }
            )
            detail_msg = (
                "Read-only access: your role cannot perform this action"
                if (is_write or is_read_only)
                else "Permission denied"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=detail_msg
            )
        return current_user

    return permission_dependency


async def require_super_admin(
    request: Request,
    current_user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    if current_user.get("role") != "SUPER_ADMIN":
        is_write = request.method in ["POST", "PUT", "PATCH", "DELETE"]
        await log_audit_event(
            user=current_user,
            action="ACCESS_DENIED",
            entity_type="ENDPOINT",
            entity_id=request.url.path,
            details={
                "method": request.method,
                "endpoint": request.url.path,
                "required_role": "SUPER_ADMIN",
                "user_role": current_user.get("role")
            }
        )
        detail_msg = (
            "Read-only access: your role cannot perform this action"
            if (is_write or current_user.get("is_read_only"))
            else "Super Admin privileges required"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail_msg
        )
    return current_user


def get_user_scope_filter(current_user: Dict[str, Any]) -> Dict[str, Any]:
    """
    Central Role-Based Read Scoping Helper:
    - Super Admin can query and access all records org-wide.
    - Staff Admin (Staff Rep) is a full READ-ONLY MIRROR of Super Admin,
      with identical visibility across all pages and endpoints.
    - Returns {} so every read endpoint retrieves the complete dataset.
    - Explicit narrowing (such as 'My Leads' toggle or 'Owner' filter) is
      handled via dedicated query parameters on endpoints rather than hard scoping.
    """
    return {}


def create_action_token(email_id: str, action: str, expires_in_minutes: int = 2880) -> str:
    """Create a signed, expiring token for reminder email deep-linking."""
    expire = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=expires_in_minutes)
    payload = {
        "email_id": email_id,
        "action": action,
        "exp": expire,
        "iat": datetime.datetime.now(datetime.timezone.utc),
        "purpose": "scheduled_reminder_action"
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def verify_action_token(token: str) -> Optional[Dict[str, Any]]:
    """Verify signed action token. Returns payload or None if invalid/expired."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        if payload.get("purpose") != "scheduled_reminder_action":
            return None
        return payload
    except Exception:
        return None
