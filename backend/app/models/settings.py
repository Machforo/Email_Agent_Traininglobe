from typing import Any, Dict, List, Optional
import datetime
from pydantic import BaseModel, Field


class SystemSettingsSchema(BaseModel):
    default_send_time: str = "18:00"
    timezone: str = "Asia/Kolkata"
    business_hours_start: int = 9
    business_hours_end: int = 19
    daily_send_limit: int = 100
    followup_intervals_days: List[int] = Field(default_factory=lambda: [3, 5, 7])
    max_followups: int = 3
    dry_run_mode: bool = True

    # Sender and Signature Configuration
    default_sender_name: str = "Pallabi Hansda"
    default_sender_designation: str = "Business Development Manager"
    company_legal_name: str = "Traininglobe Consultancy Pvt. Ltd."
    enable_lead_owner_override: bool = True

    # Scheduled Email Reminders
    reminder_enabled: bool = True
    reminder_lead_minutes: int = Field(default=30, ge=5, le=1440)
    reminder_email_recipients: List[str] = Field(default_factory=list)
    reminder_channels: List[str] = Field(default_factory=lambda: ["email", "dashboard"])
    reminder_send_immediately_if_due: bool = True

    # Integration Status Indicators (safe for all roles, no secrets exposed)
    zoho_status: Optional[str] = "Not connected"
    llm_status: Optional[str] = "Not connected"
    database_status: Optional[str] = "Connected"


class KnowledgeBaseItemCreate(BaseModel):
    category: str  # "ABOUT" | "SERVICES" | "APPROVED_CLAIMS" | "RESTRICTIONS" | "REFERENCE_CLIENTS"
    title: str
    content: str
    service_line: Optional[str] = "Enterprise AI Workshops"  # "Enterprise AI Workshops" | "Campus Placement" | "Corporate Onboarding"
    status: str = "Pending verification"  # "Verified" | "Pending verification"
    approved_for_outreach: bool = False
    region: Optional[str] = None  # e.g., "GCC", "Global", or None
    source: Optional[str] = None


class KnowledgeBaseItemUpdate(BaseModel):
    category: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    service_line: Optional[str] = None
    status: Optional[str] = None
    approved_for_outreach: Optional[bool] = None
    region: Optional[str] = None
    source: Optional[str] = None


class KnowledgeBaseItemResponse(BaseModel):
    id: str
    category: str
    title: str
    content: str
    service_line: Optional[str] = "Enterprise AI Workshops"
    status: str = "Pending verification"
    approved_for_outreach: bool = False
    region: Optional[str] = None
    source: Optional[str] = None
    updated_at: Optional[datetime.datetime] = None


class EmailTemplateCreate(BaseModel):
    name: str
    kind: str = "FIRST_TOUCH"  # "FIRST_TOUCH" | "FOLLOWUP" | "REPLY"
    service_line: str = "Enterprise AI Workshops"
    stage: Optional[int] = None
    subject_template: str
    body_template: str
    description: Optional[str] = None


class EmailTemplateUpdate(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = None
    service_line: Optional[str] = None
    stage: Optional[int] = None
    subject_template: Optional[str] = None
    body_template: Optional[str] = None
    description: Optional[str] = None


class EmailTemplateResponse(BaseModel):
    id: str
    name: str
    kind: str
    service_line: str
    stage: Optional[int] = None
    subject_template: str
    body_template: str
    description: Optional[str] = None
    updated_at: Optional[datetime.datetime] = None


class TemplatePreviewRequest(BaseModel):
    template_id: Optional[str] = None
    subject_template: Optional[str] = None
    body_template: Optional[str] = None
    sample_lead: Optional[Dict[str, Any]] = None


class TemplatePreviewResponse(BaseModel):
    rendered_subject: str
    rendered_body: str
    word_count: int
    used_placeholders: List[str] = Field(default_factory=list)
