import 'dotenv/config';
import { chat, chatJson } from '../src/lib/ai/groq';
import { MODELS, envModel } from '../src/lib/ai/models';

/** Verifies the Gemini fallback fires on oversize prompts and stays off for search. */

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

(async () => {
  console.log('\n1. Normal prompt stays on Groq');
  const small = await chat([{ role: 'user', content: 'Reply with exactly: OK' }], {
    model: envModel('writer'),
    maxTokens: 300,
  });
  check('served by Groq', !small.model.includes('fallback'), small.model);

  console.log('\n2. Oversize prompt routes to Gemini');
  // ~40k tokens of filler: far beyond the 8k/min budget of the writer model.
  const filler = 'The institution published a placement report for the year. '.repeat(2600);
  const big = await chat(
    [
      {
        role: 'user',
        content: `Here is a long document:\n${filler}\n\nReply with exactly one word: ACKNOWLEDGED`,
      },
    ],
    { model: envModel('writer'), maxTokens: 300 },
  );
  check('served by Gemini', big.model.includes('fallback'), big.model);
  check('returned usable text', big.content.length > 0, big.content.slice(0, 60));
  check('counted input tokens', big.tokensIn > 10_000, `${big.tokensIn} in`);

  console.log('\n3. JSON still parses through the fallback path');
  const json = await chatJson<{ verdict: string }>(
    [
      {
        role: 'user',
        content: `${filler}\n\nReturn strict JSON: {"verdict":"ok"}`,
      },
    ],
    { model: MODELS.structurer, maxTokens: 300 },
  );
  check('parsed JSON from fallback', json.data?.verdict === 'ok', JSON.stringify(json.data));

  console.log('\n4. Search models never silently fall back');
  // Gemini has no web grounding on this key, so a compound failure must surface.
  const search = await chat([{ role: 'user', content: 'Who founded IIT Delhi? One line.' }], {
    model: envModel('search'),
  });
  check('search stayed on compound', !search.model.includes('fallback'), search.model);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('crashed:', err);
  process.exit(1);
});
