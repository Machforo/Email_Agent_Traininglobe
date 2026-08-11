import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { notify } from '@/lib/api';

/**
 * One-click unsubscribe. Suppresses the address, stops the sequence, and tells the
 * owner. Handles POST too because Gmail's List-Unsubscribe-Post sends one.
 */
async function unsubscribe(trackingId: string) {
  const message = await prisma.emailMessage.findUnique({
    where: { trackingId },
    include: { sequence: true },
  });
  if (!message) return false;

  const email = message.toEmail.toLowerCase();

  await prisma.suppression.upsert({
    where: { email },
    create: { email, reason: 'UNSUBSCRIBE', note: `Unsubscribed from message ${message.id}` },
    update: {},
  });

  await prisma.sequence.update({
    where: { id: message.sequenceId },
    data: { status: 'STOPPED', nextActionAt: null, stoppedReason: 'Recipient unsubscribed' },
  });

  await prisma.institution.update({
    where: { id: message.sequence.institutionId },
    data: { status: 'UNSUBSCRIBED' },
  });

  await notify(
    message.ownerId,
    'SYSTEM',
    `${email} unsubscribed`,
    'Their sequence has been stopped and the address suppressed.',
    `/sequences/${message.sequenceId}`,
  );

  return true;
}

function page(title: string, body: string) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f6f7f9;color:#111;">
<div style="max-width:460px;padding:40px;background:#fff;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center;">
<h1 style="font-size:20px;margin:0 0 12px;">${title}</h1>
<p style="margin:0;color:#555;line-height:1.6;">${body}</p>
</div></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ trackingId: string }> }) {
  const { trackingId } = await params;
  try {
    const done = await unsubscribe(trackingId);
    return done
      ? page('You have been unsubscribed', 'You will not receive any further emails from us. Sorry for the interruption.')
      : page('Link not recognised', 'This unsubscribe link is invalid or has expired.');
  } catch (err) {
    console.error('[unsubscribe]', err);
    return page('Something went wrong', 'Please reply to the email with "unsubscribe" and we will remove you manually.');
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ trackingId: string }> }) {
  const { trackingId } = await ctx.params;
  try {
    await unsubscribe(trackingId);
  } catch (err) {
    console.error('[unsubscribe:post]', err);
  }
  return new NextResponse(null, { status: 204 });
}
