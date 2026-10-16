import pytest
import datetime
from httpx import AsyncClient, ASGITransport
from bson import ObjectId

from app.main import app
from app.core.database import connect_to_mongo, close_mongo_connection, get_database
from app.core.security import create_access_token, hash_password, create_action_token, verify_action_token
from app.services.reminder_service import (
    compute_reminder_at,
    process_due_reminders,
    cancel_pending_reminder,
    build_reminder_email_content,
    format_timezone_datetime,
)


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


# ==============================================================================
# 1. UNIT TESTS: Reminder Time Computation & Action Tokens
# ==============================================================================

def test_compute_reminder_at_normal():
    """When scheduled_for is comfortably in the future, reminder_at is scheduled_for - lead_minutes."""
    now = datetime.datetime.now(datetime.timezone.utc)
    scheduled_for = now + datetime.timedelta(hours=2)  # 120 mins ahead
    lead_minutes = 30

    reminder_at, status = compute_reminder_at(
        scheduled_for=scheduled_for,
        lead_minutes=lead_minutes,
        send_immediately_if_due=True,
    )

    expected_reminder_at = scheduled_for - datetime.timedelta(minutes=30)
    assert status == "pending"
    assert reminder_at is not None
    assert abs((reminder_at - expected_reminder_at).total_seconds()) < 2


def test_compute_reminder_at_closer_immediate():
    """When scheduled closer than lead_minutes and send_immediately_if_due is True, fire immediately."""
    now = datetime.datetime.now(datetime.timezone.utc)
    scheduled_for = now + datetime.timedelta(minutes=15)  # 15 min ahead (< 30)
    lead_minutes = 30

    reminder_at, status = compute_reminder_at(
        scheduled_for=scheduled_for,
        lead_minutes=lead_minutes,
        send_immediately_if_due=True,
    )

    assert status == "pending"
    assert reminder_at is not None
    # reminder_at should be <= current time to be picked up immediately
    assert reminder_at <= datetime.datetime.now(datetime.timezone.utc)


def test_compute_reminder_at_closer_skip():
    """When scheduled closer than lead_minutes and send_immediately_if_due is False, mark skipped."""
    now = datetime.datetime.now(datetime.timezone.utc)
    scheduled_for = now + datetime.timedelta(minutes=10)
    lead_minutes = 30

    reminder_at, status = compute_reminder_at(
        scheduled_for=scheduled_for,
        lead_minutes=lead_minutes,
        send_immediately_if_due=False,
    )

    assert status == "skipped"
    assert reminder_at is not None


def test_action_tokens_generation_and_verification():
    """Signed action tokens verify correctly with payload and purpose."""
    email_id = str(ObjectId())
    token = create_action_token(email_id=email_id, action="reschedule", expires_in_minutes=60)

    payload = verify_action_token(token)
    assert payload is not None
    assert payload["email_id"] == email_id
    assert payload["action"] == "reschedule"
    assert payload["purpose"] == "scheduled_reminder_action"


@pytest.mark.asyncio
async def test_build_reminder_email_content():
    """Reminder email generates subject and body with lead info, timezone label, and deep-link URLs."""
    lead = {
        "name": "Arjun Mehta",
        "company_name": "TechCorp Innovations",
        "email": f"arjun_{ObjectId()}@techcorp.com",
    }
    scheduled_for = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=30)
    email_doc = {
        "_id": ObjectId(),
        "subject": "AI Engineering Partnership for TechCorp",
        "body": "Hi Arjun, loved your recent announcement regarding enterprise growth...",
        "scheduled_for": scheduled_for,
        "approver_name": "Super Admin User",
    }
    config = {
        "timezone": "Asia/Kolkata",
    }

    subject, body_html, body_text = await build_reminder_email_content(
        lead=lead,
        email_doc=email_doc,
        scheduled_for=scheduled_for,
        minutes_remaining=30,
        config=config,
    )

    assert "Arjun Mehta" in subject
    assert "TechCorp Innovations" in subject
    assert "IST" in body_html
    assert "30 minutes" in body_html
    assert "sends in 30 minutes" in body_text
    assert "Review in Scheduled Queue" in body_html
    assert "Reschedule" in body_html
    assert "Send Now" in body_html
    assert "Manual Release Policy" in body_html
    assert "not sent automatically" in body_text
    assert "token=" in body_html


# ==============================================================================
# 2. INTEGRATION TESTS: Backend Workflow & Idempotency
# ==============================================================================

@pytest.mark.asyncio
async def test_scheduled_reminder_lifecycle_and_idempotency():
    await connect_to_mongo()
    db = get_database()
    now = datetime.datetime.now(datetime.timezone.utc)

    # Setup Super Admin user
    super_admin_id = ObjectId()
    super_admin = {
        "_id": super_admin_id,
        "email": f"super_remind_{super_admin_id}@traininglobe.com",
        "name": "Reminder Admin",
        "password_hash": hash_password("Test@123"),
        "role": "SUPER_ADMIN",
        "active": True,
        "created_at": now,
    }
    await db.users.insert_one(super_admin)

    # Setup Lead with unique email
    lead_id = ObjectId()
    lead = {
        "_id": lead_id,
        "name": "Kavita Rao",
        "email": f"kavita_{lead_id}@cloudscale.io",
        "company_name": "CloudScale",
        "status": "Contacted",
        "owner_id": str(super_admin_id),
        "created_at": now,
    }
    await db.leads.insert_one(lead)

    # 1. Insert a scheduled email due for reminder right now
    email_id = ObjectId()
    scheduled_for = now + datetime.timedelta(minutes=25)
    reminder_at = now - datetime.timedelta(minutes=1)  # reminder is already due

    scheduled_email = {
        "_id": email_id,
        "lead_id": str(lead_id),
        "subject": "CloudScale Scaling Discussion",
        "body": "Hi Kavita, reaching out regarding enterprise AI upskilling.",
        "status": "Scheduled",
        "scheduled_for": scheduled_for,
        "approver_id": str(super_admin_id),
        "approver_name": "Reminder Admin",
        "approver_email": super_admin["email"],
        "reminder_at": reminder_at,
        "reminder_sent_at": None,
        "reminder_status": "pending",
        "reminder_retry_count": 0,
        "created_at": now,
    }
    await db.emails.insert_one(scheduled_email)

    # 2. Run process_due_reminders() (Simulate background worker)
    # This should process the reminder, send dry-run email, create notification, update reminder_sent_at
    processed_count = await process_due_reminders()
    assert processed_count >= 1

    # Check email document in DB
    updated_email = await db.emails.find_one({"_id": email_id})
    assert updated_email["reminder_status"] == "sent"
    assert updated_email["reminder_sent_at"] is not None

    # Check notification collection
    notif = await db.notifications.find_one({"scheduled_email_id": str(email_id)})
    assert notif is not None
    assert notif["type"] == "SCHEDULED_EMAIL_REMINDER"
    assert "Kavita Rao" in notif["title"]
    assert notif["lead_id"] == str(lead_id)

    # Check audit log
    audit_entry = await db.audit_logs.find_one({
        "action": "REMINDER_SENT",
        "entity_id": str(email_id),
    })
    assert audit_entry is not None

    # 3. IDEMPOTENCY TEST: Run process_due_reminders() a second time
    # Because reminder_sent_at is now set, it must NEVER send or duplicate the reminder
    second_processed = await process_due_reminders()
    # Count of notifications for this scheduled_email_id must still be exactly 1
    total_notifs = await db.notifications.count_documents({"scheduled_email_id": str(email_id)})
    assert total_notifs == 1


@pytest.mark.asyncio
async def test_reschedule_resets_reminder():
    await connect_to_mongo()
    db = get_database()
    now = datetime.datetime.now(datetime.timezone.utc)

    admin_id = ObjectId()
    lead_id = ObjectId()
    email_id = ObjectId()

    # Create admin user in db
    await db.users.insert_one({
        "_id": admin_id,
        "email": f"admin_resched_{admin_id}@traininglobe.com",
        "name": "Super Admin Test",
        "password_hash": hash_password("Test@123"),
        "role": "SUPER_ADMIN",
        "active": True,
        "created_at": now,
    })

    # Pre-existing email with reminder already sent
    scheduled_email = {
        "_id": email_id,
        "lead_id": str(lead_id),
        "subject": "Follow up consultation",
        "status": "Scheduled",
        "scheduled_for": now + datetime.timedelta(minutes=30),
        "approver_id": str(admin_id),
        "approver_name": "Admin",
        "approver_email": "admin@traininglobe.com",
        "reminder_at": now - datetime.timedelta(minutes=5),
        "reminder_sent_at": now - datetime.timedelta(minutes=5),
        "reminder_status": "sent",
        "created_at": now,
    }
    await db.emails.insert_one(scheduled_email)

    # Insert old notification
    await db.notifications.insert_one({
        "_id": ObjectId(),
        "type": "SCHEDULED_EMAIL_REMINDER",
        "scheduled_email_id": str(email_id),
        "title": "Old Reminder",
        "dismissed_at": None,
        "created_at": now,
    })

    # Reschedule to 3 hours in future
    new_time = now + datetime.timedelta(hours=3)
    lead = {
        "_id": lead_id,
        "name": "Test Reschedule Lead",
        "email": f"resched_{lead_id}@example.com",
    }
    await db.leads.insert_one(lead)

    super_token = create_access_token({"sub": str(admin_id), "role": "SUPER_ADMIN"})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.post(
            f"/api/approvals/{email_id}/reschedule",
            json={"scheduled_for": new_time.isoformat()},
            headers={"Authorization": f"Bearer {super_token}"},
        )
        assert res.status_code == 200

    # Verify reminder fields were reset
    reloaded = await db.emails.find_one({"_id": email_id})
    assert reloaded["reminder_status"] == "pending"
    assert reloaded["reminder_sent_at"] is None
    assert reloaded["reminder_at"] is not None
    expected_reminder = new_time - datetime.timedelta(minutes=30)
    reloaded_reminder = reloaded["reminder_at"]
    if reloaded_reminder.tzinfo is None:
        reloaded_reminder = reloaded_reminder.replace(tzinfo=datetime.timezone.utc)
    assert abs((reloaded_reminder - expected_reminder).total_seconds()) < 60

    # Old notification should be dismissed
    old_notif = await db.notifications.find_one({"scheduled_email_id": str(email_id)})
    assert old_notif["dismissed_at"] is not None


@pytest.mark.asyncio
async def test_cancel_pending_reminder():
    await connect_to_mongo()
    db = get_database()
    now = datetime.datetime.now(datetime.timezone.utc)

    email_id = ObjectId()
    lead_id = ObjectId()
    admin_id = ObjectId()

    # Create admin user in db
    await db.users.insert_one({
        "_id": admin_id,
        "email": f"admin_cancel_{admin_id}@traininglobe.com",
        "name": "Super Admin Test",
        "password_hash": hash_password("Test@123"),
        "role": "SUPER_ADMIN",
        "active": True,
        "created_at": now,
    })

    scheduled_email = {
        "_id": email_id,
        "lead_id": str(lead_id),
        "subject": "Cancel Test",
        "status": "Scheduled",
        "scheduled_for": now + datetime.timedelta(hours=1),
        "approver_id": str(admin_id),
        "reminder_at": now + datetime.timedelta(minutes=30),
        "reminder_sent_at": None,
        "reminder_status": "pending",
        "created_at": now,
    }
    await db.emails.insert_one(scheduled_email)
    await db.leads.insert_one({
        "_id": lead_id,
        "name": "Lead to Cancel",
        "email": f"cancel_{lead_id}@test.com",
    })

    # Reject draft (cancels delivery)
    super_token = create_access_token({"sub": str(admin_id), "role": "SUPER_ADMIN"})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.post(
            f"/api/approvals/{email_id}/reject",
            json={"reason": "Cancelled by admin", "regenerate": False},
            headers={"Authorization": f"Bearer {super_token}"},
        )
        assert res.status_code == 200

    reloaded = await db.emails.find_one({"_id": email_id})
    assert reloaded["reminder_status"] == "cancelled"


@pytest.mark.asyncio
async def test_notifications_api_endpoints():
    await connect_to_mongo()
    db = get_database()
    now = datetime.datetime.now(datetime.timezone.utc)

    super_id = ObjectId()
    staff_id = ObjectId()
    lead_own = ObjectId()
    lead_other = ObjectId()

    # Insert test users into DB so auth succeeds
    await db.users.insert_many([
        {
            "_id": super_id,
            "email": f"super_notif_{super_id}@traininglobe.com",
            "name": "Super Admin Test",
            "password_hash": hash_password("Test@123"),
            "role": "SUPER_ADMIN",
            "active": True,
            "created_at": now,
        },
        {
            "_id": staff_id,
            "email": f"staff_notif_{staff_id}@traininglobe.com",
            "name": "Staff Admin Test",
            "password_hash": hash_password("Test@123"),
            "role": "ADMIN",
            "active": True,
            "created_at": now,
        },
    ])

    await db.leads.insert_many([
        {"_id": lead_own, "name": "Staff Lead", "email": f"staff_{lead_own}@test.com", "owner_id": str(staff_id)},
        {"_id": lead_other, "name": "Other Lead", "email": f"other_{lead_other}@test.com", "owner_id": str(super_id)},
    ])

    notif_super = {
        "_id": ObjectId(),
        "type": "SCHEDULED_EMAIL_REMINDER",
        "title": "Super Admin Alert",
        "message": "Outreach goes out soon",
        "lead_id": str(lead_other),
        "scheduled_email_id": str(ObjectId()),
        "is_active": True,
        "read_at": None,
        "dismissed_at": None,
        "created_at": now,
    }
    notif_staff = {
        "_id": ObjectId(),
        "type": "SCHEDULED_EMAIL_REMINDER",
        "title": "Staff Admin Alert",
        "message": "Outreach goes out soon",
        "lead_id": str(lead_own),
        "scheduled_email_id": str(ObjectId()),
        "is_active": True,
        "read_at": None,
        "dismissed_at": None,
        "created_at": now,
    }
    await db.notifications.insert_many([notif_super, notif_staff])

    super_token = create_access_token({"sub": str(super_id), "role": "SUPER_ADMIN"})
    staff_token = create_access_token({"sub": str(staff_id), "role": "ADMIN"})

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Super Admin sees all notifications
        res_super = await ac.get("/api/notifications", headers={"Authorization": f"Bearer {super_token}"})
        assert res_super.status_code == 200
        super_notifs = res_super.json()
        assert any(n["id"] == str(notif_super["_id"]) for n in super_notifs)
        assert any(n["id"] == str(notif_staff["_id"]) for n in super_notifs)

        # Staff Admin only sees notifications for their own lead
        res_staff = await ac.get("/api/notifications", headers={"Authorization": f"Bearer {staff_token}"})
        assert res_staff.status_code == 200
        staff_notifs = res_staff.json()
        assert any(n["id"] == str(notif_staff["_id"]) for n in staff_notifs)
        assert not any(n["id"] == str(notif_super["_id"]) for n in staff_notifs)

        # Test mark read
        res_read = await ac.post(
            f"/api/notifications/{notif_super['_id']}/read",
            headers={"Authorization": f"Bearer {super_token}"},
        )
        assert res_read.status_code == 200
        assert res_read.json()["success"] is True

        # Test dismiss
        res_dismiss = await ac.post(
            f"/api/notifications/{notif_super['_id']}/dismiss",
            headers={"Authorization": f"Bearer {super_token}"},
        )
        assert res_dismiss.status_code == 200
        assert res_dismiss.json()["success"] is True


@pytest.mark.asyncio
async def test_scheduled_email_not_sent_automatically():
    """Verify that background scheduler NEVER automatically dispatches scheduled emails."""
    from app.services.scheduler_service import check_scheduled_deliveries
    await connect_to_mongo()
    db = get_database()
    now = datetime.datetime.now(datetime.timezone.utc)

    email_id = ObjectId()
    lead_id = ObjectId()
    admin_id = ObjectId()

    # Scheduled email past its scheduled_for time
    scheduled_email = {
        "_id": email_id,
        "lead_id": str(lead_id),
        "subject": "Hold Until Manual Release",
        "status": "Scheduled",
        "scheduled_for": now - datetime.timedelta(minutes=30),  # In the past
        "approver_id": str(admin_id),
        "sent_at": None,
        "created_at": now,
    }
    await db.emails.insert_one(scheduled_email)

    # Run check_scheduled_deliveries
    await check_scheduled_deliveries()

    # Verify email was NOT sent and remains in Scheduled status awaiting manual admin release
    reloaded = await db.emails.find_one({"_id": email_id})
    assert reloaded["status"] == "Scheduled"
    assert reloaded["sent_at"] is None
