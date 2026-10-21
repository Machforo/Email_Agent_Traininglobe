import datetime
import os
import logging
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo
from bson import ObjectId

from app.core.config import settings
from app.core.database import get_database, serialize_doc
from app.core.security import create_action_token
from app.core.audit import log_audit_event
from app.services.zoho_service import send_email_via_zoho

logger = logging.getLogger("scheduled_reminder_service")


def get_configured_timezone(tz_name: Optional[str] = None) -> ZoneInfo:
    """Return ZoneInfo for the given timezone name or configured fallback."""
    tz_str = tz_name or settings.TIMEZONE or "Asia/Kolkata"
    try:
        return ZoneInfo(tz_str)
    except Exception:
        return ZoneInfo("Asia/Kolkata")


def format_timezone_datetime(dt: datetime.datetime, tz_name: Optional[str] = None) -> str:
    """Format UTC datetime into user-friendly localized string with timezone abbreviation."""
    if not dt:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    tz = get_configured_timezone(tz_name)
    local_dt = dt.astimezone(tz)
    return local_dt.strftime("%d %b %Y, %I:%M %p") + " " + local_dt.strftime("%Z")


def compute_reminder_at(
    scheduled_for: datetime.datetime,
    lead_minutes: int = 30,
    send_immediately_if_due: bool = True
) -> Tuple[datetime.datetime, str]:
    """
    Compute when the reminder should fire.
    Returns: (reminder_at, reminder_status)
    If scheduled_for is closer than lead_minutes:
      - If send_immediately_if_due is True: fires immediately (now, 'pending')
      - If False: marked 'skipped'
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    if scheduled_for.tzinfo is None:
        scheduled_for = scheduled_for.replace(tzinfo=datetime.timezone.utc)

    target_reminder = scheduled_for - datetime.timedelta(minutes=lead_minutes)

    if target_reminder <= now:
        if send_immediately_if_due:
            return now, "pending"
        else:
            return target_reminder, "skipped"

    return target_reminder, "pending"


async def get_system_settings_dict() -> Dict[str, Any]:
    """Retrieve system settings from DB or return standard defaults."""
    db = get_database()
    if db is None:
        return {
            "reminder_enabled": True,
            "reminder_lead_minutes": 30,
            "reminder_email_recipients": [],
            "reminder_channels": ["email", "dashboard"],
            "reminder_send_immediately_if_due": True,
            "timezone": settings.TIMEZONE or "Asia/Kolkata",
        }
    config = await db.system_settings.find_one({"_id": "global_config"})
    if not config:
        return {
            "reminder_enabled": True,
            "reminder_lead_minutes": 30,
            "reminder_email_recipients": [],
            "reminder_channels": ["email", "dashboard"],
            "reminder_send_immediately_if_due": True,
            "timezone": settings.TIMEZONE or "Asia/Kolkata",
        }
    return config


async def build_reminder_email_content(
    lead: Dict[str, Any],
    email_doc: Dict[str, Any],
    scheduled_for: datetime.datetime,
    minutes_remaining: int,
    config: Dict[str, Any]
) -> Tuple[str, str, str]:
    """
    Construct subject, HTML content, and plaintext content for the reminder email.
    Includes deep-linking action URLs with signed tokens.
    """
    lead_name = lead.get("name", "Prospect")
    lead_company = lead.get("company_name", "Organization")
    lead_email = lead.get("email", "")
    email_id = str(email_doc.get("_id", email_doc.get("id", "")))
    subject_preview = email_doc.get("subject", "Follow-up")
    body_text = email_doc.get("body", "") or email_doc.get("body_text", "")
    body_snippet = (body_text[:180] + "...") if len(body_text) > 180 else body_text
    approver_name = email_doc.get("approver_name", "Super Admin")

    tz_name = config.get("timezone", settings.TIMEZONE)
    formatted_time = format_timezone_datetime(scheduled_for, tz_name)

    email_subject = f"Reminder: email to {lead_name} ({lead_company}) is scheduled for {formatted_time}"

    # Signed deep links (expiring in 48 hours)
    app_base_url = os.getenv("APP_URL", "http://localhost:5173")
    token_review = create_action_token(email_id, "review")
    token_reschedule = create_action_token(email_id, "reschedule")
    token_cancel = create_action_token(email_id, "cancel")

    link_review = f"{app_base_url}/scheduled?email_id={email_id}&action=review&token={token_review}"
    link_reschedule = f"{app_base_url}/scheduled?email_id={email_id}&action=reschedule&token={token_reschedule}"
    link_cancel = f"{app_base_url}/scheduled?email_id={email_id}&action=cancel&token={token_cancel}"

    plain_text = f"""
Scheduled Email Delivery Reminder
Traininglobe AI Lead Nurturing

An approved email is queued for dispatch in {minutes_remaining} minutes.

Recipient: {lead_name} ({lead_email})
Company: {lead_company}
Subject: {subject_preview}
Scheduled For: {formatted_time} (sends in {minutes_remaining} minutes)
Authorized By: {approver_name}

Message Preview:
"{body_snippet}"

Manage This Delivery:
- Review in Scheduled Queue: {link_review}
- Reschedule Time: {link_reschedule}
- Cancel Delivery: {link_cancel}

Note: Approved emails are sent automatically at the scheduled time. You can reschedule or cancel them before then.
Each link requires authentication and will expire in 48 hours.
""".strip()

    html_content = f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>{email_subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
    
    <div style="background-color: #4f46e5; padding: 20px 24px; color: #ffffff;">
      <h2 style="margin: 0; font-size: 18px; font-weight: 600;">Scheduled Email Reminder</h2>
      <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9;">Traininglobe AI Lead Nurturing Gatekeeper</p>
    </div>

    <div style="padding: 24px;">
      <div style="background-color: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 14px; font-weight: 600; color: #92400e;">
          Outreach to <strong>{lead_name}</strong> is scheduled for dispatch in <strong>{minutes_remaining} minutes</strong> ({formatted_time}).
        </p>
      </div>

      <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px;">
        <tr>
          <td style="padding: 6px 0; color: #64748b; width: 120px;">Recipient:</td>
          <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">{lead_name} &lt;{lead_email}&gt;</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Company:</td>
          <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">{lead_company}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Subject:</td>
          <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">{subject_preview}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Scheduled For:</td>
          <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">{formatted_time}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Authorized By:</td>
          <td style="padding: 6px 0; color: #334155;">{approver_name}</td>
        </tr>
      </table>

      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 24px;">
        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 6px;">Draft Preview</div>
        <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #334155; font-style: italic;">
          "{body_snippet}"
        </p>
      </div>

      <div style="margin-bottom: 24px;">
        <div style="font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 10px;">Take Action:</div>
        <table style="width: 100%; border-collapse: separate; border-spacing: 8px 0;">
          <tr>
            <td style="width: 33%; text-align: center;">
              <a href="{link_review}" style="display: block; background-color: #4f46e5; color: #ffffff; text-decoration: none; padding: 9px 12px; border-radius: 6px; font-size: 12px; font-weight: 600;">Review in Queue</a>
            </td>
            <td style="width: 33%; text-align: center;">
              <a href="{link_reschedule}" style="display: block; background-color: #6366f1; color: #ffffff; text-decoration: none; padding: 9px 12px; border-radius: 6px; font-size: 12px; font-weight: 600;">Reschedule</a>
            </td>
            <td style="width: 33%; text-align: center;">
              <a href="{link_cancel}" style="display: block; background-color: #e11d48; color: #ffffff; text-decoration: none; padding: 9px 12px; border-radius: 6px; font-size: 12px; font-weight: 600;">Cancel Send</a>
            </td>
          </tr>
        </table>
      </div>

      <p style="margin: 0; font-size: 12px; color: #64748b; border-top: 1px solid #f1f5f9; padding-top: 16px;">
        <strong>Automatic Delivery Notice:</strong> Approved emails are sent automatically at the scheduled time. You can reschedule or cancel them before then.<br>
        Links require an authenticated Super Admin session and expire in 48 hours.
      </p>
    </div>
  </div>
</body>
</html>
""".strip()

    return email_subject, html_content, plain_text


async def send_reminder_email_to_recipients(
    lead: Dict[str, Any],
    email_doc: Dict[str, Any],
    scheduled_for: datetime.datetime,
    minutes_remaining: int,
    config: Dict[str, Any]
) -> Dict[str, Any]:
    """Send reminder email to the approving Super Admin and any extra configured recipients."""
    db = get_database()
    recipients = set()

    # 1. Approving Super Admin
    approver_id = email_doc.get("approved_by")
    if approver_id and db is not None:
        try:
            user = await db.users.find_one({"_id": ObjectId(approver_id)})
            if user and user.get("email"):
                recipients.add(user["email"].strip().lower())
        except Exception:
            pass

    # Fallback to initial Super Admin email if no approver email found
    if not recipients:
        recipients.add(settings.SUPERADMIN_EMAIL.strip().lower())

    # 2. Configured extra Super Admin recipients
    extra_emails = config.get("reminder_email_recipients", [])
    for em in extra_emails:
        if em and isinstance(em, str) and "@" in em:
            recipients.add(em.strip().lower())

    subject, html_content, plain_text = await build_reminder_email_content(
        lead=lead,
        email_doc=email_doc,
        scheduled_for=scheduled_for,
        minutes_remaining=minutes_remaining,
        config=config
    )

    send_results = []
    for recipient_email in recipients:
        try:
            res = await send_email_via_zoho(
                recipient_email=recipient_email,
                subject=subject,
                body_text=html_content or plain_text
            )
            send_results.append({"recipient": recipient_email, "result": res})
        except Exception as e:
            logger.warning(f"Failed to send reminder email to {recipient_email}: {e}")
            send_results.append({"recipient": recipient_email, "error": str(e)})

    # If at least one recipient succeeded (or in dry run mode)
    success = any(r.get("result", {}).get("success") for r in send_results) or settings.ZOHO_DRY_RUN
    return {
        "success": success,
        "results": send_results,
        "recipients": list(recipients)
    }


async def create_reminder_notification(
    lead: Dict[str, Any],
    email_doc: Dict[str, Any],
    scheduled_for: datetime.datetime,
    minutes_remaining: int,
    config: Dict[str, Any]
) -> Dict[str, Any]:
    """Create a persistent in-app notification in MongoDB."""
    db = get_database()
    if db is None:
        return {}

    now = datetime.datetime.now(datetime.timezone.utc)
    email_id = str(email_doc.get("_id", email_doc.get("id", "")))
    lead_id = str(lead.get("_id", email_doc.get("lead_id", "")))
    lead_name = lead.get("name", "Lead")
    lead_company = lead.get("company_name", "Company")

    tz_name = config.get("timezone", settings.TIMEZONE)
    formatted_time = format_timezone_datetime(scheduled_for, tz_name)

    # Deactivate any prior notification for this scheduled email to prevent duplicates
    await db.notifications.update_many(
        {"scheduled_email_id": email_id},
        {"$set": {"is_active": False, "dismissed_at": now}}
    )

    notification_doc = {
        "user_id": None,  # Visible to all Super Admins
        "role": "SUPER_ADMIN",
        "type": "SCHEDULED_EMAIL_REMINDER",
        "title": f"Upcoming Delivery: {lead_name}",
        "message": f"Email to {lead_name} ({lead_company}) goes out in {minutes_remaining} minutes ({formatted_time}).",
        "scheduled_email_id": email_id,
        "lead_id": lead_id,
        "lead_name": lead_name,
        "lead_company": lead_company,
        "scheduled_for": scheduled_for,
        "minutes_remaining": minutes_remaining,
        "formatted_time": formatted_time,
        "created_at": now,
        "read_at": None,
        "dismissed_at": None,
        "expires_at": scheduled_for + datetime.timedelta(hours=2),
        "is_active": True
    }

    res = await db.notifications.insert_one(notification_doc)
    notification_doc["_id"] = res.inserted_id
    return serialize_doc(notification_doc)


async def cancel_pending_reminder(email_id: str, reason: str = "cancelled"):
    """Cancel pending reminder and deactivate any existing in-app notifications."""
    db = get_database()
    if db is None or not email_id:
        return

    now = datetime.datetime.now(datetime.timezone.utc)
    try:
        await db.emails.update_one(
            {"_id": ObjectId(email_id)},
            {"$set": {"reminder_status": "cancelled", "reminder_cancelled_at": now}}
        )
    except Exception:
        pass

    try:
        await db.notifications.update_many(
            {"scheduled_email_id": email_id},
            {"$set": {"is_active": False, "dismissed_at": now}}
        )
    except Exception:
        pass


async def process_due_reminders():
    """
    Background Worker:
    Finds scheduled emails where reminder_at <= now, reminder_sent_at is null,
    and status is still 'Scheduled'.
    Uses atomic lock (find_one_and_update) to guarantee idempotency across concurrent workers.
    """
    db = get_database()
    if db is None:
        return

    config = await get_system_settings_dict()
    if not config.get("reminder_enabled", True):
        return

    channels = config.get("reminder_channels", ["email", "dashboard"])
    now = datetime.datetime.now(datetime.timezone.utc)

    # Find candidates
    candidates = await db.emails.find({
        "status": "Scheduled",
        "reminder_at": {"$lte": now},
        "reminder_sent_at": None,
        "$or": [
            {"reminder_status": {"$in": ["pending", None]}},
            {"reminder_status": "failed", "reminder_retry_count": {"$lt": 3}}
        ]
    }).to_list(30)

    processed_count = 0
    for item in candidates:
        email_id = item["_id"]

        # 1. Atomic claim lock
        claimed = await db.emails.find_one_and_update(
            {
                "_id": email_id,
                "status": "Scheduled",
                "reminder_sent_at": None,
                "$or": [
                    {"reminder_status": {"$in": ["pending", None]}},
                    {"reminder_status": "failed", "reminder_retry_count": {"$lt": 3}}
                ]
            },
            {
                "$set": {
                    "reminder_status": "processing",
                    "reminder_processing_at": now
                }
            },
            return_document=True
        )

        if not claimed:
            continue

        # 2. Re-check if already dispatched or cancelled
        if claimed.get("status") != "Scheduled":
            await db.emails.update_one(
                {"_id": email_id},
                {"$set": {"reminder_status": "skipped", "reminder_error": "Email no longer in Scheduled status"}}
            )
            await log_audit_event(
                user={"id": "system", "name": "Reminder Scheduler", "role": "SUPER_ADMIN"},
                action="REMINDER_SKIPPED",
                entity_type="EMAIL",
                entity_id=str(email_id),
                details={"reason": "Email status was not Scheduled at execution time"}
            )
            continue

        # 3. Fetch lead details
        lead = {}
        lead_id = claimed.get("lead_id")
        if lead_id:
            try:
                lead = await db.leads.find_one({"_id": ObjectId(lead_id)}) or {}
            except Exception:
                pass

        scheduled_for = claimed.get("scheduled_for", now + datetime.timedelta(minutes=30))
        if scheduled_for.tzinfo is None:
            scheduled_for = scheduled_for.replace(tzinfo=datetime.timezone.utc)

        # Minutes remaining
        remaining_seconds = max(0, int((scheduled_for - now).total_seconds()))
        minutes_remaining = max(1, remaining_seconds // 60)

        email_success = True
        error_detail = None

        # 4. Channel: Email
        if "email" in channels:
            email_result = await send_reminder_email_to_recipients(
                lead=lead,
                email_doc=claimed,
                scheduled_for=scheduled_for,
                minutes_remaining=minutes_remaining,
                config=config
            )
            if not email_result.get("success") and not settings.ZOHO_DRY_RUN:
                email_success = False
                error_detail = f"Email delivery error to {email_result.get('recipients')}"

        # 5. Channel: Dashboard Notification
        if "dashboard" in channels:
            try:
                await create_reminder_notification(
                    lead=lead,
                    email_doc=claimed,
                    scheduled_for=scheduled_for,
                    minutes_remaining=minutes_remaining,
                    config=config
                )
            except Exception as e:
                logger.error(f"Failed to create in-app notification: {e}")

        # 6. Finalize status and audit
        if email_success:
            await db.emails.update_one(
                {"_id": email_id},
                {
                    "$set": {
                        "reminder_sent_at": now,
                        "reminder_status": "sent",
                        "reminder_error": None
                    }
                }
            )
            await log_audit_event(
                user={"id": "system", "name": "Reminder Scheduler", "role": "SUPER_ADMIN"},
                action="REMINDER_SENT",
                entity_type="EMAIL",
                entity_id=str(email_id),
                lead_id=str(lead.get("_id", lead_id)),
                details={
                    "scheduled_for": scheduled_for.isoformat(),
                    "minutes_remaining": minutes_remaining,
                    "channels": channels
                }
            )
            processed_count += 1
        else:
            retry_count = claimed.get("reminder_retry_count", 0) + 1
            await db.emails.update_one(
                {"_id": email_id},
                {
                    "$set": {
                        "reminder_status": "failed",
                        "reminder_retry_count": retry_count,
                        "reminder_error": error_detail,
                        # Schedule next retry with exponential backoff (1 min, 2 min, 4 min)
                        "reminder_at": now + datetime.timedelta(minutes=2 ** (retry_count - 1))
                    }
                }
            )
            await log_audit_event(
                user={"id": "system", "name": "Reminder Scheduler", "role": "SUPER_ADMIN"},
                action="REMINDER_FAILED",
                entity_type="EMAIL",
                entity_id=str(email_id),
                lead_id=str(lead.get("_id", lead_id)),
                details={
                    "attempt": retry_count,
                    "error": error_detail
                }
            )
            processed_count += 1

    return processed_count
