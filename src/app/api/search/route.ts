import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { AnthropicSearchClient } from "@/search/client";
import { runSearch } from "@/search/search";
import type { SearchRequestBody, SearchResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: SearchRequestBody;
  try {
    body = (await req.json()) as SearchRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const query = (body.query ?? "").trim();
  if (!query) {
    return NextResponse.json({ error: "empty query" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "AI search needs ANTHROPIC_API_KEY. Add it to .env.local and restart the dev server.",
      },
      { status: 503 },
    );
  }

  const db = getDb();
  const client = new AnthropicSearchClient();
  const result = await runSearch(db, client, {
    query,
    location: body.location ?? null,
    radiusMi: body.radiusMi ?? null,
    includeHiddenGone: body.includeHiddenGone ?? false,
  });

  const res: SearchResponse = {
    query,
    interpretation: result.interpretation,
    intentChips: result.intentChips,
    matches: result.matches,
    candidateCount: result.candidateCount,
    model: result.model,
    error: result.error,
  };
  return NextResponse.json(res, { status: result.error ? 502 : 200 });
}
