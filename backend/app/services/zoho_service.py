import datetime
import uuid
from typing import Any, Dict, List, Optional
import httpx

from app.core.config import settings

# In-memory access token cache
_cached_access_token: Optional[str] = None
_token_expiry: Optional[datetime.datetime] = None
_cached_account_id: Optional[str] = None
_cached_from_address: Optional[str] = None


def get_zoho_mail_domain() -> str:
    return "https://mail.zoho.in" if "zoho.in" in settings.ZOHO_AUTH_URL else "https://mail.zoho.com"


async def get_zoho_mail_account(token: str) -> tuple[Optional[str], Optional[str]]:
    """Discover user's accountId and verified fromAddress in Zoho Mail."""
    global _cached_account_id, _cached_from_address
    if _cached_account_id and _cached_from_address:
        return _cached_account_id, _cached_from_address

    mail_domain = get_zoho_mail_domain()
    headers = {"Authorization": f"Zoho-oauthtoken {token}"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{mail_domain}/api/accounts", headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                for acc in data.get("data", []):
                    acc_id = acc.get("accountId")
                    send_details = acc.get("sendMailDetails", [])
                    from_addr = None
                    if send_details and isinstance(send_details, list):
                        from_addr = send_details[0].get("fromAddress")
                    chosen_from = from_addr or acc.get("primaryEmailAddress") or settings.ZOHO_FROM_EMAIL
                    if acc_id:
                        _cached_account_id = str(acc_id)
                        _cached_from_address = chosen_from
                        return _cached_account_id, _cached_from_address
    except Exception:
        pass
    return None, settings.ZOHO_FROM_EMAIL


async def get_zoho_access_token() -> Optional[str]:
    """Retrieve or refresh Zoho OAuth 2.0 access token using refresh_token grant."""
    global _cached_access_token, _token_expiry

    if settings.ZOHO_DRY_RUN or not settings.ZOHO_REFRESH_TOKEN or not settings.ZOHO_CLIENT_ID:
        return "mock_zoho_access_token"

    now = datetime.datetime.now(datetime.timezone.utc)
    if _cached_access_token and _token_expiry and now < _token_expiry:
        return _cached_access_token

    params = {
        "refresh_token": settings.ZOHO_REFRESH_TOKEN,
        "client_id": settings.ZOHO_CLIENT_ID,
        "client_secret": settings.ZOHO_CLIENT_SECRET,
        "grant_type": "refresh_token"
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(f"{settings.ZOHO_AUTH_URL}/oauth/v2/token", params=params)
            if resp.status_code == 200:
                data = resp.json()
                _cached_access_token = data.get("access_token")
                expires_in = data.get("expires_in", 3600)
                _token_expiry = now + datetime.timedelta(seconds=expires_in - 120)
                return _cached_access_token
    except Exception:
        pass

    return None


async def sync_leads_from_zoho_crm() -> List[Dict[str, Any]]:
    """Fetch recent leads from Zoho CRM API or return simulated CRM leads in Dry-Run mode."""
    if settings.ZOHO_DRY_RUN or not settings.ZOHO_CLIENT_ID:
        # Realistic simulated leads for testing
        return [
            {
                "zoho_lead_id": f"zoho_lead_{uuid.uuid4().hex[:8]}",
                "name": "Arjun Mehta",
                "email": f"arjun.mehta_{uuid.uuid4().hex[:4]}@techcorp-demo.in",
                "company_name": "TechCorp Innovations",
                "company_website": "https://techcorp-demo.in",
                "source": "ZOHO_CRM",
                "extra_fields": {"City": "Bengaluru", "Industry": "Software & AI"}
            },
            {
                "zoho_lead_id": f"zoho_lead_{uuid.uuid4().hex[:8]}",
                "name": "Priya Sharma",
                "email": f"priya.sharma_{uuid.uuid4().hex[:4]}@cloudwave-labs.com",
                "company_name": "CloudWave Labs",
                "company_website": "https://cloudwave-labs.com",
                "source": "ZOHO_CRM",
                "extra_fields": {"City": "Hyderabad", "Industry": "Cloud Infrastructure"}
            }
        ]

    token = await get_zoho_access_token()
    if not token:
        return []

    headers = {"Authorization": f"Zoho-oauthtoken {token}"}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(f"{settings.ZOHO_API_DOMAIN}/crm/v2/Leads", headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                results = []
                for item in data.get("data", []):
                    results.append({
                        "zoho_lead_id": item.get("id"),
                        "name": f"{item.get('First_Name', '')} {item.get('Last_Name', '')}".strip() or item.get("Full_Name", "Lead"),
                        "email": item.get("Email"),
                        "company_name": item.get("Company", "Organization"),
                        "company_website": item.get("Website"),
                        "source": "ZOHO_CRM",
                        "extra_fields": item
                    })
                return [r for r in results if r["email"]]
    except Exception:
        pass

    return []


async def update_zoho_lead_status(zoho_lead_id: str, new_status: str) -> bool:
    """Sync status changes back to Zoho CRM."""
    if not zoho_lead_id or settings.ZOHO_DRY_RUN or not settings.ZOHO_CLIENT_ID:
        return True

    token = await get_zoho_access_token()
    if not token:
        return False

    headers = {"Authorization": f"Zoho-oauthtoken {token}"}
    payload = {
        "data": [
            {
                "id": zoho_lead_id,
                "Lead_Status": new_status
            }
        ]
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.put(f"{settings.ZOHO_API_DOMAIN}/crm/v2/Leads/{zoho_lead_id}", json=payload, headers=headers)
            return resp.status_code in (200, 201)
    except Exception:
        return False


async def send_email_via_zoho(
    recipient_email: str,
    subject: str,
    body_text: str,
    in_reply_to: Optional[str] = None
) -> Dict[str, Any]:
    """
    Send an email through Zoho Mail / CRM Email API.
    Returns tracking metadata (message_id, zoho_message_id, status).
    """
    if settings.ZOHO_DRY_RUN or not settings.ZOHO_CLIENT_ID:
        # Mock successful send in Dry-Run mode
        simulated_msg_id = f"<{uuid.uuid4().hex[:16]}@zoho.traininglobe.com>"
        return {
            "success": True,
            "message_id": simulated_msg_id,
            "zoho_message_id": f"dry_run_{uuid.uuid4().hex[:12]}",
            "dry_run": True,
            "note": "Email simulated in dry-run mode (no external Zoho call made)."
        }

    token = await get_zoho_access_token()
    if not token:
        return {"success": False, "error": "Unable to obtain Zoho OAuth access token"}

    account_id, from_address = await get_zoho_mail_account(token)
    if not account_id:
        return {"success": False, "error": "Unable to discover Zoho Mail accountId for authenticated user"}

    mail_domain = get_zoho_mail_domain()
    headers = {
        "Authorization": f"Zoho-oauthtoken {token}",
        "Content-Type": "application/json"
    }
    payload = {
        "fromAddress": from_address,
        "toAddress": recipient_email,
        "subject": subject,
        "content": body_text
    }
    if in_reply_to:
        payload["inReplyTo"] = in_reply_to

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{mail_domain}/api/accounts/{account_id}/messages",
                headers=headers,
                json=payload
            )
            if resp.status_code in (200, 201):
                data = resp.json()
                msg_info = data.get("data", {})
                message_id = msg_info.get("mailId") or msg_info.get("messageId") or f"<{uuid.uuid4().hex}@zoho.com>"
                zoho_msg_id = str(msg_info.get("messageId") or msg_info.get("mailId") or "")
                return {
                    "success": True,
                    "message_id": message_id,
                    "zoho_message_id": zoho_msg_id,
                    "dry_run": False
                }
            return {"success": False, "error": f"Zoho API returned HTTP {resp.status_code}: {resp.text}"}
    except Exception as e:
        return {"success": False, "error": str(e)}
