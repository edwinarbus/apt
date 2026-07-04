import { getDb } from "@/db/client";
import { AnthropicSearchClient } from "@/search/client";
import { runSearch } from "@/search/search";
import type { SearchRequestBody, SearchResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";
// Adaptive thinking can reason for a while before the answer starts.
export const maxDuration = 300;

/**
 * Streams the search as NDJSON so the UI can show live, real progress:
 *   {"type":"stage","stage":"assemble","candidates":600}
 *   {"type":"stage","stage":"prerank","kept":60}
 *   {"type":"stage","stage":"model_start","model":"claude-sonnet-5"}
 *   {"type":"thinking","delta":"…"}          // Claude's real summarized thinking
 *   {"type":"delta","chars":1234}            // model output growing
 *   {"type":"done","result":{...}}           // final SearchResponse
 * Errors arrive as {"type":"error","error":"..."} on the same stream.
 */
export async function POST(req: Request) {
  let body: SearchRequestBody;
  try {
    body = (await req.json()) as SearchRequestBody;
  } catch {
    return jsonError("invalid JSON body", 400);
  }
  const query = (body.query ?? "").trim();
  if (!query) return jsonError("empty query", 400);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      if (!process.env.ANTHROPIC_API_KEY) {
        send({
          type: "error",
          error:
            "AI search needs ANTHROPIC_API_KEY. Add it to .env.local and restart the dev server.",
        });
        controller.close();
        return;
      }

      try {
        const db = await getDb();
        const client = new AnthropicSearchClient();
        let lastDelta = 0;
        const result = await runSearch(
          db,
          client,
          {
            query,
            location: body.location ?? null,
            radiusMi: body.radiusMi ?? null,
            includeHiddenGone: body.includeHiddenGone ?? false,
          },
          (event) => {
            // Throttle delta events (every ~400 chars) to keep the stream light.
            if (event.type === "delta") {
              if (event.chars - lastDelta < 400) return;
              lastDelta = event.chars;
            }
            send(event);
          },
        );
        if (result.error) {
          send({ type: "error", error: result.error });
        } else {
          const payload: SearchResponse = {
            query,
            interpretation: result.interpretation,
            intentChips: result.intentChips,
            matches: result.matches,
            candidateCount: result.candidateCount,
            model: result.model,
            error: null,
          };
          send({ type: "done", result: payload });
        }
      } catch (err) {
        send({ type: "error", error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function jsonError(error: string, status: number) {
  return new Response(JSON.stringify({ type: "error", error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
