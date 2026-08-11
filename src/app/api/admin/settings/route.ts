import { z } from 'zod';
import { audit, handler, ok } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { DEFAULT_SETTINGS, getSettings, setSetting } from '@/lib/settings';

export const GET = handler(async () => {
  await requireAdmin();
  return ok({ settings: await getSettings(), defaults: DEFAULT_SETTINGS });
});

const schema = z.record(z.string(), z.string());

export const PATCH = handler(async (req: Request) => {
  const admin = await requireAdmin();
  const body = schema.parse(await req.json());

  const allowed = Object.keys(DEFAULT_SETTINGS);
  for (const [key, value] of Object.entries(body)) {
    if (!allowed.includes(key)) continue;
    await setSetting(key, value);
  }

  await audit(admin.id, 'SETTINGS_UPDATED', 'SystemSetting', undefined, body);
  return ok({ settings: await getSettings() });
});
