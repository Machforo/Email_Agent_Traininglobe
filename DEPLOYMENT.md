# Deploying

- **EC2 (one machine, web + worker)?** → [EC2](#ec2--one-machine)
- **Just want the team to try it, without paying?** → [Testing for free](#testing-for-free)
- **Ready to run it properly, 24/7 on Vercel + Render?** → [The paid setup](#the-paid-setup--vercel--render)

---

# EC2 — one machine

Node **22** (see `.nvmrc`). Postgres on the box or RDS. Both processes must run or AI drafts never finish.

```bash
git pull
npm ci
cp -n .env.example .env   # then edit
# Required: DATABASE_URL, AUTH_SECRET, ENCRYPTION_KEY, GROQ_API_KEYS,
# APP_URL=http://YOUR_PUBLIC_IP   (or https://your.domain — must match the browser)
npm run db:seed           # first time only
npm run build
npm i -g pm2
npm run ec2:check
npm run ec2:start
pm2 startup               # once, so it survives reboot
```

Check:

```bash
curl -s http://127.0.0.1:3000/api/health
# {"ok":true,"db":"up","worker":"up",...}

pm2 logs outreach-worker
# [worker] env loaded from ... | groq keys: N
```

Open `http://YOUR_IP/dashboard` after login (or `/login`). Nginx should proxy `/` to `127.0.0.1:3000`. If `worker` is `"down"`, drafts stay on “Waiting for the worker”.

---

# Testing for free

**Render has no free background worker** — the cheapest is $7/month, so a Blueprint will
always ask for payment ([Render pricing](https://render.com/pricing)). You do not need
Render to test. The worker is just a Node process; run it on your own machine and
everything else can be free.

Two routes. Both cost nothing and neither needs a card.

## Route A — nothing to sign up for (10 minutes)

Everything runs on your machine; the team reaches it over a free HTTPS tunnel.

```bash
winget install --id Cloudflare.cloudflared
```

Four terminals:

```bash
npm run pg
```

```bash
npm run worker
```

```bash
npm run dev
```

```bash
cloudflared tunnel --url http://localhost:3000
```

It prints a URL like `https://random-words.trycloudflare.com`. Put that in `.env` as
`APP_URL`, restart `npm run dev` and `npm run worker`, and send the URL to the team.

**Limits, so nothing surprises you:** the URL changes each time you restart the tunnel,
which kills tracking links in already-sent mail. Your machine sleeping takes it down.
Fine for a week of trying it out; not where you land.

## Route B — free hosted app, worker on your machine

Better if you want a stable URL the team can bookmark. The app is properly hosted and
always up; only the worker depends on your laptop.

| Piece | Where | Cost |
|---|---|---|
| Postgres | [Neon](https://neon.com/pricing) free tier | ₹0, no card |
| Next.js app | Vercel Hobby | ₹0, no card |
| Worker | your machine | ₹0 |

**1. Database.** Sign up at neon.com, create a project, copy the connection string
(the **pooled** one). Free tier: 0.5 GB, 100 compute-hours/month, no card.

**2. Create the schema.** Locally, with `DATABASE_URL` set to that Neon string:

```bash
npx prisma migrate deploy && npm run db:seed
```

**3. App on Vercel.** Import the GitHub repo at vercel.com/new. Add these environment
variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Neon pooled connection string |
| `AUTH_SECRET` | generate it (see below) |
| `ENCRYPTION_KEY` | generate it (see below) |
| `GROQ_API_KEYS` | your keys, comma-separated |
| `GEMINI_API_KEY` | your key |
| `APP_URL` | your `https://….vercel.app` URL, after the first deploy |

**4. Worker, on your machine.** Point it at the same Neon database — put the same
`DATABASE_URL` and `APP_URL` in your local `.env`, then:

```bash
npm run worker
```

The team can now use the Vercel URL from anywhere. Drafts only get processed while your
worker is running; anything queued while it is off is picked up as soon as you start it
again — nothing is lost.

### Two things to know about the free tiers

**Neon's 100 compute-hours.** The worker keeps the database awake while it runs. Leaving
it on 24/7 works out to roughly 180 compute-hours a month, which exceeds the free
allowance and suspends the database until the next cycle. Running it during working
hours (~8h/day) lands around 40 — comfortably inside. The queue backs off to a 30-second
poll when idle specifically so this stays cheap.

**Vercel Hobby forbids commercial use.** For evaluating the tool it is fine. Once this is
doing real company work you need Pro (~$20/month), or move the app to Render too.

### When to stop doing this

Move to the paid setup when you want follow-ups and reply detection to keep running
overnight and at weekends without your laptop. That is the only thing you are buying:
**$13/month** for a worker that never sleeps.

---

# The paid setup — Vercel + Render

```
┌─────────────────────┐         ┌──────────────────────┐
│  Vercel             │         │  Render              │
│  Next.js app        │         │  Worker (1 instance) │
│  UI + fast reads    │         │  All AI + all email  │
│  enqueues jobs      │         │  drains the queue    │
└──────────┬──────────┘         └───────────┬──────────┘
           │                                │
           └────────────► Postgres ◄────────┘
                       (Render managed)
```

The app never does slow work. It writes a job row and returns; the worker picks it up.
Measured on the real pipeline: **enqueue responds in ~0.5s** while the job itself takes
**145–355s**. That gap is the whole reason for this architecture — Vercel kills a
function at 60s (Hobby) or 300s (Pro), so the cascade could never have run there.

---

## Before you start: rotate the credentials

Every key below was pasted into a chat window. Replace all of them before anything is
public:

- Groq → https://console.groq.com/keys
- Gemini → https://aistudio.google.com/apikey
- Gmail app password → https://myaccount.google.com/apppasswords

Then generate fresh app secrets:

```bash
node -e "const c=require('crypto');console.log('AUTH_SECRET='+c.randomBytes(48).toString('base64url'));console.log('ENCRYPTION_KEY='+c.randomBytes(32).toString('hex'))"
```

> `ENCRYPTION_KEY` decrypts stored Gmail app passwords. Set it **once, before the team
> connects their mailboxes**. Changing it later makes every stored password unreadable
> and everyone has to re-enter theirs.

Push the code to a **private** GitHub repo. `.env` is git-ignored, so no secrets travel
with it.

```bash
git init && git add -A && git commit -m "Outreach agent"
```

---

## Step 1 — Database and worker on Render

Render reads `render.yaml` from the repo and creates both.

1. https://dashboard.render.com → **New → Blueprint** → connect the repo.
2. Render shows one database (`outreach-db`) and one worker (`outreach-worker`). Apply.
3. Open **outreach-worker → Environment** and fill in the values marked "sync: false":

   | Variable | Value |
   |---|---|
   | `AUTH_SECRET` | from the command above |
   | `ENCRYPTION_KEY` | from the command above |
   | `GROQ_API_KEYS` | your rotated keys, comma-separated |
   | `GEMINI_API_KEY` | your rotated key |
   | `APP_URL` | leave blank for now — you'll have it after step 2 |

   `DATABASE_URL` is wired to the database automatically.

The worker's build command runs `prisma migrate deploy`, so the schema is created on
first deploy. Watch the log for:

```
[worker …] queue every 3s | inbox poll "*/5 * * * *" | …
```

**Do not raise the instance count above 1.** Two workers would both claim due
follow-ups. The queue guards against double-sends, but there is no upside.

### Seed the first admin

Render → **outreach-worker → Shell**:

```bash
SEED_ADMIN_EMAIL=you@yourdomain.com SEED_ADMIN_PASSWORD='a-strong-password' SEED_ADMIN_NAME='Your Name' npm run db:seed
```

This also loads the five starter templates.

---

## Step 2 — App on Vercel

1. https://vercel.com/new → import the same repo. It detects Next.js; `vercel.json`
   supplies the build command.
2. Add environment variables (**Production**, and Preview if you use it):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Render's **External** connection string |
   | `AUTH_SECRET` | same as the worker |
   | `ENCRYPTION_KEY` | same as the worker |
   | `GROQ_API_KEYS` | same as the worker |
   | `GEMINI_API_KEY` | same as the worker |
   | `APP_URL` | your Vercel URL, e.g. `https://outreach.vercel.app` |

   Use Render's **External** Postgres URL here (the Internal one is only reachable from
   inside Render). Copy it from the database page.

3. Deploy.

### Then close the loop

Go back to Render → outreach-worker → Environment and set `APP_URL` to the same Vercel
URL. The worker builds tracking pixels and unsubscribe links into every mail it sends —
if this is wrong or missing, recipients get dead unsubscribe links.

`AUTH_SECRET` and `ENCRYPTION_KEY` **must match on both hosts** or sessions and stored
mailbox passwords break.

### Custom domain (optional)

Vercel → Settings → Domains. Add it, point the DNS as instructed, then update `APP_URL`
in **both** places.

---

## Step 3 — Check it works

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://YOUR-APP.vercel.app/login
```

Then sign in as the admin and:

1. Connect your mailbox (amber banner at the top).
2. Add a prospect and press **Draft mail**.
3. The modal should say "Waiting for the worker" and then "Researching, writing and
   fact-checking". If it sits on *Waiting* forever, the worker is not running — check
   its Render logs.
4. When the draft lands, read the **Verification** tab before approving.

---

## Onboarding the team

Send each person their login plus these steps. **Each needs their own Gmail app
password** — that is what makes mail send from their address with replies coming back
to them.

1. Sign in and change your password.
2. Amber banner → **Connect mailbox**. You need a Google **app password**, not your
   normal one: turn on 2-Step Verification, then https://myaccount.google.com/apppasswords,
   create one for "Mail", paste the 16 characters. Add your signature too.
3. **Prospects → Add prospect.** Institution, contact email, and — most importantly — a
   note on the angle you want. That note steers the whole mail.
4. **Draft mail.** Takes 2–6 minutes. You can close the dialog; it keeps running and
   you get a notification.
5. Read the **Verification** tab, then **Approve** to send.

Tell them explicitly:

- Nothing sends without a human pressing Approve.
- Editing a draft before approving is not wasted — the system learns from the edit.
- A verdict of REVISE is normal. It means the fact-checker is doing its job.
- Rejecting *with a reason* teaches it more than silently regenerating.

### Admin duties

- **Admin → Accounts**: add the real team, delete the `member1…4` placeholders.
- **Admin → Team performance**: per-person volume, reply rate, bounces.
- **Admin → System settings**: follow-up spacing, the offering description the agents
  pitch from, manual job runs.
- Watch the **bounce rate**. Above 3% sustained risks the sending domain's reputation.

---

## Costs

| | Plan | Approx. |
|---|---|---|
| Vercel | Hobby (or Pro if commercial) | $0 – $20/mo |
| Render worker | Starter | ~$7/mo |
| Render Postgres | Basic 256MB | ~$6/mo |
| Groq / Gemini | Free tier | $0 |

Vercel's Hobby plan forbids commercial use — if this is company work, you need Pro.
Render's free worker tier sleeps, which would stall the queue, so Starter is the
minimum that actually works.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Draft stuck on "Waiting for the worker" | Worker down, or pointed at a different DB | Render logs; confirm both `DATABASE_URL`s target the same database |
| Login does nothing | `AUTH_SECRET` differs between hosts | Make them identical, redeploy both |
| "Malformed encrypted payload" | `ENCRYPTION_KEY` changed after mailboxes were connected | Restore the old key, or have everyone re-enter their app password |
| Dead unsubscribe links | `APP_URL` wrong on the worker | Set it to the public URL, redeploy |
| Too many connections | Several Vercel instances each holding a pool | Already limited to 2 per instance; raise the Postgres plan if it persists |
| Jobs retry then fail | Real error — read it | Admin, or `npm run jobs` locally against the same DB |
| Drafting slow (2–6 min) | Groq free-tier rate limits | Expected. A paid Groq tier removes most of the wait |

Useful commands (locally, with `DATABASE_URL` pointed at the Render database):

```bash
npm run jobs
```

```bash
npm run runs
```

```bash
npm run mailcheck
```

---

## Deploying updates

Vercel redeploys on push automatically. Render rebuilds the worker and runs
`prisma migrate deploy` as part of its build, so schema changes apply there.

Push schema changes **before** the app code that depends on them, so the database is
never behind the running app.

---

## Local development

Three terminals. No Postgres install needed — `npm run pg` serves PGlite (real Postgres
compiled to WASM) over the Postgres wire protocol, so local behaves like production.

```bash
npm run pg
```

```bash
npm run dev
```

```bash
npm run worker
```

Then `npx prisma migrate deploy && npm run db:seed` once. Data lives in `.pgdata`;
delete that folder for a clean slate.
