// Scoped MCP tool pack — BI-ARCH-TOOLPACKS.
//
// `apps/web/lib/mcp-tools.ts` is a 16k-line mega-module that both declares the
// full PLATFORM_TOOLS registry and dispatches every tool. The spec (§6.2) calls
// for splitting it into domain-owned "tool packs", each owning its tool
// definitions, handler map, and grant metadata — with mcp-tools.ts reduced to a
// thin composition layer over time. This is the shape those packs converge on.
//
// A pack bundles the three things that previously lived in three different
// places (definitions inline in mcp-tools.ts, handlers in a sibling module,
// grants in agent-grants.ts), so domain metadata travels together. Grant gating
// still resolves through agent-grants.ts `TOOL_TO_GRANTS`; the pack mirrors it so
// a test can assert the two never drift (the R3 authority-control safeguard).

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";

/**
 * A tool handler, with the context fields the dispatch site (executeTool) passes
 * through from its `ToolExecutionContext` — `routeContext`, `threadId`, and the
 * acting coworker's `agentId`. The registry forwards the full runtime context;
 * this is the structural subset packs may rely on. Handlers may ignore any of it.
 */
export type ToolPackHandler = (
  params: Record<string, unknown>,
  userId: string,
  context?: {
    routeContext?: string;
    threadId?: string;
    agentId?: string;
    /** Owning TaskRun id, forwarded for handlers that attribute background work. */
    taskRunId?: string;
    /** Caller attribution from the MCP route (client UA token + auth identity)
     *  for decision-ledger writers. */
    callerClient?: string;
    apiTokenId?: string;
    authSource?: string;
    tokenScope?: string;
    authorityDecisionId?: string;
  },
) => Promise<ToolResult>;

export type ToolPack = {
  /** Domain identifier, e.g. "deliberation-siem", "backlog", "work-capsules". */
  packId: string;
  /** Tool definitions this pack owns (name, schema, requiredCapability, …). */
  definitions: ToolDefinition[];
  /** Tool name -> handler. The registry composes these for dispatch. */
  handlers: Record<string, ToolPackHandler>;
  /**
   * Agent-grant categories per tool, mirroring agent-grants.ts `TOOL_TO_GRANTS`
   * (which stays the gating source). Co-located so the metadata travels with the
   * pack; `tool-registry.test.ts` asserts it matches the gating source.
   */
  grants: Record<string, readonly string[]>;
};
