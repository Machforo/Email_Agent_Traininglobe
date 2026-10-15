import path from 'node:path';
import { groqKeyCount, loadEnvFromRoot, missingEnv } from '../lib/env';

const root = path.resolve(__dirname, '../..');
loadEnvFromRoot(root);
process.env.APP_ROLE = 'worker';
try {
  process.chdir(root);
} catch {
  /* chdir can fail in some containers; env load above is what matters */
}

const missing = missingEnv();
if (missing.length) {
  console.error(
    `[worker] missing ${missing.join(', ')} — AI jobs cannot run. Set them in ${path.join(root, '.env')}`,
  );
  process.exit(1);
}

console.log(
  `[worker] env loaded from ${root} | groq keys: ${groqKeyCount()} | gemini: ${process.env.GEMINI_API_KEY ? 'yes' : 'no'}`,
);
