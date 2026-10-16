# Traininglobe AI Lead Nurturing

> **Intelligent, Grounded B2B Outreach with Mandatory Human Approval Gatekeeper**

An enterprise-grade AI lead nurturing and cadence management platform integrated with **Zoho CRM** and **Zoho Mail**. The system researches target accounts, synthesizes personalized emails grounded exclusively in verified Traininglobe corporate credentials, tracks replies with automated intent classification, and enforces a **strict backend gatekeeper requiring explicit human admin approval before any email can be dispatched**.

---

## 🌟 Key Architecture & Principles

1. **Mandatory Human Approval Gatekeeper**:
   - AI drafts are stored in `Draft Ready` status and **can NEVER be dispatched automatically**.
   - The delivery service checks for `status == "Approved"`, a non-null `approved_by` user ID, and absence from the `opt_out_suppression` table before dispatching.
   - Any attempt to bypass human approval triggers an immediate `403 Forbidden` and is permanently logged in the audit trail.
2. **Zero-Hallucination Knowledge Base Grounding**:
   - AI prompt contexts are anchored strictly to verified claims stored in the `knowledge_base` collection (accreditations, course curricula, delivery formats, verified metrics).
   - Zero invented pricing, guarantees, or partner names.
3. **Zoho CRM & Zoho Mail Integration**:
   - OAuth 2.0 refresh-token flow with automated access token refresh and token caching.
   - Pulls and updates leads from Zoho CRM (`/crm/v6/Leads`).
   - Dispatches approved emails via Zoho Mail API (`/mail/v1/accounts/{accountId}/messages`).
   - Includes transparent **Dry-Run Mode** (`ZOHO_DRY_RUN=true`) allowing complete UI and cadence testing with zero risk of sending unapproved emails.
4. **Intelligent Inbound Reply Classifier**:
   - Classifies replies into 8 intents: `Interested`, `Asks a question`, `Pricing concern`, `Contact me later`, `Requests a proposal`, `No reply`, `Not interested / asks to stop`, and `Agrees to collaborate`.
   - On opt-out, automatically halts cadence, adds the contact to global suppression, and tags the lead in Zoho CRM.
5. **Strict Role-Based Access Control (RBAC)**:
   - **Super Admin**: Full visibility over all leads, users, approval queues, dispatch policies, and audit trails.
   - **Admin / Sales Rep**: Scoped access restricted strictly to leads assigned to their user ID.

---

## 🛠️ Tech Stack

- **Backend**: Python 3.10+ / FastAPI / Motor (Async MongoDB) / Pydantic v2 / APScheduler
- **Database**: MongoDB Atlas (`traininglobe_lead_nurturing`)
- **Frontend**: React 19 / Tailwind CSS v4 / Vite / Lucide React / Modern Glassmorphism UI
- **LLM Engine**: Multi-provider support (Groq / Gemini / OpenAI) with deterministic grounded fallback
- **Authentication**: JWT Bearer Tokens with bcrypt password hashing

---

## 🔐 Credentials & Default Accounts

| Role | Email | Password | Access Level |
| :--- | :--- | :--- | :--- |
| **Super Admin** | `admin@traininglobe.com` | `121archis` | Global Queue, All Leads, KB, Audit, Rules |
| **Sales Rep Admin** | `member1@traininglobe.com` | `Member@123` | Scoped to assigned leads |

---

## 🚀 Quickstart Guide

### 1. Prerequisites
- Python 3.10+ installed
- Node.js 20+ and npm installed
- MongoDB Atlas connection string (`MONGO_URI` in `.env`)

### 2. Backend Setup & Startup

```bash
# Navigate to backend directory
cd backend

# Install Python dependencies
pip install -r requirements.txt

# Run database seed script (creates users, sample leads, knowledge base facts)
python seed_data.py

# Start FastAPI development server
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

The FastAPI backend will be live at:
- **API Base**: `http://127.0.0.1:8000/api`
- **Interactive Swagger Docs**: `http://127.0.0.1:8000/docs`

### 3. Frontend Setup & Startup

```bash
# Navigate to frontend directory
cd frontend

# Install Node dependencies
npm install

# Start Vite dev server
npm run dev
```

The React Admin Dashboard will be live at:
- **Web App**: `http://localhost:5173/`

---

## 🧪 Testing the Human Approval Gatekeeper & Core Workflows

Run the automated backend test suite (covering approval gate bypass prevention, opt-out suppression, intent classification, idempotency, and RBAC):

```bash
cd backend
pytest tests/test_lead_nurturing.py -v
```

### Manual Interactive Walkthrough via UI
1. Open `http://localhost:5173/` in your browser.
2. Sign in with `admin@traininglobe.com` / `121archis`.
3. **Dashboard**: Notice the amber alert banner warning of pending drafts requiring human review.
4. **Approval Queue**:
   - Inspect lead research intelligence and synthesized draft.
   - Test **1-Click Approve & Send Now** (dispatches immediately through the delivery gatekeeper).
   - Test **Edit Draft** (character counters and tone adjustment).
   - Test **Schedule for Later** (selects business hours window).
   - Test **Reject with Feedback** (optionally triggers instant grounded re-draft).
5. **Leads Portfolio**:
   - Search leads, filter by lifecycle status, or click **+ Add New Lead**.
   - Click **Sync Zoho CRM** to pull latest CRM records.
   - Click any lead to open the **Lead Detail Modal**.
   - Navigate to the **Inbound Reply Simulator** tab to test prospect replies (e.g. "Can we talk Tuesday?", "Unsubscribe me") and see live AI intent classification.
6. **Knowledge Base & System Rules**:
   - Add/remove verified facts in the grounding repository.
   - Configure daily sending limits and dispatch windows.
7. **Security & Audit Trail**:
   - Inspect immutable logs of every human approval, rejection, and dispatch.

---

## 🔑 Zoho CRM & Zoho Mail Setup Guide

The application connects to Zoho using the standard OAuth 2.0 refresh-token flow.

### Step 1: Create a Zoho API Client
1. Navigate to the [Zoho API Console](https://api-console.zoho.com).
2. Click **Add Client** and select **Server-based Applications**.
3. Fill in:
   - **Client Name**: `Traininglobe AI Nurturing`
   - **Homepage URL**: `https://traininglobe.com`
   - **Authorized Redirect URIs**: `http://localhost:8000/api/auth/zoho/callback`
4. Copy the generated **Client ID** and **Client Secret**.

### Step 2: Generate Zoho OAuth Grant Token
In your browser, visit the authorization URL (substitute your actual Client ID and Zoho domain, e.g., `.in` or `.com`):
```text
https://accounts.zoho.in/oauth/v2/auth?scope=ZohoCRM.modules.leads.ALL,ZohoMail.messages.ALL,ZohoMail.accounts.READ,offline_access&client_id=YOUR_CLIENT_ID&response_type=code&access_type=offline&redirect_uri=http://localhost:8000/api/auth/zoho/callback
```
Authorize access. Zoho will redirect to your callback with a `code` query parameter (the Grant Token).

### Step 3: Exchange Grant Token for Refresh Token
Execute a `POST` request to generate the permanent Refresh Token:
```bash
curl -X POST https://accounts.zoho.in/oauth/v2/token \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=http://localhost:8000/api/auth/zoho/callback" \
  -d "code=YOUR_GRANT_TOKEN"
```
The JSON response contains your permanent `refresh_token`.

### Step 4: Configure `.env`
Add your Zoho credentials to `.env`:
```ini
ZOHO_CLIENT_ID="REDACTED"
ZOHO_CLIENT_SECRET="REDACTED"
ZOHO_REFRESH_TOKEN="REDACTED"
ZOHO_AUTH_URL=https://accounts.zoho.in
ZOHO_API_DOMAIN=https://www.zohoapis.in
ZOHO_FROM_EMAIL=outreach@traininglobe.com
ZOHO_DRY_RUN=false
```

> **Note on Dry-Run Mode**: Setting `ZOHO_DRY_RUN=true` allows safe testing with simulated CRM leads and dispatches without consuming API quotas or sending real emails.

---

## 📡 REST API Summary

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Authenticate and obtain JWT access token |
| `GET` | `/api/auth/me` | Fetch authenticated user profile and permissions |
| `GET` | `/api/reports/metrics` | Pipeline overview, reply rates, and funnel stats |
| `GET` | `/api/approvals` | List drafts requiring mandatory human approval |
| `POST` | `/api/approvals/{id}/approve` | **Admin approval gatekeeper** (dispatch or schedule) |
| `POST` | `/api/approvals/{id}/edit` | Modify draft subject/body prior to approval |
| `POST` | `/api/approvals/{id}/reject` | Reject draft with feedback & optional regeneration |
| `POST` | `/api/approvals/{id}/reschedule` | Change scheduled delivery date & time |
| `GET` | `/api/leads` | List leads (scoped by user role) with search/filter |
| `POST` | `/api/leads` | Register target lead and kick off AI research |
| `POST` | `/api/leads/import/csv` | Bulk import leads from CSV |
| `POST` | `/api/leads/sync/zoho` | Synchronize leads directly from Zoho CRM |
| `GET` | `/api/emails/thread/{lead_id}` | Retrieve complete conversation history |
| `POST` | `/api/emails/inbound/webhook` | Process prospect replies & classify intent |
| `GET` | `/api/settings/knowledge-base` | View verified facts for hallucination-free AI |
| `POST` | `/api/settings/knowledge-base` | Add verified claim to AI grounding store |
| `GET` | `/api/audit` | View immutable security audit trail |

---

## 🔒 Security & Compliance Assurance

- **Zero Unapproved Emails**: Dispatches without a valid `approved_by` user ID are rejected by backend assertions.
- **CAN-SPAM Compliant**: Every email automatically incorporates physical office address and an unsubscribe mechanism.
- **Opt-Out Suppression**: Instant addition to MongoDB suppression collection upon negative intent detection.
- **Audit Logging**: Every action (approve, reject, edit, reschedule, send) generates an immutable, non-deletable audit entry.
