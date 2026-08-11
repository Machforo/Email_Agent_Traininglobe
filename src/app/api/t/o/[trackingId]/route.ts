import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// 1x1 transparent GIF.
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

/**
 * Open tracking. Always returns the pixel, even on error — a tracking failure must
 * never render a broken image in the recipient's mail client.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ trackingId: string }> },
) {
  const { trackingId } = await params;

  try {
    const message = await prisma.emailMessage.findUnique({
      where: { trackingId },
      select: { id: true, openedAt: true, sentAt: true },
    });

    if (message) {
      // Mail clients often prefetch images the instant a message arrives. Ignore
      // hits within 10s of sending, which would otherwise log a false "open".
      const tooSoon =
        message.sentAt && Date.now() - message.sentAt.getTime() < 10_000;

      if (!tooSoon) {
        await prisma.emailMessage.update({
          where: { id: message.id },
          data: {
            openCount: { increment: 1 },
            ...(message.openedAt ? {} : { openedAt: new Date() }),
          },
        });
        await prisma.trackingEvent.create({
          data: {
            emailMessageId: message.id,
            type: 'OPEN',
            userAgent: req.headers.get('user-agent')?.slice(0, 300),
          },
        });
      }
    }
  } catch (err) {
    console.error('[track:open]', err);
  }

  return new NextResponse(new Uint8Array(PIXEL), {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
      'Content-Length': String(PIXEL.length),
    },
  });
}
