// apps/web/lib/mcp/load-tools.ts
//
// The load_tools meta-tool surface (BI-D8101329, MCP tool-tier Phase 2). Kept
// out of route.ts so the transport module stays under the module-size ceiling;
// the route wires these into tools/list (append LOAD_TOOLS_LISTED) and tools/call
// (build the result, then SSE-or-JSON it). Grant filtering and the session-store
// write stay in the route/store — this module is presentation + payload shaping.

import { LOAD_TOOLS_TOOL_NAME } from "@/lib/tak/tool-intent";
import { MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";

type JsonRpcId = string | number | null;
type NoMatchReason = "unknown-tool-name" | "reviewer-route-required" | "not-granted" | "intent-no-match" | "missing-query";
type LoadToolsNoMatch = { reason: NoMatchReason; requestedNames?: string[] };

export function classifyLoadToolsNoMatch(
  args: Record<string, unknown>,
  knownNames: ReadonlySet<string>,
  grantedNames: ReadonlySet<string>,
  selectedCount: number,
): LoadToolsNoMatch | undefined {
  if (selectedCount > 0) return undefined;
  const requestedNames = Array.isArray(args.names)
    ? args.names.filter((name): name is string => typeof name === "string")
    : [];
  if (requestedNames.length > 0) {
    const reason = requestedNames.some((name) => !knownNames.has(name))
      ? "unknown-tool-name"
      : requestedNames.some((name) => name.startsWith("record_initiative_"))
        ? "reviewer-route-required"
        : requestedNames.some((name) => !grantedNames.has(name))
          ? "not-granted"
          : "intent-no-match";
    return { reason, requestedNames };
  }
  return { reason: typeof args.query === "string" && args.query.trim() ? "intent-no-match" : "missing-query" };
}

/**
 * Keep the cross-client recovery contract inside Codex's documented 512-char
 * initialize-instruction budget; org context may be appended after this.
 */
export const MCP_PROGRESSIVE_DISCLOSURE_INSTRUCTIONS =
  "DPF discloses MCP tools progressively. If absent, call load_tools with {names:[\"exact_tool_name\"]} or {query:\"capability intent\"}. Honor notifications/tools/list_changed or re-fetch tools/list. If the host top-level registry stays stale, invoke the loaded tool through its programmatic tool catalog; this remains governed MCP. Resources are not tools; plugins cannot recover connected-server tools. Missing grant means authorization failure; connection error means server unavailable. DPF domain MCP.";

// The synthetic load_tools tool as it appears on tools/list. Not a granted
// domain tool — the route handles it inline in tools/call. Description is
// provenance-free per the tool-economy hygiene guard.
export const LOAD_TOOLS_LISTED = {
  name: LOAD_TOOLS_TOOL_NAME,
  description:
    "Load additional authorized MCP tools into this session so they appear on the next tools/list. Use it when the current tool set does not contain a capability you need: pass {names:[\"exact_tool_name\"]} to load specific tools, or {query:\"natural-language capability intent\"} to rank matching names and descriptions. Discovery-only — it never executes a tool, and loaded tools are appended to (not swapped for) the current set. Call search_tool_marketplace if you do not know a tool's name.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Natural-language capability intent ranked against authorized tool names and descriptions.",
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
  noMatch?: LoadToolsNoMatch,
): { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> } {
  const noMatchRecovery = selected.length === 0 && noMatch
    ? {
      ...noMatch,
      ...(noMatch.reason === "reviewer-route-required"
        ? {
          supportedEntryPoint: { toolName: "get_backlog_item" },
          nextStep: "Call get_backlog_item for the initiative and use its server-issued reviewerRoutes packet. The author must not invoke the reviewer writer directly.",
        }
        : {
          nextStep: noMatch.reason === "unknown-tool-name"
            ? "Use an intent query or search_tool_marketplace; do not retry the nonexistent exact name."
            : "Use a broader intent query or an authorized workflow entry point; do not retry the same unavailable exact name.",
        }),
    }
    : undefined;
  let data: Record<string, unknown> = {
    newlyLoaded: selected.map((t) => ({ name: t.name, description: firstSentence(t.description) })),
    loadedToolNames,
    count: selected.length,
    listChanged: selected.length > 0,
    noMatch: noMatchRecovery,
    recovery:
      selected.length > 0
        ? { reListTools: true, programmaticCatalogFallback: true }
        : undefined,
    note:
      selected.length > 0
        ? "Tools loaded for this session. Honor notifications/tools/list_changed or re-fetch tools/list. If the host top-level registry remains unchanged, invoke the loaded tool through its programmatic tool catalog; this remains governed MCP."
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

/** Machine-readable recovery for a tool name that is absent from the grant map. */
export function buildUnknownToolResult(toolName: string): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError: true;
} {
  const recovery = {
    tool: LOAD_TOOLS_TOOL_NAME,
    exactName: { names: [toolName] },
    intentQuery: { query: "describe the capability you need" },
    nextStep:
      "Call load_tools, then honor notifications/tools/list_changed or re-fetch tools/list. If the host top-level registry stays stale, use its programmatic tool catalog. Exact-name loading requires a correctly spelled authorized deferred tool; use an intent query or search_tool_marketplace otherwise.",
  };
  const structuredContent = { error: "unknown_tool", toolName, recovery };
  return {
    content: [
      {
        type: "text",
        text: `Unknown tool: ${toolName}. Use load_tools by exact name or capability intent, then re-fetch tools/list.`,
      },
    ],
    structuredContent,
    isError: true,
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
