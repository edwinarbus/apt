import { describe, expect, it } from "vitest";
import {
  advanceStaleStatus,
  isMissingStatus,
  shouldProcessStaleUpdates,
} from "@/core/stale";

describe("advanceStaleStatus", () => {
  it("walks the cautious missing chain", () => {
    expect(advanceStaleStatus("active")).toBe("missing_once");
    expect(advanceStaleStatus("missing_once")).toBe("missing_multiple_runs");
    expect(advanceStaleStatus("missing_multiple_runs")).toBe("likely_unavailable");
    expect(advanceStaleStatus("likely_unavailable")).toBe("likely_unavailable");
  });
});

describe("shouldProcessStaleUpdates", () => {
  it("only allows fully successful runs with verified pagination", () => {
    expect(shouldProcessStaleUpdates("success", true)).toBe(true);
    expect(shouldProcessStaleUpdates("success", false)).toBe(false);
    expect(shouldProcessStaleUpdates("success", null)).toBe(false);
    expect(shouldProcessStaleUpdates("partial", true)).toBe(false);
    expect(shouldProcessStaleUpdates("failed", true)).toBe(false);
    expect(shouldProcessStaleUpdates("skipped", true)).toBe(false);
  });
});

describe("isMissingStatus", () => {
  it("identifies the missing chain", () => {
    expect(isMissingStatus("missing_once")).toBe(true);
    expect(isMissingStatus("likely_unavailable")).toBe(true);
    expect(isMissingStatus("active")).toBe(false);
  });
});
