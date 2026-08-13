import path from 'node:path';
import { groqKeyCount, loadEnvFromRoot, missingEnv } from '../src/lib/env';

/**
 * Pre-flight for EC2. Does not start processes — just says whether this box can.
 *
 *   npm run ec2:check
 */
const root = path.resolve(process.cwd());
loadEnvFromRoot(root);

const missing = missingEnv();
if (missing.length) {
  console.error(`FAIL missing env: ${missing.join(', ')}`);
  console.error(`Fill ${path.join(root, '.env')} (see .env.example).`);
  process.exit(1);
}

const major = Number(process.versions.node.split('.')[0]);
const minor = Number(process.versions.node.split('.')[1]);
const nodeOk =
  (major === 20 && minor >= 19) || major === 22 || major >= 24;
if (!nodeOk) {
  console.error(`FAIL Node ${process.version} — need ^20.19 || ^22.12 || >=24 (see .nvmrc)`);
  process.exit(1);
}

const appUrl = process.env.APP_URL!.replace(/\/$/, '');
if (/localhost|127\.0\.0\.1/.test(appUrl) && process.env.NODE_ENV === 'production') {
  console.warn(`WARN APP_URL is ${appUrl} — tracking and cookies will be wrong on EC2. Use the public http(s) URL.`);
}

console.log('ok');
console.log(`  node     ${process.version}`);
console.log(`  APP_URL  ${appUrl}`);
console.log(`  groq     ${groqKeyCount()} key(s)`);
console.log(`  gemini   ${process.env.GEMINI_API_KEY ? 'yes' : 'no'}`);
console.log('\nNext: npm run build && npm run ec2:start');
