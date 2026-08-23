import { describe, it, expect } from "vitest";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import {
  TOOL_TO_GRANTS,
  expandGrants,
  COWORKER_READ_BASELINE_GRANTS,
} from "./agent-grants";
import registryData from "../../../../packages/db/data/agent_registry.json";
import { TOOL_REACHABILITY_EXEMPTIONS } from "./tool-reachability-exemptions";

/**
 * Tool reachability conformance — BI-6FD78522 (M6, late-defect-detection
 * hardening plan docs/superpowers/plans/2026-08-16-late-defect-detection-hardening-plan.md).
 *
 * A registered-but-unreachable artifact must fail conformance. Incidents this
 * gate would have caught at PR time:
 *   - BI-F998BCE8: 7 tools sealed — a grants mapping no agent holds plus
 *     deny-by-default made them invisible to every coworker.
 *   - BI-88B77204: a coworker prompt instructs a tool the grant layer never
 *     exposes, so the coworker fails at call time with a default-deny line.
 *
 * DEFINITION OF REACHABLE (mirrors the runtime gating in getAvailableTools +
 * isToolAllowedByGrants, and the honored-mapping computation in
 * apps/web/scripts/audit-coworker-tool-grants.ts): a PLATFORM_TOOLS tool is
 * reachable iff
 *   - it has a TOOL_TO_GRANTS entry (absence = deny-by-default), AND
 *   - the entry is [] (identity-scoped universal access), OR at least one
 *     agent in packages/db/data/agent_registry.json holds — after the
 *     COWORKER_READ_BASELINE_GRANTS union and GRANT_IMPLICATIONS expansion the
 *     runtime applies — one of the required grants.
 *
 * A tool that is neither reachable nor on the reasoned exemption list
 * (tool-reachability-exemptions.ts) fails. The exemption list is shrink-only:
 * stale entries (tools that became reachable or left the registry) also fail,
 * so the baseline can only shrink.
 */

type RegistryAgent = {
  agent_id: string;
  config_profile: { tool_grants: string[] };
};

const agents = (registryData as { agents: RegistryAgent[] }).agents;

// Each agent's effective grant set, the way the runtime computes it: the
// agent's own grants unioned with the coworker read baseline, expanded
// through GRANT_IMPLICATIONS (see getAvailableTools / isToolAllowedByGrants).
const agentEffectiveGrants: ReadonlyArray<ReadonlySet<string>> = agents.map(
  (a) =>
    new Set(
      expandGrants([
        ...a.config_profile.tool_grants,
        ...COWORKER_READ_BASELINE_GRANTS,
      ]),
    ),
);

function isReachable(toolName: string): boolean {
  const required = TOOL_TO_GRANTS[toolName];
  if (!required) return false; // no entry — denied by default for every caller
  if (required.length === 0) return true; // identity-scoped universal access
  return agentEffectiveGrants.some((grants) =>
    required.some((g) => grants.has(g)),
  );
}

describe("tool reachability conformance (BI-6FD78522)", () => {
  const toolNames = PLATFORM_TOOLS.map((t) => t.name);
  const unreachable = toolNames.filter((name) => !isReachable(name)).sort();
  const exempted = new Set(Object.keys(TOOL_REACHABILITY_EXEMPTIONS));

  it("registry composes a non-trivial tool surface", () => {
    expect(toolNames.length).toBeGreaterThan(50);
  });

  it("every registered tool is reachable by at least one agent, or carries a reasoned exemption", () => {
    const newUnreachable = unreachable.filter((name) => !exempted.has(name));
    expect(
      newUnreachable,
      `Registered-but-unreachable tool(s) with no exemption:\n  ${newUnreachable.join("\n  ")}\n\n` +
        `Each of these is in PLATFORM_TOOLS but no agent in agent_registry.json can ever be ` +
        `authorized to call it (missing TOOL_TO_GRANTS entry = deny-by-default, or required ` +
        `grants no agent holds). Fix: add a TOOL_TO_GRANTS entry and grant the key to the ` +
        `owning agent(s). Only if the tool is genuinely internal/deferred, add it to ` +
        `TOOL_REACHABILITY_EXEMPTIONS with a reason (shrink-only — prefer fixing).`,
    ).toEqual([]);
  });

  it("the exemption list is shrink-only: no stale entries", () => {
    const unreachableSet = new Set(unreachable);
    const stale = [...exempted].filter((name) => !unreachableSet.has(name)).sort();
    expect(
      stale,
      `Stale exemption(s):\n  ${stale.join("\n  ")}\n\n` +
        `These tools are now reachable (or no longer registered) — remove their rows from ` +
        `tool-reachability-exemptions.ts so the baseline shrinks with the fix.`,
    ).toEqual([]);
  });

  it("exemption reasons are real prose, not placeholders", () => {
    for (const [name, reason] of Object.entries(TOOL_REACHABILITY_EXEMPTIONS)) {
      expect(reason.trim().length, `exemption for ${name} needs a real reason`).toBeGreaterThan(20);
    }
  });
});
