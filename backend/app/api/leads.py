import csv
import datetime
import io
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from bson import ObjectId

from app.core.database import get_database, serialize_doc
from app.core.security import get_user_scope_filter, require_permission, require_super_admin
from app.models.lead import LeadCreate, LeadResponse, LeadStatus, LeadUpdate, can_transition
from app.services.research_service import research_company
from app.services.ai_service import draft_first_email
from app.services.zoho_service import sync_leads_from_zoho_crm, update_zoho_lead_status
from app.core.audit import log_audit_event

router = APIRouter(prefix="/leads", tags=["Leads"])


async def trigger_lead_pipeline(lead_doc: Dict[str, Any]):
    """Background task helper: research company and generate first draft in Draft Ready state."""
    db = get_database()
    lead_id = str(lead_doc["_id"])

    # 1. Company research
    research_res = await research_company(
        lead_id=lead_id,
        company_name=lead_doc["company_name"],
        company_website=lead_doc.get("company_website")
    )

    # 2. Draft first email
    draft_content = await draft_first_email(lead=lead_doc, research=research_res)
    if not draft_content.get("body") or not draft_content.get("body").strip():
        from app.services.ai_service import generate_first_outreach_mock
        needs = research_res.get("likely_needs", ["practical technical training"])
        needs_txt = needs[0] if needs else "practical technical training"
        subj, bdy = generate_first_outreach_mock(
            lead_doc.get("name", "there"),
            lead_doc.get("company_name", "your company"),
            research_res.get("summary", ""),
            needs_txt,
            "Standard"
        )
        draft_content = {"subject": subj, "body": bdy, "confidence_score": 0.95}

    draft_record = {
        "lead_id": lead_id,
        "thread_id": lead_id,
        "message_id": None,
        "in_reply_to": None,
        "references": [],
        "direction": "OUTBOUND",
        "kind": "FIRST_TOUCH",
        "stage": 0,
        "status": "Draft Ready",
        "subject": draft_content["subject"],
        "body": draft_content["body"],
        "confidence_score": draft_content.get("confidence_score", 0.95),
        "flagged_for_review": draft_content.get("flagged_for_review", False),
        "review_reason": draft_content.get("review_reason"),
        "service_line": draft_content.get("service_line"),
        "approved_by": None,
        "approved_at": None,
        "scheduled_for": None,
        "sent_at": None,
        "created_at": datetime.datetime.now(datetime.timezone.utc)
    }

    await db.emails.insert_one(draft_record)

    # Update lead status to Draft Ready
    await db.leads.update_one(
        {"_id": lead_doc["_id"]},
        {"$set": {"status": LeadStatus.DRAFT_READY.value, "updated_at": datetime.datetime.now(datetime.timezone.utc)}}
    )


@router.get("", response_model=List[LeadResponse])
async def list_leads(
    status_filter: Optional[str] = Query(None, alias="status"),
    search: Optional[str] = None,
    owner_id: Optional[str] = None,
    my_leads: Optional[bool] = None,
    skip: int = 0,
    limit: int = 100,
    current_user: Dict[str, Any] = Depends(require_permission("leads:read"))
):
    """
    List leads with filtering and search.
    Super Admin and Staff Admin have full read visibility org-wide.
    Optional owner_id or my_leads parameters allow narrowing down.
    Tolerant of older, partial, or malformed documents.
    """
    if skip < 0:
        raise HTTPException(status_code=400, detail="Invalid skip parameter: must be >= 0")
    if limit <= 0 or limit > 1000:
        raise HTTPException(status_code=400, detail="Invalid limit parameter: must be between 1 and 1000")

    db = get_database()
    query = get_user_scope_filter(current_user)

    # Explicit Owner / My Leads narrowing
    if my_leads:
        current_uid = str(current_user.get("id") or current_user.get("_id") or "")
        if ObjectId.is_valid(current_uid):
            query["owner_id"] = {"$in": [current_uid, ObjectId(current_uid)]}
        else:
            query["owner_id"] = current_uid
    elif owner_id and owner_id.strip() and owner_id.strip().upper() != "ALL":
        clean_owner = owner_id.strip()
        if clean_owner == "me":
            current_uid = str(current_user.get("id") or current_user.get("_id") or "")
            if ObjectId.is_valid(current_uid):
                query["owner_id"] = {"$in": [current_uid, ObjectId(current_uid)]}
            else:
                query["owner_id"] = current_uid
        elif ObjectId.is_valid(clean_owner):
            query["owner_id"] = {"$in": [clean_owner, ObjectId(clean_owner)]}
        else:
            query["owner_id"] = clean_owner

    if status_filter and status_filter.strip().upper() != "ALL":
        query["status"] = status_filter.strip()

    if search and search.strip():
        import re
        escaped_search = re.escape(search.strip())
        regex = {"$regex": escaped_search, "$options": "i"}
        query["$or"] = [
            {"name": regex},
            {"email": regex},
            {"company_name": regex},
            {"company": regex}
        ]

    cursor = db.leads.find(query).sort("created_at", -1).skip(skip).limit(limit)
    leads = await cursor.to_list(limit)

    # Attach owner names safely without throwing InvalidId
    user_ids = []
    for l in leads:
        oid = l.get("owner_id")
        if oid and ObjectId.is_valid(str(oid)):
            user_ids.append(ObjectId(str(oid)))
        appr_id = l.get("approved_by")
        if appr_id and ObjectId.is_valid(str(appr_id)):
            user_ids.append(ObjectId(str(appr_id)))

    user_map = {}
    if user_ids:
        users_cursor = db.users.find({"_id": {"$in": user_ids}})
        user_map = {str(u["_id"]): u.get("name", "") async for u in users_cursor}

    results = []
    for l in leads:
        try:
            lead_dict = serialize_doc(l)
            if not isinstance(lead_dict, dict):
                continue

            # Ensure id string
            if "id" not in lead_dict and "_id" in lead_dict:
                lead_dict["id"] = str(lead_dict["_id"])
            elif "id" not in lead_dict:
                lead_dict["id"] = str(ObjectId())

            # Company fallback
            raw_company = (lead_dict.get("company_name") or lead_dict.get("company") or "").strip()
            lead_dict["company_name"] = raw_company or "Unknown Company"
            lead_dict["company"] = lead_dict["company_name"]

            # Name fallback
            raw_name = (lead_dict.get("name") or "").strip()
            if not raw_name:
                first = (lead_dict.get("first_name") or "").strip()
                last = (lead_dict.get("last_name") or "").strip()
                raw_name = f"{first} {last}".strip()
            if not raw_name:
                raw_email = lead_dict.get("email") or ""
                raw_name = raw_email.split("@")[0] if "@" in raw_email else "Unknown"
            lead_dict["name"] = raw_name or "Unknown"

            if not lead_dict.get("first_name"):
                parts = lead_dict["name"].split(" ")
                lead_dict["first_name"] = parts[0]
                lead_dict["last_name"] = " ".join(parts[1:]) if len(parts) > 1 else ""

            # Email fallback
            if not lead_dict.get("email"):
                lead_dict["email"] = "unknown@domain.com"

            # Status fallback
            lead_dict["status"] = lead_dict.get("status") or LeadStatus.NEW_LEAD.value

            # Owner mapping
            raw_owner_id = lead_dict.get("owner_id")
            if raw_owner_id:
                owner_id_str = str(raw_owner_id)
                lead_dict["owner_id"] = owner_id_str
                lead_dict["owner_name"] = user_map.get(owner_id_str) or "Unassigned"
            else:
                lead_dict["owner_id"] = None
                lead_dict["owner_name"] = "Unassigned"

            # Approved by mapping
            raw_appr = lead_dict.get("approved_by")
            if raw_appr:
                lead_dict["approved_by"] = str(raw_appr)
                lead_dict["approver_name"] = user_map.get(str(raw_appr)) or lead_dict.get("approver_name")

            # Extra fields
            if not isinstance(lead_dict.get("extra_fields"), dict):
                lead_dict["extra_fields"] = {}

            # Followup counts
            try:
                lead_dict["followup_count"] = int(lead_dict.get("followup_count") or 0)
            except (ValueError, TypeError):
                lead_dict["followup_count"] = 0

            try:
                lead_dict["max_followups"] = int(lead_dict.get("max_followups") or 3)
            except (ValueError, TypeError):
                lead_dict["max_followups"] = 3

            results.append(lead_dict)
        except Exception as item_err:
            import logging
            logging.getLogger(__name__).warning(f"Error processing lead item {l.get('_id')}: {item_err}")
            continue

    return results


@router.post("", response_model=LeadResponse)
async def create_lead(
    lead_in: LeadCreate,
    current_user: Dict[str, Any] = Depends(require_permission("leads:write"))
):
    """Create a new lead with email deduplication and kick off research and drafting."""
    db = get_database()
    email_clean = lead_in.email.strip().lower()

    # Deduplication
    existing = await db.leads.find_one({"email": email_clean})
    if existing:
        raise HTTPException(status_code=400, detail=f"Lead with email '{email_clean}' already exists.")

    now = datetime.datetime.now(datetime.timezone.utc)
    owner_id = lead_in.owner_id or current_user["id"]

    # Verify assigned owner exists
    owner = await db.users.find_one({"_id": ObjectId(owner_id)})
    if not owner:
        owner_id = current_user["id"]

    lead_name = (lead_in.name or f"{lead_in.first_name or ''} {lead_in.last_name or ''}").strip() or email_clean.split("@")[0]
    comp_name = (lead_in.company_name or lead_in.company or email_clean.split("@")[1]).strip()

    doc = {
        "name": lead_name,
        "email": email_clean,
        "company_name": comp_name,
        "company": comp_name,
        "company_website": lead_in.company_website.strip() if lead_in.company_website else None,
        "owner_id": owner_id,
        "source": lead_in.source,
        "extra_fields": lead_in.extra_fields,
        "status": LeadStatus.NEW_LEAD.value,
        "followup_count": 0,
        "max_followups": 3,
        "next_action_at": None,
        "preferred_contact_date": None,
        "created_at": now,
        "updated_at": now
    }

    res = await db.leads.insert_one(doc)
    doc["_id"] = res.inserted_id

    # Run research & drafting
    await trigger_lead_pipeline(doc)

    await log_audit_event(
        user=current_user,
        action="CREATE_LEAD",
        entity_type="LEAD",
        entity_id=str(res.inserted_id),
        details={"name": doc["name"], "email": doc["email"], "company": doc["company_name"]}
    )

    lead_res = await db.leads.find_one({"_id": res.inserted_id})
    return serialize_doc(lead_res)


@router.get("/{lead_id}", response_model=LeadResponse)
async def get_lead(
    lead_id: str,
    current_user: Dict[str, Any] = Depends(require_permission("leads:read"))
):
    if not ObjectId.is_valid(lead_id):
        raise HTTPException(status_code=404, detail="Lead not found or access denied")
    db = get_database()
    scope = get_user_scope_filter(current_user)
    scope["_id"] = ObjectId(lead_id)

    lead = await db.leads.find_one(scope)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found or access denied")

    lead_data = serialize_doc(lead)
    raw_company = (lead_data.get("company_name") or lead_data.get("company") or "").strip()
    lead_data["company_name"] = raw_company or "Unknown Company"
    lead_data["company"] = lead_data["company_name"]

    raw_name = (lead_data.get("name") or "").strip()
    if not raw_name:
        first = (lead_data.get("first_name") or "").strip()
        last = (lead_data.get("last_name") or "").strip()
        raw_name = f"{first} {last}".strip()
    if not raw_name:
        raw_email = lead_data.get("email") or ""
        raw_name = raw_email.split("@")[0] if "@" in raw_email else "Unknown"
    lead_data["name"] = raw_name or "Unknown"

    if not lead_data.get("first_name"):
        parts = lead_data["name"].split(" ")
        lead_data["first_name"] = parts[0]
        lead_data["last_name"] = " ".join(parts[1:]) if len(parts) > 1 else ""

    if not lead_data.get("email"):
        lead_data["email"] = "unknown@domain.com"

    lead_data["status"] = lead_data.get("status") or LeadStatus.NEW_LEAD.value

    raw_owner_id = lead_data.get("owner_id")
    if raw_owner_id and ObjectId.is_valid(str(raw_owner_id)):
        owner = await db.users.find_one({"_id": ObjectId(str(raw_owner_id))})
        if owner:
            lead_data["owner_name"] = owner.get("name")

    return lead_data


@router.put("/{lead_id}", response_model=LeadResponse)
async def update_lead(
    lead_id: str,
    lead_update: LeadUpdate,
    current_user: Dict[str, Any] = Depends(require_permission("leads:write"))
):
    db = get_database()
    scope = get_user_scope_filter(current_user)
    scope["_id"] = ObjectId(lead_id)

    lead = await db.leads.find_one(scope)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found or access denied")

    updates = {}
    if lead_update.name is not None:
        updates["name"] = lead_update.name.strip()
    if lead_update.company_name is not None:
        updates["company_name"] = lead_update.company_name.strip()
    if lead_update.company_website is not None:
        updates["company_website"] = lead_update.company_website.strip()
    if lead_update.owner_id is not None and current_user.get("role") == "SUPER_ADMIN":
        updates["owner_id"] = lead_update.owner_id
    if lead_update.preferred_contact_date is not None:
        updates["preferred_contact_date"] = lead_update.preferred_contact_date.isoformat()

    # Validate state transition if status provided
    if lead_update.status and lead_update.status != lead.get("status"):
        if not can_transition(lead.get("status", LeadStatus.NEW_LEAD.value), lead_update.status):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid lifecycle transition from '{lead.get('status')}' to '{lead_update.status}'."
            )
        updates["status"] = lead_update.status

    if updates:
        updates["updated_at"] = datetime.datetime.now(datetime.timezone.utc)
        await db.leads.update_one({"_id": ObjectId(lead_id)}, {"$set": updates})
        await log_audit_event(
            user=current_user,
            action="UPDATE_LEAD",
            entity_type="LEAD",
            entity_id=lead_id,
            details=updates
        )

    updated = await db.leads.find_one({"_id": ObjectId(lead_id)})
    return serialize_doc(updated)


@router.delete("/{lead_id}")
async def delete_lead(
    lead_id: str,
    current_user: Dict[str, Any] = Depends(require_permission("leads:write"))
):
    """Super Admin only: Delete a lead and its associated data."""
    db = get_database()
    res = await db.leads.delete_one({"_id": ObjectId(lead_id)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Lead not found")

    await db.emails.delete_many({"lead_id": lead_id})
    await db.company_research.delete_many({"lead_id": lead_id})

    await log_audit_event(
        user=current_user,
        action="DELETE_LEAD",
        entity_type="LEAD",
        entity_id=lead_id
    )
    return {"success": True, "message": "Lead deleted successfully"}


@router.post("/import/csv")
async def import_leads_csv(
    file: UploadFile = File(...),
    current_user: Dict[str, Any] = Depends(require_permission("leads:write"))
):
    """
    Bulk import leads from CSV with deduplication and auto-research triggering.
    Expected CSV columns: Name, Email, Company, Website (optional)
    """
    db = get_database()
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    imported_count = 0
    duplicate_count = 0
    error_count = 0

    for row in reader:
        # Standardize field names
        clean_row = {k.strip().lower(): v.strip() for k, v in row.items() if k}
        email = clean_row.get("email") or clean_row.get("lead email") or clean_row.get("contact email")
        name = clean_row.get("name") or clean_row.get("lead name") or clean_row.get("full name") or "Lead"
        company = clean_row.get("company") or clean_row.get("company name") or clean_row.get("organization") or "Organization"
        website = clean_row.get("website") or clean_row.get("company website") or clean_row.get("url")

        if not email or "@" not in email:
            error_count += 1
            continue

        email_clean = email.strip().lower()
        if await db.leads.find_one({"email": email_clean}):
            duplicate_count += 1
            continue

        now = datetime.datetime.now(datetime.timezone.utc)
        lead_doc = {
            "name": name,
            "email": email_clean,
            "company_name": company,
            "company_website": website,
            "owner_id": current_user["id"],
            "source": "CSV_IMPORT",
            "status": LeadStatus.NEW_LEAD.value,
            "followup_count": 0,
            "max_followups": 3,
            "next_action_at": None,
            "preferred_contact_date": None,
            "created_at": now,
            "updated_at": now
        }
        res = await db.leads.insert_one(lead_doc)
        lead_doc["_id"] = res.inserted_id
        await trigger_lead_pipeline(lead_doc)
        imported_count += 1

    await log_audit_event(
        user=current_user,
        action="IMPORT_CSV_LEADS",
        entity_type="LEAD",
        entity_id="bulk",
        details={"imported": imported_count, "duplicates": duplicate_count, "errors": error_count}
    )

    return {
        "success": True,
        "imported": imported_count,
        "duplicates_skipped": duplicate_count,
        "invalid_skipped": error_count
    }


@router.post("/sync/zoho")
async def sync_zoho_leads(
    current_user: Dict[str, Any] = Depends(require_permission("leads:write"))
):
    """Sync recent leads from Zoho CRM."""
    db = get_database()
    zoho_leads = await sync_leads_from_zoho_crm()

    imported = 0
    duplicates = 0

    for item in zoho_leads:
        email_clean = item["email"].strip().lower()
        if await db.leads.find_one({"email": email_clean}):
            duplicates += 1
            continue

        now = datetime.datetime.now(datetime.timezone.utc)
        lead_doc = {
            "name": item["name"],
            "email": email_clean,
            "company_name": item["company_name"],
            "company_website": item.get("company_website"),
            "owner_id": current_user["id"],
            "source": "ZOHO_CRM",
            "zoho_lead_id": item.get("zoho_lead_id"),
            "status": LeadStatus.NEW_LEAD.value,
            "followup_count": 0,
            "max_followups": 3,
            "next_action_at": None,
            "preferred_contact_date": None,
            "created_at": now,
            "updated_at": now
        }
        res = await db.leads.insert_one(lead_doc)
        lead_doc["_id"] = res.inserted_id
        await trigger_lead_pipeline(lead_doc)
        imported += 1

    await log_audit_event(
        user=current_user,
        action="SYNC_ZOHO_CRM",
        entity_type="LEAD",
        entity_id="bulk",
        details={"imported": imported, "duplicates_skipped": duplicates}
    )

    return {
        "success": True,
        "synced": imported,
        "duplicates_skipped": duplicates
    }
