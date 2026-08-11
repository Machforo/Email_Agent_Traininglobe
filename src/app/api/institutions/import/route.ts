import { z } from 'zod';
import { audit, handler, ok } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

const schema = z.object({ csv: z.string().min(1) });

/**
 * Bulk import from CSV so members can paste a whole prospecting sheet at once.
 * Expected headers (case-insensitive, order-free):
 *   institution, email, contact_name, title, website, city, state, type, notes
 */
export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const { csv } = schema.parse(await req.json());

  const rows = parseCsv(csv);
  if (!rows.length) return ok({ imported: 0, skipped: 0, errors: ['No data rows found'] });

  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  for (const [index, row] of rows.entries()) {
    const name = pick(row, ['institution', 'institution_name', 'name', 'college', 'university']);
    const email = pick(row, ['email', 'contact_email', 'mail']);

    if (!name || !email) {
      errors.push(`Row ${index + 2}: missing institution name or email`);
      skipped++;
      continue;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errors.push(`Row ${index + 2}: "${email}" is not a valid email`);
      skipped++;
      continue;
    }

    // Re-importing the same sheet shouldn't create duplicates.
    const existing = await prisma.institution.findFirst({
      where: { ownerId: user.id, name: { equals: name } },
      include: { contacts: true },
    });

    if (existing) {
      if (existing.contacts.some((c) => c.email === email.toLowerCase())) {
        skipped++;
        continue;
      }
      await prisma.contact.create({
        data: {
          institutionId: existing.id,
          email: email.toLowerCase(),
          name: pick(row, ['contact_name', 'name_of_contact', 'person']) || null,
          title: pick(row, ['title', 'designation', 'role']) || null,
          isPrimary: false,
        },
      });
      imported++;
      continue;
    }

    await prisma.institution.create({
      data: {
        name,
        ownerId: user.id,
        website: pick(row, ['website', 'url', 'site']) || null,
        city: pick(row, ['city']) || null,
        state: pick(row, ['state']) || null,
        country: pick(row, ['country']) || 'India',
        type: pick(row, ['type', 'category']) || null,
        notes: pick(row, ['notes', 'note', 'remarks', 'brief']) || null,
        contacts: {
          create: {
            email: email.toLowerCase(),
            name: pick(row, ['contact_name', 'name_of_contact', 'person']) || null,
            title: pick(row, ['title', 'designation', 'role']) || null,
            isPrimary: true,
          },
        },
      },
    });
    imported++;
  }

  await audit(user.id, 'INSTITUTIONS_IMPORTED', 'Institution', undefined, { imported, skipped });
  return ok({ imported, skipped, errors: errors.slice(0, 25) });
});

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v && v.trim()) return v.trim();
  }
  return '';
}

/** Minimal RFC-4180 CSV reader: handles quoted fields, embedded commas and newlines. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim()));
  if (nonEmpty.length < 2) return [];

  const headers = nonEmpty[0]!.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return nonEmpty.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = (cells[i] ?? '').trim()));
    return obj;
  });
}
