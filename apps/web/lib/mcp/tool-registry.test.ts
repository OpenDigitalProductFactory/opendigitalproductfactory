import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { DELIBERATION_TOOLS } from "@/lib/mcp/deliberation-handlers";
import { SIEM_TOOLS } from "@/lib/mcp/siem-handlers";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { isToolAllowedByGrants, TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

import { TOOL_PACK_REGISTRY } from "./pack-registry";

import { deliberationSiemPack } from "./packs/deliberation-siem-pack";
import { runtimeCoordinationPack } from "./packs/runtime-coordination-pack";
import { workCapsulesPack } from "./packs/work-capsules-pack";
import { workbooksPack } from "./packs/workbooks-pack";
import { feedbackPack } from "./packs/feedback-pack";
import { activityRoutingPack } from "./packs/activity-routing-pack";
import { selfUpgradePack } from "./packs/self-upgrade-pack";
import { coworkerServiceCatalogPack } from "./packs/coworker-service-catalog-pack";
import { coworkerToolGrantPack } from "./packs/coworker-tool-grant-pack";
import { coworkerMemoryPack } from "./packs/coworker-memory-pack";
import { demandScoringPack } from "./packs/demand-scoring-pack";
import { composeToolPacks } from "./tool-registry";
// The inline-case ratchet's extractor lives in the CI guard (scripts/), kept as
// the single source of truth so this test and the guard can never disagree.
import { extractInlineCaseNames } from "../../../../scripts/check-mcp-tool-pack.mjs";

// BI-ARCH-TOOLPACKS parity guard: the first extracted pack must stay
// behaviourally identical to the inline registration it replaced.

describe("deliberation-siem tool pack", () => {
  it("bundles exactly the deliberation + SIEM definitions", () => {
    const expected = [...DELIBERATION_TOOLS, ...SIEM_TOOLS].map((t) => t.name).sort();
    expect(deliberationSiemPack.definitions.map((t) => t.name).sort()).toEqual(expected);
  });

  it("has a handler for every definition it owns", () => {
    for (const def of deliberationSiemPack.definitions) {
      expect(deliberationSiemPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(deliberationSiemPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of deliberationSiemPack.definitions) {
      expect(platformNames.has(def.name), def.name).toBe(true);
    }
  });
});

describe("runtime-coordination tool pack", () => {
  it("bundles its five runtime tools, each with a (lazy) handler", () => {
    expect(runtimeCoordinationPack.definitions.map((t) => t.name).sort()).toEqual([
      "get_runtime_coordination_map",
      "heartbeat_runtime_target",
      "record_runtime_verification",
      "register_runtime_target",
      "release_runtime_target",
    ]);
    for (const def of runtimeCoordinationPack.definitions) {
      expect(runtimeCoordinationPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(runtimeCoordinationPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of runtimeCoordinationPack.definitions) {
      expect(platformNames.has(def.name), def.name).toBe(true);
    }
  });
});

describe("work-capsules tool pack", () => {
  it("has a (lazy) handler for every definition", () => {
    for (const def of workCapsulesPack.definitions) {
      expect(workCapsulesPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(workCapsulesPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of workCapsulesPack.definitions) {
      expect(platformNames.has(def.name), def.name).toBe(true);
    }
  });
});

describe("workbooks tool pack", () => {
  it("has a (lazy) handler for every definition", () => {
    for (const def of workbooksPack.definitions) {
      expect(workbooksPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(workbooksPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of workbooksPack.definitions) {
      expect(platformNames.has(def.name), def.name).toBe(true);
    }
  });
});

describe("feedback tool pack", () => {
  it("bundles its three feedback tools, each with a handler", () => {
    expect(feedbackPack.definitions.map((t) => t.name).sort()).toEqual([
      "escalate_feedback_upstream",
      "register_tech_debt",
      "report_quality_issue",
    ]);
    for (const def of feedbackPack.definitions) {
      expect(feedbackPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(feedbackPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of feedbackPack.definitions) {
      expect(platformNames.has(def.name), def.name).toBe(true);
    }
  });
});

describe("activity-routing tool pack", () => {
  it("bundles the harness confidence approval acknowledgement tool", () => {
    expect(activityRoutingPack.definitions.map((t) => t.name)).toEqual([
      "activity_harness_confidence_override",
    ]);
    for (const def of activityRoutingPack.definitions) {
      expect(activityRoutingPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(activityRoutingPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of activityRoutingPack.definitions) {
      expect(platformNames.has(def.name), def.name).toBe(true);
    }
  });
});

describe("self-upgrade tool pack", () => {
  it("bundles the governed self-upgrade request + repair + queue-status tools", () => {
    expect(selfUpgradePack.definitions.map((t) => t.name)).toEqual([
      "request_self_upgrade",
      "repair_promoter_image",
      "get_self_upgrade_queue_status",
      "get_quiescence_status",
    ]);
    for (const def of selfUpgradePack.definitions) {
      expect(selfUpgradePack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(selfUpgradePack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of selfUpgradePack.definitions) {
      expect(platformNames.has(def.name), def.name).toBe(true);
    }
  });
});

describe("coworker service catalog tool pack", () => {
  it("bundles the coworker catalog discovery and engagement tools", () => {
    expect(coworkerServiceCatalogPack.definitions.map((t) => t.name).sort()).toEqual([
      "analyze_coworker_engagement_refinement",
      "get_coworker_offer",
      "list_coworker_offers",
      "list_coworker_services",
      "request_coworker_engagement",
      "resolve_coworker_offer_agent_card",
    ]);
    for (const def of coworkerServiceCatalogPack.definitions) {
      expect(coworkerServiceCatalogPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(coworkerServiceCatalogPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of coworkerServiceCatalogPack.definitions) {
      expect(platformNames.has(def.name), def.name).toBe(true);
    }
  });
});

describe("coworker tool-grant pack", () => {
  it("bundles the manage_coworker_tool_grant door with a handler", () => {
    expect(coworkerToolGrantPack.definitions.map((t) => t.name)).toEqual(["manage_coworker_tool_grant"]);
    for (const def of coworkerToolGrantPack.definitions) {
      expect(coworkerToolGrantPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(coworkerToolGrantPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of coworkerToolGrantPack.definitions) {
      expect(platformNames.has(def.name), def.name).toBe(true);
    }
  });
});

describe("coworker memory pack", () => {
  it("bundles the self-scoped working-note doors with a handler each", () => {
    expect(coworkerMemoryPack.definitions.map((t) => t.name).sort()).toEqual([
      "list_working_notes",
      "record_working_note",
    ]);
    for (const def of coworkerMemoryPack.definitions) {
      expect(coworkerMemoryPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    expect(coworkerMemoryPack.grants).toEqual({ record_working_note: [], list_working_notes: [] });
    for (const [name, grants] of Object.entries(coworkerMemoryPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of coworkerMemoryPack.definitions) {
      expect(platformNames.has(def.name), def.name).toBe(true);
    }
  });
});

describe("demand-scoring tool pack", () => {
  it("bundles the score_demand_item door with a handler", () => {
    expect(demandScoringPack.definitions.map((t) => t.name)).toEqual([
      "score_demand_item",
      "transition_demand_item",
      "link_demand_evidence",
      "supersede_demand_evidence",
      "record_effort_estimate",
      "set_demand_policy",
      "set_backlog_delivery_budget",
      "find_duplicate_candidates",
      "merge_backlog_items",
      "run_capacity_drain",
      "sweep_duplicate_demand",
      "approve_demand_for_funding",
    ]);
    for (const def of demandScoringPack.definitions) {
      expect(demandScoringPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(demandScoringPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });

  it("keeps every pack tool present in the live PLATFORM_TOOLS registry", () => {
    const platformNames = new Set(PLATFORM_TOOLS.map((t) => t.name));
    for (const def of demandScoringPack.definitions) {
      expect(platformNames.has(def.name), def.name).toBe(true);
    }
  });
});

describe("composeToolPacks", () => {
  it("composes definitions + handler/grant lookup from packs", () => {
    const registry = composeToolPacks([deliberationSiemPack]);
    expect(registry.definitions).toHaveLength(deliberationSiemPack.definitions.length);
    expect(registry.getHandler("deliberate_on")).toBeTypeOf("function");
    expect(registry.getHandler("not_a_tool")).toBeUndefined();
    expect(registry.getGrants("open_security_case")).toEqual(["siem_investigate"]);
  });

  it("composes all five real packs without collision", () => {
    const registry = composeToolPacks([
      deliberationSiemPack,
      runtimeCoordinationPack,
      workCapsulesPack,
      workbooksPack,
      feedbackPack,
      selfUpgradePack,
      coworkerServiceCatalogPack,
    ]);
    expect(registry.definitions).toHaveLength(
      deliberationSiemPack.definitions.length +
        runtimeCoordinationPack.definitions.length +
        workCapsulesPack.definitions.length +
        workbooksPack.definitions.length +
        feedbackPack.definitions.length +
        selfUpgradePack.definitions.length +
        coworkerServiceCatalogPack.definitions.length,
    );
    expect(registry.getHandler("register_runtime_target")).toBeTypeOf("function");
    expect(registry.getHandler("create_workroom")).toBeTypeOf("function");
    expect(registry.getHandler("workbook_list_tables")).toBeTypeOf("function");
    expect(registry.getHandler("report_quality_issue")).toBeTypeOf("function");
    expect(registry.getHandler("request_self_upgrade")).toBeTypeOf("function");
    expect(registry.getHandler("list_coworker_offers")).toBeTypeOf("function");
  });

  it("rejects the same tool name claimed by two packs", () => {
    expect(() => composeToolPacks([deliberationSiemPack, deliberationSiemPack])).toThrow(
      /Duplicate tool/,
    );
  });
});

// BI-OPT-RATCHETS: inline executeTool `case` arms in mcp-tools.ts are a frozen
// set that may only SHRINK. New MCP tools must land in a pack, not the switch.
// The CI guard (scripts/check-mcp-tool-pack.mjs) enforces this against
// scripts/mcp-tool-pack-baseline.json; this test asserts the same invariant in
// the unit suite so it fails fast in the same run as the pack tests above.
describe("executeTool inline-case ratchet", () => {
  // tool-registry.test.ts -> mcp -> lib -> web -> apps -> <repo root>.
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const mcpToolsSource = readFileSync(join(repoRoot, "apps/web/lib/mcp-tools.ts"), "utf8");
  const baseline: string[] = JSON.parse(
    readFileSync(join(repoRoot, "scripts/mcp-tool-pack-baseline.json"), "utf8"),
  );
  const inlineCases = extractInlineCaseNames(mcpToolsSource);

  it("locates the switch body and extracts inline cases that match the baseline", () => {
    // Guards against a refactor that silently breaks the extractor (e.g. the
    // switch is renamed) and makes the ratchet vacuously pass. No fixed count
    // floor: BET-4 (EP-8DC217EB) drains the inline set toward zero as domains
    // move into packs, so the invariant is that the extractor agrees with the
    // frozen baseline exactly — a broken extractor would diverge from it.
    expect(new Set(inlineCases)).toEqual(new Set(baseline));
    expect(new Set(inlineCases).size).toBe(inlineCases.length); // no duplicate arms
  });

  it("adds no inline case beyond the frozen baseline (new tools go in a pack)", () => {
    const baselineSet = new Set(baseline);
    const added = inlineCases.filter((name) => !baselineSet.has(name));
    expect(added, `new inline executeTool cases — register these in a pack instead: ${added.join(", ")}`).toEqual(
      [],
    );
  });

  it("keeps the baseline in sync — no stale entries once a tool is extracted", () => {
    const currentSet = new Set(inlineCases);
    const removed = baseline.filter((name) => !currentSet.has(name));
    expect(
      removed,
      `baseline lists tools no longer inline — run \`node scripts/check-mcp-tool-pack.mjs --update\`: ${removed.join(", ")}`,
    ).toEqual([]);
  });
});

// BI-88B77204. The per-pack "R3 no-drift" suites above are enumerated BY HAND,
// so a pack that is never added to the list is never checked — which is how
// `evaluate_profession_decision` shipped with no TOOL_TO_GRANTS entry at all.
// TOOL_TO_GRANTS denies unlisted tools by default (isToolAllowedByGrants), so
// the effect was not a loose permission but a silently sealed door: the only
// entry point to the WSID decision tier was unreachable for every coworker,
// and the tier read "never used" for months while the routing block instructed
// agents to call it. A console.warn at deny time is not observable in CI.
//
// This sweep is registry-driven rather than hand-listed, so it covers packs
// that do not exist yet.
describe("tool-pack grant coverage (registry-wide)", () => {
  // Two host-surface telemetry tools remain outside coworker identity scope.
  // Self-scoped coworker tools must carry an explicit [] mapping: present and
  // intentionally universal, rather than absent and denied by default.
  const KNOWN_UNGATED_BI_F998BCE8 = [
    // BI-D6DFC0E7: benign self-report telemetry — a surface reporting its OWN
    // toolchain readiness (and reading the fleet roll-up) cannot exceed its
    // authority or affect anyone else, mirroring propose_improvement.
    "surface-readiness:get_fleet_readiness",
    "surface-readiness:record_surface_readiness",
  ];

  it("gives every registered pack tool a TOOL_TO_GRANTS entry", () => {
    const ungated = TOOL_PACK_REGISTRY.packs.flatMap((pack) =>
      pack.definitions
        .filter((def) => !TOOL_TO_GRANTS[def.name])
        .map((def) => `${pack.packId}:${def.name}`),
    );
    const unexpected = ungated.filter((t) => !KNOWN_UNGATED_BI_F998BCE8.includes(t));
    expect(
      unexpected,
      `these pack tools have no TOOL_TO_GRANTS entry and are therefore DENIED for every coworker — add one, or extend the BI-F998BCE8 baseline only with a decision behind it: ${unexpected.join(", ")}`,
    ).toEqual([]);

    // Ratchet: the baseline must not outlive the tools it excuses.
    const staleBaseline = KNOWN_UNGATED_BI_F998BCE8.filter((t) => !ungated.includes(t));
    expect(
      staleBaseline,
      `these tools are gated now — remove them from KNOWN_UNGATED_BI_F998BCE8: ${staleBaseline.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps every pack-mirrored grant identical to the gating source", () => {
    const drifted: string[] = [];
    for (const pack of TOOL_PACK_REGISTRY.packs) {
      for (const [name, grants] of Object.entries(pack.grants)) {
        const gating = TOOL_TO_GRANTS[name];
        if (JSON.stringify(gating) !== JSON.stringify(grants)) {
          drifted.push(`${pack.packId}:${name} (pack=${JSON.stringify(grants)} gating=${JSON.stringify(gating)})`);
        }
      }
    }
    expect(drifted, `pack grant metadata drifted from TOOL_TO_GRANTS: ${drifted.join(", ")}`).toEqual([]);
  });

  it("allows explicitly self-scoped tools while unknown tools remain denied", () => {
    expect(isToolAllowedByGrants("record_working_note", ["registry_read"])).toBe(true);
    expect(isToolAllowedByGrants("unknown_self_scoped_tool", ["registry_read"])).toBe(false);
  });
});

// BI-17CBD21F: a tool name must have exactly one implementation.
//
// `composeToolPacks` already threw on duplicate DEFINITIONS, but handlers and
// grants overwrote silently. `initiative-readiness-pack` derived a handler for
// every lane in `INITIATIVE_READINESS_LANES` — including
// `record_plan_backlog_coverage`, a lane it routes for recovery but does not
// own as a tool — and, being registered after `decomposition-pack`, shadowed
// the real handler. Callers using the documented schema were refused with
// `gate-not-authorized` by a handler they never addressed.
describe("tool name ownership", () => {
  it("registers exactly one handler and grant set per tool name", () => {
    const seenHandlers = new Map<string, string>();
    const seenGrants = new Map<string, string>();
    const collisions: string[] = [];

    for (const pack of TOOL_PACK_REGISTRY.packs) {
      for (const name of Object.keys(pack.handlers)) {
        const owner = seenHandlers.get(name);
        if (owner) collisions.push(`handler "${name}": ${owner} and ${pack.packId}`);
        else seenHandlers.set(name, pack.packId);
      }
      for (const name of Object.keys(pack.grants)) {
        const owner = seenGrants.get(name);
        if (owner) collisions.push(`grant "${name}": ${owner} and ${pack.packId}`);
        else seenGrants.set(name, pack.packId);
      }
    }

    expect(collisions).toEqual([]);
  });

  // A handler with no matching definition is legitimate for a retained alias —
  // the Workroom rename kept the pre-rename `*capsule*` names callable, and a
  // few deprecated names are still answered. It is NOT legitimate as a silent
  // second implementation of a name another pack defines, which is how
  // BI-17CBD21F happened. Pin the deliberate set so a new orphan is caught.
  const KNOWN_UNDEFINED_HANDLERS = new Set([
    "claim_capsule_scope",
    "create_work_capsule",
    "dpf_test_kernel_refuse_probe",
    "generate_code",
    "get_work_capsule",
    "heartbeat_capsule",
    "iterate_sandbox",
    "list_work_capsules",
    "plan_capsule_worktree",
    "reassign_capsule_executor",
    "record_capsule_evidence",
    "release_capsule_scope",
    "update_work_capsule_status",
  ]);

  it("registers a handler without a definition only for a retained alias", () => {
    const unexpected: string[] = [];
    for (const pack of TOOL_PACK_REGISTRY.packs) {
      const defined = new Set(pack.definitions.map((definition) => definition.name));
      for (const name of Object.keys(pack.handlers)) {
        if (!defined.has(name) && !KNOWN_UNDEFINED_HANDLERS.has(name)) {
          unexpected.push(`${pack.packId} handles undefined tool "${name}"`);
        }
      }
    }
    expect(unexpected).toEqual([]);
  });

  it("never answers a name another pack defines", () => {
    const definedBy = new Map<string, string>();
    for (const pack of TOOL_PACK_REGISTRY.packs) {
      for (const definition of pack.definitions) definedBy.set(definition.name, pack.packId);
    }
    const shadowing: string[] = [];
    for (const pack of TOOL_PACK_REGISTRY.packs) {
      for (const name of Object.keys(pack.handlers)) {
        const owner = definedBy.get(name);
        if (owner && owner !== pack.packId) {
          shadowing.push(`${pack.packId} handles "${name}" defined by ${owner}`);
        }
      }
    }
    expect(shadowing).toEqual([]);
  });

  it("keeps record_plan_backlog_coverage owned by the pack that implements its schema", () => {
    const owner = TOOL_PACK_REGISTRY.packs.find((pack) =>
      pack.definitions.some((definition) => definition.name === "record_plan_backlog_coverage"));
    expect(owner?.packId).toBe("decomposition");

    const schema = owner?.definitions.find((d) => d.name === "record_plan_backlog_coverage")?.inputSchema;
    const properties = Object.keys((schema as { properties?: Record<string, unknown> })?.properties ?? {});
    expect(properties).toContain("deliverables");
    expect(properties).not.toContain("gate");
  });
});
