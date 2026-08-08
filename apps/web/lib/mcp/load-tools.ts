// apps/web/lib/mcp/load-tools.ts
//
// The load_tools meta-tool surface (BI-D8101329, MCP tool-tier Phase 2). Kept
// out of route.ts so the transport module stays under the module-size ceiling;
// the route wires these into tools/list (append LOAD_TOOLS_LISTED) and tools/call
// (build the result, then SSE-or-JSON it). Grant filtering and the session-store
// write stay in the route/store — this module is presentation + payload shaping.

import { LOAD_TOOLS_TOOL_NAME } from "./tool-tier";
import { MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";

type JsonRpcId = string | number | null;

// The synthetic load_tools tool as it appears on tools/list. Not a granted
// domain tool — the route handles it inline in tools/call. Description is
// provenance-free per the tool-economy hygiene guard.
export const LOAD_TOOLS_LISTED = {
  name: LOAD_TOOLS_TOOL_NAME,
  description:
    "Load additional MCP tools into this session so they appear on the next tools/list. Use it when the current tool set does not contain a tool you need: pass {names:[\"exact_tool_name\"]} to load specific tools, or {query:\"keyword\"} to search names and descriptions. Discovery-only — it never executes a tool, and loaded tools are appended to (not swapped for) the current set, so the cached prompt prefix is preserved. Call search_tool_marketplace first if you don't know a tool's name.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Case-insensitive keyword matched against tool name and description.",
      },
      names: {
        type: "array",
        items: { type: "string" },
        description: "Exact tool names to load into this session.",
      },
    },
    additionalProperties: false,
  },
  annotations: {
    title: "load tools",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

/** First sentence of a tool description, hard-capped, for compact summaries. */
function firstSentence(text: string): string {
  const s = (text ?? "").trim();
  const m = s.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : s).trim().slice(0, 200);
}

/**
 * Shape the model-facing load_tools result from the selected tools and the
 * resulting session set. Bounds the payload against the MCP route cap
 * (context-engineering-standards.md G1/P6): a very broad query can match the
 * whole granted surface, so drop descriptions to names-only before overflow.
 */
export function buildLoadToolsResult(
  selected: ReadonlyArray<{ name: string; description: string }>,
  loadedToolNames: string[],
): { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> } {
  let data: Record<string, unknown> = {
    newlyLoaded: selected.map((t) => ({ name: t.name, description: firstSentence(t.description) })),
    loadedToolNames,
    count: selected.length,
    listChanged: selected.length > 0,
    note:
      selected.length > 0
        ? "Tools loaded for this session — re-fetch tools/list to use them (a notifications/tools/list_changed was emitted for list_changed-aware clients)."
        : "No granted tools matched. Pass exact names or a broader query, or call search_tool_marketplace to find tool names.",
  };
  if (JSON.stringify(data).length > MCP_ROUTE_TOOL_RESULT_CHAR_CAP) {
    data = {
      ...data,
      newlyLoaded: selected.map((t) => ({ name: t.name, description: "" })),
      _summariesTruncated: true,
    };
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ success: true, ...data }, null, 2) }],
    structuredContent: data,
  };
}

/**
 * Spec-conformant single-POST-with-SSE response (MCP Streamable HTTP): emit the
 * list_changed notification, then the tool result, then close. Used only when
 * the client advertised `Accept: text/event-stream`; the route's plain-JSON path
 * is the fallback (those clients re-fetch tools/list on the result).
 */
export function loadToolsSseResponse(id: JsonRpcId, result: unknown): Response {
  const enc = new TextEncoder();
  const frames = [
    { jsonrpc: "2.0", method: "notifications/tools/list_changed" },
    { jsonrpc: "2.0", id, result },
  ];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(enc.encode(`event: message\ndata: ${JSON.stringify(frame)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
