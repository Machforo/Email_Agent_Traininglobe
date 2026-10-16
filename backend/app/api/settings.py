import datetime
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException, status
from bson import ObjectId

from app.core.database import get_database, serialize_doc
from app.core.security import require_permission, require_super_admin
from app.models.settings import (
    KnowledgeBaseItemCreate,
    KnowledgeBaseItemResponse,
    SystemSettingsSchema,
)
from app.services.scheduler_service import get_system_settings
from app.core.audit import log_audit_event

router = APIRouter(prefix="/settings", tags=["Settings & Knowledge Base"])


@router.get("", response_model=SystemSettingsSchema)
async def get_settings(
    current_user: Dict[str, Any] = Depends(require_permission("settings:read"))
):
    """Retrieve global automation rules, sending limits, and business hours."""
    return await get_system_settings()


@router.put("", response_model=SystemSettingsSchema)
async def update_settings(
    req: SystemSettingsSchema,
    current_user: Dict[str, Any] = Depends(require_permission("settings:write"))
):
    """Super Admin only: Update sending schedules, business hours, and intervals."""
    db = get_database()
    settings_dict = req.model_dump()
    settings_dict["_id"] = "global_config"
    settings_dict["updated_at"] = datetime.datetime.now(datetime.timezone.utc)

    await db.system_settings.update_one(
        {"_id": "global_config"},
        {"$set": settings_dict},
        upsert=True
    )

    await log_audit_event(
        user=current_user,
        action="UPDATE_SYSTEM_SETTINGS",
        entity_type="SYSTEM",
        entity_id="global_config",
        details=req.model_dump()
    )

    return req


@router.get("/knowledge-base", response_model=List[KnowledgeBaseItemResponse])
async def list_knowledge_base(
    current_user: Dict[str, Any] = Depends(require_permission("knowledge:read"))
):
    """List all verified Traininglobe knowledge base claims and service details."""
    db = get_database()
    items = await db.knowledge_base.find().sort("category", 1).to_list(100)
    return [serialize_doc(i) for i in items]


@router.post("/knowledge-base", response_model=KnowledgeBaseItemResponse)
async def add_knowledge_base_item(
    req: KnowledgeBaseItemCreate,
    current_user: Dict[str, Any] = Depends(require_permission("knowledge:write"))
):
    """Super Admin only: Add verified Traininglobe claims or service guidelines."""
    db = get_database()
    doc = {
        "category": req.category.strip().upper(),
        "title": req.title.strip(),
        "content": req.content.strip(),
        "updated_at": datetime.datetime.now(datetime.timezone.utc)
    }
    res = await db.knowledge_base.insert_one(doc)
    doc["_id"] = res.inserted_id

    await log_audit_event(
        user=current_user,
        action="ADD_KNOWLEDGE_BASE_ITEM",
        entity_type="KNOWLEDGE_BASE",
        entity_id=str(res.inserted_id),
        details={"title": req.title, "category": req.category}
    )

    return serialize_doc(doc)


@router.delete("/knowledge-base/{item_id}")
async def delete_knowledge_base_item(
    item_id: str,
    current_user: Dict[str, Any] = Depends(require_permission("knowledge:write"))
):
    """Super Admin only: Remove an item from the knowledge base."""
    db = get_database()
    res = await db.knowledge_base.delete_one({"_id": ObjectId(item_id)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")

    await log_audit_event(
        user=current_user,
        action="DELETE_KNOWLEDGE_BASE_ITEM",
        entity_type="KNOWLEDGE_BASE",
        entity_id=item_id
    )
    return {"success": True, "message": "Knowledge base item deleted"}
