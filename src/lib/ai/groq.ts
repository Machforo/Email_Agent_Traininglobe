import { geminiAvailable, geminiChat } from './gemini';
import { bucketFor, estimateTokens, parseRetryDelayMs, sleep } from './limiter';
import { DEFAULT_TPM, MODEL_TPM, envModel } from './models';

/**
 * Groq client.
 *
 * Two things this has to survive:
 *  1. Rate limits are per-model and shared across all API keys in the org, so we pace
 *     requests through a token bucket (see limiter.ts) instead of firing blindly.
 *  2. When we do get a 429, the API tells us how long to wait — sometimes 30+ seconds.
 *     We honour that instead of retrying immediately.
 *
 * Keys are still rotated, which helps with per-key request limits and gives us a
 * fallback if one key is revoked.
 */

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ExecutedTool = {
  type?: string;
  arguments?: unknown;
  output?: string;
  search_results?: { results?: { title?: string; url?: string; content?: string }[] };
};

export type GroqResult = {
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  executedTools: ExecutedTool[];
  sources: string[];
};

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

function keys(): string[] {
  const raw = process.env.GROQ_API_KEYS ?? process.env.GROQ_API_KEY ?? '';
  const list = raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (!list.length) throw new Error('GROQ_API_KEYS is not set');
  return list;
}

let cursor = 0;

export const REASONING_MODEL = () => envModel('writer');
export const SEARCH_MODEL = () => envModel('search');

export type ChatOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  timeoutMs?: number;
  /** Attempts across keys before giving up. */
  maxAttempts?: number;
};

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<GroqResult> {
  const model = opts.model ?? REASONING_MODEL();
  const promptText = messages.map((m) => m.content).join('\n');
  const estimate = estimateTokens(promptText, opts.maxTokens ?? 1500);

  // The compound models are the only ones that can search the web. Falling back to
  // Gemini for those would silently turn a grounded fact-check into an ungrounded
  // opinion, so they must fail loudly instead.
  const searchGrounded = model.startsWith('groq/compound');
  const canFallBack = geminiAvailable() && !searchGrounded;

  // A prompt that cannot fit Groq's per-model budget will never succeed there, no
  // matter how long we wait. Send it straight to Gemini's much larger context.
  const budget = (MODEL_TPM[model] ?? DEFAULT_TPM) * 0.9;
  if (canFallBack && estimate > budget) {
    console.warn(
      `[ai] prompt ~${estimate} tokens exceeds ${model} budget (${Math.round(budget)}) — using Gemini`,
    );
    return geminiChat(messages, opts);
  }

  try {
    return await bucketFor(model).schedule(estimate, () => execute(messages, model, opts, estimate));
  } catch (err) {
    if (!canFallBack) throw err;
    const message = err instanceof Error ? err.message : String(err);
    // Only fall back for capacity problems. A malformed request would fail on Gemini
    // too, and hiding it behind a second provider makes debugging much harder.
    const capacityProblem =
      /429|rate limit|timed out|Groq 5\d\d|request_too_large|Request Entity Too Large|context/i.test(
        message,
      );
    if (!capacityProblem) throw err;

    console.warn(`[ai] ${model} failed (${message.slice(0, 120)}) — falling back to Gemini`);
    return geminiChat(messages, opts);
  }
}

async function execute(
  messages: ChatMessage[],
  model: string,
  opts: ChatOptions,
  estimate: number,
): Promise<GroqResult> {
  const all = keys();
  const started = Date.now();
  const bucket = bucketFor(model);

  const body: Record<string, unknown> = { model, messages };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;

  // The compound (web-search) models reject max_tokens and response_format.
  const isCompound = model.startsWith('groq/compound');
  if (!isCompound) {
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.json) body.response_format = { type: 'json_object' };
  }

  const maxAttempts = opts.maxAttempts ?? Math.max(4, all.length * 2);
  let lastError: Error | null = null;
  let spentRecorded = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const apiKey = all[cursor % all.length]!;
    cursor++;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // Keep our idea of the budget in sync with reality.
      const limitHeader = res.headers.get('x-ratelimit-limit-tokens');
      if (limitHeader) bucket.updateLimit(Number(limitHeader));
      const remainingRequests = res.headers.get('x-ratelimit-remaining-requests');
      if (remainingRequests) bucket.updateRemainingRequests(Number(remainingRequests));

      if (!res.ok) {
        const text = await res.text();

        if (res.status === 429) {
          const waitMs = parseRetryDelayMs(res.headers, text) ?? 5_000;
          // Tell the bucket to hold everything for this model, not just this call.
          bucket.blockFor(waitMs);
          lastError = new Error(`Groq 429 (waited ${Math.round(waitMs / 1000)}s): ${text.slice(0, 200)}`);
          await sleep(Math.min(waitMs + 250, 40_000));
          continue;
        }

        if (res.status >= 500) {
          lastError = new Error(`Groq ${res.status}: ${text.slice(0, 200)}`);
          await sleep(500 * (attempt + 1));
          continue;
        }

        // 413 means the prompt itself is too big — retrying will not help.
        throw new Error(`Groq ${res.status}: ${text.slice(0, 400)}`);
      }

      const data = (await res.json()) as {
        model?: string;
        choices?: { message?: { content?: string; executed_tools?: ExecutedTool[] } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const message = data.choices?.[0]?.message;
      const executedTools = message?.executed_tools ?? [];
      const tokensIn = data.usage?.prompt_tokens ?? 0;
      const tokensOut = data.usage?.completion_tokens ?? 0;

      bucket.record(tokensIn + tokensOut || estimate);
      spentRecorded = true;

      return {
        content: (message?.content ?? '').trim(),
        model: data.model ?? model,
        tokensIn,
        tokensOut,
        latencyMs: Date.now() - started,
        executedTools,
        sources: collectSources(executedTools),
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.name === 'AbortError') lastError = new Error('Groq request timed out');
      // A non-retryable client error: surface it straight away.
      if (/^Groq 4(?!29)/.test(lastError.message)) break;
      await sleep(400 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  if (!spentRecorded) bucket.record(Math.min(estimate, 1000));
  throw lastError ?? new Error('Groq request failed');
}

/** Pull the URLs the compound model actually visited out of its tool trace. */
function collectSources(tools: ExecutedTool[]): string[] {
  const urls = new Set<string>();
  for (const t of tools) {
    for (const r of t.search_results?.results ?? []) {
      if (r.url) urls.add(r.url);
    }
    if (typeof t.output === 'string') {
      for (const m of t.output.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) urls.add(m[0]);
    }
  }
  return [...urls].slice(0, 25);
}

/**
 * Chat with a JSON response.
 *
 * Reasoning models (gpt-oss, qwen) spend hidden reasoning tokens out of the same
 * `max_tokens` budget as the answer, so with `response_format: json_object` they can
 * hit the cap mid-object and the API rejects the whole call with
 * `json_validate_failed: max completion tokens reached`. When that happens we retry
 * once with a bigger budget and without strict JSON mode — `parseJsonLoose` recovers
 * the object from the prose, which is more reliable than failing the pipeline.
 */
export async function chatJson<T>(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<{ data: T; raw: GroqResult }> {
  try {
    const raw = await chat(messages, { ...opts, json: opts.json ?? true });
    return { data: parseJsonLoose<T>(raw.content), raw };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const truncatedJson =
      message.includes('json_validate_failed') || message.includes('max completion tokens');
    if (!truncatedJson) throw err;

    const retry = await chat(messages, {
      ...opts,
      json: false,
      maxTokens: Math.min((opts.maxTokens ?? 2000) * 2, 8000),
    });
    return { data: parseJsonLoose<T>(retry.content), raw: retry };
  }
}

/** LLMs sometimes wrap JSON in prose or fences; recover the outermost value. */
export function parseJsonLoose<T>(text: string): T {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
    const aStart = cleaned.indexOf('[');
    const aEnd = cleaned.lastIndexOf(']');
    if (aStart !== -1 && aEnd > aStart) {
      return JSON.parse(cleaned.slice(aStart, aEnd + 1)) as T;
    }
    throw new Error(`Model did not return valid JSON: ${cleaned.slice(0, 200)}`);
  }
}
