import pytest
import datetime
from httpx import AsyncClient, ASGITransport
from bson import ObjectId

from app.main import app
from app.core.database import connect_to_mongo, close_mongo_connection, get_database
from app.core.security import create_access_token, hash_password


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


@pytest.mark.asyncio
async def test_staff_admin_readonly_and_super_admin_permissions():
    await connect_to_mongo()
    db = get_database()
    now = datetime.datetime.now(datetime.timezone.utc)

    # 1. Setup mock test users in DB
    staff_user_id = ObjectId()
    super_user_id = ObjectId()
    other_user_id = ObjectId()

    staff_user = {
        "_id": staff_user_id,
        "email": f"test_staff_{staff_user_id}@traininglobe.com",
        "name": "Staff Rep Test",
        "password_hash": hash_password("Test@123"),
        "role": "ADMIN",
        "active": True,
        "created_at": now
    }
    super_user = {
        "_id": super_user_id,
        "email": f"test_super_{super_user_id}@traininglobe.com",
        "name": "Super Admin Test",
        "password_hash": hash_password("Test@123"),
        "role": "SUPER_ADMIN",
        "active": True,
        "created_at": now
    }
    await db.users.insert_many([staff_user, super_user])

    # Generate JWT tokens
    staff_token = create_access_token({"sub": str(staff_user_id), "role": "ADMIN"})
    super_token = create_access_token({"sub": str(super_user_id), "role": "SUPER_ADMIN"})

    staff_headers = {"Authorization": f"Bearer {staff_token}"}
    super_headers = {"Authorization": f"Bearer {super_token}"}

    # 2. Setup mock leads: one owned by staff, one owned by other user
    own_lead_id = ObjectId()
    other_lead_id = ObjectId()

    own_lead = {
        "_id": own_lead_id,
        "name": "Own Lead",
        "email": f"own_{own_lead_id}@example.com",
        "company_name": "Own Company",
        "owner_id": str(staff_user_id),
        "status": "Draft Ready",
        "created_at": now,
        "updated_at": now
    }
    other_lead = {
        "_id": other_lead_id,
        "name": "Other Lead",
        "email": f"other_{other_lead_id}@example.com",
        "company_name": "Other Company",
        "owner_id": str(other_user_id),
        "status": "Draft Ready",
        "created_at": now,
        "updated_at": now
    }
    await db.leads.insert_many([own_lead, other_lead])

    # Setup mock drafts
    own_draft_id = ObjectId()
    other_draft_id = ObjectId()

    own_draft = {
        "_id": own_draft_id,
        "lead_id": str(own_lead_id),
        "direction": "OUTBOUND",
        "kind": "FIRST_TOUCH",
        "status": "Draft Ready",
        "subject": "Own Subject",
        "body": "Own Body",
        "created_at": now
    }
    other_draft = {
        "_id": other_draft_id,
        "lead_id": str(other_lead_id),
        "direction": "OUTBOUND",
        "kind": "FIRST_TOUCH",
        "status": "Draft Ready",
        "subject": "Other Subject",
        "body": "Other Body",
        "created_at": now
    }
    await db.emails.insert_many([own_draft, other_draft])

    # Setup mock knowledge base item
    kb_id = ObjectId()
    await db.knowledge_base.insert_one({
        "_id": kb_id,
        "category": "USP",
        "title": "Test Fact",
        "content": "Test Grounded Fact Content",
        "updated_at": now
    })

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # --- TEST 1: /auth/me returns permissions and is_read_only ---
        me_staff = await client.get("/api/auth/me", headers=staff_headers)
        assert me_staff.status_code == 200
        staff_data = me_staff.json()
        assert staff_data["is_read_only"] is True
        assert "leads:read" in staff_data["permissions"]
        assert "leads:write" not in staff_data["permissions"]
        assert "settings:read" not in staff_data["permissions"]

        me_super = await client.get("/api/auth/me", headers=super_headers)
        assert me_super.status_code == 200
        super_data = me_super.json()
        assert super_data["is_read_only"] is False
        assert "leads:write" in super_data["permissions"]
        assert "settings:read" in super_data["permissions"]

        # --- TEST 2: Staff Admin gets 200 on all permitted GET endpoints ---
        r_metrics = await client.get("/api/reports/metrics", headers=staff_headers)
        assert r_metrics.status_code == 200

        r_leads = await client.get("/api/leads", headers=staff_headers)
        assert r_leads.status_code == 200

        r_own_lead = await client.get(f"/api/leads/{own_lead_id}", headers=staff_headers)
        assert r_own_lead.status_code == 200

        r_approvals = await client.get("/api/approvals", headers=staff_headers)
        assert r_approvals.status_code == 200
        # Scoped to own leads
        app_items = r_approvals.json()
        assert all(item["draft"]["lead_id"] == str(own_lead_id) for item in app_items)

        r_thread = await client.get(f"/api/emails/thread/{own_lead_id}", headers=staff_headers)
        assert r_thread.status_code == 200

        r_scheduled = await client.get("/api/emails/scheduled", headers=staff_headers)
        assert r_scheduled.status_code == 200

        r_kb = await client.get("/api/settings/knowledge-base", headers=staff_headers)
        assert r_kb.status_code == 200

        r_audit = await client.get("/api/audit", headers=staff_headers)
        assert r_audit.status_code == 200

        # --- TEST 3: Staff Admin is blocked from GET /settings (dispatch & cadence rules) ---
        r_settings_get = await client.get("/api/settings", headers=staff_headers)
        assert r_settings_get.status_code == 403

        # --- TEST 4: Scoping - Staff Admin cannot read another owner's lead ---
        r_other_lead = await client.get(f"/api/leads/{other_lead_id}", headers=staff_headers)
        assert r_other_lead.status_code in [403, 404]

        r_other_thread = await client.get(f"/api/emails/thread/{other_lead_id}", headers=staff_headers)
        assert r_other_thread.status_code in [403, 404]

        # --- TEST 5: Every write endpoint returns 403 for Staff Admin ---
        error_msg = "Read-only access: your role cannot perform this action"

        # 5a. Lead write endpoints
        r1 = await client.post("/api/leads", json={"email": "new@lead.com", "name": "New"}, headers=staff_headers)
        assert r1.status_code == 403
        assert error_msg in r1.json()["detail"]

        r2 = await client.put(f"/api/leads/{own_lead_id}", json={"name": "Updated"}, headers=staff_headers)
        assert r2.status_code == 403
        assert error_msg in r2.json()["detail"]

        r3 = await client.delete(f"/api/leads/{own_lead_id}", headers=staff_headers)
        assert r3.status_code == 403
        assert error_msg in r3.json()["detail"]

        r4 = await client.post("/api/leads/import/csv", files={"file": ("test.csv", b"name,email\na,b@c.com")}, headers=staff_headers)
        assert r4.status_code == 403
        assert error_msg in r4.json()["detail"]

        r5 = await client.post("/api/leads/sync/zoho", headers=staff_headers)
        assert r5.status_code == 403
        assert error_msg in r5.json()["detail"]

        # 5b. Approval & draft write endpoints
        r6 = await client.post(f"/api/approvals/{own_draft_id}/approve", headers=staff_headers)
        assert r6.status_code == 403
        assert error_msg in r6.json()["detail"]

        r7 = await client.post(f"/api/approvals/{own_draft_id}/edit", json={"subject": "S", "body": "B"}, headers=staff_headers)
        assert r7.status_code == 403
        assert error_msg in r7.json()["detail"]

        r8 = await client.post(f"/api/approvals/{own_draft_id}/reject", json={"reason": "R", "regenerate": False}, headers=staff_headers)
        assert r8.status_code == 403
        assert error_msg in r8.json()["detail"]

        r9 = await client.post(f"/api/approvals/{own_draft_id}/reschedule", json={"scheduled_for": now.isoformat()}, headers=staff_headers)
        assert r9.status_code == 403
        assert error_msg in r9.json()["detail"]

        # 5c. Webhook / simulation
        r10 = await client.post("/api/emails/inbound/webhook", json={"from_email": "x@y.com", "subject": "Re:", "body": "Hi"}, headers=staff_headers)
        assert r10.status_code == 403
        assert error_msg in r10.json()["detail"]

        # 5d. Settings & Knowledge write endpoints
        r11 = await client.put("/api/settings", json={"daily_limit": 10}, headers=staff_headers)
        assert r11.status_code == 403
        assert error_msg in r11.json()["detail"]

        r12 = await client.post("/api/settings/knowledge-base", json={"category": "USP", "title": "T", "content": "C"}, headers=staff_headers)
        assert r12.status_code == 403
        assert error_msg in r12.json()["detail"]

        r13 = await client.delete(f"/api/settings/knowledge-base/{kb_id}", headers=staff_headers)
        assert r13.status_code == 403
        assert error_msg in r13.json()["detail"]

        # 5e. Users management
        r14 = await client.get("/api/auth/users", headers=staff_headers)
        assert r14.status_code == 403

        r15 = await client.post("/api/auth/users", json={"email": "u@t.com", "name": "U", "password": "P"}, headers=staff_headers)
        assert r15.status_code == 403

        # --- TEST 6: ACCESS_DENIED audit log verification ---
        denied_logs = await db.audit_logs.find({"action": "ACCESS_DENIED", "user_id": str(staff_user_id)}).to_list(100)
        assert len(denied_logs) > 0, "Denied write attempts must be logged in the audit trail"

        # --- TEST 7: Super Admin can still perform actions ---
        r_super_settings = await client.get("/api/settings", headers=super_headers)
        assert r_super_settings.status_code == 200

        r_super_other_lead = await client.get(f"/api/leads/{other_lead_id}", headers=super_headers)
        assert r_super_other_lead.status_code == 200

    # Cleanup test data
    await db.users.delete_many({"_id": {"$in": [staff_user_id, super_user_id]}})
    await db.leads.delete_many({"_id": {"$in": [own_lead_id, other_lead_id]}})
    await db.emails.delete_many({"_id": {"$in": [own_draft_id, other_draft_id]}})
    await db.knowledge_base.delete_one({"_id": kb_id})
    await db.audit_logs.delete_many({"user_id": str(staff_user_id)})
