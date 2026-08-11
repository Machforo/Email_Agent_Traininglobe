import { z } from 'zod';
import { audit, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

const contactSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  title: z.string().optional(),
  linkedin: z.string().optional(),
  phone: z.string().optional(),
});

const createSchema = z.object({
  name: z.string().min(2),
  website: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().default('India'),
  type: z.string().optional(),
  notes: z.string().optional(),
  tags: z.string().optional(),
  contacts: z.array(contactSchema).min(1),
});

export const GET = handler(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const q = url.searchParams.get('q');
  // Admins can inspect a specific member's pipeline; members only see their own.
  const scopeUser =
    user.role === 'ADMIN' && url.searchParams.get('userId')
      ? url.searchParams.get('userId')!
      : user.id;
  const all = user.role === 'ADMIN' && url.searchParams.get('scope') === 'all';

  const institutions = await prisma.institution.findMany({
    where: {
      ...(all ? {} : { ownerId: scopeUser }),
      ...(status ? { status } : {}),
      ...(q ? { name: { contains: q } } : {}),
    },
    include: {
      contacts: true,
      owner: { select: { id: true, name: true } },
      sequences: {
        select: { id: true, status: true, currentStage: true, nextActionAt: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 300,
  });

  return ok({ institutions });
});

export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const body = createSchema.parse(await req.json());

  const institution = await prisma.institution.create({
    data: {
      name: body.name.trim(),
      website: body.website?.trim() || null,
      city: body.city?.trim() || null,
      state: body.state?.trim() || null,
      country: body.country || 'India',
      type: body.type || null,
      notes: body.notes || null,
      tags: body.tags || null,
      ownerId: user.id,
      contacts: {
        create: body.contacts.map((c, i) => ({
          email: c.email.toLowerCase().trim(),
          name: c.name?.trim() || null,
          title: c.title?.trim() || null,
          linkedin: c.linkedin?.trim() || null,
          phone: c.phone?.trim() || null,
          isPrimary: i === 0,
        })),
      },
    },
    include: { contacts: true },
  });

  await audit(user.id, 'INSTITUTION_CREATED', 'Institution', institution.id, {
    name: institution.name,
  });

  return ok({ institution }, { status: 201 });
});
