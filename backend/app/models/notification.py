import datetime
from typing import Optional
from pydantic import BaseModel, Field


class NotificationResponse(BaseModel):
    id: str
    user_id: Optional[str] = None
    role: Optional[str] = "SUPER_ADMIN"
    type: str = "SCHEDULED_EMAIL_REMINDER"
    title: str
    message: str
    scheduled_email_id: str
    lead_id: Optional[str] = None
    lead_name: Optional[str] = None
    lead_company: Optional[str] = None
    scheduled_for: Optional[datetime.datetime] = None
    minutes_remaining: Optional[int] = None
    formatted_time: Optional[str] = None
    created_at: datetime.datetime
    read_at: Optional[datetime.datetime] = None
    dismissed_at: Optional[datetime.datetime] = None
    expires_at: Optional[datetime.datetime] = None
    is_active: bool = True
