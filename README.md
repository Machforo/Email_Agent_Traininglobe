# Outreach Agent — Traininglobe

An AI-assisted outreach dashboard for institutional sales. A team member adds an
institution and a note about the angle they want; a chain of agents researches the
institution on the live web, writes the mail, fact-checks every claim against
sources, revises what doesn't hold up, and hands it to a human. **Nothing is sent
until a person presses Approve.** After that the system runs the follow-up ladder,
watches for replies, and drafts responses.

---

## Architecture

The app is split across two hosts because the agent cascade takes 145–355 seconds and
no serverless platform will hold a request open that long (Vercel caps at 60s on Hobby,
300s on Pro).

```
Vercel  →  Next.js app: UI, fast reads, enqueues jobs   (responds in ~0.5s)
Render  →  worker: all AI and all email, drains queue   (takes 145-355s)
Render  →  managed Postgres, shared by both
```

Nothing slow or outward-facing runs inside an HTTP request. The app writes a `Job` row
and returns a job id; the UI polls it. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Quick start (local)

Three terminals. No Postgres install needed — `npm run pg` serves PGlite (real Postgres
compiled to WASM) over the Postgres wire protocol, so local matches production.

```bash
npm install
```

```bash
npm run pg
```

```bash
npx prisma migrate deploy && npm run db:seed && npm run dev
```

```bash
npm run worker
```

Open http://localhost:3000 and sign in.

| Account | Email | Password |
|---|---|---|
| Admin | `atharv.kumar@webisdom.com` | `ChangeMe@123` |
| Members | `member1@traininglobe.com` … `member4@…` | `Member@123` |

**Change these passwords before anyone else uses the system.**

On first sign-in each member is asked for their own Gmail **app password**. Mail then
sends from their own address, so replies come back to them and threading works.

---

## The agent cascade

Each stage is a separate model call, and every one is recorded on the draft so the
reviewer can see exactly what happened (the "Agent trace" tab).

```
Research  ─ groq/compound-mini ──── live web search: what the institution is,
   │                                 recent developments, observable gaps + why
   ▼
Structure ─ llama-3.3-70b ────────── evidence → gaps / solutions / hooks (JSON)
   │
   ▼
Compose   ─ gpt-oss-120b ─────────── writes the mail from research + template
   │                                 + the member's notes + learned feedback
   ▼
Verify    ─ groq/compound-mini ───── fact-checks every claim on the web; confirms
   │                                 the recipient actually holds the stated role
   ▼
Revise    ─ gpt-oss-120b ─────────── applies the corrections, deletes what can't
   │                                 be supported (loops up to N times)
   ▼
HUMAN APPROVAL ───────────────────── edit, approve, or reject with a reason
   │
   ▼
Send      ─ Gmail SMTP ───────────── tracked, threaded, signed
```

The verifier does real work. On a test run it flagged the composer for inventing a
"Digital Innovation Centre", fabricating IBM/Microsoft partnerships, and asserting an
unsupported placement outcome — all before a human saw the draft.

### Why the models are split up

Groq rate limits are **per model but shared across every API key in the org** — this
was verified: the remaining-token counter drops no matter which key is used, so
rotating keys buys reliability, not throughput. Throughput comes from spreading the
cascade across models, each with its own budget:

| Model | Tokens/min | Used for |
|---|---|---|
| `groq/compound-mini` | 70,000 (250 req/window) | web research, fact-checking |
| `llama-3.3-70b-versatile` | 12,000 | JSON structuring, reply analysis, insights |
| `openai/gpt-oss-120b` | 8,000 | writing and revising the actual prose |
| `openai/gpt-oss-20b` | 8,000 | small utility jobs |

`src/lib/ai/limiter.ts` paces requests through a rolling token ledger per model and
honours the exact `retry-after` the API returns (it asks for 30+ seconds sometimes).
Because of this pacing a full cascade takes **90–180 seconds on the free tier**. A paid
Groq tier removes most of that wait; nothing else needs to change.

Reasoning models spend hidden reasoning tokens out of the same completion budget, so
strict JSON mode can fail mid-object. `chatJson` catches that and retries once with a
larger budget and lenient parsing rather than failing the pipeline.

### Gemini fallback

Groq's free tier is tight, so `gemini-flash-latest` (~1M token context) backs it up in
two situations: a prompt too large for the per-model budget — long threads, big
research dumps, many accumulated feedback rules — and Groq exhausting its retries on
rate limits or 5xx. The switch is automatic and shows up in the agent trace as
`gemini-flash-latest (fallback)`.

It deliberately does **not** cover the search models. Gemini's `google_search`
grounding is quota-blocked on the current key, so falling back there would turn a
web-grounded fact-check into an ungrounded guess — the pipeline fails loudly instead.
Malformed-request errors don't trigger it either; only capacity problems do, so real
bugs stay visible. `npm run fallback-check` verifies all four behaviours.

---

## What the system does after the first mail

- **Follow-ups.** Three by default, three days apart, configurable. Each is written
  fresh against the thread, must add something new, and gets shorter each time. They
  land in the approval queue unless an admin turns on auto-send.
- **Replies.** The worker polls each member's mailbox over IMAP (read-only — it never
  marks anything seen or moves mail). A reply is matched to its sequence by RFC
  threading headers, summarised, classified for sentiment and intent, and the
  follow-up clock is stopped. A response is drafted for approval.
- **Bounces.** Detected from delivery-status reports. Hard bounces suppress the
  address and stop the sequence.
- **Unsubscribes.** One-click, honoured via `List-Unsubscribe`, and enforced at send
  time from a suppression list.

## The learning loop

Every edit a reviewer makes before approving is diffed against the AI original, and a
model distils the difference into a one-line rule ("open with their own recent
announcement rather than a compliment"). Rejections with a reason, and rules typed
directly in Settings, feed the same store. Those rules are injected into every later
prompt for that member; admins can make a rule team-wide. Settings → *What the AI has
learned* shows and lets you disable them.

## Analytics

Per-member by default; admins can switch to the whole team and drill into anyone.
Sends, delivery, opens, clicks, replies, sentiment split, bounce rate, per-stage reply
rate (which touch actually earns the reply), time-to-first-reply, and an AI analyst
read of the numbers with specific changes to make.

Chart colours use the first three slots of the reference categorical palette,
validated for both light and dark surfaces. Light-mode aqua falls just below the 3:1
contrast line, so every chart ships a legend *and* a table view.

---

## Layout

```
prisma/schema.prisma      data model (Postgres via Prisma 7 driver adapter)
src/lib/ai/               groq client, rate limiter, model routing, agents, pipeline
src/lib/email/            SMTP send, IMAP poll, tracking pixel + click rewriting
src/lib/jobs/             the work queue: enqueue, atomic claim, handlers
src/lib/analytics.ts      all statistics
src/worker/               queue runner + cron: follow-ups, inbox polling, housekeeping
src/app/(dashboard)/      the UI
src/app/api/              REST API — enqueues, never executes
scripts/                  operational checks (below)
```

## Checks

```bash
npm run typecheck
```

```bash
npm run e2e
```

```bash
npm run pagecheck
```

```bash
npm run mailcheck
```

```bash
npm run runs
```

- `typecheck` — tsc, no emit
- `e2e` — full API walkthrough including a real agent cascade (~3 min). Deliberately
  stops before approval, because approving sends a real email.
- `pagecheck` — every dashboard route renders for a logged-in admin
- `mailcheck` — verifies Gmail SMTP + IMAP credentials; sends nothing
- `runs` — last 12 agent calls with models, tokens, latency and errors
- `fallback-check` — confirms Gemini takes over on oversize prompts and never on search
- `pollcheck` — times a real IMAP poll and shows the UID watermark
- `jobs` — state of the work queue; the first thing to check when work seems stuck

**Deploying: see [DEPLOYMENT.md](DEPLOYMENT.md).**

---

## Security notes

- Gmail app passwords are encrypted at rest with AES-256-GCM (`ENCRYPTION_KEY`) and
  only decrypted at send time.
- Sessions are HTTP-only signed JWT cookies. `middleware.ts` only checks that a cookie
  exists — real authorisation happens server-side in every route via `requireUser()` /
  `requireAdmin()`.
- Members can only read and act on their own records; admins see everything. This is
  enforced per route, not in the UI.
- The click-tracking redirect only forwards to `http`/`https`, so it can't be used as
  an open redirect to `javascript:`.
- `.env` holds live secrets and is git-ignored. **The Groq API keys and the Gmail app
  password currently in it were shared in chat — rotate them before this goes anywhere
  real.**

## Known limits

- **The worker is not optional.** If it is down, drafts sit at "Waiting for the worker"
  forever and no follow-up or reply is ever processed. `npm run jobs` shows the queue.
- Open tracking undercounts (image blocking) and overcounts (mail-client prefetch).
  Hits within 10s of sending are ignored, but treat opens as a trend, not a fact.
- Gmail's own sending limits apply on top of the per-user daily cap.
- Case-study files are stored in Postgres, capped at 15MB. That is the right call while
  both hosts need to read them; if the library grows large, move to object storage.
- The send path is exercised by unit-level checks but **no real mail has been sent from
  this install yet** — do one test send to your own address before running a campaign.
- Local dev uses PGlite, which is single-process. It is a faithful Postgres for
  development but must never be used in production.
