import 'dotenv/config';
import { hashPassword } from '../src/lib/password';
import { prisma } from '../src/lib/db';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

/**
 * Creates the admin account, a few member accounts and a starter template set.
 * Safe to re-run: everything is upserted by a natural key.
 */

const TEMPLATES = [
  {
    name: 'Initial outreach — gap-led',
    stage: 'INITIAL',
    subject: 'quick thought on {{institution}} placements',
    body: `Hi {{first_name}},

I was looking at what {{institution}} has been doing recently and one thing stood out.

[The AI replaces this with the specific gap it found and why it matters for your students.]

We work with institutions to close exactly that gap — industry-mentored training that slots into the existing timetable rather than competing with it.

Would you be open to a 15-minute call to see whether it's relevant for your next cohort?`,
    guidance:
      'Lead with the specific gap found in research. Keep it consultative, never salesy. One ask at the end.',
  },
  {
    name: 'Follow-up 1 — new angle',
    stage: 'FOLLOWUP_1',
    subject: 'following up',
    body: `Hi {{first_name}},

Following up on my note about {{institution}}.

[The AI adds one new angle or a short question here — not a repeat of the first mail.]

Worth a short conversation?`,
    guidance: 'Short. Add one new idea. Do not repeat the original pitch.',
  },
  {
    name: 'Follow-up 2 — case study',
    stage: 'FOLLOWUP_2',
    subject: 'how a similar institution handled this',
    body: `Hi {{first_name}},

Thought this might be more useful than another email from me — attaching a short case study from an institution facing a similar situation.

[The AI adds one line on the most relevant result.]

Happy to walk through how it would map to {{institution}} if useful.`,
    guidance: 'Attach a case study. Reference it in one line, do not summarise the whole thing.',
  },
  {
    name: 'Follow-up 3 — graceful close',
    stage: 'FOLLOWUP_3',
    subject: 'closing the loop',
    body: `Hi {{first_name}},

I don't want to keep filling your inbox, so this is my last note on this.

If placement readiness is something you're looking at later in the year, just reply and I'll pick it up then. Otherwise I'll leave it here.`,
    guidance: 'Warm, brief, no pressure. Leave the door open. Never guilt-trip.',
  },
  {
    name: 'Reply handler',
    stage: 'REPLY',
    subject: 'Re: {{institution}}',
    body: `Hi {{first_name}},

[The AI answers their questions directly here, in the order they asked them.]`,
    guidance:
      'Answer every question asked. Match their length and tone. Propose concrete times if they want a call.',
  },
];

async function main() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@traininglobe.com').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe@123';
  const adminName = process.env.SEED_ADMIN_NAME ?? 'Admin';

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: 'ADMIN', active: true },
    create: {
      email: adminEmail,
      name: adminName,
      passwordHash: await hashPassword(adminPassword),
      role: 'ADMIN',
      signature: `${adminName}\nTraininglobe`,
    },
  });
  console.log(`admin: ${admin.email} / ${adminPassword}`);

  // Placeholder member accounts — the admin renames these or adds real ones in the console.
  const members = [
    { name: 'Team Member 1', email: 'member1@traininglobe.com' },
    { name: 'Team Member 2', email: 'member2@traininglobe.com' },
    { name: 'Team Member 3', email: 'member3@traininglobe.com' },
    { name: 'Team Member 4', email: 'member4@traininglobe.com' },
  ];

  for (const m of members) {
    const user = await prisma.user.upsert({
      where: { email: m.email },
      update: {},
      create: {
        email: m.email,
        name: m.name,
        passwordHash: await hashPassword('Member@123'),
        role: 'MEMBER',
        signature: `${m.name}\nTraininglobe`,
      },
    });
    console.log(`member: ${user.email} / Member@123`);
  }

  // Shared starter templates, owned by the admin.
  for (const t of TEMPLATES) {
    const existing = await prisma.template.findFirst({
      where: { ownerId: admin.id, name: t.name },
    });
    if (existing) continue;
    await prisma.template.create({
      data: { ...t, ownerId: admin.id, isShared: true },
    });
  }
  console.log(`${TEMPLATES.length} shared templates ready`);

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }
  console.log('system settings initialised');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
