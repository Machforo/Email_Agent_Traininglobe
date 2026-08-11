import { DEFAULT_TPM, MODEL_TPM } from './models';

/**
 * Per-model token pacing.
 *
 * Groq enforces a tokens-per-minute budget per model, shared across all our API keys.
 * Without pacing, the cascade fires four calls back-to-back and the third one gets a
 * 429 telling us to wait 31 seconds — which is exactly what happened in testing.
 *
 * This keeps a rolling 60-second ledger of tokens spent per model and makes a request
 * wait until there is room, rather than firing and being rejected. Requests to the same
 * model are serialised; different models run concurrently.
 */

type Spend = { at: number; tokens: number };

class ModelBucket {
  private spends: Spend[] = [];
  private chain: Promise<void> = Promise.resolve();
  /** Set when the API explicitly tells us to back off until a point in time. */
  private blockedUntil = 0;
  /**
   * Requests remaining in the current window, as last reported by the API.
   * Tokens are not the only cap: groq/compound-mini allows 70k tokens/min but only
   * 250 requests per window, and that request cap is what bites during heavy use.
   */
  private remainingRequests = Infinity;

  constructor(
    public readonly model: string,
    private limit: number,
  ) {}

  updateLimit(limit: number) {
    if (Number.isFinite(limit) && limit > 0) this.limit = limit;
  }

  /** Feed back the `x-ratelimit-remaining-requests` header so we can ease off early. */
  updateRemainingRequests(remaining: number) {
    if (Number.isFinite(remaining)) this.remainingRequests = remaining;
  }

  /** Spread requests out as the request budget runs low, instead of hitting the wall. */
  private requestPacingMs(): number {
    if (this.remainingRequests > 40) return 0;
    if (this.remainingRequests > 10) return 1_500;
    if (this.remainingRequests > 0) return 5_000;
    return 15_000;
  }

  blockFor(ms: number) {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms);
  }

  private prune() {
    const cutoff = Date.now() - 60_000;
    this.spends = this.spends.filter((s) => s.at > cutoff);
  }

  private used(): number {
    this.prune();
    return this.spends.reduce((a, s) => a + s.tokens, 0);
  }

  record(tokens: number) {
    this.spends.push({ at: Date.now(), tokens });
  }

  /**
   * Queue a request behind the others for this model, waiting until `estimate`
   * tokens fit inside the rolling budget.
   */
  schedule<T>(estimate: number, fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      await this.waitForRoom(estimate);
      return fn();
    });
    // Keep the chain alive even if this request rejects.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async waitForRoom(estimate: number) {
    // Leave 10% headroom — our token estimate is approximate.
    const ceiling = this.limit * 0.9;
    const capped = Math.min(estimate, ceiling);

    const pacing = this.requestPacingMs();
    if (pacing) await sleep(pacing);

    for (let i = 0; i < 60; i++) {
      const now = Date.now();
      if (now < this.blockedUntil) {
        await sleep(Math.min(this.blockedUntil - now, 35_000));
        continue;
      }
      if (this.used() + capped <= ceiling) return;

      // Wait until the oldest spend falls out of the 60s window.
      this.prune();
      const oldest = this.spends[0];
      const waitMs = oldest ? Math.max(oldest.at + 60_000 - now, 250) : 1_000;
      await sleep(Math.min(waitMs, 20_000));
    }
  }
}

const buckets = new Map<string, ModelBucket>();

export function bucketFor(model: string): ModelBucket {
  let b = buckets.get(model);
  if (!b) {
    b = new ModelBucket(model, MODEL_TPM[model] ?? DEFAULT_TPM);
    buckets.set(model, b);
  }
  return b;
}

/** Rough token estimate: ~3.6 characters per token for English prose. */
export function estimateTokens(text: string, maxOutput = 0): number {
  return Math.ceil(text.length / 3.6) + maxOutput;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Groq returns the wait time both as a `retry-after` header and inside the error
 * message ("Please try again in 31.035s"). Prefer whichever is present.
 */
export function parseRetryDelayMs(headers: Headers, body: string): number | null {
  const header = headers.get('retry-after');
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs)) return Math.ceil(secs * 1000);
  }
  const m = body.match(/try again in ([\d.]+)\s*(ms|s|m)\b/i);
  if (m) {
    const value = Number(m[1]);
    const unit = m[2]!.toLowerCase();
    if (!Number.isFinite(value)) return null;
    const ms = unit === 'ms' ? value : unit === 'm' ? value * 60_000 : value * 1000;
    return Math.ceil(ms);
  }
  return null;
}
