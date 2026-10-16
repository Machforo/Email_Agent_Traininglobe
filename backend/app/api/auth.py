import datetime
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException, status
from bson import ObjectId

from app.core.database import get_database, serialize_doc
from app.core.security import (
    create_access_token,
    get_current_user,
    get_user_permissions,
    hash_password,
    is_role_read_only,
    require_permission,
    require_super_admin,
    verify_password,
)
from app.models.user import LoginRequest, TokenResponse, UserCreate, UserResponse

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    db = get_database()
    email_clean = req.email.strip().lower()
    user = await db.users.find_one({"email": email_clean})

    if not user or not verify_password(req.password, user.get("password_hash", "")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    if not user.get("active", True):
        raise HTTPException(status_code=400, detail="Account is disabled")

    user_data = serialize_doc(user)
    role = user_data.get("role", "ADMIN")
    user_data["permissions"] = get_user_permissions(role)
    user_data["is_read_only"] = is_role_read_only(role)
    token = create_access_token(data={"sub": user_data["id"], "role": role})

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user_data
    }


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: Dict[str, Any] = Depends(get_current_user)):
    return current_user


@router.get("/users", response_model=List[UserResponse])
async def list_users(
    current_user: Dict[str, Any] = Depends(require_permission("users:manage"))
):
    """Super Admin only: List all team users."""
    db = get_database()
    users = await db.users.find().to_list(100)
    results = []
    for u in users:
        u_data = serialize_doc(u)
        u_role = u_data.get("role", "ADMIN")
        u_data["permissions"] = get_user_permissions(u_role)
        u_data["is_read_only"] = is_role_read_only(u_role)
        results.append(u_data)
    return results


@router.post("/users", response_model=UserResponse)
async def create_user(
    req: UserCreate,
    current_user: Dict[str, Any] = Depends(require_permission("users:manage"))
):
    """Super Admin only: Create an Admin or Super Admin user."""
    db = get_database()
    email_clean = req.email.strip().lower()

    existing = await db.users.find_one({"email": email_clean})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    doc = {
        "email": email_clean,
        "name": req.name.strip(),
        "password_hash": hash_password(req.password),
        "role": req.role if req.role in ["SUPER_ADMIN", "ADMIN"] else "ADMIN",
        "active": req.active,
        "created_at": datetime.datetime.now(datetime.timezone.utc)
    }
    res = await db.users.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)
