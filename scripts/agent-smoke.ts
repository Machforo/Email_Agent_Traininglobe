import 'dotenv/config';
import { composeEmail, researchInstitution, verifyEmail } from '../src/lib/ai/agents';
import { prisma } from '../src/lib/db';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

const line = (s: string) => console.log('\n' + '='.repeat(70) + '\n' + s + '\n' + '='.repeat(70));

(async () => {
  line('1. RESEARCH AGENT (web search)');
  const research = await researchInstitution({
    institution: 'Lovely Professional University',
    website: 'https://www.lpu.in',
    city: 'Phagwara',
    state: 'Punjab',
    country: 'India',
    type: 'University',
    contactName: null,
    contactTitle: 'Head of Training & Placement',
    notes:
      'Focus on their placement outcomes and whether students are AI-ready. We want to offer an AI upskilling programme for final-year students.',
    offering: DEFAULT_SETTINGS.offering,
  });
  console.log('overview:', research.overview);
  console.log('confidence:', research.confidence);
  console.log('gaps:', research.gaps.map((g) => '- ' + g.gap).join('\n'));
  console.log('hooks:', research.personalizationHooks);
  console.log('sources:', research.sources.slice(0, 5));

  line('2. COMPOSER AGENT');
  const composed = await composeEmail({
    ownerId: 'smoke-test-user',
    senderName: 'Atharv Kumar',
    senderOrg: DEFAULT_SETTINGS.orgName,
    institution: 'Lovely Professional University',
    contactName: null,
    contactTitle: 'Head of Training & Placement',
    research,
    notes: 'Offer an AI upskilling programme for final-year students.',
    template: null,
    stage: 0,
  });
  console.log('SUBJECT:', composed.subject);
  console.log('BODY:\n' + composed.body);
  console.log('\nrationale:', composed.rationale);

  line('3. VERIFICATION AGENT (web fact-check)');
  const verification = await verifyEmail({
    institution: 'Lovely Professional University',
    website: 'https://www.lpu.in',
    contactName: null,
    contactTitle: 'Head of Training & Placement',
    subject: composed.subject,
    body: composed.body,
  });
  console.log('verdict:', verification.verdict, '| confidence:', verification.confidence);
  console.log('contactVerified:', verification.contactVerified, '-', verification.contactNotes);
  console.log('checks:');
  for (const c of verification.checks) console.log(`  [${c.status}] ${c.claim}`);
  console.log('corrections:');
  for (const c of verification.corrections) console.log(`  [${c.severity}] ${c.issue} -> ${c.fix}`);

  const runs = await prisma.agentRun.count();
  console.log(`\nAgentRun rows logged: ${runs}`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('SMOKE FAILED:', e);
  await prisma.$disconnect();
  process.exit(1);
});
