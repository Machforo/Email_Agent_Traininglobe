from enum import Enum
from typing import Any, Dict, List, Optional
import datetime
from pydantic import BaseModel, EmailStr, Field


class LeadStatus(str, Enum):
    NEW_LEAD = "New Lead"
    DRAFT_READY = "Draft Ready"
    CONTACTED = "Contacted"
    ENGAGED = "Engaged"
    QUALIFIED = "Qualified"
    FOLLOWUP_PENDING = "Follow-up Pending"
    CONVERTED = "Converted"
    LOST_DORMANT = "Lost / Dormant"
    OPTED_OUT = "Opted Out"


# Allowed state transitions graph
ALLOWED_TRANSITIONS = {
    LeadStatus.NEW_LEAD: {
        LeadStatus.DRAFT_READY,
        LeadStatus.CONTACTED,
        LeadStatus.LOST_DORMANT,
        LeadStatus.OPTED_OUT,
    },
    LeadStatus.DRAFT_READY: {
        LeadStatus.CONTACTED,
        LeadStatus.FOLLOWUP_PENDING,
        LeadStatus.LOST_DORMANT,
        LeadStatus.OPTED_OUT,
    },
    LeadStatus.CONTACTED: {
        LeadStatus.ENGAGED,
        LeadStatus.FOLLOWUP_PENDING,
        LeadStatus.QUALIFIED,
        LeadStatus.CONVERTED,
        LeadStatus.LOST_DORMANT,
        LeadStatus.OPTED_OUT,
    },
    LeadStatus.FOLLOWUP_PENDING: {
        LeadStatus.DRAFT_READY,
        LeadStatus.CONTACTED,
        LeadStatus.ENGAGED,
        LeadStatus.LOST_DORMANT,
        LeadStatus.OPTED_OUT,
    },
    LeadStatus.ENGAGED: {
        LeadStatus.QUALIFIED,
        LeadStatus.CONVERTED,
        LeadStatus.FOLLOWUP_PENDING,
        LeadStatus.DRAFT_READY,
        LeadStatus.LOST_DORMANT,
        LeadStatus.OPTED_OUT,
    },
    LeadStatus.QUALIFIED: {
        LeadStatus.CONVERTED,
        LeadStatus.ENGAGED,
        LeadStatus.LOST_DORMANT,
        LeadStatus.OPTED_OUT,
    },
    LeadStatus.CONVERTED: {
        LeadStatus.OPTED_OUT,
    },
    LeadStatus.LOST_DORMANT: {
        LeadStatus.NEW_LEAD,
        LeadStatus.DRAFT_READY,
        LeadStatus.OPTED_OUT,
    },
    LeadStatus.OPTED_OUT: set(),  # Terminal state (cannot transition out)
}


def can_transition(current: str, target: str) -> bool:
    try:
        curr_enum = LeadStatus(current)
        target_enum = LeadStatus(target)
    except ValueError:
        return False
    if curr_enum == target_enum:
        return True
    return target_enum in ALLOWED_TRANSITIONS.get(curr_enum, set())


class LeadBase(BaseModel):
    name: str
    email: EmailStr
    company_name: str
    company_website: Optional[str] = None
    owner_id: Optional[str] = None
    source: str = "MANUAL"  # "ZOHO_CRM" | "CSV_IMPORT" | "MANUAL"
    extra_fields: Dict[str, Any] = Field(default_factory=dict)
    company: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None


class LeadCreate(BaseModel):
    name: Optional[str] = None
    email: EmailStr
    company_name: Optional[str] = None
    company: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    company_website: Optional[str] = None
    owner_id: Optional[str] = None
    source: str = "MANUAL"
    extra_fields: Dict[str, Any] = Field(default_factory=dict)


class LeadUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    company_name: Optional[str] = None
    company: Optional[str] = None
    company_website: Optional[str] = None
    owner_id: Optional[str] = None
    status: Optional[str] = None
    preferred_contact_date: Optional[datetime.date] = None


class LeadResponse(LeadBase):
    id: str
    status: str = LeadStatus.NEW_LEAD.value
    owner_name: Optional[str] = None
    followup_count: int = 0
    max_followups: int = 3
    next_action_at: Optional[datetime.datetime] = None
    preferred_contact_date: Optional[datetime.date] = None
    created_at: Optional[datetime.datetime] = None
    updated_at: Optional[datetime.datetime] = None
    zoho_lead_id: Optional[str] = None
    research_summary: Optional[str] = None

