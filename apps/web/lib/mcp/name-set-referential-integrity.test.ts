// Name-set referential integrity — mechanism M1 of the late-defect-detection
// hardening plan (BI-47629B5B, docs/superpowers/plans/
// 2026-08-16-late-defect-detection-hardening-plan.md).
//
// A hardcoded name that resolves to no registered tool gates nothing while
// reading as coverage (the ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES incident: seven
// of nine names matched nothing). Every name-set that gates behavior must
// therefore resolve against the registry it indexes into.
//
// Covered-set completeness note — the tool name-sets that gate behavior and
// where each is resolution-tested:
//   - ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES ......... here
//   - PRECONDITION_TOOL_NAMES .................... here (also the only names
//     hardcoded inside collaborationShapeForTool, which now reads these same
//     exported sets — no third copy exists)
//   - TOOL_TO_GRANTS keys ........................ here
//   - CONSEQUENTIAL_DECISION_TOOLS ............... lib/tak/consequential-tool-coverage.test.ts
//   - CORE_MCP_TOOL_NAMES ........................ lib/mcp/tool-tier.test.ts
//     ("CORE_MCP_TOOL_NAMES drift guard")
//   - prometheus scrape targets vs compose services
//     ............................................ scripts/check-no-unresolved-prometheus-targets.mjs
// New name-keyed gate lists must be added here or carry their own
// resolution test.

import { describe, expect, it } from "vitest";

import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { BROWSER_USE_SERVER_SLUG } from "@/lib/browser-drive/sidecar";
import { TOOL_TO_GRANTS, WORKROOM_TOOL_ALIASES } from "@/lib/tak/agent-grants";
import {
  ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES,
  PRECONDITION_TOOL_NAMES,
} from "@/lib/tak/consequential-tool-policy";

/**
 * Names from `names` that resolve to nothing. A name resolves when it is in
 * `resolvable`, or when it is a namespaced external-server tool
 * (`<serverSlug>__<toolName>`) whose slug is in `allowedNamespaces` — external
 * sidecars own their own tool suffixes, so the repo can only vouch for the
 * namespace prefix (see the browser-use entries in TOOL_TO_GRANTS).
 */
export function unresolvedNames(
  names: Iterable<string>,
  resolvable: ReadonlySet<string>,
  allowedNamespaces: readonly string[] = [],
): string[] {
  const out: string[] = [];
  for (const name of names) {
    if (resolvable.has(name)) continue;
    const sep = name.indexOf("__");
    if (sep > 0 && allowedNamespaces.includes(name.slice(0, sep))) continue;
    out.push(name);
  }
  return out;
}

const CATALOG_NAMES: ReadonlySet<string> = new Set(PLATFORM_TOOLS.map((t) => t.name));

describe("unresolvedNames (the helper itself — red cases on fabricated sets)", () => {
  const registry = new Set(["real_tool", "other_tool"]);

  it("flags a phantom name added to a copy of a clean set", () => {
    expect(unresolvedNames(["real_tool"], registry)).toEqual([]);
    // The red case: one fabricated phantom, and the helper names it.
    expect(unresolvedNames(["real_tool", "launch_campaign"], registry)).toEqual([
      "launch_campaign",
    ]);
  });

  it("resolves a namespaced name only through an allowed namespace", () => {
    expect(unresolvedNames(["srv__anything"], registry, ["srv"])).toEqual([]);
    expect(unresolvedNames(["rogue-srv__anything"], registry, ["srv"])).toEqual([
      "rogue-srv__anything",
    ]);
    // A bare "__suffix" name has no slug; it must not slip through.
    expect(unresolvedNames(["__anything"], registry, [""])).toEqual(["__anything"]);
  });
});

describe("live name-sets resolve against the live catalog", () => {
  it("every ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES entry is a registered tool", () => {
    expect(unresolvedNames(ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES, CATALOG_NAMES)).toEqual([]);
  });

  it("every PRECONDITION_TOOL_NAMES entry is a registered tool", () => {
    expect(unresolvedNames(PRECONDITION_TOOL_NAMES, CATALOG_NAMES)).toEqual([]);
  });

  // Retired tool names that deliberately KEEP a TOOL_TO_GRANTS row: a stale
  // model call to them must reach the pack's removed-guard handler (which says
  // "Tool removed — use X instead") rather than dying in default-deny with a
  // misleading authorization error. See sandbox-pack.ts (iterateSandbox).
  // Shrink-only: if one of these names comes back as a live catalog tool,
  // remove it here; never add a name without a removed-guard rationale.
  const RETIRED_GUARD_ROWS = ["launch_sandbox", "generate_code", "iterate_sandbox"] as const;

  it("every TOOL_TO_GRANTS key resolves — catalog tool, pinned workroom alias, namespaced sidecar tool, or listed retirement guard", () => {
    // Alias keys are legitimate non-catalog names ONLY because the sibling
    // agent-grants test pins each one to a defined canonical row; anything
    // else must be a live catalog tool, a namespaced/bare sidecar tool
    // (checked separately below), or a listed retirement-guard row.
    const resolvable = new Set([
      ...CATALOG_NAMES,
      ...Object.keys(WORKROOM_TOOL_ALIASES),
      ...RETIRED_GUARD_ROWS,
      // Bare sidecar names are admitted only via their namespaced twin — the
      // mirror test below is what makes this admission referential.
      ...Object.keys(TOOL_TO_GRANTS)
        .filter((k) => k.startsWith(`${BROWSER_USE_SERVER_SLUG}__`))
        .map((k) => k.slice(BROWSER_USE_SERVER_SLUG.length + 2)),
    ]);
    const unresolved = unresolvedNames(Object.keys(TOOL_TO_GRANTS), resolvable, [
      BROWSER_USE_SERVER_SLUG,
    ]);
    expect(
      unresolved,
      `TOOL_TO_GRANTS keys that resolve to no registered tool (a key that matches nothing grants nothing — or worse, waits to silently authorize a future tool of the same name): ${unresolved.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the retirement-guard list honest — none of its names is a live catalog tool", () => {
    for (const name of RETIRED_GUARD_ROWS) {
      expect(
        CATALOG_NAMES.has(name),
        `${name} is live again — remove it from RETIRED_GUARD_ROWS`,
      ).toBe(false);
    }
  });

  it("gives every bare sidecar row the SAME grants as its namespaced twin (pre-namespace rows cannot drift in authority)", () => {
    const bareRows = Object.keys(TOOL_TO_GRANTS).filter(
      (k) => !k.includes("__") && TOOL_TO_GRANTS[`${BROWSER_USE_SERVER_SLUG}__${k}`] !== undefined,
    );
    expect(bareRows.length).toBeGreaterThan(0); // browse_open et al.
    for (const bare of bareRows) {
      expect(TOOL_TO_GRANTS[bare], `${bare} must match its namespaced twin`).toEqual(
        TOOL_TO_GRANTS[`${BROWSER_USE_SERVER_SLUG}__${bare}`],
      );
    }
  });

  it("every workroom alias VALUE (canonical name) is a registered tool", () => {
    expect(unresolvedNames(Object.values(WORKROOM_TOOL_ALIASES), CATALOG_NAMES)).toEqual([]);
  });
});
