// GPP Phase 1, T1 — critical-interaction map (pure builder, fixtures only).
// Acceptance AC-MAP: every registered tool appears exactly once with its
// consequence class, guards, guard modes and direct call sites.
import { describe, expect, it } from "vitest";

import { classifyConsequentialTool } from "@/lib/tak/consequential-tool-policy";

import {
  buildCriticalInteractionMap,
  renderCriticalInteractionMarkdown,
  type CriticalInteractionDeps,
  type MapToolInput,
} from "./critical-interaction-map";

const tools: MapToolInput[] = [
  { name: "search_things", sideEffect: false },
  { name: "save_note", sideEffect: true },
  { name: "create_portal_pr", sideEffect: true, consequence: "outward", consequenceScope: "platform", buildPhases: ["ship"] },
  { name: "deploy_feature", sideEffect: true, consequence: "irreversible", consequenceScope: "platform" },
  { name: "record_initiative_evidence", sideEffect: true },
];

const deps: CriticalInteractionDeps = {
  classify: (tool) =>
    classifyConsequentialTool({
      toolName: tool.name,
      tool: {
        sideEffect: tool.sideEffect,
        consequence: (tool.consequence ?? undefined) as never,
        consequenceScope: (tool.consequenceScope ?? undefined) as never,
      },
    }),
  grantsFor: (name) => ({ create_portal_pr: ["build_promote"], save_note: ["notes_write"] })[name] ?? [],
  holdersOf: (grant) => ({ build_promote: ["AGT-B", "AGT-A"], notes_write: ["AGT-A"] })[grant] ?? [],
  projectableTools: new Set(["record_initiative_evidence"]),
  shapeGateMode: "shadow",
  directSites: new Map([
    ["deploy_feature", ["lib/build/ship.ts:111"]],
    ["dynamic", ["lib/actions/proposals.ts:60"]],
  ]),
};

const map = buildCriticalInteractionMap(tools, deps, { generatedAt: "2026-10-01T00:00:00Z", gitSha: "abc" });
const byName = (name: string) => map.tools.find((entry) => entry.name === name)!;

describe("critical-interaction map", () => {
  it("lists every tool exactly once, critical tools first", () => {
    expect(map.tools.map((entry) => entry.name).sort()).toEqual(tools.map((tool) => tool.name).sort());
    expect(map.tools.slice(0, 2).every((entry) => entry.critical)).toBe(true);
  });

  it("marks outward and irreversible tools critical, using the runtime classifier", () => {
    expect(byName("create_portal_pr").critical).toBe(true);
    expect(byName("deploy_feature").critical).toBe(true);
    expect(byName("save_note").critical).toBe(false);
    expect(byName("search_things").critical).toBe(false);
  });

  it("derives guard modes from the inputs, not from new rules", () => {
    expect(byName("create_portal_pr").guards).toMatchObject({ escalation: "enforced", alignmentInWorkroom: true, shapeGate: "shadow" });
    expect(byName("search_things").guards).toMatchObject({ escalation: "none", alignment: "none", shapeGate: "none" });
    expect(byName("record_initiative_evidence").guards.projector).toBe("enforced");
  });

  it("shows the Phase 2 permit guard in shadow for every critical tool and none otherwise", () => {
    expect(byName("create_portal_pr").guards.permit).toBe("shadow");
    expect(byName("deploy_feature").guards.permit).toBe("shadow");
    expect(byName("save_note").guards.permit).toBe("none");
    expect(byName("search_things").guards.permit).toBe("none");
    expect(renderCriticalInteractionMarkdown(map)).toContain("| Permit |");
  });

  it("flags side-effecting tools with no consequence class", () => {
    expect(byName("save_note").unclassifiedSideEffect).toBe(true);
    expect(byName("create_portal_pr").unclassifiedSideEffect).toBe(false);
    expect(byName("search_things").unclassifiedSideEffect).toBe(false);
  });

  it("carries grants, sorted holders and direct sites, including dynamic ones", () => {
    expect(byName("create_portal_pr")).toMatchObject({ grants: ["build_promote"], holders: ["AGT-A", "AGT-B"] });
    expect(byName("deploy_feature").directSites).toEqual(["lib/build/ship.ts:111"]);
    expect(map.dynamicDirectSites).toEqual(["lib/actions/proposals.ts:60"]);
    expect(map.totals).toEqual({ tools: 5, sideEffect: 4, critical: 2, unclassifiedSideEffect: 2, directSites: 2 });
  });

  it("renders critical, unclassified and dynamic sections", () => {
    const markdown = renderCriticalInteractionMarkdown(map);
    expect(markdown).toContain("## Critical tools");
    expect(markdown).toContain("## Unclassified side-effecting tools");
    expect(markdown).toContain("- lib/actions/proposals.ts:60");
  });
});
