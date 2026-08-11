import 'dotenv/config';
import { ImapFlow } from 'imapflow';
import { verifyCredentials } from '../src/lib/email/smtp';

// Never hardcode a credential here — this file is committed.
//   npm run mailcheck -- you@example.com "xxxx xxxx xxxx xxxx"
// or set MAILCHECK_EMAIL / MAILCHECK_APP_PASSWORD.
const EMAIL = process.argv[2] ?? process.env.MAILCHECK_EMAIL ?? '';
const PASS = (process.argv[3] ?? process.env.MAILCHECK_APP_PASSWORD ?? '').replace(/\s+/g, '');

if (!EMAIL || !PASS) {
  console.error(
    'Usage: npm run mailcheck -- <gmail-address> "<app password>"\n' +
      '   or: set MAILCHECK_EMAIL and MAILCHECK_APP_PASSWORD',
  );
  process.exit(1);
}

(async () => {
  console.log(`Checking ${EMAIL} ...`);

  const smtp = await verifyCredentials(EMAIL, PASS);
  console.log('SMTP:', smtp.ok ? 'OK — can send' : `FAILED — ${smtp.error}`);

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: EMAIL, pass: PASS },
    logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const status = await client.status('INBOX', { messages: true });
      console.log(`IMAP: OK — inbox has ${status.messages} messages`);
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    console.log('IMAP: FAILED —', err instanceof Error ? err.message : err);
  }
})();
