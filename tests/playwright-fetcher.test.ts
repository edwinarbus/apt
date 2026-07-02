import { describe, expect, it, afterAll } from "vitest";
import { PlaywrightFetcher } from "@/core/playwright-fetcher";

/**
 * Verifies the reusable browser-rendering infrastructure end to end against a
 * local data: URL (no network). This is the path JS-only sources (e.g. an
 * AppFolio PM once it has inventory) use via the runner's needsJavaScript
 * switch. Skips automatically if Chromium isn't installed.
 */

const fetcher = new PlaywrightFetcher({
  requestDelayMs: 0,
  timeoutMs: 15000,
  retryCount: 0,
});

afterAll(async () => {
  await fetcher.close();
});

async function chromiumAvailable(): Promise<boolean> {
  try {
    const { chromium } = await import("playwright");
    const b = await chromium.launch({ headless: true });
    await b.close();
    return true;
  } catch {
    return false;
  }
}

describe("PlaywrightFetcher", () => {
  it("renders a JS-built DOM and returns the resulting HTML", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("chromium not installed — skipping render test");
      return;
    }
    const html = `<!doctype html><html><body><div id=app></div>
      <script>
        const grid = document.createElement('div');
        for (let i = 0; i < 3; i++) {
          const c = document.createElement('div');
          c.className = 'listing-card';
          c.textContent = 'unit ' + i;
          grid.appendChild(c);
        }
        document.getElementById('app').appendChild(grid);
      </script></body></html>`;
    const res = await fetcher.fetchText(
      `data:text/html,${encodeURIComponent(html)}`,
      { render: { waitForSelector: ".listing-card", settleMs: 100 } },
    );
    expect(res.ok).toBe(true);
    // The cards exist only after the inline script runs — proves rendering.
    expect(res.text).toContain('class="listing-card"');
    expect((res.text.match(/listing-card/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(fetcher.trace.at(-1)?.method).toBe("GET(render)");
  }, 30000);

  it("falls through to a plain HTTP GET when no render is requested", async () => {
    // No `render` option -> uses the underlying PoliteFetcher (data: URLs are
    // handled by fetch()), so this needs no browser.
    const res = await fetcher.fetchText(
      "data:text/plain,hello-plain",
      undefined,
    );
    expect(res.ok).toBe(true);
    expect(res.text).toContain("hello-plain");
  });
});
