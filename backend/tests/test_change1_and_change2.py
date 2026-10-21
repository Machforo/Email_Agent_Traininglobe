import pytest
import datetime
from httpx import AsyncClient, ASGITransport
from bson import ObjectId

from app.main import app
from app.core.database import connect_to_mongo, get_database
from app.core.security import create_access_token, hash_password
from app.services.ai_service import (
    generate_first_outreach_mock,
    generate_followup_mock,
    generate_reply_mock,
    verify_grounding,
    format_greeting,
    is_gcc_region,
    resolve_service_line,
    draft_first_email,
)
from app.services.delivery_service import send_approved_email


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


# ==============================================================================
# Change 2: 8-Part Reference Email Structure, Length & Verified KB Tests
# ==============================================================================

def test_first_outreach_mock_word_count_and_eight_parts():
    """
    Verify first-outreach draft has 180-240 words and contains all eight template parts.
    """
    lead_name = "Tamara Fayad"
    company_name = "QIG"
    summary = "digital transformation across its diversified industrial, technology, marine, property and financial-services portfolio"
    
    verified_kb = {
        "APPROVED_CLAIMS": [
            {
                "title": "Track Record across GCC",
                "content": "Across the GCC region, we have delivered 500+ corporate cohorts and upskilled 15,000+ professionals with a 98% satisfaction rating.",
                "region": "GCC",
                "status": "Verified"
            },
            {
                "title": "Productivity & ROI Impact",
                "content": "Our practical workshops typically boost employee productivity by 10%-40% while delivering immediate business ROI and operational capability gains.",
                "status": "Verified"
            }
        ],
        "REFERENCE_CLIENTS": [
            {
                "title": "Enterprise AI Reference Clients",
                "content": "Our experience includes programs with QatarEnergy, Saudi Aramco helping organizations build practical enterprise AI capabilities.",
                "approved_for_outreach": True,
                "status": "Verified"
            }
        ],
        "SERVICES": [
            {
                "title": "Workshop Format",
                "content": "High-impact, 1-to-3-day executive and technical AI workshops built on 100% live simulation sandbox labs.",
                "status": "Verified"
            }
        ]
    }

    subject, body = generate_first_outreach_mock(
        lead_name=lead_name,
        company_name=company_name,
        summary=summary,
        sender_name="Pallabi Hansda",
        sender_designation="Business Development Manager",
        company_legal_name="Traininglobe Consultancy Pvt. Ltd.",
        is_gcc=True,
        role_or_industry="diversified industrial technology",
        verified_kb=verified_kb
    )

    word_count = len(body.split())
    assert 180 <= word_count <= 240, f"Expected 180-240 words, got {word_count}"

    # Part 1: Greeting
    assert "Tamara Fayad,\n\nI hope this message finds you well." in body

    # Part 2: Sender introduction & Track record
    assert "I am Pallabi Hansda from Traininglobe Consultancy Pvt. Ltd." in body
    assert "leading global digital transformation and AI training organization" in body
    assert "Across the GCC region, we have delivered 500+ corporate cohorts and upskilled 15,000+ professionals with a 98% satisfaction rating." in body

    # Part 3: Company paragraph
    assert "With QIG continuing its digital transformation across its diversified industrial" in body

    # Part 4: Offering paragraph
    assert "1-to-3-day executive and technical AI workshops built on 100% live simulation sandbox labs" in body
    assert "Microsoft 365 Copilot" in body
    assert "AI Strategy & Governance" in body

    # Part 5: Impact paragraph
    assert "boost employee productivity by 10%-40%" in body

    # Part 6: Experience paragraph (reference clients)
    assert "QatarEnergy, Saudi Aramco" in body

    # Part 7: Soft CTA
    assert "Would you be open to a brief discussion next week to explore how this could complement QIG's current digital transformation and strategic priorities?" in body

    # Part 8: Signature block
    assert "Best regards,\nPallabi Hansda\nBusiness Development Manager\nTraininglobe Consultancy Pvt. Ltd." in body
    assert "Traininglobe Outreach Team" not in body


def test_first_outreach_omits_reference_clients_when_none_approved():
    """
    Verify experience paragraph is omitted when no reference clients are approved in knowledge base.
    """
    verified_kb = {
        "APPROVED_CLAIMS": [
            {
                "title": "Track Record",
                "content": "Across the GCC region, we have delivered 500+ corporate cohorts and upskilled 15,000+ professionals with a 98% satisfaction rating.",
                "region": "GCC",
                "status": "Verified"
            }
        ],
        "REFERENCE_CLIENTS": [
            # NOT approved for outreach
            {
                "title": "Reference Clients",
                "content": "Programs with QatarEnergy, Saudi Aramco.",
                "approved_for_outreach": False,
                "status": "Verified"
            }
        ]
    }

    subject, body = generate_first_outreach_mock(
        lead_name="Kavita Rao",
        company_name="Apex Logistics",
        summary="Logistics automation and fleet operations",
        sender_name="Pallabi Hansda",
        sender_designation="Business Development Manager",
        company_legal_name="Traininglobe Consultancy Pvt. Ltd.",
        is_gcc=True,
        verified_kb=verified_kb
    )

    word_count = len(body.split())
    assert 180 <= word_count <= 240, f"Expected 180-240 words without reference clients, got {word_count}"
    assert "QatarEnergy" not in body
    assert "Saudi Aramco" not in body
    assert "Our experience includes programs with" not in body


def test_first_outreach_never_contains_unverified_numbers():
    """
    Verify draft never contains unverified numbers when facts are Pending verification.
    """
    pending_kb = {
        "APPROVED_CLAIMS": [
            # Pending verification - must NOT be used
        ],
        "REFERENCE_CLIENTS": []
    }

    subject, body = generate_first_outreach_mock(
        lead_name="David Miller",
        company_name="Solace Tech",
        summary="Enterprise cloud software",
        sender_name="Pallabi Hansda",
        sender_designation="Business Development Manager",
        company_legal_name="Traininglobe Consultancy Pvt. Ltd.",
        is_gcc=False,
        verified_kb=pending_kb
    )

    word_count = len(body.split())
    assert 180 <= word_count <= 240, f"Expected 180-240 words, got {word_count}"
    # Must NOT invent unverified numbers
    assert "500+" not in body
    assert "15,000+" not in body
    assert "98%" not in body
    assert "QatarEnergy" not in body
    assert "Saudi Aramco" not in body


def test_first_outreach_gcc_vs_non_gcc_regional_rule():
    """
    Regional rule: 'Across the GCC region' must ONLY be used for leads in GCC.
    Leads outside GCC must never receive the regional GCC phrase.
    """
    lead_gcc = {"name": "Rashid Al-Kuwari", "email": "rashid@qig.qa", "company_name": "QIG Qatar"}
    lead_us = {"name": "John Doe", "email": "john@usacorp.com", "company_name": "USA Corp", "extra_fields": {"Country": "United States"}}

    assert is_gcc_region(lead_gcc) is True
    assert is_gcc_region(lead_us) is False

    # GCC Lead
    _, body_gcc = generate_first_outreach_mock(
        lead_name=lead_gcc["name"],
        company_name=lead_gcc["company_name"],
        summary="Industrial and marine engineering",
        is_gcc=True
    )
    assert "Across the GCC region" in body_gcc

    # Non-GCC Lead
    _, body_non_gcc = generate_first_outreach_mock(
        lead_name=lead_us["name"],
        company_name=lead_us["company_name"],
        summary="Global retail software infrastructure",
        is_gcc=False
    )
    assert "Across the GCC region" not in body_non_gcc


def test_first_outreach_thin_research_honest_fallback():
    """
    When research is thin, use the honest generic fallback line without inventing initiatives.
    """
    _, body_thin = generate_first_outreach_mock(
        lead_name="Sarah Connor",
        company_name="Cyberdyne",
        summary="",  # Thin research
        is_gcc=True
    )

    word_count = len(body_thin.split())
    assert 180 <= word_count <= 240, f"Expected 180-240 words for thin research, got {word_count}"
    assert "With Cyberdyne continuing to advance its operational and technical initiatives, we see strong potential to support your team's AI skills development." in body_thin


def test_greeting_fallback_on_missing_or_slug_name():
    """
    Greeting logic: fallback to 'Hello,' if name is missing or looks like an email prefix/slug.
    """
    assert format_greeting("Tamara Fayad") == "Tamara Fayad,"
    assert format_greeting("user_12345") == "Hello,"
    assert format_greeting("tamara@domain.com") == "Hello,"
    assert format_greeting("lead_99") == "Hello,"
    assert format_greeting("") == "Hello,"
    assert format_greeting(None) == "Hello,"


def test_service_line_detection_and_review_flag():
    """
    Matches service line based on industry/tags. If ambiguous, flags draft for human review.
    """
    # AI workshop industry
    ai_lead = {"industry": "Artificial Intelligence & Digital Transformation", "company_name": "Nexus AI"}
    s_ai, flag_ai, _ = resolve_service_line(ai_lead)
    assert s_ai == "Enterprise AI Workshops"
    assert flag_ai is False

    # Campus placement industry
    campus_lead = {"industry": "University Engineering College", "company_name": "Apex Institute of Tech"}
    s_camp, flag_camp, _ = resolve_service_line(campus_lead)
    assert s_camp == "Campus Placement"
    assert flag_camp is False

    # Ambiguous / thin lead -> Flagged for human review
    vague_lead = {"industry": "", "company_name": "Unknown Entity", "extra_fields": {}}
    s_vague, flag_vague, reason_vague = resolve_service_line(vague_lead)
    assert flag_vague is True
    assert "Unclear service line" in reason_vague


def test_followup_mock_word_count_and_distinct_angles():
    lead_name = "Rohit Verma"
    company_name = "Vertex AI Labs"

    # Stage 1: Live simulation sandbox labs & 10%-40% productivity boost
    sub1, body1 = generate_followup_mock(
        lead_name=lead_name,
        company_name=company_name,
        stage=1,
        previous_subject="Practical AI capability building for Vertex AI Labs",
    )
    wc1 = len(body1.split())
    assert 100 <= wc1 <= 170, f"Stage 1 follow-up expected 100-170 words, got {wc1}"
    assert "100% live simulation sandbox labs" in body1
    assert "10%-40%" in body1
    assert "Traininglobe Outreach Team" not in body1
    assert "Pallabi Hansda" in body1

    # Stage 2: Executive AI governance & leadership strategy
    sub2, body2 = generate_followup_mock(
        lead_name=lead_name,
        company_name=company_name,
        stage=2,
        previous_subject="Practical AI capability building for Vertex AI Labs",
    )
    wc2 = len(body2.split())
    assert 100 <= wc2 <= 170, f"Stage 2 follow-up expected 100-170 words, got {wc2}"
    assert "AI Strategy & Governance" in body2 or "Executive Leadership Strategy" in body2
    assert body1 != body2

    # Stage 3: Graceful final check-in
    sub3, body3 = generate_followup_mock(
        lead_name=lead_name,
        company_name=company_name,
        stage=3,
        previous_subject="Practical AI capability building for Vertex AI Labs",
    )
    wc3 = len(body3.split())
    assert 100 <= wc3 <= 170, f"Stage 3 follow-up expected 100-170 words, got {wc3}"
    assert "final follow-up" in body3.lower() or "final" in body3.lower()


def test_reply_mock_word_count_and_pricing_grounding():
    lead_name = "Anita Desai"
    company_name = "Apex Cloud"

    inbound_pricing = "What is the cost of your executive AI workshops and do you provide bulk discounts?"
    sub, body = generate_reply_mock(
        lead_name=lead_name,
        company_name=company_name,
        detected_intent="Pricing concern",
        incoming_message=inbound_pricing,
        previous_subject="Practical AI capability building for Apex Cloud",
    )
    wc = len(body.split())
    assert 100 <= wc <= 200, f"Reply expected 100-200 words, got {wc}"
    assert "Pallabi Hansda" in body
    assert "Traininglobe Outreach Team" not in body
    assert "$" not in body
    assert "100% placement guarantee" not in body
    assert "discount" not in body or "tailored" in body.lower() or "customized" in body.lower()


# ==============================================================================
# Change 1: Endpoint Removal & Governance Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_regenerate_longer_endpoint_is_removed():
    """
    Change 1: The 'Regenerate longer' API endpoint must be completely removed.
    Calling POST /api/approvals/{draft_id}/regenerate-longer should return 404 or 405.
    """
    await connect_to_mongo()
    db = get_database()
    now = datetime.datetime.now(datetime.timezone.utc)
    admin_id = ObjectId()
    draft_id = ObjectId()

    await db.users.insert_one({
        "_id": admin_id,
        "email": f"admin_test_{admin_id}@traininglobe.com",
        "name": "Super Admin Test",
        "password_hash": hash_password("Test@123"),
        "role": "SUPER_ADMIN",
        "active": True,
        "created_at": now,
    })

    super_token = create_access_token({"sub": str(admin_id), "role": "SUPER_ADMIN"})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.post(
            f"/api/approvals/{draft_id}/regenerate-longer",
            headers={"Authorization": f"Bearer {super_token}"},
        )
        # Endpoint removed -> 404 Not Found (or 405 Method Not Allowed)
        assert res.status_code in [404, 405], f"Expected 404/405 for removed endpoint, got {res.status_code}"


@pytest.mark.asyncio
async def test_delivery_service_rejects_empty_body():
    await connect_to_mongo()
    db = get_database()
    draft_id = ObjectId()
    lead_id = ObjectId()
    await db.leads.insert_one({"_id": lead_id, "name": "Test", "email": f"test_{draft_id}@lead.com"})
    await db.emails.insert_one({
        "_id": draft_id,
        "lead_id": str(lead_id),
        "status": "Approved",
        "approved_by": str(ObjectId()),
        "body": "   ",
    })
    with pytest.raises(ValueError, match="Draft .* has an empty body"):
        await send_approved_email(str(draft_id), {"id": str(ObjectId())})


@pytest.mark.asyncio
async def test_template_library_and_preview_api():
    """
    Verify template listing and preview endpoint functionality.
    """
    await connect_to_mongo()
    db = get_database()
    now = datetime.datetime.now(datetime.timezone.utc)
    admin_id = ObjectId()

    await db.users.insert_one({
        "_id": admin_id,
        "email": f"staff_test_{admin_id}@traininglobe.com",
        "name": "Staff Admin Test",
        "password_hash": hash_password("Test@123"),
        "role": "STAFF_ADMIN",
        "active": True,
        "created_at": now,
    })

    token = create_access_token({"sub": str(admin_id), "role": "STAFF_ADMIN"})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # 1. List templates
        res = await ac.get("/api/settings/templates", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        tpls = res.json()
        assert len(tpls) >= 5

        # 2. Preview template
        preview_res = await ac.post(
            "/api/settings/templates/preview",
            json={"template_id": tpls[0]["id"]},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert preview_res.status_code == 200
        data = preview_res.json()
        assert "rendered_subject" in data
        assert "rendered_body" in data
        assert data["word_count"] >= 150
