import datetime
from typing import Any, Dict
from bson import ObjectId
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.config import settings
from app.core.database import get_database
from app.models.lead import LeadStatus
from app.services.ai_service import draft_followup_email, generate_followup_mock
from app.services.delivery_service import send_approved_email
from app.services.reminder_service import cancel_pending_reminder, process_due_reminders
from app.core.audit import log_audit_event

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
            "default_sender_name": "Pallabi Hansda",
            "default_sender_designation": "Business Development Manager",
            "company_legal_name": "Traininglobe Consultancy Pvt. Ltd.",
            "enable_lead_owner_override": True,
            "reminder_enabled": True,
            "reminder_lead_minutes": 30,
            "reminder_email_recipients": [],
            "reminder_channels": ["email", "dashboard"],
            "reminder_send_immediately_if_due": True,
        }
    if "default_sender_name" not in config:
        config["default_sender_name"] = "Pallabi Hansda"
    if "default_sender_designation" not in config:
        config["default_sender_designation"] = "Business Development Manager"
    if "company_legal_name" not in config:
        config["company_legal_name"] = "Traininglobe Consultancy Pvt. Ltd."
    if "enable_lead_owner_override" not in config:
        config["enable_lead_owner_override"] = True

    # Safe integration indicators (never leak secrets, tokens, or credentials)
    zoho_connected = bool(settings.ZOHO_CLIENT_ID and settings.ZOHO_CLIENT_SECRET and settings.ZOHO_REFRESH_TOKEN)
    llm_connected = bool(settings.GROQ_API_KEY or settings.GEMINI_API_KEY or settings.OPENAI_API_KEY or settings.LLM_PROVIDER)
    config["zoho_status"] = "Connected" if zoho_connected else "Not connected"
    config["llm_status"] = "Connected" if llm_connected else "Not connected"
    config["database_status"] = "Connected" if settings.MONGO_URI else "Not connected"

    return config


async def recover_pending_scheduled() -> int:
    """
    Recover pending or stuck items from the DB on server restart.
    Any email left in 'Sending' status from a crashed worker is safely restored to 'Scheduled'.
    """
    db = get_database()
    if db is None:
        return 0

    now = datetime.datetime.now(datetime.timezone.utc)
    stuck_threshold = now - datetime.timedelta(minutes=5)
    result = await db.emails.update_many(
        {"status": "Sending", "dispatch_attempted_at": {"$lt": stuck_threshold}},
        {"$set": {"status": "Scheduled", "overdue_reason": "Recovered pending dispatch after server restart"}}
    )
    return result.modified_count


async def check_scheduled_deliveries():
    """
    Automated Background Dispatch Job (runs every 1 minute):
    Dispatches approved emails whose scheduled_for <= now.
    Checks:
      1. Mandatory approval (status 'Scheduled' and non-null approved_by)
      2. Recipient is not opted out or in a stop state
      3. Business hours & daily send limits (defers to next window if exceeded)
      4. Idempotency via atomic status lock ('Scheduled' -> 'Sending')
      5. Error handling with retries and exponential backoff
      6. Audit logging (DISPATCH_SCHEDULED_EMAIL)
    """
    db = get_database()
    if db is None:
        return

    now = datetime.datetime.now(datetime.timezone.utc)
    config = await get_system_settings()

    # 1. Business Hours Check
    current_hour = now.hour  # Business hours comparison
    start_hour = config.get("business_hours_start", 9)
    end_hour = config.get("business_hours_end", 19)

    # Allow 24h test dispatch when in dry-run test mode, but check business hours in production
    is_outside_business_hours = (current_hour < start_hour or current_hour >= end_hour) and not settings.ZOHO_DRY_RUN

    # 2. Daily Send Limit Check
    today_start = datetime.datetime.combine(datetime.date.today(), datetime.time.min, tzinfo=datetime.timezone.utc)
    sent_today = await db.emails.count_documents({"status": "Sent", "sent_at": {"$gte": today_start}})
    daily_limit = config.get("daily_send_limit", 100)
    is_daily_limit_exceeded = sent_today >= daily_limit and not settings.ZOHO_DRY_RUN

    # Find due scheduled emails
    due_emails = await db.emails.find({
        "status": "Scheduled",
        "scheduled_for": {"$lte": now}
    }).sort("scheduled_for", 1).to_list(25)

    dispatched_count = 0

    if not due_emails:
        return dispatched_count

    for email_doc in due_emails:
        email_id = email_doc["_id"]

        # If outside business hours, record reason and defer
        if is_outside_business_hours:
            await db.emails.update_one(
                {"_id": email_id},
                {"$set": {"overdue_reason": f"Outside business hours ({start_hour}:00 - {end_hour}:00). Auto-dispatch will resume in next sending window."}}
            )
            continue

        # If daily limit reached, record reason and defer
        if is_daily_limit_exceeded:
            await db.emails.update_one(
                {"_id": email_id},
                {"$set": {"overdue_reason": f"Daily sending limit ({daily_limit} emails) reached for today. Outreach will resume tomorrow."}}
            )
            continue

        # 3. Check Mandatory Approval Gatekeeper
        approved_by = email_doc.get("approved_by")
        if not approved_by:
            await db.emails.update_one(
                {"_id": email_id},
                {
                    "$set": {
                        "status": "Failed",
                        "error_message": "Blocked: Missing mandatory human approver ID.",
                        "overdue_reason": "Missing human approval attribution"
                    }
                }
            )
            await log_audit_event(
                user={"id": "system_scheduler", "name": "System Scheduler"},
                action="DISPATCH_SCHEDULED_EMAIL_FAILED",
                entity_type="EMAIL",
                entity_id=str(email_id),
                details={"reason": "MISSING_APPROVER_ID"}
            )
            continue

        # 4. Check Lead Opt-Out and Stop State
        lead_id = email_doc.get("lead_id")
        lead = await db.leads.find_one({"_id": ObjectId(lead_id)}) if lead_id else None
        if not lead:
            await db.emails.update_one(
                {"_id": email_id},
                {"$set": {"status": "Failed", "error_message": f"Lead {lead_id} not found."}}
            )
            continue

        recipient_email = lead.get("email", "").strip().lower()
        is_suppressed = await db.opt_out_suppression.find_one({"email": recipient_email})
        is_stop_state = (
            bool(lead.get("opt_out"))
            or bool(lead.get("opted_out"))
            or lead.get("status") in [
                LeadStatus.OPTED_OUT.value,
                "OPTED_OUT",
                "Opted Out",
                LeadStatus.LOST_DORMANT.value,
                "LOST_DORMANT",
                "Lost / Dormant",
                "Unsubscribed",
                "Do Not Contact",
            ]
        )

        if is_suppressed or is_stop_state:
            await db.emails.update_one(
                {"_id": email_id},
                {
                    "$set": {
                        "status": "Cancelled",
                        "error_message": "Blocked: Recipient is in opt-out suppression or stop state.",
                        "cancellation_reason": "Recipient opted out or in stop state",
                        "overdue_reason": "Recipient opted out or in stop state"
                    }
                }
            )
            await log_audit_event(
                user={"id": approved_by, "name": email_doc.get("approver_name", "System Scheduler")},
                action="DISPATCH_SCHEDULED_EMAIL_BLOCKED",
                entity_type="EMAIL",
                entity_id=str(email_id),
                details={"recipient": recipient_email, "reason": "OPTED_OUT_OR_STOP_STATE"}
            )
            continue

        # 5. Idempotency Lock: Atomic state transition from 'Scheduled' to 'Sending'
        lock_res = await db.emails.update_one(
            {"_id": email_id, "status": "Scheduled"},
            {"$set": {"status": "Sending", "dispatch_attempted_at": now}}
        )
        if lock_res.modified_count == 0:
            # Another scheduler execution or worker acquired this draft
            continue

        # 6. Execute Dispatch via Delivery Gatekeeper
        approver_user = {
            "id": approved_by,
            "name": email_doc.get("approver_name", "Scheduled Admin"),
            "role": "SUPER_ADMIN"
        }

        try:
            # Temporarily set to 'Approved' so send_approved_email gatekeeper validation passes
            await db.emails.update_one({"_id": email_id}, {"$set": {"status": "Approved"}})
            await cancel_pending_reminder(str(email_id), reason="auto_dispatched")

            await send_approved_email(str(email_id), approver_user)
            dispatched_count += 1

            # Record successful auto-dispatch audit event
            await log_audit_event(
                user=approver_user,
                action="DISPATCH_SCHEDULED_EMAIL",
                entity_type="EMAIL",
                entity_id=str(email_id),
                details={
                    "recipient": recipient_email,
                    "subject": email_doc.get("subject"),
                    "scheduled_for": email_doc.get("scheduled_for").isoformat() if email_doc.get("scheduled_for") else None,
                    "dispatched_at": now.isoformat(),
                    "auto_dispatched": True
                }
            )
        except Exception as e:
            # Retry mechanism with exponential backoff
            retry_count = email_doc.get("retry_count", 0) + 1
            max_retries = 3

            if retry_count < max_retries:
                backoff_minutes = 2 ** retry_count  # 2m, 4m
                next_retry = now + datetime.timedelta(minutes=backoff_minutes)
                await db.emails.update_one(
                    {"_id": email_id},
                    {
                        "$set": {
                            "status": "Scheduled",
                            "retry_count": retry_count,
                            "scheduled_for": next_retry,
                            "last_error": str(e),
                            "overdue_reason": f"Retry {retry_count}/{max_retries} scheduled after error: {str(e)}"
                        }
                    }
                )
            else:
                await db.emails.update_one(
                    {"_id": email_id},
                    {
                        "$set": {
                            "status": "Failed",
                            "retry_count": retry_count,
                            "error_message": f"Auto-dispatch failed after {max_retries} attempts: {str(e)}",
                            "overdue_reason": f"Delivery failed after {max_retries} attempts: {str(e)}"
                        }
                    }
                )

            await log_audit_event(
                user=approver_user,
                action="DISPATCH_SCHEDULED_EMAIL_FAILED",
                entity_type="EMAIL",
                entity_id=str(email_id),
                details={
                    "recipient": recipient_email,
                    "error": str(e),
                    "retry_count": retry_count,
                    "attempted_at": now.isoformat()
                }
            )

    return dispatched_count


async def check_followup_cadence():
    """
    Check leads in 'Contacted' status where no reply was received after the configured interval.
    Drafts the next follow-up with grounded content and queues it for mandatory human approval.
    """
    db = get_database()
    if db is None:
        return

    now = datetime.datetime.now(datetime.timezone.utc)
    config = await get_system_settings()
    max_followups = config.get("max_followups", 3)
    email_length = config.get("email_length", "Standard")

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

        # Generate follow-up draft using configured length
        draft_content = await draft_followup_email(
            lead=lead,
            stage=followup_count + 1,
            previous_subject=last_subject,
            email_length=email_length
        )

        # Safeguard: never save empty body
        if not draft_content.get("body") or not draft_content.get("body").strip():
            subj, bdy = generate_followup_mock(
                lead.get("name", "there"),
                lead.get("company_name", "your team"),
                followup_count + 1,
                last_subject,
                email_length
            )
            draft_content = {"subject": subj, "body": bdy, "confidence_score": 0.95}

        draft_doc = {
            "lead_id": lead_id,
            "thread_id": last_email.get("thread_id", lead_id) if last_email else lead_id,
            "message_id": None,
            "in_reply_to": last_email.get("message_id") if last_email else None,
            "references": [last_email["message_id"]] if (last_email and last_email.get("message_id")) else [],
            "direction": "OUTBOUND",
            "kind": "FOLLOWUP",
            "stage": followup_count + 1,
            "status": "Draft Ready",
            "subject": draft_content["subject"],
            "body": draft_content["body"],
            "confidence_score": draft_content.get("confidence_score", 0.93),
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
    # Automated dispatch runs every 1 minute
    scheduler.add_job(check_scheduled_deliveries, "interval", minutes=1, id="check_scheduled", max_instances=1)
    scheduler.add_job(check_followup_cadence, "interval", minutes=5, id="check_followups")
    scheduler.add_job(process_due_reminders, "interval", minutes=1, id="process_reminders")
    scheduler.start()


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown()
