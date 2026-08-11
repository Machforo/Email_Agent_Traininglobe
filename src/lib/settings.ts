import { prisma } from './db';

export const DEFAULT_SETTINGS = {
  orgName: 'Traininglobe',
  offering:
    'Traininglobe partners with educational institutions to close the gap between curriculum and industry expectations: hands-on training programmes in AI, data and emerging tech for students and faculty, industry-mentored capstone projects, placement readiness and corporate connect programmes.',
  followUpDays: '3',
  maxFollowUps: '3',
  minConfidenceToSend: '55',
  maxRevisionLoops: '2',
  autoSendFollowUps: 'false',
  trackOpens: 'true',
  trackClicks: 'true',
  sendWindowStart: '9',
  sendWindowEnd: '19',
  unsubscribeFooter: 'true',
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

export async function getSettings(): Promise<Record<SettingKey, string>> {
  const rows = await prisma.systemSetting.findMany();
  const map = { ...DEFAULT_SETTINGS } as Record<string, string>;
  for (const r of rows) map[r.key] = r.value;
  return map as Record<SettingKey, string>;
}

export async function getSetting(key: SettingKey): Promise<string> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row?.value ?? DEFAULT_SETTINGS[key];
}

export async function setSetting(key: string, value: string) {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export function settingNumber(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function settingBool(v: string | undefined, fallback = false): boolean {
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}
