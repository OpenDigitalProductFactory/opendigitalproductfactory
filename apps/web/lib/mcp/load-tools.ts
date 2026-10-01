// apps/web/lib/mcp/load-tools.ts
//
// The load_tools meta-tool surface (BI-D8101329, MCP tool-tier Phase 2). Kept
// out of route.ts so the transport module stays under the module-size ceiling;
// the route wires these into tools/list (append LOAD_TOOLS_LISTED) and tools/call
// (build the result, then SSE-or-JSON it). Grant filtering and the session-store
// write stay in the route/store — this module is presentation + payload shaping.

import { LOAD_TOOLS_TOOL_NAME } from "@/lib/tak/tool-intent";
import { canonicalWorkroomToolName } from "@/lib/tak/workroom-tool-aliases";
import { INITIATIVE_READINESS_LANES } from "@/lib/tak/initiative-readiness-tool-grants";
import { MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";
import type { ListingAuthority } from "./listing-authority";

type JsonRpcId = string | number | null;
type NoMatchReason = "unknown-tool-name" | "reviewer-route-required" | "not-granted" | "intent-no-match" | "missing-query";
type LoadToolsNoMatch = { reason: NoMatchReason; requestedNames?: string[] };

/**
 * A writer the author must NOT invoke directly — the registry decides, not the
 * tool's name (BI-7876699F).
 *
 * `record_initiative_*` used to be matched by prefix, which is right for nine of
 * the ten lanes and wrong for the only one that matters to an author:
 * `record_initiative_evidence` is declared `independent: false` with
 * `design-author` among its accountableRoles. Prefix-matching it meant a
 * delivery-small item could never satisfy RESEARCH_REQUIRED — its own shape owes
 * no baseline and no plan, so the author had no reachable writer at all and the
 * item could not be closed by anyone.
 *
 * The prefix test also sat ABOVE the not-granted branch, so a missing grant was
 * reported as "reviewer-route-required" and sent the operator to a recovery
 * packet that issues no route. One registry, one answer.
 */
function isReviewerOnlyWriter(name: string): boolean {
  return INITIATIVE_READINESS_LANES[name]?.independent === true;
}

/**
 * The legacy one-line summary of what could not be loaded. `grantedNames` must be
 * the AUTHORIZED set the selection drew from (token ∩ role ∩ agent ∩ clearance):
 * judging against the token-only set made an agent-grant denial read as
 * "intent-no-match" (BI-949FBBAE). For an exact-name request it covers only the
 * names that cannot be loaded, so a partial match still says what was left out;
 * a callable name that merely missed this call's batch limit is not listed.
 */
export function classifyLoadToolsNoMatch(
  args: Record<string, unknown>,
  knownNames: ReadonlySet<string>,
  grantedNames: ReadonlySet<string>,
  selectedNames: ReadonlySet<string>,
): LoadToolsNoMatch | undefined {
  const requestedNames = Array.isArray(args.names)
    ? args.names.filter((name): name is string => typeof name === "string")
    : [];
  if (requestedNames.length > 0) {
    const unmatched = requestedNames.filter((name) => {
      const canonical = canonicalWorkroomToolName(name.trim());
      return !selectedNames.has(canonical) && !grantedNames.has(canonical);
    });
    if (unmatched.length === 0) return undefined;
    const canonicalNames = unmatched.map((name) => canonicalWorkroomToolName(name.trim()));
    const reason = canonicalNames.some((name) => !knownNames.has(name))
      ? "unknown-tool-name"
      : canonicalNames.some(isReviewerOnlyWriter)
        ? "reviewer-route-required"
        : canonicalNames.some((name) => !grantedNames.has(name))
          ? "not-granted"
          : "intent-no-match";
    return { reason, requestedNames: unmatched };
  }
  if (selectedNames.size > 0) return undefined;
  return { reason: typeof args.query === "string" && args.query.trim() ? "intent-no-match" : "missing-query" };
}

// ─── Per-name status (BI-949FBBAE) ───────────────────────────────────────────
// load_tools used to answer only for the names it loaded. Every requested name
// now gets one entry saying which authority axis stopped it, in call order:
// token scope, then the person's role, then the acting coworker's grants, then
// clearance. `reviewer-route-required` keeps its place above the grant axes
// (BI-7876699F): an author must not call a reviewer-only writer at all.

export type LoadToolsStatusReason =
  | "unknown-tool-name"
  | "token-scope-missing"
  | "role-capability-missing"
  | "agent-grant-missing"
  | "clearance-denied"
  | "reviewer-route-required";

export type LoadToolsNameStatus = {
  name: string;
  serverHasTool: boolean;
  tokenGranted: boolean;
  /** null when the connection has no acting coworker (no agent axis applies). */
  agentGranted: boolean | null;
  loadedInSession: boolean;
  callableByName: boolean;
  reason: LoadToolsStatusReason | null;
  recovery: string | null;
};

/** What the route already knows about this caller's authority, per tool name. */
export type LoadToolsStatusFacts = {
  knownNames: ReadonlySet<string>;
  /** Names tools/call would admit: token ∩ role ∩ agent grants ∩ clearance. */
  authorizedNames: ReadonlySet<string>;
  loadedToolNames: readonly string[];
  /** Token coarse scope + granular grant (expanded) admit the tool. */
  tokenGrants: (name: string) => boolean;
  /** The acting person's platform role carries the tool's required capability. */
  roleAllows: (name: string) => boolean;
  authority: ListingAuthority;
  /** The runtime grant predicate (tak/agent-grants isToolAllowedByGrants). */
  isAllowedByGrants: (name: string, grants: string[]) => boolean;
  requiredGrants: (name: string) => readonly string[];
};

const REVIEWER_ROUTE_RECOVERY =
  "The author dispatches the reviewer route from get_backlog_item; this tool is for the independent reviewer.";

function grantList(grants: readonly string[]): string {
  return grants.length === 0 ? "no grant is mapped" : grants.length === 1 ? grants[0] : `any one of ${grants.join(", ")}`;
}

function recoveryFor(
  reason: LoadToolsStatusReason,
  grants: readonly string[],
  authority: ListingAuthority,
): string {
  switch (reason) {
    case "unknown-tool-name":
      return "No tool by this name exists on this server. Do not retry it; use a load_tools intent query or search_tool_marketplace to find the right name.";
    case "reviewer-route-required":
      return REVIEWER_ROUTE_RECOVERY;
    case "token-scope-missing":
      return `This connection's token does not carry the grant this tool needs (${grantList(grants)}). Reissue the MCP token or re-authorize with that scope.`;
    case "role-capability-missing":
      return "Your platform role does not include the capability this tool requires. An administrator must change your role; a new token will not help.";
    case "agent-grant-missing":
      return authority.agentBound && authority.blanketDeny && authority.cause === "agent-unresolved"
        ? "The coworker this connection acts as is not an active, resolvable identity, so none of its grants apply. Reconnect through OAuth or reissue the token with an active coworker."
        : `The coworker this connection acts as holds none of the grants this tool needs (${grantList(grants)}). An administrator can grant it to that coworker; the token cannot widen it.`;
    case "clearance-denied":
      return "Your sensitivity clearance does not cover the data sensitivity of the coworker this connection acts as, so every tool through it is refused. An administrator must raise your clearance or bind the connection to a coworker at your level.";
  }
}

/** One status entry per distinct requested name, in request order. Pure. */
export function buildLoadToolsStatus(
  args: Record<string, unknown>,
  facts: LoadToolsStatusFacts,
): LoadToolsNameStatus[] {
  const requested = Array.isArray(args.names)
    ? args.names.filter((name): name is string => typeof name === "string").map((name) => name.trim()).filter(Boolean)
    : [];
  const loaded = new Set(facts.loadedToolNames);
  const { authority } = facts;
  const seen = new Set<string>();
  const status: LoadToolsNameStatus[] = [];
  for (const name of requested) {
    const canonical = canonicalWorkroomToolName(name);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const serverHasTool = facts.knownNames.has(canonical);
    const tokenGranted = serverHasTool && facts.tokenGrants(canonical);
    const agentUnresolved = authority.agentBound && authority.blanketDeny && authority.cause === "agent-unresolved";
    const agentGranted = !authority.agentBound
      ? null
      : serverHasTool && !agentUnresolved && facts.isAllowedByGrants(canonical, authority.agentGrants);
    const callableByName = facts.authorizedNames.has(canonical);
    const loadedInSession = loaded.has(canonical);
    const reason: LoadToolsStatusReason | null = callableByName
      ? null
      : !serverHasTool
        ? "unknown-tool-name"
        : isReviewerOnlyWriter(canonical)
          ? "reviewer-route-required"
          : !tokenGranted
            ? "token-scope-missing"
            : !facts.roleAllows(canonical)
              ? "role-capability-missing"
              : agentGranted === false
                ? "agent-grant-missing"
                : "clearance-denied";
    const recovery = reason
      ? recoveryFor(reason, facts.requiredGrants(canonical), authority)
      : loadedInSession
        ? null
        : "Callable, but not loaded by this call: it hit the per-call load limit. Call load_tools again with this name.";
    status.push({ name, serverHasTool, tokenGranted, agentGranted, loadedInSession, callableByName, reason, recovery });
  }
  return status;
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
  status: LoadToolsNameStatus[] = [],
): { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> } {
  // Populated for a partial match too (BI-949FBBAE): loading one name of four
  // must still say why the other three were not loaded.
  const noMatchRecovery = noMatch
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
    status,
    recovery:
      selected.length > 0
        ? { reListTools: true, programmaticCatalogFallback: true }
        : undefined,
    note:
      (selected.length > 0
        ? "Tools loaded for this session. Honor notifications/tools/list_changed or re-fetch tools/list. If the host top-level registry remains unchanged, invoke the loaded tool through its programmatic tool catalog; this remains governed MCP."
        : "No granted tools matched. Pass exact names or a broader query, or call search_tool_marketplace to find tool names.")
      + (status.some((entry) => entry.reason !== null || !entry.loadedInSession)
        ? " Each requested name has a status entry saying why it was or was not loaded."
        : ""),
  };
  if (JSON.stringify(data).length > MCP_ROUTE_TOOL_RESULT_CHAR_CAP) {
    data = {
      ...data,
      newlyLoaded: selected.map((t) => ({ name: t.name, description: "" })),
      _summariesTruncated: true,
    };
  }
  if (JSON.stringify(data).length > MCP_ROUTE_TOOL_RESULT_CHAR_CAP) {
    // A very long names list: keep every verdict, drop the repeated prose.
    data = { ...data, status: status.map((entry) => ({ ...entry, recovery: null })), _statusRecoveryTruncated: true };
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
