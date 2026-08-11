import type { ChatMessage, ChatOptions, GroqResult } from './groq';

/**
 * Gemini fallback.
 *
 * Groq's free tier is tight — 8,000 tokens/minute on the writing model — and the
 * cascade regularly bumps into it. Gemini Flash has a ~1M token context and its own
 * quota, so it covers the two cases Groq can't:
 *
 *   1. a prompt too large for the Groq per-model budget (long threads, big research
 *      dumps, many feedback rules)
 *   2. Groq exhausting its retries on rate limits or 5xx
 *
 * It is NOT a substitute for the search models. Gemini's `google_search` grounding
 * is quota-blocked on this key, so falling back for research or fact-checking would
 * quietly turn a web-grounded verification into an ungrounded guess — worse than
 * failing loudly. `chat()` enforces that.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export function geminiAvailable(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL ?? 'gemini-flash-latest';
}

/** Gemini Flash accepts ~1M input tokens; keep a wide margin below that. */
export const GEMINI_MAX_INPUT_TOKENS = 900_000;

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  error?: { code?: number; message?: string; status?: string };
};

export async function geminiChat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<GroqResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const model = geminiModel();
  const started = Date.now();

  // Gemini has no dedicated system role on this endpoint; system text goes into
  // systemInstruction and the rest becomes the conversation.
  const systemText = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');

  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const body: Record<string, unknown> = {
    contents: contents.length ? contents : [{ role: 'user', parts: [{ text: systemText }] }],
    generationConfig: {
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (systemText && contents.length) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);

  try {
    const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = (await res.json()) as GeminiResponse;

    if (!res.ok || data.error) {
      const message = data.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`Gemini ${data.error?.code ?? res.status}: ${message.slice(0, 300)}`);
    }

    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim();

    if (!text) {
      throw new Error(
        `Gemini returned no text (finishReason: ${candidate?.finishReason ?? 'unknown'})`,
      );
    }

    const usage = data.usageMetadata ?? {};
    return {
      content: text,
      // Tag the model so the agent trace shows which provider actually answered.
      model: `${model} (fallback)`,
      tokensIn: usage.promptTokenCount ?? 0,
      // Gemini bills hidden reasoning separately; count it so cost figures stay honest.
      tokensOut: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
      latencyMs: Date.now() - started,
      executedTools: [],
      sources: [],
    };
  } finally {
    clearTimeout(timer);
  }
}
