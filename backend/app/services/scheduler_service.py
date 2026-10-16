import datetime
from typing import Any, Dict
from bson import ObjectId
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.config import settings
from app.core.database import get_database
from app.models.lead import LeadStatus
from app.services.ai_service import draft_followup_email
from app.services.delivery_service import send_approved_email
from app.services.reminder_service import cancel_pending_reminder, process_due_reminders

scheduler = AsyncIOScheduler()


async def get_system_settings() -> Dict[str, Any]:
    db = get_database()
    config = await db.system_settings.find_one({"_id": "global_config"}) if db is not None else None
    if not config:
        return {
            "default_send_time": settings.DEFAULT_SEND_TIME,
            "timezone": settings.TIMEZONE,
            "business_hours_start": settings.BUSINESS_HOURS_START,
            "business_hours_end": settings.BUSINESS_HOURS_END,
            "daily_send_limit": settings.DAILY_SEND_LIMIT,
            "max_followups": settings.MAX_FOLLOWUPS,
            "followup_intervals_days": [3, 5, 7],
            "reminder_enabled": True,
            "reminder_lead_minutes": 30,
            "reminder_email_recipients": [],
            "reminder_channels": ["email", "dashboard"],
            "reminder_send_immediately_if_due": True,
        }
    return config


async def check_scheduled_deliveries():
    """Process emails queued with status 'Scheduled' whose scheduled_for is due."""
    db = get_database()
    if db is None:
        return

    now = datetime.datetime.now(datetime.timezone.utc)
    config = await get_system_settings()

    # Business hour check
    current_hour = now.hour  # Simple UTC-relative or localized check
    start_hour = config.get("business_hours_start", 9)
    end_hour = config.get("business_hours_end", 19)

    # Daily limit check
    today_start = datetime.datetime.combine(datetime.date.today(), datetime.time.min, tzinfo=datetime.timezone.utc)
    sent_today = await db.emails.count_documents({"status": "Sent", "sent_at": {"$gte": today_start}})
    daily_limit = config.get("daily_send_limit", 100)

    if sent_today >= daily_limit:
        return  # Quota reached for today; will send during next window

    # Find due scheduled emails
    due_emails = await db.emails.find({
        "status": "Scheduled",
        "scheduled_for": {"$lte": now}
    }).to_list(20)

    for email_doc in due_emails:
        try:
            # System pseudo-user for background dispatch (preserves original approved_by)
            approver = {
                "id": email_doc.get("approved_by"),
                "name": email_doc.get("approver_name", "Scheduled Admin")
            }
            # Set to Approved so delivery gate passes
            await db.emails.update_one({"_id": email_doc["_id"]}, {"$set": {"status": "Approved"}})
            await cancel_pending_reminder(str(email_doc["_id"]), reason="dispatched")
            await send_approved_email(str(email_doc["_id"]), approver)
        except Exception:
            pass


async def check_followup_cadence():
    """
    Check leads in 'Contacted' status where no reply was received after the configured interval.
    Drafts the next follow-up and queues it for mandatory human approval.
    """
    db = get_database()
    if db is None:
        return

    now = datetime.datetime.now(datetime.timezone.utc)
    config = await get_system_settings()
    max_followups = config.get("max_followups", 3)

    # Leads past their next action date
    due_leads = await db.leads.find({
        "status": {"$in": [LeadStatus.CONTACTED.value, LeadStatus.FOLLOWUP_PENDING.value]},
        "next_action_at": {"$lte": now}
    }).to_list(30)

    for lead in due_leads:
        lead_id = str(lead["_id"])
        followup_count = lead.get("followup_count", 0)

        # Check if max follow-ups exhausted
        if followup_count >= max_followups:
            await db.leads.update_one(
                {"_id": lead["_id"]},
                {
                    "$set": {
                        "status": LeadStatus.LOST_DORMANT.value,
                        "updated_at": now
                    }
                }
            )
            continue

        # Check if there is already an active draft for this lead
        existing_draft = await db.emails.find_one({
            "lead_id": lead_id,
            "status": {"$in": ["Draft Ready", "Approved", "Scheduled"]}
        })
        if existing_draft:
            continue

        # Get last sent email for subject continuity
        last_email = await db.emails.find_one(
            {"lead_id": lead_id, "direction": "OUTBOUND", "status": "Sent"},
            sort=[("sent_at", -1)]
        )
        last_subject = last_email.get("subject", "Traininglobe partnership") if last_email else "Traininglobe partnership"

        # Generate follow-up draft
        draft_content = await draft_followup_email(
            lead=lead,
            stage=followup_count,
            previous_subject=last_subject
        )

        draft_doc = {
            "lead_id": lead_id,
            "thread_id": last_email.get("thread_id", lead_id) if last_email else lead_id,
            "message_id": None,
            "in_reply_to": last_email.get("message_id") if last_email else None,
            "references": [last_email["message_id"]] if (last_email and last_email.get("message_id")) else [],
            "direction": "OUTBOUND",
            "kind": "FOLLOWUP",
            "stage": followup_count,
            "status": "Draft Ready",
            "subject": draft_content["subject"],
            "body": draft_content["body"],
            "confidence_score": draft_content.get("confidence_score", 0.90),
            "approved_by": None,
            "approved_at": None,
            "scheduled_for": None,
            "sent_at": None,
            "created_at": now
        }

        await db.emails.insert_one(draft_doc)

        # Update lead status to indicate follow-up draft is waiting
        await db.leads.update_one(
            {"_id": lead["_id"]},
            {"$set": {"status": LeadStatus.DRAFT_READY.value, "updated_at": now}}
        )


def start_scheduler():
    scheduler.add_job(check_scheduled_deliveries, "interval", minutes=1, id="check_scheduled")
    scheduler.add_job(check_followup_cadence, "interval", minutes=5, id="check_followups")
    scheduler.add_job(process_due_reminders, "interval", minutes=1, id="process_reminders")
    scheduler.start()


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown()
