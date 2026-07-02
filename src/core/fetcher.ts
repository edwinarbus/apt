/**
 * Polite HTTP client used by all adapters. Enforces a per-source delay between
 * requests, timeouts, and bounded retries with backoff. Never throws — every
 * request resolves to a FetchResult so adapters can degrade gracefully and the
 * run record can explain exactly what happened.
 */

export interface FetcherOptions {
  requestDelayMs: number;
  timeoutMs: number;
  retryCount: number;
  userAgent?: string;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number | null;
  ok: boolean;
  text: string;
  elapsedMs: number;
  error: string | null;
}

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PoliteFetcher {
  private lastRequestAt = 0;
  requestsMade = 0;

  constructor(private opts: FetcherOptions) {}

  async fetchText(
    url: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ): Promise<FetchResult> {
    const attempts = Math.max(1, this.opts.retryCount + 1);
    let last: FetchResult | null = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await this.respectDelay(attempt);
      last = await this.attempt(url, init);
      this.requestsMade++;
      if (last.ok) return last;
      // Retry only transient failures; 4xx (except 429) will not improve.
      const retryable =
        last.status === null || last.status === 429 || last.status >= 500;
      if (!retryable) return last;
      if (last.status === 429) await sleep(this.opts.requestDelayMs * 4);
    }
    return last!;
  }

  private async respectDelay(attempt: number): Promise<void> {
    const delay = this.opts.requestDelayMs * (attempt > 1 ? attempt : 1);
    const since = Date.now() - this.lastRequestAt;
    if (this.lastRequestAt > 0 && since < delay) {
      await sleep(delay - since);
    }
    this.lastRequestAt = Date.now();
  }

  private async attempt(
    url: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ): Promise<FetchResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const res = await fetch(url, {
        method: init?.method ?? "GET",
        body: init?.body,
        headers: {
          "User-Agent": this.opts.userAgent ?? DEFAULT_USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...init?.headers,
        },
        redirect: "follow",
        signal: controller.signal,
      });
      const text = await res.text();
      return {
        url,
        finalUrl: res.url || url,
        status: res.status,
        ok: res.ok,
        text,
        elapsedMs: Date.now() - started,
        error: res.ok ? null : `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        url,
        finalUrl: url,
        status: null,
        ok: false,
        text: "",
        elapsedMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
