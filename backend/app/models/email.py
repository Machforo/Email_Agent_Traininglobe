from typing import Any, Dict, List, Optional
import datetime
from pydantic import BaseModel, EmailStr, Field


class EmailDirection:
    OUTBOUND = "OUTBOUND"
    INBOUND = "INBOUND"


class EmailStatus:
    DRAFT_READY = "Draft Ready"
    APPROVED = "Approved"
    REJECTED = "Rejected"
    SCHEDULED = "Scheduled"
    SENT = "Sent"
    DELIVERED = "Delivered"
    BOUNCED = "Bounced"
    FAILED = "Failed"


class DraftEditRequest(BaseModel):
    subject: str
    body: str
    approve_now: bool = False
    schedule_time: Optional[datetime.datetime] = None


class DraftRejectRequest(BaseModel):
    reason: str
    regenerate: bool = False
    feedback_notes: Optional[str] = None


class DraftRescheduleRequest(BaseModel):
    scheduled_for: datetime.datetime


class EmailResponse(BaseModel):
    id: str
    lead_id: str
    thread_id: Optional[str] = None
    message_id: Optional[str] = None
    in_reply_to: Optional[str] = None
    references: List[str] = Field(default_factory=list)
    direction: str = "OUTBOUND"
    kind: str = "FIRST_TOUCH"  # FIRST_TOUCH | FOLLOWUP | REPLY
    stage: int = 0
    status: str = "Draft Ready"
    subject: str = ""
    body: str = ""
    confidence_score: Optional[float] = None
    detected_intent: Optional[str] = None
    approved_by: Optional[str] = None
    approver_name: Optional[str] = None
    approved_at: Optional[datetime.datetime] = None
    rejection_reason: Optional[str] = None
    scheduled_for: Optional[datetime.datetime] = None
    sent_at: Optional[datetime.datetime] = None
    idempotency_key: Optional[str] = None
    zoho_message_id: Optional[str] = None
    reminder_at: Optional[datetime.datetime] = None
    reminder_sent_at: Optional[datetime.datetime] = None
    reminder_status: Optional[str] = None  # pending | sent | skipped | failed | cancelled
    reminder_retry_count: int = 0
    reminder_error: Optional[str] = None
    flagged_for_review: bool = False
    review_reason: Optional[str] = None
    service_line: Optional[str] = None
    created_at: Optional[datetime.datetime] = None


class ApprovalQueueItem(BaseModel):
    draft: EmailResponse
    lead_name: str
    lead_email: str
    company_name: str
    company_website: Optional[str] = None
    owner_id: Optional[str] = None
    owner_name: Optional[str] = None
    approved_by: Optional[str] = None
    approver_name: Optional[str] = None
    research_summary: Optional[str] = None
    sources: List[str] = Field(default_factory=list)
    thread_history: List[EmailResponse] = Field(default_factory=list)


class InboundEmailWebhook(BaseModel):
    from_email: EmailStr
    to_email: Optional[str] = "outreach@traininglobe.com"
    subject: str
    body_text: Optional[str] = None
    body: Optional[str] = None
    message_id: str
    in_reply_to: Optional[str] = None
    references: Optional[str] = None

