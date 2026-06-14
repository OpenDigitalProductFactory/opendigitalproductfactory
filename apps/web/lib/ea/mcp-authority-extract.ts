// apps/web/lib/ea/mcp-authority-extract.ts
//
// Pure extractor for the MCP tool-authority SysML projection (Parity Engine,
// Slice 1 — docs/superpowers/specs/2026-06-14-design-implementation-parity-engine-design.md).
//
// The MCP tool→grant authority surface (`TOOL_TO_GRANTS` in
// apps/web/lib/tak/agent-grants.ts, ~242 entries, default-deny) is the
// security-critical authorization registry. Today it is absent from the SysML/EA
// graph, or only hand-approximated in the AI Agent Authority view. This module
// DERIVES the SysML model from that registry deterministically, so the model is a
// live projection that cannot drift from the implementation — the parity gap closes
// by extraction, not hand-modeling.
//
// Pure + dependency-free (input is the registry source text); the seed/reconcile
// shell supplies IO and idempotent upsert. Mirrors the pure/IO split of
// data-model-mirror + architecture-parity. SysML mapping:
//   - each grant   → `requirement`  (mcp:grant:<key>)
//   - each tool    → `action`       (mcp:tool:<name>)
//   - tool→grant   → `traces`       (the action traces the authority requirement gating it)
//   - default-deny → `constraint`   (a tool absent from the map is denied)
//   - package      → `package`      (contains all of the above)

export type McpAuthElementType = "package" | "requirement" | "action" | "constraint";

export interface McpAuthElement {
  /** Stable source key → EaElement.infraCiKey (e.g. "mcp:tool:query_backlog"). */
  sysmlKey: string;
  typeSlug: McpAuthElementType;
  name: string;
  description: string;
  /** Order-independent content signature for change detection. */
  descriptor: string;
}

export interface McpAuthRel {
  fromKey: string;
  toKey: string;
  relSlug: "contains" | "traces";
}

export interface McpAuthorityModel {
  elements: McpAuthElement[];
  relationships: McpAuthRel[];
  toolCount: number;
  grantCount: number;
}

export const MCP_AUTH_PACKAGE_KEY = "mcp:pkg";
export const MCP_AUTH_DEFAULT_DENY_KEY = "mcp:constraint:default-deny";

/**
 * Parse the `TOOL_TO_GRANTS` object literal out of agent-grants.ts source.
 * String/regex parse (not import) to stay decoupled from compilation, matching
 * the existing audits. Handles quoted ("a__b") and bare (drive_browser_task) keys.
 */
export function parseToolToGrants(src: string): Record<string, string[]> {
  const block = src.match(/TOOL_TO_GRANTS:[^=]*=\s*\{([\s\S]*?)\n\};/);
  const map: Record<string, string[]> = {};
  if (!block) return map;
  for (const line of block[1].split("\n")) {
    const m = line.match(/^\s*(?:"([^"]+)"|'([^']+)'|([a-zA-Z0-9_]+)):\s*\[([^\]]*)\]/);
    if (!m) continue;
    const toolName = m[1] ?? m[2] ?? m[3];
    if (!toolName) continue;
    map[toolName] = m[4]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return map;
}

/** Build the desired SysML authority model from the parsed tool→grants map. */
export function buildMcpAuthorityModel(toolToGrants: Record<string, string[]>): McpAuthorityModel {
  const elements: McpAuthElement[] = [];
  const relationships: McpAuthRel[] = [];

  elements.push({
    sysmlKey: MCP_AUTH_PACKAGE_KEY,
    typeSlug: "package",
    name: "MCP Tool Authority",
    description:
      "Live SysML projection of the MCP tool→grant authorization surface (TOOL_TO_GRANTS, default-deny), derived from apps/web/lib/tak/agent-grants.ts so it cannot drift from the implementation.",
    descriptor: "package:mcp-tool-authority",
  });

  elements.push({
    sysmlKey: MCP_AUTH_DEFAULT_DENY_KEY,
    typeSlug: "constraint",
    name: "Default-deny tool authority",
    description:
      "A tool with no TOOL_TO_GRANTS entry is denied; a coworker may invoke a tool only if its (implication-expanded) grants intersect the tool's required grants.",
    descriptor: "constraint:default-deny",
  });

  const tools = Object.keys(toolToGrants).sort();
  const grants = Array.from(new Set(Object.values(toolToGrants).flat())).sort();

  for (const grant of grants) {
    const key = `mcp:grant:${grant}`;
    elements.push({
      sysmlKey: key,
      typeSlug: "requirement",
      name: `Grant: ${grant}`,
      description: `Authority requirement '${grant}' — a caller must hold this grant (directly or via GRANT_IMPLICATIONS) to invoke the tools that require it.`,
      descriptor: `grant:${grant}`,
    });
    relationships.push({ fromKey: MCP_AUTH_PACKAGE_KEY, toKey: key, relSlug: "contains" });
  }

  for (const tool of tools) {
    const key = `mcp:tool:${tool}`;
    const required = [...toolToGrants[tool]].sort();
    elements.push({
      sysmlKey: key,
      typeSlug: "action",
      name: `Tool: ${tool}`,
      description: `MCP tool '${tool}' — gated by grant(s): ${required.join(", ") || "(none — would be default-denied)"}.`,
      descriptor: `tool:${tool}|grants:${required.join(",")}`,
    });
    relationships.push({ fromKey: MCP_AUTH_PACKAGE_KEY, toKey: key, relSlug: "contains" });
    for (const grant of required) {
      relationships.push({ fromKey: key, toKey: `mcp:grant:${grant}`, relSlug: "traces" });
    }
  }

  relationships.push({ fromKey: MCP_AUTH_PACKAGE_KEY, toKey: MCP_AUTH_DEFAULT_DENY_KEY, relSlug: "contains" });

  return { elements, relationships, toolCount: tools.length, grantCount: grants.length };
}
