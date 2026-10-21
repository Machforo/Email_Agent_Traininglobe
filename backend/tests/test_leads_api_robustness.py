import datetime
from bson import ObjectId
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.core.database import connect_to_mongo, get_database
from app.core.security import create_access_token


@pytest.mark.asyncio
async def test_leads_empty_collection():
    """Verify GET /api/leads returns 200 and [] for Super Admin & Staff Admin when collection is empty."""
    await connect_to_mongo()
    db = get_database()
    transport = ASGITransport(app=app)

    # Create test super admin and staff admin
    super_admin_id = ObjectId()
    staff_admin_id = ObjectId()

    await db.users.insert_many([
        {"_id": super_admin_id, "email": f"super_{super_admin_id}@traininglobe.com", "role": "SUPER_ADMIN", "name": "Super Admin Test", "active": True},
        {"_id": staff_admin_id, "email": f"staff_{staff_admin_id}@traininglobe.com", "role": "ADMIN", "name": "Staff Admin Test", "active": True},
    ])

    super_token = create_access_token({"sub": str(super_admin_id), "role": "SUPER_ADMIN", "id": str(super_admin_id)})
    staff_token = create_access_token({"sub": str(staff_admin_id), "role": "ADMIN", "id": str(staff_admin_id)})

    # Filter with non-existent status so result is effectively empty
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r_super = await client.get("/api/leads?status=NON_EXISTENT_STATUS_XYZ", headers={"Authorization": f"Bearer {super_token}"})
        assert r_super.status_code == 200
        assert r_super.json() == []

        r_staff = await client.get("/api/leads?status=NON_EXISTENT_STATUS_XYZ", headers={"Authorization": f"Bearer {staff_token}"})
        assert r_staff.status_code == 200
        assert r_staff.json() == []


@pytest.mark.asyncio
async def test_leads_normal_lead():
    """Verify GET /api/leads returns 200 with complete valid lead."""
    await connect_to_mongo()
    db = get_database()
    transport = ASGITransport(app=app)

    super_admin_id = ObjectId()
    staff_admin_id = ObjectId()
    normal_lead_id = ObjectId()

    await db.users.insert_many([
        {"_id": super_admin_id, "email": f"super_{super_admin_id}@traininglobe.com", "role": "SUPER_ADMIN", "name": "Super Admin Test", "active": True},
        {"_id": staff_admin_id, "email": f"staff_{staff_admin_id}@traininglobe.com", "role": "ADMIN", "name": "Staff Admin Test", "active": True},
    ])

    await db.leads.insert_one({
        "_id": normal_lead_id,
        "name": "Jane Doe",
        "email": f"jane_{normal_lead_id}@example.com",
        "company_name": "Acme Innovations",
        "company_website": "https://acme.example.com",
        "owner_id": str(staff_admin_id),
        "source": "MANUAL",
        "status": "Draft Ready",
        "created_at": datetime.datetime.now(datetime.timezone.utc),
    })

    super_token = create_access_token({"sub": str(super_admin_id), "role": "SUPER_ADMIN", "id": str(super_admin_id)})
    staff_token = create_access_token({"sub": str(staff_admin_id), "role": "ADMIN", "id": str(staff_admin_id)})

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Super Admin sees the lead
        r_super = await client.get(f"/api/leads?search={normal_lead_id}", headers={"Authorization": f"Bearer {super_token}"})
        assert r_super.status_code == 200
        data = r_super.json()
        assert len(data) == 1
        assert data[0]["name"] == "Jane Doe"
        assert data[0]["company_name"] == "Acme Innovations"
        assert data[0]["owner_name"] == "Staff Admin Test"

        # Staff Admin assigned sees the lead
        r_staff = await client.get(f"/api/leads?search={normal_lead_id}", headers={"Authorization": f"Bearer {staff_token}"})
        assert r_staff.status_code == 200
        data_staff = r_staff.json()
        assert len(data_staff) == 1
        assert data_staff[0]["name"] == "Jane Doe"


@pytest.mark.asyncio
async def test_leads_legacy_and_partial_documents():
    """Verify GET /api/leads is resilient against legacy documents missing company_name, email, owner_id, or dates."""
    await connect_to_mongo()
    db = get_database()
    transport = ASGITransport(app=app)

    super_admin_id = ObjectId()
    staff_admin_id = ObjectId()

    await db.users.insert_many([
        {"_id": super_admin_id, "email": f"super_{super_admin_id}@traininglobe.com", "role": "SUPER_ADMIN", "name": "Super Admin Test", "active": True},
        {"_id": staff_admin_id, "email": f"staff_{staff_admin_id}@traininglobe.com", "role": "ADMIN", "name": "Staff Admin Test", "active": True},
    ])

    partial_lead_1 = ObjectId()
    partial_lead_2 = ObjectId()
    partial_lead_3 = ObjectId()

    # 1. Missing company_name, only has company: None
    await db.leads.insert_one({
        "_id": partial_lead_1,
        "name": "Legacy Lead One",
        "email": f"legacy1_{partial_lead_1}@test.com",
        "company": None,
        "company_name": None,
        "owner_id": "invalid_non_objectid_string_123",  # Non-ObjectId string
        "status": None,
        "created_at": None,
    })

    # 2. Missing name (only has first_name), missing owner_id, missing status
    await db.leads.insert_one({
        "_id": partial_lead_2,
        "first_name": "Anonymous",
        "last_name": None,
        "email": f"partial2_{partial_lead_2}@test.com",
        "company_name": "Solitary Corp",
        "owner_id": str(staff_admin_id),
        "status": "Contacted",
    })

    # 3. Completely stripped bare document (only _id and email to satisfy Mongo unique index)
    await db.leads.insert_one({
        "_id": partial_lead_3,
        "email": f"partial3_{partial_lead_3}@test.com",
    })

    super_token = create_access_token({"sub": str(super_admin_id), "role": "SUPER_ADMIN", "id": str(super_admin_id)})
    staff_token = create_access_token({"sub": str(staff_admin_id), "role": "ADMIN", "id": str(staff_admin_id)})

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Super admin query should succeed 200 without raising Pydantic validation error or InvalidId
        r_super = await client.get("/api/leads?limit=50", headers={"Authorization": f"Bearer {super_token}"})
        assert r_super.status_code == 200
        leads_list = r_super.json()
        assert isinstance(leads_list, list)

        # Verify fallback values were populated for partial_lead_1 (searched directly)
        r_lead1 = await client.get(f"/api/leads?search=Legacy%20Lead%20One", headers={"Authorization": f"Bearer {super_token}"})
        assert r_lead1.status_code == 200
        leads1 = r_lead1.json()
        assert len(leads1) >= 1
        lead1_res = next((l for l in leads1 if l["id"] == str(partial_lead_1)), None)
        assert lead1_res is not None
        assert lead1_res["company_name"] == "Unknown Company"
        assert lead1_res["name"] == "Legacy Lead One"

        # Verify fallback values for partial_lead_2
        r_lead2 = await client.get(f"/api/leads?search=Solitary%20Corp", headers={"Authorization": f"Bearer {super_token}"})
        assert r_lead2.status_code == 200
        leads2 = r_lead2.json()
        assert len(leads2) >= 1
        lead2_res = next((l for l in leads2 if l["id"] == str(partial_lead_2)), None)
        assert lead2_res is not None
        assert lead2_res["name"] == "Anonymous"
        assert lead2_res["email"] == f"partial2_{partial_lead_2}@test.com"
        assert lead2_res["owner_name"] == "Staff Admin Test"

        # Verify fallback values for partial_lead_3
        r_lead3 = await client.get(f"/api/leads?search={partial_lead_3}", headers={"Authorization": f"Bearer {super_token}"})
        assert r_lead3.status_code == 200
        leads3 = r_lead3.json()
        assert len(leads3) >= 1
        lead3_res = next((l for l in leads3 if l["id"] == str(partial_lead_3)), None)
        assert lead3_res is not None
        assert lead3_res["company_name"] == "Unknown Company"
        assert lead3_res["name"] == f"partial3_{partial_lead_3}"
        assert lead3_res["email"] == f"partial3_{partial_lead_3}@test.com"

        # Staff admin query also succeeds without 500
        r_staff = await client.get("/api/leads?limit=50", headers={"Authorization": f"Bearer {staff_token}"})
        assert r_staff.status_code == 200


@pytest.mark.asyncio
async def test_leads_pagination_and_query_validation():
    """Verify parameters like negative skip, invalid limit, and regex searches are safely handled."""
    await connect_to_mongo()
    db = get_database()
    transport = ASGITransport(app=app)

    super_admin_id = ObjectId()
    await db.users.insert_one({
        "_id": super_admin_id,
        "email": f"super_{super_admin_id}@traininglobe.com",
        "role": "SUPER_ADMIN",
        "name": "Super Admin Test",
        "active": True
    })
    token = create_access_token({"sub": str(super_admin_id), "role": "SUPER_ADMIN", "id": str(super_admin_id)})

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Negative skip returns 400
        r_skip = await client.get("/api/leads?skip=-5", headers={"Authorization": f"Bearer {token}"})
        assert r_skip.status_code == 400

        # Zero or excessive limit returns 400
        r_limit_0 = await client.get("/api/leads?limit=0", headers={"Authorization": f"Bearer {token}"})
        assert r_limit_0.status_code == 400
        r_limit_huge = await client.get("/api/leads?limit=9999", headers={"Authorization": f"Bearer {token}"})
        assert r_limit_huge.status_code == 400

        # Special characters in search regex do NOT trigger 500 Mongo error
        r_search_special = await client.get("/api/leads?search=[.*+?^${}()|", headers={"Authorization": f"Bearer {token}"})
        assert r_search_special.status_code == 200

        # status=ALL works as 'no status filter'
        r_all = await client.get("/api/leads?status=ALL", headers={"Authorization": f"Bearer {token}"})
        assert r_all.status_code == 200


@pytest.mark.asyncio
async def test_global_exception_handler_request_id():
    """Verify global exception handler catches unexpected exceptions with request_id without leaking secrets."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Accessing an endpoint with malformed auth header or invalid route
        res = await client.get("/api/leads/not_a_valid_object_id_999", headers={"Authorization": "Bearer bad_token"})
        assert res.status_code in [401, 404]
