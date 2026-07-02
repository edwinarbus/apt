import type { Browser } from "playwright";
import {
  DEFAULT_USER_AGENT,
  PoliteFetcher,
  type FetchInit,
  type FetchResult,
  type FetchTraceEntry,
  type FetcherOptions,
  type TextFetcher,
} from "./fetcher";

/**
 * A TextFetcher that renders JavaScript-heavy pages in a headless Chromium
 * (Playwright) and returns the rendered DOM. Requests WITHOUT a `render`
 * option fall through to a plain PoliteFetcher HTTP GET — so robots.txt and
 * any server-rendered detail pages stay cheap, and only the pages that truly
 * need a browser pay for one.
 *
 * The browser is launched lazily on the first render request and must be
 * released with `close()` (the runner/verifier call it in a finally). Chromium
 * is provided by the `playwright` dev dependency; `npx playwright install
 * chromium` downloads the binary once.
 */
export class PlaywrightFetcher implements TextFetcher {
  requestsMade = 0;
  trace: FetchTraceEntry[] = [];
  private http: PoliteFetcher;
  private browser: Browser | null = null;
  private browserPromise: Promise<Browser> | null = null;

  constructor(private opts: FetcherOptions) {
    this.http = new PoliteFetcher(opts);
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    if (!this.browserPromise) {
      // Import lazily so environments without Playwright installed can still
      // load this module (it only fails if a render is actually attempted).
      this.browserPromise = import("playwright").then(({ chromium }) =>
        chromium.launch({ headless: true }),
      );
    }
    this.browser = await this.browserPromise;
    return this.browser;
  }

  async fetchText(url: string, init?: FetchInit): Promise<FetchResult> {
    if (!init?.render) {
      const res = await this.http.fetchText(url, init);
      // Surface plain-fetch traffic in this fetcher's own trace/counter.
      this.requestsMade = this.http.requestsMade;
      this.trace = this.http.trace;
      return res;
    }
    return this.render(url, init);
  }

  private async render(url: string, init: FetchInit): Promise<FetchResult> {
    const render = init.render!;
    const timeoutMs = render.timeoutMs ?? this.opts.timeoutMs;
    const started = Date.now();
    const record = (result: FetchResult) => {
      this.requestsMade++;
      this.trace.push({
        url,
        method: "GET(render)",
        status: result.status,
        elapsedMs: result.elapsedMs,
        bytes: result.text.length,
        error: result.error,
        at: new Date().toISOString(),
      });
      return result;
    };

    let page;
    try {
      const browser = await this.getBrowser();
      page = await browser.newPage({
        userAgent: this.opts.userAgent ?? DEFAULT_USER_AGENT,
      });
    } catch (err) {
      return record({
        url,
        finalUrl: url,
        status: null,
        ok: false,
        text: "",
        elapsedMs: Date.now() - started,
        error: `browser launch failed (is chromium installed? run \`npx playwright install chromium\`): ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }

    try {
      const response = await page.goto(url, {
        waitUntil: "networkidle",
        timeout: timeoutMs,
      });
      if (render.waitForSelector) {
        try {
          await page.waitForSelector(render.waitForSelector, {
            timeout: Math.min(15000, timeoutMs),
          });
        } catch {
          // The selector never appeared — return what rendered anyway so the
          // adapter can decide (e.g. a genuine empty-results page).
        }
      }
      if (render.scrollToLoad) {
        // Many listing grids lazy-load price/image as cards enter the
        // viewport. Step-scroll to the bottom so every card fully renders.
        // Passed as a string (not a function) so the bundler's __name helper
        // can't leak into the serialized browser code.
        await page.evaluate(`new Promise((resolve) => {
          let y = 0;
          const step = () => {
            window.scrollBy(0, window.innerHeight);
            y += window.innerHeight;
            if (y >= document.body.scrollHeight) { window.scrollTo(0, 0); resolve(); }
            else { setTimeout(step, 250); }
          };
          step();
        })`);
      }
      if (render.settleMs) await page.waitForTimeout(render.settleMs);
      const text = await page.content();
      const status = response?.status() ?? 200;
      return record({
        url,
        finalUrl: page.url(),
        status,
        ok: status >= 200 && status < 400,
        text,
        elapsedMs: Date.now() - started,
        error: status >= 400 ? `HTTP ${status}` : null,
      });
    } catch (err) {
      return record({
        url,
        finalUrl: url,
        status: null,
        ok: false,
        text: "",
        elapsedMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      await page.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.browserPromise = null;
    }
  }
}
