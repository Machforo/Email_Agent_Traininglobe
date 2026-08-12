/**
 * Business-hours guard in the member's timezone. Mail sent at 3am reads as
 * automated, and Gmail is more likely to treat a burst outside working hours as spam.
 *
 * Uses Intl rather than the process local clock — EC2 is often UTC while members
 * are Asia/Kolkata.
 */
export function isWithinSendWindow(
  startHour: number,
  endHour: number,
  now = new Date(),
  timeZone = 'Asia/Kolkata',
): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now);
  const hourRaw = parts.find((p) => p.type === 'hour')?.value;
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(hourRaw === '24' ? '0' : hourRaw); // some engines emit 24 for midnight
  if (!Number.isFinite(hour) || !weekday) return false;
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return hour >= startHour && hour < endHour;
}
