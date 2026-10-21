import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from bson import ObjectId

from app.core.database import get_database, serialize_doc
from app.core.security import require_permission, require_super_admin
from app.models.settings import (
    KnowledgeBaseItemCreate,
    KnowledgeBaseItemUpdate,
    KnowledgeBaseItemResponse,
    SystemSettingsSchema,
    EmailTemplateCreate,
    EmailTemplateUpdate,
    EmailTemplateResponse,
    TemplatePreviewRequest,
    TemplatePreviewResponse,
)
from app.services.scheduler_service import get_system_settings
from app.services.template_service import seed_templates_and_kb, render_template_string
from app.core.audit import log_audit_event

router = APIRouter(prefix="/settings", tags=["Settings & Knowledge Base"])


@router.get("", response_model=SystemSettingsSchema)
async def get_settings(
    current_user: Dict[str, Any] = Depends(require_permission("settings:read"))
):
    """Retrieve global automation rules, sending limits, sender profile, and business hours."""
    await seed_templates_and_kb()
    return await get_system_settings()


@router.put("", response_model=SystemSettingsSchema)
async def update_settings(
    req: SystemSettingsSchema,
    current_user: Dict[str, Any] = Depends(require_permission("settings:write"))
):
    """Super Admin only: Update sending schedules, sender details, and intervals."""
    db = get_database()
    settings_dict = req.model_dump()
    settings_dict["_id"] = "global_config"
    settings_dict["updated_at"] = datetime.datetime.now(datetime.timezone.utc)

    # Do not persist email_length
    settings_dict.pop("email_length", None)

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


# ==============================================================================
# KNOWLEDGE BASE CRUD & VERIFICATION
# ==============================================================================

@router.get("/knowledge-base", response_model=List[KnowledgeBaseItemResponse])
async def list_knowledge_base(
    current_user: Dict[str, Any] = Depends(require_permission("knowledge:read"))
):
    """List all Traininglobe knowledge base claims, status, and service details."""
    await seed_templates_and_kb()
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
    now = datetime.datetime.now(datetime.timezone.utc)
    doc = {
        "category": req.category.strip().upper(),
        "title": req.title.strip(),
        "content": req.content.strip(),
        "service_line": req.service_line or "Enterprise AI Workshops",
        "status": req.status or "Pending verification",
        "approved_for_outreach": req.approved_for_outreach,
        "region": req.region,
        "source": req.source,
        "updated_at": now
    }
    res = await db.knowledge_base.insert_one(doc)
    doc["_id"] = res.inserted_id

    await log_audit_event(
        user=current_user,
        action="ADD_KNOWLEDGE_BASE_ITEM",
        entity_type="KNOWLEDGE_BASE",
        entity_id=str(res.inserted_id),
        details={"title": req.title, "category": req.category, "status": doc["status"]}
    )

    return serialize_doc(doc)


@router.put("/knowledge-base/{item_id}", response_model=KnowledgeBaseItemResponse)
async def update_knowledge_base_item(
    item_id: str,
    req: KnowledgeBaseItemUpdate,
    current_user: Dict[str, Any] = Depends(require_permission("knowledge:write"))
):
    """Super Admin only: Edit fact or toggle status to 'Verified' / 'Pending verification'."""
    db = get_database()
    existing = await db.knowledge_base.find_one({"_id": ObjectId(item_id)})
    if not existing:
        raise HTTPException(status_code=404, detail="Knowledge base item not found")

    update_fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if not update_fields:
        return serialize_doc(existing)

    update_fields["updated_at"] = datetime.datetime.now(datetime.timezone.utc)
    if "category" in update_fields:
        update_fields["category"] = update_fields["category"].strip().upper()

    await db.knowledge_base.update_one(
        {"_id": ObjectId(item_id)},
        {"$set": update_fields}
    )

    await log_audit_event(
        user=current_user,
        action="UPDATE_KNOWLEDGE_BASE_ITEM",
        entity_type="KNOWLEDGE_BASE",
        entity_id=item_id,
        details=update_fields
    )

    updated = await db.knowledge_base.find_one({"_id": ObjectId(item_id)})
    return serialize_doc(updated)


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


# ==============================================================================
# EMAIL TEMPLATES LIBRARY (Super Admin edit, Staff Admin view-only)
# ==============================================================================

@router.get("/templates", response_model=List[EmailTemplateResponse])
async def list_templates(
    current_user: Dict[str, Any] = Depends(require_permission("knowledge:read"))
):
    """List all email templates in the Template Library."""
    await seed_templates_and_kb()
    db = get_database()
    items = await db.templates.find().sort([("kind", 1), ("stage", 1)]).to_list(100)
    return [serialize_doc(i) for i in items]


@router.put("/templates/{template_id}", response_model=EmailTemplateResponse)
async def update_template(
    template_id: str,
    req: EmailTemplateUpdate,
    current_user: Dict[str, Any] = Depends(require_permission("knowledge:write"))
):
    """Super Admin only: Edit template structure and placeholders."""
    db = get_database()
    existing = await db.templates.find_one({"_id": ObjectId(template_id)})
    if not existing:
        raise HTTPException(status_code=404, detail="Template not found")

    update_fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if not update_fields:
        return serialize_doc(existing)

    update_fields["updated_at"] = datetime.datetime.now(datetime.timezone.utc)
    await db.templates.update_one({"_id": ObjectId(template_id)}, {"$set": update_fields})

    await log_audit_event(
        user=current_user,
        action="UPDATE_EMAIL_TEMPLATE",
        entity_type="TEMPLATE",
        entity_id=template_id,
        details=update_fields
    )

    updated = await db.templates.find_one({"_id": ObjectId(template_id)})
    return serialize_doc(updated)


@router.post("/templates/preview", response_model=TemplatePreviewResponse)
async def preview_template(
    req: TemplatePreviewRequest,
    current_user: Dict[str, Any] = Depends(require_permission("knowledge:read", allow_read_only_post=True))
):
    """Render a live preview of an email template using sample lead data."""
    db = get_database()
    subj_tpl = req.subject_template or ""
    body_tpl = req.body_template or ""

    if req.template_id and (not subj_tpl or not body_tpl):
        tpl = await db.templates.find_one({"_id": ObjectId(req.template_id)})
        if tpl:
            subj_tpl = subj_tpl or tpl.get("subject_template", "")
            body_tpl = body_tpl or tpl.get("body_template", "")

    # Resolve settings for sender defaults
    cfg = await db.system_settings.find_one({"_id": "global_config"}) or {}
    sender_name = cfg.get("default_sender_name", "Pallabi Hansda")
    sender_desig = cfg.get("default_sender_designation", "Business Development Manager")
    company_legal = cfg.get("company_legal_name", "Traininglobe Consultancy Pvt. Ltd.")

    sample = req.sample_lead or {
        "lead_name": "Tamara Fayad",
        "company": "QIG",
        "industry": "Industrial & Financial Services",
        "company_paragraph": "With QIG continuing its digital transformation across its diversified industrial, technology, marine, property and financial-services portfolio, we see strong potential for practical AI capability building across its businesses.",
        "topics": "Generative AI & Enterprise Documentation Automation, Microsoft 365 Copilot, AI Strategy & Governance, Enterprise Data Science & Predictive AI, Agentic AI & Talent Enablement, and Executive Leadership Strategy",
        "impact": "Our practical workshops typically boost employee productivity by 10%-40% while delivering immediate business ROI and operational capability gains.",
        "reference_clients": "Our experience includes programs with QatarEnergy, Saudi Aramco helping organizations build practical enterprise AI capabilities.",
        "track_record_statement": "Across the GCC region, we have delivered 500+ corporate cohorts and upskilled 15,000+ professionals with a 98% satisfaction rating.",
        "reply_body": "Regarding your query on live simulation sandbox environments, all participants work in dedicated cloud sandboxes executing real prompts and workflow automation."
    }

    placeholders = {
        "lead_name": sample.get("lead_name", "Tamara Fayad"),
        "company": sample.get("company", "QIG"),
        "company_paragraph": sample.get("company_paragraph", ""),
        "topics": sample.get("topics", "Generative AI & Enterprise Documentation Automation, Microsoft 365 Copilot"),
        "impact": sample.get("impact", "Our practical workshops typically boost employee productivity by 10%-40%."),
        "reference_clients": sample.get("reference_clients", ""),
        "track_record_statement": sample.get("track_record_statement", ""),
        "reply_body": sample.get("reply_body", ""),
        "previous_subject": "Practical AI capability building for QIG",
        "sender_name": sender_name,
        "designation": sender_desig,
        "sender_designation": sender_desig,
        "company_legal_name": company_legal,
    }

    rendered_subj = render_template_string(subj_tpl, placeholders)
    rendered_body = render_template_string(body_tpl, placeholders)

    # Detect placeholders used
    used = [p for p in placeholders.keys() if f"{{{p}}}" in (subj_tpl + body_tpl)]

    return TemplatePreviewResponse(
        rendered_subject=rendered_subj,
        rendered_body=rendered_body,
        word_count=len(rendered_body.split()),
        used_placeholders=used
    )
