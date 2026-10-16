import datetime
import pytest
from app.models.lead import LeadStatus, can_transition
from app.services.delivery_service import send_approved_email
from app.services.ai_service import classify_reply_intent
from app.core.security import get_user_scope_filter


# ------------------------------------------------------------------------------
# 1. State Transitions Validation Tests
# ------------------------------------------------------------------------------
def test_valid_lifecycle_transitions():
    """Verify allowed state transitions in the lead lifecycle."""
    assert can_transition(LeadStatus.NEW_LEAD.value, LeadStatus.DRAFT_READY.value) is True
    assert can_transition(LeadStatus.DRAFT_READY.value, LeadStatus.CONTACTED.value) is True
    assert can_transition(LeadStatus.CONTACTED.value, LeadStatus.ENGAGED.value) is True
    assert can_transition(LeadStatus.CONTACTED.value, LeadStatus.FOLLOWUP_PENDING.value) is True
    assert can_transition(LeadStatus.ENGAGED.value, LeadStatus.QUALIFIED.value) is True
    assert can_transition(LeadStatus.QUALIFIED.value, LeadStatus.CONVERTED.value) is True
    assert can_transition(LeadStatus.ENGAGED.value, LeadStatus.OPTED_OUT.value) is True


def test_invalid_lifecycle_transitions():
    """Verify prohibited state transitions are blocked."""
    # Terminal Converted state cannot jump back to New Lead
    assert can_transition(LeadStatus.CONVERTED.value, LeadStatus.NEW_LEAD.value) is False
    assert can_transition(LeadStatus.CONVERTED.value, LeadStatus.DRAFT_READY.value) is False
    # Opted Out is a terminal suppression state
    assert can_transition(LeadStatus.OPTED_OUT.value, LeadStatus.CONTACTED.value) is False
    assert can_transition(LeadStatus.OPTED_OUT.value, LeadStatus.DRAFT_READY.value) is False


# ------------------------------------------------------------------------------
# 2. RBAC Query Isolation Tests
# ------------------------------------------------------------------------------
def test_rbac_super_admin_scope():
    """Super Admin must have an empty filter to access all leads organization-wide."""
    super_admin_user = {"id": "super_admin_123", "role": "SUPER_ADMIN", "name": "Super Admin"}
    scope = get_user_scope_filter(super_admin_user)
    assert scope == {}


def test_rbac_admin_scope_enforcement():
    """Admin query filter must restrict access strictly to their assigned owner_id."""
    admin_user = {"id": "admin_456", "role": "ADMIN", "name": "Sales Rep"}
    scope = get_user_scope_filter(admin_user)
    assert scope == {"owner_id": "admin_456"}


# ------------------------------------------------------------------------------
# 3. Intent Classification & Opt-out Detection Tests
# ------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_intent_classification_opt_out():
    """Verify opt-out intent is detected with top confidence."""
    reply = "Please unsubscribe me from these emails and remove me from your list."
    result = await classify_reply_intent(reply)
    assert result["intent"] == "Not interested / asks to stop"
    assert result["confidence"] >= 0.95


@pytest.mark.asyncio
async def test_intent_classification_interested():
    """Verify interest intent detection."""
    reply = "Sounds interesting. Could you send your calendar link so we can connect?"
    result = await classify_reply_intent(reply)
    assert result["intent"] == "Interested"


@pytest.mark.asyncio
async def test_intent_classification_contact_later():
    """Verify 'contact me later' extracts follow-up date."""
    reply = "We are super busy with exams this month, please follow up in next quarter."
    result = await classify_reply_intent(reply)
    assert result["intent"] == "Contact me later"
    assert result["preferred_contact_date"] is not None


# ------------------------------------------------------------------------------
# 4. Mandatory Approval Enforcement Tests
# ------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_refusal_to_send_unapproved_email(monkeypatch):
    """Verify backend delivery service refuses to send emails not marked 'Approved'."""
    from app.core import database

    class MockDB:
        emails = None

    class MockEmailColl:
        async def find_one(self, query):
            return {
                "_id": "mock_draft_id",
                "lead_id": "mock_lead_id",
                "status": "Draft Ready",  # Not approved!
                "subject": "Test",
                "body": "Hello",
                "approved_by": None
            }

    mock_db = MockDB()
    mock_db.emails = MockEmailColl()
    monkeypatch.setattr(database, "get_database", lambda: mock_db)

    with pytest.raises(PermissionError) as exc_info:
        await send_approved_email("507f1f77bcf86cd799439011", {"id": "admin_123", "name": "Admin"})

    assert "Current status is 'Draft Ready', but must be 'Approved'" in str(exc_info.value)


@pytest.mark.asyncio
async def test_refusal_to_send_without_approver_id(monkeypatch):
    """Verify backend delivery service refuses to send without a human approver attribution."""
    from app.core import database

    class MockDB:
        emails = None

    class MockEmailColl:
        async def find_one(self, query):
            return {
                "_id": "mock_draft_id",
                "lead_id": "mock_lead_id",
                "status": "Approved",
                "subject": "Test",
                "body": "Hello",
                "approved_by": None
            }

    mock_db = MockDB()
    mock_db.emails = MockEmailColl()
    monkeypatch.setattr(database, "get_database", lambda: mock_db)

    # Empty approver user dict
    with pytest.raises(PermissionError) as exc_info:
        await send_approved_email("507f1f77bcf86cd799439011", {})

    assert "Missing mandatory human approver ID" in str(exc_info.value)


# ------------------------------------------------------------------------------
# 5. Opt-out Suppression Gate Tests
# ------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_opt_out_suppression_blocks_delivery(monkeypatch):
    """Verify delivery gatekeeper halts sending if recipient email is on suppression list."""
    from app.core import database

    class MockEmailColl:
        async def find_one(self, query):
            return {
                "_id": "507f1f77bcf86cd799439011",
                "lead_id": "507f1f77bcf86cd799439012",
                "status": "Approved",
                "subject": "Test",
                "body": "Hello",
                "approved_by": "admin_1"
            }
        async def update_one(self, *args, **kwargs):
            return None

    class MockLeadColl:
        async def find_one(self, query):
            return {"_id": "507f1f77bcf86cd799439012", "email": "optedout@prospect.com", "status": "Contacted"}
        async def update_one(self, *args, **kwargs):
            return None

    class MockSuppressionColl:
        async def find_one(self, query):
            return {"email": "optedout@prospect.com", "reason": "PROSPECT_UNSUBSCRIBE"}

    class MockDB:
        emails = MockEmailColl()
        leads = MockLeadColl()
        opt_out_suppression = MockSuppressionColl()

    monkeypatch.setattr(database, "get_database", lambda: MockDB())

    with pytest.raises(PermissionError) as exc_info:
        await send_approved_email("507f1f77bcf86cd799439011", {"id": "admin_1", "name": "Admin"})

    assert "is on the opt-out suppression list" in str(exc_info.value)


# ------------------------------------------------------------------------------
# 6. Idempotency & Duplicate-Send Prevention Tests
# ------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_duplicate_send_idempotency_protection(monkeypatch):
    """Verify that calling send_approved_email on an already 'Sent' draft returns without re-sending."""
    from app.core import database

    class MockDB:
        def __init__(self):
            self.emails = self

        async def find_one(self, query):
            return {
                "_id": "507f1f77bcf86cd799439011",
                "lead_id": "507f1f77bcf86cd799439012",
                "status": "Sent",  # Already sent!
                "subject": "Test",
                "body": "Hello",
                "approved_by": "admin_1",
                "sent_at": datetime.datetime.now(datetime.timezone.utc)
            }

    monkeypatch.setattr(database, "get_database", lambda: MockDB())

    result = await send_approved_email("507f1f77bcf86cd799439011", {"id": "admin_1", "name": "Admin"})
    assert result["status"] == "Sent"
