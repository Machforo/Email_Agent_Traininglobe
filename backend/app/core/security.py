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
        "users:manage",
    ],
    "ADMIN": [
        "dashboard:read",
        "leads:read",
        "approvals:read",
        "emails:read",
        "knowledge:read",
        "audit:read",
    ],
    "STAFF_ADMIN": [
        "dashboard:read",
        "leads:read",
        "approvals:read",
        "emails:read",
        "knowledge:read",
        "audit:read",
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
    role = user_dict.get("role", "ADMIN")
    user_dict["permissions"] = get_user_permissions(role)
    user_dict["is_read_only"] = is_role_read_only(role)
    return user_dict


def require_permission(required_perm: str):
    """
    Central Permission Enforcement Dependency.
    Checks the role & permissions from the verified JWT on every request.
    Enforces that Staff Admin (is_read_only=True) can only perform GET (read) actions.
    Every write attempt (POST/PUT/PATCH/DELETE) returns 403 with:
    'Read-only access: your role cannot perform this action' and is logged as ACCESS_DENIED.
    """
    async def permission_dependency(
        request: Request,
        current_user: Dict[str, Any] = Depends(get_current_user)
    ) -> Dict[str, Any]:
        user_perms = current_user.get("permissions", [])
        is_write = request.method in ["POST", "PUT", "PATCH", "DELETE"]
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
    Role-Based Query Filter:
    - Super Admin can query and access all records.
    - Staff Admin can ONLY query records assigned to them (owner_id == user.id).
    """
    if current_user.get("role") == "SUPER_ADMIN":
        return {}
    return {"owner_id": current_user["id"]}
