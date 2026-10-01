// A stage names the tools it needs, and the names are real and reachable
// (BI-43C3E914).
//
// GPP — docs/architecture/gated-permissions-process.md, draft 0.1.
// WorkShapeStage.tools is the first realization of binding element 2
// "Attachment" (a binding attaches to a stage, not only to a shape) and element
// 5 "Capability set" (§7.1). This file is the conformance check over it:
//
//   C-1 Stage coverage (GPP-001)       — every agent stage of a standing shape
//                                         declares tools or is a known gap.
//   C-2 Vocabulary resolution (GPP-002) — every declared name is a registered
//                                         platform tool. Scope: stage `tools`
//                                         only. Shape `grants` tokens such as
//                                         `tool:write-source` are BI-00588B51's
//                                         and are deliberately not checked here.
//   C-4 Accountable authority — necessary first condition (grant held) — the
//                                         stage's accountable agent holds a grant
//                                         each declared tool requires, resolved
//                                         by the runtime's own resolver. Holding
//                                         the grant is not all of C-4, which is
//                                         about owning the consequence.
//   Pin capacity                        — declared tools + record_workroom_evidence
//                                         fit the scheduler's required-tool pin.

import { beforeAll, describe, expect, it, vi } from "vitest";

// The runtime resolves agent grants DB-first (AgentToolGrant, seeded on every
// boot from HARDCODED_COWORKER_GRANTS by slug) and falls back to
// agent_registry.json. Stand in for the seeded table only, so the REAL
// getAgentToolGrantsAsync runs — this test re-derives no grant rule of its own.
const seededAgentLookup = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@dpf/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { HARDCODED_COWORKER_GRANTS: seed } = await import("@dpf/db/workforce-seed");
  return {
    ...actual,
    prisma: {
      agent: {
        findFirst: async (args: { where: { OR: Array<{ agentId?: string; slugId?: string }> } }) => {
          seededAgentLookup.calls++;
          const id = args.where.OR.map((entry) => entry.agentId ?? entry.slugId).find(Boolean) ?? "";
          const seeded = seed[id];
          return seeded ? { toolGrants: seeded.map((grantKey) => ({ grantKey })) } : null;
        },
      },
    },
  };
});

import { REQUIRED_TOOL_PIN_CAPACITY } from "@/lib/actions/coworker-tool-budget";
import { COWORKER_AUTHORIZED_SURFACE_BASELINE_GRANTS } from "@/lib/coworker/authorized-surface-coworker-contract";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { getAgentToolGrantsAsync, isToolAllowedByGrants, TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

import { roomAuthorizesTool, roomGrantsFromWorkShape } from "./room-turn-authority";
import { STAGE_EVIDENCE_TOOL, stageDeclaredTools } from "./stage-briefing";
import { KNOWN_STAGE_TOOL_GAPS, stageToolGapKey } from "./stage-tool-gaps";
import { listWorkShapes, readWorkShapeDefinitionContract } from "./work-shapes";

type AgentStage = { shapeKey: string; stageKey: string; agentId: string; tools: readonly string[] };

/** Every agent-principal stage of a cadence-triggered (standing) shape. */
function standingAgentStages(): AgentStage[] {
  const rows: AgentStage[] = [];
  for (const shape of listWorkShapes()) {
    if (!shape.triggers.includes("cadence")) continue;
    for (const stage of shape.stages) {
      if (!stage.accountablePrincipalRef.startsWith("agent:")) continue;
      rows.push({
        shapeKey: shape.key,
        stageKey: stage.key,
        agentId: stage.accountablePrincipalRef.slice("agent:".length),
        tools: stageDeclaredTools(readWorkShapeDefinitionContract(shape), stage.key),
      });
    }
  }
  return rows;
}

const declaring = () => standingAgentStages().filter((stage) => stage.tools.length > 0);
const gapKeys = new Set(KNOWN_STAGE_TOOL_GAPS.map((gap) => stageToolGapKey(gap.shapeKey, gap.stageKey)));

/** What the scheduled run attaches from: the agent's resolved grants plus the
 *  surface baseline resolveAutonomousWorkTools passes as additionalGrants. */
const effectiveGrants = new Map<string, string[]>();
beforeAll(async () => {
  for (const agentId of new Set(standingAgentStages().map((stage) => stage.agentId))) {
    const grants = await getAgentToolGrantsAsync(agentId);
    effectiveGrants.set(agentId, [...new Set([...grants, ...COWORKER_AUTHORIZED_SURFACE_BASELINE_GRANTS])]);
  }
});

describe("GPP C-1 Stage coverage (GPP-001) — standing agent stages declare tools", () => {
  it("every agent stage of a cadence shape declares tools or is on KNOWN_STAGE_TOOL_GAPS", () => {
    const uncovered = standingAgentStages()
      .filter((stage) => stage.tools.length === 0 && !gapKeys.has(stageToolGapKey(stage.shapeKey, stage.stageKey)))
      .map((stage) => stageToolGapKey(stage.shapeKey, stage.stageKey));
    expect(uncovered).toEqual([]);
  });

  it("the gap list only shrinks: no listed stage now declares tools", () => {
    const declared = new Set(declaring().map((stage) => stageToolGapKey(stage.shapeKey, stage.stageKey)));
    expect(KNOWN_STAGE_TOOL_GAPS.filter((gap) => declared.has(stageToolGapKey(gap.shapeKey, gap.stageKey)))).toEqual([]);
  });

  it("every gap names a real standing agent stage, once, with a reason and a backlog ref", () => {
    const real = new Set(standingAgentStages().map((stage) => stageToolGapKey(stage.shapeKey, stage.stageKey)));
    expect(KNOWN_STAGE_TOOL_GAPS.filter((gap) => !real.has(stageToolGapKey(gap.shapeKey, gap.stageKey)))).toEqual([]);
    expect(gapKeys.size).toBe(KNOWN_STAGE_TOOL_GAPS.length);
    for (const gap of KNOWN_STAGE_TOOL_GAPS) {
      expect(gap.reason.trim().length, stageToolGapKey(gap.shapeKey, gap.stageKey)).toBeGreaterThan(0);
      expect(gap.backlogRef, stageToolGapKey(gap.shapeKey, gap.stageKey)).toMatch(/^BI-/);
    }
  });

  it("the first slice covers the stages the live install reported as unable to read", () => {
    const by = new Map(declaring().map((stage) => [stageToolGapKey(stage.shapeKey, stage.stageKey), stage.tools]));
    expect(by.get("dependency-advisory-watch/sweep")).toEqual(["read_codebase_manifest", "list_patch_posture"]);
    expect(by.get("issue-triage-watch/dedupe")).toContain("find_duplicate_candidates");
    expect(by.get("release-readiness-watch/assemble")).toEqual(expect.arrayContaining(["list_backlog_items", "get_backlog_item"]));
    expect(by.get("coworker-fitness-watch/measure")).toEqual(["get_capability_completeness"]);
    expect(by.get("adopter-health-watch/read")).toEqual(["list_customer_accounts"]);
    expect(by.get("inquiry-response-watch/draft")).toContain("list_storefront_activity");
  });

  it("the standing read-tool slice covers pull-request flow, contributor intake, vendor renewal and payables", () => {
    const by = new Map(declaring().map((stage) => [stageToolGapKey(stage.shapeKey, stage.stageKey), stage.tools]));
    expect(by.get("pull-request-flow-watch/read")).toEqual(["list_pull_requests"]);
    expect(by.get("pull-request-flow-watch/classify")).toEqual(["list_pull_requests"]);
    expect(by.get("contributor-intake-watch/sync")).toEqual(["read_contributor_inventory"]);
    expect(by.get("contributor-intake-watch/flag")).toEqual(["read_contributor_inventory"]);
    expect(by.get("vendor-renewal-watch/read")).toEqual(["list_supplier_contracts"]);
    expect(by.get("vendor-renewal-watch/report")).toEqual(["list_supplier_contracts", "list_bills"]);
    expect(by.get("payables-watch/read")).toEqual(["list_bills"]);
    expect(by.get("payables-watch/report")).toEqual(["list_bills"]);
  });

  it("a shape whose stage declares a tool behind a non-baseline grant lets its room surface carry that grant", () => {
    // The room narrows a coworker turn to roomGrantsFromWorkShape(shape.grants);
    // `tool:read` expands only to the read baseline. Scoped to the shapes this
    // slice touches; see the report for the shapes declared before it.
    const shapes = ["pull-request-flow-watch", "contributor-intake-watch", "vendor-renewal-watch", "payables-watch"];
    const unauthorized = declaring()
      .filter((stage) => shapes.includes(stage.shapeKey))
      .flatMap((stage) => {
        const shape = listWorkShapes().find((candidate) => candidate.key === stage.shapeKey)!;
        const surface = roomGrantsFromWorkShape(shape.grants);
        return stage.tools
          .filter((name) => !roomAuthorizesTool(name, surface))
          .map((name) => `${stageToolGapKey(stage.shapeKey, stage.stageKey)}: ${name}`);
      });
    expect(unauthorized).toEqual([]);
  });
});

describe("GPP C-2 Vocabulary resolution (GPP-002) — declared stage tools resolve", () => {
  const registered = new Map(PLATFORM_TOOLS.map((tool) => [tool.name, tool]));

  it("every declared tool name is a registered platform tool", () => {
    const dangling = declaring().flatMap((stage) =>
      stage.tools.filter((name) => !registered.has(name)).map((name) => `${stageToolGapKey(stage.shapeKey, stage.stageKey)}: ${name}`),
    );
    expect(dangling).toEqual([]);
  });

  it("every declared tool has a grant mapping, so it is not denied by default", () => {
    const unmapped = declaring().flatMap((stage) =>
      stage.tools.filter((name) => !TOOL_TO_GRANTS[name]).map((name) => `${stageToolGapKey(stage.shapeKey, stage.stageKey)}: ${name}`),
    );
    expect(unmapped).toEqual([]);
  });

  it("declared tools are read-only in this slice (an advise-boundary run strips writes)", () => {
    const writes = declaring().flatMap((stage) =>
      stage.tools.filter((name) => registered.get(name)?.sideEffect).map((name) => `${stageToolGapKey(stage.shapeKey, stage.stageKey)}: ${name}`),
    );
    expect(writes).toEqual([]);
  });

  it("a stage does not declare the same tool twice", () => {
    for (const stage of declaring()) {
      expect(new Set(stage.tools).size, stageToolGapKey(stage.shapeKey, stage.stageKey)).toBe(stage.tools.length);
    }
  });
});

describe("GPP C-4 Accountable authority — necessary first condition (grant held)", () => {
  it("resolves grants through the runtime's DB-first resolver, not a parallel rule", () => {
    expect(seededAgentLookup.calls).toBeGreaterThan(0);
  });

  it("every standing accountable agent resolves to a grant set", () => {
    const empty = [...effectiveGrants].filter(([, grants]) =>
      grants.every((grant) => (COWORKER_AUTHORIZED_SURFACE_BASELINE_GRANTS as readonly string[]).includes(grant)),
    );
    expect(empty.map(([agentId]) => agentId)).toEqual([]);
  });

  it("the stage's accountable agent holds a grant each declared tool requires", () => {
    const unheld = declaring().flatMap((stage) => {
      const grants = effectiveGrants.get(stage.agentId) ?? [];
      return stage.tools
        .filter((name) => !isToolAllowedByGrants(name, grants))
        .map((name) => `${stageToolGapKey(stage.shapeKey, stage.stageKey)} (${stage.agentId}): ${name} needs ${JSON.stringify(TOOL_TO_GRANTS[name])}`);
    });
    expect(unheld).toEqual([]);
  });

  it("customer-advisor holds storefront_read, so inquiry-response-watch/draft reaches list_storefront_activity", () => {
    expect(effectiveGrants.get("customer-advisor")).toContain("storefront_read");
    expect(isToolAllowedByGrants("list_storefront_activity", effectiveGrants.get("customer-advisor") ?? [])).toBe(true);
  });
});

describe("pin capacity — declared tools fit the scheduler's required-tool pin", () => {
  it(`declared tools + ${STAGE_EVIDENCE_TOOL} <= REQUIRED_TOOL_PIN_CAPACITY`, () => {
    const over = declaring()
      .filter((stage) => new Set([STAGE_EVIDENCE_TOOL, ...stage.tools]).size > REQUIRED_TOOL_PIN_CAPACITY)
      .map((stage) => stageToolGapKey(stage.shapeKey, stage.stageKey));
    expect(REQUIRED_TOOL_PIN_CAPACITY).toBe(4);
    expect(over).toEqual([]);
  });
});
