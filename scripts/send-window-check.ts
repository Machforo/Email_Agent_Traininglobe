/**
 * Self-check for isWithinSendWindow timezone handling.
 *   npx tsx scripts/send-window-check.ts
 */
import { isWithinSendWindow } from '../src/lib/send-window';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Wednesday 10:00 Asia/Kolkata = 04:30 UTC
const wedMorningUtc = new Date('2026-08-12T04:30:00.000Z');
assert(isWithinSendWindow(9, 19, wedMorningUtc, 'Asia/Kolkata'), 'Wed 10 IST should be inside 9–19');
assert(!isWithinSendWindow(9, 19, wedMorningUtc, 'UTC'), 'Wed 04 UTC should be outside 9–19');

// Saturday noon IST
const satNoonUtc = new Date('2026-08-15T06:30:00.000Z');
assert(!isWithinSendWindow(9, 19, satNoonUtc, 'Asia/Kolkata'), 'Saturday should be blocked');

console.log('send-window-check: ok');
