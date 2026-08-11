# Information — how this system works

Read this first if you are picking up the codebase, or if you are on the team and want
to understand what the tool is actually doing on your behalf.

- **Using it day to day?** Read [Part 1](#part-1--what-it-does) and stop.
- **Working on the code?** Carry on to [Part 2](#part-2--how-it-is-built).

---

# Part 1 — What it does

## The job it replaces

The team's manual process was: collect an institution's email → research them deeply →
find a gap and why it exists → work out the solution → write a mail → fact-check the
details → send → follow up at day 3, 6 and 9 → handle the reply.

This system does every step except the judgement calls. A human still decides what goes
out — **nothing is ever sent without someone pressing Approve.**

## The five-minute version

1. **Add a prospect.** Institution name, the contact's email, and a note about the angle
   you want. That note matters more than anything else you type — it steers the whole
   mail.
2. **Press "Draft mail".** Five AI agents run in sequence: one researches the
   institution on the live web, one writes the email, one fact-checks every claim it
   made, one rewrites whatever could not be supported. Takes 2–6 minutes. You can close
   the window; it keeps running and notifies you.
3. **Review it.** Four tabs: the email, the **Verification report**, the **Research**,
   and the **Agent trace**. Read the verification tab before anything else.
4. **Approve.** The mail sends from *your* Gmail, so replies come back to you.
5. **The system takes it from there.** Follow-ups at day 3, 6 and 9, each written fresh
   and each shorter than the last. If they reply, follow-ups stop immediately, the reply
   is summarised, and a response is drafted for your approval.

## The screens

| Screen | What it is for |
|---|---|
| **Overview** | Your numbers, what is waiting on you, what is scheduled |
| **Prospects** | Institutions you are targeting. Add one, or import a CSV |
| **Approvals** | Every draft waiting for a human. This is where the real work happens |
| **Sequences** | Every live conversation and where it sits in the follow-up ladder |
| **Replies** | Inbound mail, summarised and classified, with a response drafted |
| **Templates** | The structure and tone you want. The AI rewrites them per institution |
| **Case studies** | PDFs and decks to attach — best used on follow-up 2 |
| **Analytics** | Your performance, plus an AI read of what to change |
| **Admin** | Team performance, accounts, system settings (admins only) |
| **Settings** | Your mailbox connection and what the AI has learned from you |

## Things worth understanding

**"REVISE" is the normal verdict, not a problem.** The fact-checker is strict on
purpose. It regularly catches the writer inventing a research centre, a partnership, or
a placement statistic. Read the corrections — they tell you where it overreached.

**Editing a draft is not wasted effort.** When you edit before approving, the system
diffs your version against the AI's and distils the difference into a rule it follows
next time. Rejecting *with a reason* teaches it even more. You can see and switch off
every rule in Settings.

**Your mailbox is yours.** Each person supplies their own Gmail app password. Mail sends
from your address, threading works, and replies land in your inbox. The password is
encrypted and only decrypted at the moment of sending.

**The system reads your inbox, narrowly.** It checks for replies every five minutes, and
only ever opens mail from addresses you are in an active conversation with, or bounce
notices. Everything else is skipped unread. It never marks anything as read and never
moves or deletes mail.

**Drafting is slow, and that is expected.** Two to six minutes. The AI provider's free
tier limits how fast we can send it work; the system paces itself to stay inside those
limits rather than failing. A paid tier removes most of the wait.

## Guardrails already in place

- Nothing sends without human approval (follow-ups included, unless an admin turns that
  off).
- Anyone who unsubscribes or hard-bounces is suppressed permanently and cannot be
  contacted again, by anyone on the team.
- Every mail carries a working one-click unsubscribe link.
- A per-person daily cap protects the Gmail account from being throttled.
- Mail only goes out on weekdays during working hours.
- Members see only their own prospects and drafts. Admins see everything.

---

# Part 2 — How it is built

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind v4 · Prisma 7 → Postgres · Groq +
Gemini · Nodemailer/ImapFlow for Gmail.

## Why it is split across two hosts

```
┌──────────────────────┐        ┌────────────────────────┐
│ Vercel               │        │ Render                 │
│ Next.js app          │        │ Worker  (1 instance)   │
│ UI + fast reads      │        │ ALL AI + ALL email     │
│ enqueues jobs, polls │        │ drains the job queue   │
│  responds in ~0.5s   │        │  jobs take 145-355s    │
└──────────┬───────────┘        └───────────┬────────────┘
           │                                │
           └──────────► Postgres ◄──────────┘
                     (Render managed)
```

The agent cascade takes **145–355 seconds**, measured. Vercel kills a function at 60s
(Hobby) or 300s (Pro). So the cascade can never run inside a request. The app writes a
`Job` row and returns a job id; the worker executes; the UI polls.

The rule that follows from this: **API routes enqueue, they never execute.** If you add
a feature that is slow or sends something outward, it belongs in a job handler.

## The agent cascade

Each box is a separate model call, recorded on the draft (visible in the Agent trace
tab).

```
Research    groq/compound-mini      live web search: what they are, recent news,
    │                               observable gaps and why they exist
    ▼
Structure   llama-3.3-70b           evidence → gaps / solutions / hooks as JSON
    │
    ▼
Compose     gpt-oss-120b            writes the mail from research + template
    │                               + the member's note + learned feedback
    ▼
Verify      groq/compound-mini      fact-checks every claim against live sources;
    │                               confirms the recipient holds the stated role
    ▼
Revise      gpt-oss-120b            applies corrections, deletes what cannot be
    │                               supported  (loops back to Verify, up to N times)
    ▼
       HUMAN APPROVAL
    │
    ▼
Send        Gmail SMTP              tracked, threaded, signed
```

### Why five different models

Groq's rate limits are **per model, shared across every API key in the org** — verified
by watching the remaining-token counter drop regardless of which key was used. Rotating
keys buys resilience, not throughput. Throughput comes from spreading the cascade across
models that each have their own budget:

| Model | Tokens/min | Role |
|---|---|---|
| `groq/compound-mini` | 70,000 (250 req/window) | web research, fact-checking |
| `llama-3.3-70b-versatile` | 12,000 | JSON structuring, reply analysis, insights |
| `openai/gpt-oss-120b` | 8,000 | writing and revising prose |
| `openai/gpt-oss-20b` | 8,000 | small utility jobs |

`src/lib/ai/limiter.ts` keeps a rolling 60-second token ledger per model and honours the
exact `retry-after` the API returns — it sometimes asks for 30+ seconds. This pacing is
why drafting takes minutes.

### Gemini fallback

`gemini-flash-latest` (~1M context) takes over in exactly two cases: a prompt too large
for Groq's per-model budget, or Groq exhausting its retries. It appears in the trace as
`gemini-flash-latest (fallback)`.

It deliberately does **not** cover the search models. Gemini's `google_search` grounding
is quota-blocked on our key, so falling back there would silently turn a web-grounded
fact-check into an ungrounded guess. Better to fail loudly. Malformed-request errors do
not trigger it either — only capacity problems — so real bugs stay visible.

## The job queue

`src/lib/jobs/` — four job types: `GENERATE_DRAFT`, `GENERATE_FOLLOWUP`, `SEND_DRAFT`,
`PROCESS_REPLY`.

Claiming is a compare-and-swap: read a `QUEUED` row, then update it guarded on
`status: 'QUEUED'`. If another worker won the race the update matches nothing and we move
on. **This is what stops a prospect being emailed twice**, and it earned its keep — at
one point twelve worker processes were accidentally running at once and no duplicate
send occurred.

Every handler must be safe to retry. `SEND_DRAFT` checks `status === 'SENT'` first and
returns rather than re-sending.

Retries back off 30s → 2m → 10m, then the job is marked `FAILED` with the reason. A
permanent refusal (no credentials, suppressed address, daily cap) stops retrying
immediately — retrying would fail identically.

### Where validation lives

Approve is deliberately **split**: everything cheap is checked synchronously in the
request — credentials present, address not suppressed, daily cap not exceeded — so the
reviewer gets an instant, actionable error. Only the SMTP call itself is deferred. A
reviewer should never learn from a notification two minutes later that their mailbox was
not connected.

## Email handling

**Sending** — per-user Gmail SMTP. The app password is AES-256-GCM encrypted
(`ENCRYPTION_KEY`) and decrypted only at send time. Follow-ups thread onto the original
via `In-Reply-To`/`References`.

**Tracking** — a 1×1 pixel for opens and a redirect for clicks, both keyed to that
specific send. Opens within 10 seconds of sending are ignored as mail-client prefetch.
The click redirect only forwards to `http`/`https`, so it cannot be abused as an open
redirect.

**Receiving** — IMAP, incremental. A UID watermark per user means each poll only fetches
what arrived since the last one, and only *envelopes* first; full bodies are downloaded
solely for addresses in a live conversation or genuine bounce notices. This matters: the
first implementation re-scanned a fortnight of mail every five minutes, pulled ~2,900
full bodies against a 37,000-message mailbox, blocked the scheduler and eventually killed
the process on a socket timeout.

Two hard-won details in `imap.ts`: ImapFlow reports socket failures by **emitting an
`error` event**, which sails straight past `try/catch` and terminates Node — there is a
listener for it. And the worker has `uncaughtException`/`unhandledRejection` guards so a
bad network moment never takes down the schedule.

## The learning loop

Every human edit before approval is diffed against the AI original and distilled into a
one-line rule. Rejection reasons and rules typed in Settings feed the same store. Those
rules are injected into every later prompt for that member; admins can make one
team-wide. Stored in `Feedback`, surfaced in Settings, individually switchable.

## Layout

```
prisma/schema.prisma     data model
src/lib/ai/              groq client, limiter, model routing, agents, pipeline, gemini
src/lib/email/           smtp, imap, render (tracking), send
src/lib/jobs/            queue (enqueue/claim/retry) + handlers
src/lib/analytics.ts     every statistic
src/worker/              queue runner + cron (follow-ups, inbox poll, housekeeping)
src/app/(dashboard)/     the 10 screens
src/app/api/             27 routes — enqueue only, never execute
scripts/                 verification scripts (below)
```

## Running it locally

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

**The worker is not optional.** Without it, drafts sit at "Waiting for the worker"
forever and no follow-up or reply is ever processed.

## Verification scripts

```bash
npm run test:all
```

87 checks across every flow. Sends one real email — to the operator's own address, never
a prospect. Requires `TEST_APP_PASSWORD` to be set; skips the mailbox sections without
it.

| Command | What it proves |
|---|---|
| `npm run test:all` | every flow, end to end |
| `npm run typecheck` | tsc, no emit |
| `npm run jobs` | queue state — first thing to check when work looks stuck |
| `npm run runs` | last 12 agent calls: model, tokens, latency, errors |
| `npm run pagecheck` | every screen renders |
| `npm run mailcheck` | Gmail SMTP + IMAP credentials (sends nothing) |
| `npm run fallback-check` | Gemini takes over on oversize prompts, never on search |
| `npm run pollcheck` | times a real IMAP poll, shows the UID watermark |

## If you change things

- **Never put a credential in a committed file.** A hardcoded app password in a test
  script leaked into a public repo once already. Use env vars; the scripts now refuse to
  run without them.
- **Slow or outward-facing work goes in a job handler**, never in a route.
- **Handlers must be idempotent.** They will be retried.
- **`AUTH_SECRET` and `ENCRYPTION_KEY` must match on both hosts**, or sessions and stored
  mailbox passwords break.
- **Changing `ENCRYPTION_KEY` makes every stored app password unreadable** and everyone
  has to reconnect.
- **`APP_URL` must be the public URL in production.** Tracking pixels and unsubscribe
  links are built from it; leave it as localhost and recipients get dead unsubscribe
  links.
- Only ever run **one** worker instance.

## Known limits

- Drafting takes 2–6 minutes on the free AI tier. A paid Groq tier is the fix.
- Open tracking undercounts (image blocking) and overcounts (prefetch). Treat it as a
  trend, not a fact.
- Case-study files live in Postgres, capped at 15MB — the right call while both hosts
  need to read them; move to object storage if the library grows large.
- The IMAP watermark is set when a mailbox is first connected, so replies that arrived
  *before* connection are never picked up.
- Local dev uses PGlite, which is single-process. Faithful for development, never for
  production.

## Deploying

See [DEPLOYMENT.md](DEPLOYMENT.md).
