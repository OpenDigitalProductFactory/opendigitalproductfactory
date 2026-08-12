// apps/web/lib/mcp/tool-naming-lint.test.ts
//
// SEP-986 new-tool naming convention guard (BI-D0FB769F, Slice 3). MCP tool
// names should be lowercase snake_case (`^[a-z][a-z0-9_]*$`) so they read
// consistently across clients and never need quoting. The existing 240+ names
// are a FROZEN contract (parent assessment §1.2) — renaming them would break
// every client and the governance switch — so any pre-existing violator is
// grandfathered in EXEMPT_LEGACY_NAMES. A NEW tool that violates the convention
// fails this test; the fix is to rename it before it ships (it isn't frozen yet),
// not to add it to the exemption list.
//
// This complements SEP-1303 input-validation conformance, which the transport
// already satisfies: governedExecuteTool returns { success: false } on a schema
// failure and route.ts maps that to an `isError` tool result (a model-visible,
// self-correctable error) rather than a JSON-RPC protocol error.

import { describe, it, expect } from "vitest";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";

const SEP986_NAME_RE = /^[a-z][a-z0-9_]*$/;

// Pre-existing names that predate the convention. Frozen contract — do NOT add
// new entries here; rename the new tool instead. (Populated only if the live
// surface actually carries a legacy violator.)
const EXEMPT_LEGACY_NAMES = new Set<string>([
  // Frozen camelCase names that predate SEP-986. Renaming would break the frozen
  // tool-name contract; they stay as-is. Do NOT extend this list for new tools.
  "saveBuildEvidence",
  "reviewDesignDoc",
  "reviewBuildPlan",
]);

describe("MCP tool naming convention (SEP-986)", () => {
  it("every non-exempt tool name is lowercase snake_case", () => {
    const violators = PLATFORM_TOOLS.map((t) => t.name)
      .filter((name) => !EXEMPT_LEGACY_NAMES.has(name))
      .filter((name) => !SEP986_NAME_RE.test(name));
    expect(violators, `non-conforming tool names: ${violators.join(", ")}`).toEqual([]);
  });

  it("the exemption list has not gone stale — every exempt name still exists", () => {
    const live = new Set(PLATFORM_TOOLS.map((t) => t.name));
    const stale = [...EXEMPT_LEGACY_NAMES].filter((name) => !live.has(name));
    expect(stale, `stale exemptions to remove: ${stale.join(", ")}`).toEqual([]);
  });

  it("tool names are unique (no shadowing)", () => {
    const names = PLATFORM_TOOLS.map((t) => t.name);
    expect(names.length).toBe(new Set(names).size);
  });
});
