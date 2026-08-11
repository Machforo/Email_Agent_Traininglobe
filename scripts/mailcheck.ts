import 'dotenv/config';
import { ImapFlow } from 'imapflow';
import { verifyCredentials } from '../src/lib/email/smtp';

const EMAIL = process.argv[2] ?? 'atharv.kumar@webisdom.com';
const PASS = (process.argv[3] ?? 'pdlb kozz uvse dzrv').replace(/\s+/g, '');

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
