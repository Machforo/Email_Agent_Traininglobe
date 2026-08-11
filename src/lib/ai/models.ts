/**
 * Model routing.
 *
 * Groq rate limits are per-model but shared across every API key in the org (verified:
 * the remaining-token counter drops no matter which key is used). Rotating keys
 * therefore buys reliability, not throughput. What *does* buy throughput is spreading
 * the cascade across different models, since each has its own tokens-per-minute bucket.
 *
 * Measured limits on this account (tokens/min):
 *   groq/compound-mini        70,000   <- web search, by far the largest budget
 *   llama-3.3-70b-versatile   12,000
 *   openai/gpt-oss-120b        8,000   <- best writer, kept for the prose steps
 *   openai/gpt-oss-20b         8,000
 *   qwen/qwen3.6-27b           8,000
 *
 * So one full pipeline run touches five separate buckets instead of hammering one.
 */

export const MODELS = {
  /** Web-search grounded. Used for research and fact-checking. */
  search: 'groq/compound-mini',
  /** Highest-quality prose — writes and revises the actual emails. */
  writer: 'openai/gpt-oss-120b',
  /** Turns long search output into structured JSON. Large context budget. */
  structurer: 'llama-3.3-70b-versatile',
  /**
   * Second structurer. Deliberately NOT a reasoning model: qwen3.6-27b spent its whole
   * completion budget on hidden reasoning and returned
   * "max completion tokens reached before generating a valid document" instead of JSON.
   */
  analyst: 'llama-3.3-70b-versatile',
  /** Small utility jobs. */
  utility: 'openai/gpt-oss-20b',
} as const;

/** Known tokens-per-minute budgets, used to pace requests before they 429. */
export const MODEL_TPM: Record<string, number> = {
  'groq/compound-mini': 70_000,
  'groq/compound': 70_000,
  'llama-3.3-70b-versatile': 12_000,
  'openai/gpt-oss-120b': 8_000,
  'openai/gpt-oss-20b': 8_000,
  'qwen/qwen3.6-27b': 8_000,
  'llama-3.1-8b-instant': 6_000,
};

export const DEFAULT_TPM = 6_000;

export function envModel(key: keyof typeof MODELS): string {
  const overrides: Record<string, string | undefined> = {
    search: process.env.GROQ_SEARCH_MODEL,
    writer: process.env.GROQ_MODEL,
  };
  return overrides[key] || MODELS[key];
}
