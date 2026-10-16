from typing import List, Optional
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

    # Scheduled Email Reminders
    reminder_enabled: bool = True
    reminder_lead_minutes: int = Field(default=30, ge=5, le=1440)
    reminder_email_recipients: List[str] = Field(default_factory=list)
    reminder_channels: List[str] = Field(default_factory=lambda: ["email", "dashboard"])
    reminder_send_immediately_if_due: bool = True


class KnowledgeBaseItemCreate(BaseModel):
    category: str  # "ABOUT" | "SERVICES" | "APPROVED_CLAIMS" | "RESTRICTIONS"
    title: str
    content: str


class KnowledgeBaseItemResponse(KnowledgeBaseItemCreate):
    id: str
    updated_at: Optional[datetime.datetime] = None
