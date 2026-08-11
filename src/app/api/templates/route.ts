import { z } from 'zod';
import { audit, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { extractTemplateVars } from '@/lib/utils';

const STAGES = ['INITIAL', 'FOLLOWUP_1', 'FOLLOWUP_2', 'FOLLOWUP_3', 'REPLY'] as const;

const schema = z.object({
  name: z.string().min(2),
  stage: z.enum(STAGES),
  subject: z.string().min(1),
  body: z.string().min(10),
  guidance: z.string().optional(),
  isShared: z.boolean().optional(),
});

export const GET = handler(async (req: Request) => {
  const user = await requireUser();
  const stage = new URL(req.url).searchParams.get('stage');

  // Members see their own templates plus anything shared with the team.
  const templates = await prisma.template.findMany({
    where: {
      OR: [{ ownerId: user.id }, { isShared: true }],
      ...(stage ? { stage } : {}),
    },
    include: { owner: { select: { id: true, name: true } } },
    orderBy: [{ stage: 'asc' }, { updatedAt: 'desc' }],
  });

  return ok({
    templates: templates.map((t) => ({ ...t, variables: extractTemplateVars(t.body + t.subject) })),
  });
});

export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const body = schema.parse(await req.json());

  const template = await prisma.template.create({
    data: {
      ownerId: user.id,
      name: body.name.trim(),
      stage: body.stage,
      subject: body.subject,
      body: body.body,
      guidance: body.guidance || null,
      isShared: body.isShared ?? false,
    },
  });

  await audit(user.id, 'TEMPLATE_CREATED', 'Template', template.id, { name: template.name });
  return ok({ template }, { status: 201 });
});
