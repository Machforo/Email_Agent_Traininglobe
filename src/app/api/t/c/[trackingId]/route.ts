import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Click tracking: record the click, then redirect to the real destination.
 * If anything goes wrong we still redirect — the recipient's click must work.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ trackingId: string }> },
) {
  const { trackingId } = await params;
  const target = new URL(req.url).searchParams.get('u');

  // Only ever redirect to http(s) — an open redirect to javascript: would be a hole.
  let destination = 'https://www.google.com';
  if (target) {
    try {
      const parsed = new URL(target);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        destination = parsed.toString();
      }
    } catch {
      /* keep the fallback */
    }
  }

  try {
    const message = await prisma.emailMessage.findUnique({
      where: { trackingId },
      select: { id: true, firstClickAt: true },
    });
    if (message) {
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: {
          clickCount: { increment: 1 },
          ...(message.firstClickAt ? {} : { firstClickAt: new Date() }),
        },
      });
      await prisma.trackingEvent.create({
        data: {
          emailMessageId: message.id,
          type: 'CLICK',
          url: destination.slice(0, 500),
          userAgent: req.headers.get('user-agent')?.slice(0, 300),
        },
      });
    }
  } catch (err) {
    console.error('[track:click]', err);
  }

  return NextResponse.redirect(destination, 302);
}
