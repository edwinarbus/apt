/**
 * Shared cost estimation for the optional AI layers (enrichment + vision).
 * Prices are USD per million tokens and are estimates for local budgeting only
 * — the real bill is whatever Anthropic charges. Cache reads bill ~0.1x input;
 * cache writes ~1.25x input.
 */

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-fable-5": { input: 10, output: 50 },
};

const FALLBACK = MODEL_PRICING["claude-sonnet-5"];

export function estimateCostUsd(model: string, usage: AiUsage): number {
  const p = MODEL_PRICING[model] ?? FALLBACK;
  const cost =
    (usage.inputTokens / 1_000_000) * p.input +
    (usage.outputTokens / 1_000_000) * p.output +
    (usage.cacheReadTokens / 1_000_000) * p.input * 0.1 +
    (usage.cacheCreationTokens / 1_000_000) * p.input * 1.25;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
