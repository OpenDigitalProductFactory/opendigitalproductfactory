// Design-rule checks, rule by rule (PR-3b-3, BI-6DA17863). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §7.2; plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-3, "Spec
// refinements" item 2).
//
// The fixture corpus (drc-corpus.test.ts) seeds one violation per rule. These
// cases cover the clauses a single fixture cannot: C-1's entry clause, C-2's
// dangling-grant clause, C-4 on an unknown agent, C-7's enforcement-entry
// clause and the test seam that clears it, D-7 on an enforced binding, D-8 on
// a value that differs from a ratified entry, D-3 failing closed, the C-7
// resolver rule applying only to doctrine resolution, C-9 not evaluated
// without facts, a sidecar for another shape version, and a lone join.

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { setBindingEnforcementOverrideForTests } from "../binding-enforcement";
import type { GppDiagnostic } from "./diagnostics";
import { runDesignRules, type DesignRuleOptions } from "./drc";
import type { GateRatificationEntry } from "./gate-ratification";
import type { GppGate, GppShapeDocument } from "./gpp-shape-schema";
import { gppShapeDocumentSchema } from "./gpp-shape-schema";
import { resolveShapeDocument, type GppResolveSources } from "./resolve";
import { defaultResolveSources } from "./resolve-sources";

type Stage = GppShapeDocument["stages"][number];

let sources: GppResolveSources;
beforeAll(() => {
  sources = defaultResolveSources();
}, 120_000);
afterEach(() => setBindingEnforcementOverrideForTests(null));

const ENFORCED: GppGate = { authority: "wwmd", mode: "enforced", blocking: true, resolution: "accountable-human" };
const RESOLVER = { module: "lib/gpp/binding-enforcement", exportName: "resolveBindingMode" };

function stage(key: string, parts: Partial<Stage> = {}): Stage {
  return {
    key,
    title: `Stage ${key}`,
    accountablePrincipalRef: "role:shape-owner",
    advance: { kind: "status-change", condition: `${key} done` },
    evidence: ["manual-check"],
    ...parts,
  };
}

function governed(key: string, gate?: GppGate, parts: Partial<Stage> = {}): Stage {
  return stage(key, {
    advance: { kind: "governed-decision", condition: `${key} decided`, decisionScope: "unit-scope", ...(gate ? { gate } : {}) },
    evidence: ["decision-record"],
    ...parts,
  });
}

function documentWith(stages: Stage[], parts: Partial<GppShapeDocument> = {}): GppShapeDocument {
  return gppShapeDocumentSchema.parse({
    format: "gpp-shape/0.1",
    key: "unit",
    version: "1.0.0",
    title: "Unit",
    description: "Unit DRC case.",
    triggers: ["claim"],
    stages,
    stopConditions: [
      { kind: "success", condition: "done", disposition: "proceed" },
      { kind: "failure", condition: "failed", disposition: "refused" },
      { kind: "budget", condition: "spent", disposition: "inconclusive" },
    ],
    grants: [],
    measures: [],
    budgets: [],
    reviewPoint: { everyDays: 7, description: "weekly" },
    collaborationShape: null,
    ...parts,
  });
}

const ratifiedAs = (gate: GppGate): Record<string, GateRatificationEntry> => ({
  "unit-scope": { status: "ratified", proposed: gate, basis: "unit test", decisionId: "DI-000000000000", ratifiedAt: "2026-10-02" },
});

async function run(document: GppShapeDocument, options: DesignRuleOptions = {}, using: GppResolveSources = sources) {
  return runDesignRules(document, await resolveShapeDocument(document, using), { directSites: new Map(), ...options });
}

const actionable = (findings: readonly GppDiagnostic[]) =>
  findings.filter((finding) => finding.severity === "error" || finding.severity === "warning").map((finding) => `${finding.code} ${finding.elementId}`);

describe("C-1 Stage coverage, entry clause", () => {
  it("a start stage holding an O/A/I tool is entered by its trigger, so no gate guards it", async () => {
    expect(actionable(await run(documentWith([stage("a", { tools: ["set_portfolio_owner"] })])))).toEqual(["C-1 stage:a"]);
  });

  it("a stage entered from a join has no gate on its entry", async () => {
    const document = documentWith([stage("a"), stage("b"), stage("c"), stage("d", { tools: ["set_portfolio_owner"] })], {
      flow: {
        nodes: [
          { id: "p", type: "parallel-split" },
          { id: "j", type: "parallel-join", pairs: "p" },
        ],
        edges: [
          { from: "a", to: "p" },
          { from: "p", to: "b" },
          { from: "p", to: "c" },
          { from: "b", to: "j" },
          { from: "c", to: "j" },
          { from: "j", to: "d" },
          { from: "d", to: "success" },
        ],
      },
    });
    expect(actionable(await run(document))).toEqual(["E-NOT-EXECUTABLE/parallel-split-join node:p", "C-1 stage:d"]);
  });

  it("a read-only start stage needs no gate", async () => {
    expect(actionable(await run(documentWith([stage("a", { tools: ["list_backlog_items"] })])))).toEqual([]);
  });
});

describe("C-2 and C-4", () => {
  it("a registered tool with no TOOL_TO_GRANTS entry is dangling (C-2), and C-4 does not repeat it", async () => {
    const dangling: GppResolveSources = { ...sources, grantRequirement: (name) => (name === "list_bills" ? null : sources.grantRequirement(name)) };
    const document = documentWith([stage("a", { accountablePrincipalRef: "agent:customer-advisor", tools: ["list_bills"] })]);
    const findings = await run(document, {}, dangling);
    expect(actionable(findings)).toEqual(["C-2 tool:a:list_bills"]);
    expect(findings.find((finding) => finding.rule === "C-2")?.message).toMatch(/TOOL_TO_GRANTS/);
  });

  it("an unregistered name is C-2 as unregistered, not as a missing grant mapping", async () => {
    const findings = await run(documentWith([stage("a", { tools: ["no_such_platform_tool"] })]));
    expect(actionable(findings)).toEqual(["C-2 tool:a:no_such_platform_tool"]);
    expect(findings.find((finding) => finding.rule === "C-2")?.message).toMatch(/not a registered platform tool/);
  });

  it("C-4 counts the authorized-surface baseline grants every coworker run attaches, as the parity test does", async () => {
    // surface_list needs coworker_screen_read, which no seeded agent holds; the run adds it as a baseline grant.
    const document = documentWith([stage("a", { accountablePrincipalRef: "agent:customer-advisor", tools: ["surface_list"] })]);
    const [facts] = (await resolveShapeDocument(document, sources)).stages;
    expect(facts?.principal.kind === "agent" ? facts.principal.grants : []).not.toContain("coworker_screen_read");
    expect(facts?.tools?.[0]?.registered).toBe(true);
    expect(actionable(await run(document))).toEqual([]);
  });

  it("an unknown accountable agent is one C-4 on the stage, not one per tool", async () => {
    const document = documentWith([stage("a", { accountablePrincipalRef: "agent:no-such-agent", tools: ["list_bills", "list_backlog_items"] })]);
    expect(actionable(await run(document))).toEqual(["C-4 stage:a"]);
  });

  it("a role principal is not checked for grants", async () => {
    expect(actionable(await run(documentWith([stage("a", { tools: ["list_bills"] })])))).toEqual([]);
  });
});

describe("C-7 Mode honesty and D-7 Resolver exists", () => {
  const withBinding = (gate: GppGate) =>
    documentWith([governed("a", gate, { binding: { id: "unit-binding", version: 1, enforcement: "enforced" } })]);

  it("an enforced binding with no GPP_BINDING_ENFORCEMENT entry is C-7, and promoting it in the test seam clears exactly that", async () => {
    const gate = { ...ENFORCED, resolver: RESOLVER };
    const options = { ratification: ratifiedAs(gate) };
    expect(actionable(await run(withBinding(gate), options))).toEqual(["C-7/ENFORCEMENT-ENTRY binding:unit-binding@1"]);
    setBindingEnforcementOverrideForTests({
      "unit-binding": { mode: "enforced", decisionId: "DI-000000000000", ratifiedAt: "2026-10-02", evidenceRef: "unit test", lineage: "sealed-required" },
    });
    expect(actionable(await run(withBinding(gate), options))).toEqual([]);
  });

  it("an enforced binding whose gate names no resolver is D-7 on the binding", async () => {
    const findings = actionable(await run(withBinding(ENFORCED), { ratification: ratifiedAs(ENFORCED) }));
    expect(findings).toEqual(["C-7/ENFORCEMENT-ENTRY binding:unit-binding@1", "D-7 binding:unit-binding@1"]);
  });

  it("an enforced accountable-human gate needs no resolver (plan refinement 2); a doctrine one does", async () => {
    expect(actionable(await run(documentWith([governed("a", ENFORCED)]), { ratification: ratifiedAs(ENFORCED) }))).toEqual([]);
    for (const resolution of ["doctrine", "doctrine-then-human"] as const) {
      const gate = { ...ENFORCED, resolution };
      expect(actionable(await run(documentWith([governed("a", gate)]), { ratification: ratifiedAs(gate) })), resolution).toEqual(["C-7/RESOLVER gate:a"]);
    }
  });

  it("a shadow gate naming a missing resolver, with no binding, is not D-7", async () => {
    const gate: GppGate = { ...ENFORCED, mode: "shadow", resolver: { module: RESOLVER.module, exportName: "noSuchResolver" } };
    expect(actionable(await run(documentWith([governed("a", gate)]), { ratification: ratifiedAs(gate) }))).toEqual([]);
  });

  it("C-7's sandbox clause is reported not-evaluated on every compile", async () => {
    const findings = await run(documentWith([stage("a")]));
    expect(findings.filter((finding) => finding.code === "C-7/SANDBOX-CONTAINMENT").map((finding) => finding.severity)).toEqual(["not-evaluated"]);
  });
});

describe("D-8 Unratified gate", () => {
  it("a typed gate that differs from its ratified entry in any field is D-8", async () => {
    const document = documentWith([governed("a", { ...ENFORCED, authority: "wwwd" })]);
    const findings = await run(document, { ratification: ratifiedAs(ENFORCED) });
    expect(actionable(findings)).toEqual(["D-8 gate:a"]);
    expect(findings.find((finding) => finding.rule === "D-8")?.message).toMatch(/differs/);
  });

  it("an equal gate passes, whatever its key order", async () => {
    const reordered = { resolution: "accountable-human", blocking: true, mode: "enforced", authority: "wwmd" } as GppGate;
    expect(actionable(await run(documentWith([governed("a", reordered)]), { ratification: ratifiedAs(ENFORCED) }))).toEqual([]);
  });

  it("a governed advance with no typed gate is not compared", async () => {
    expect(actionable(await run(documentWith([governed("a")]), { ratification: {} }))).toEqual([]);
  });
});

describe("D-3 Checkpoint exactness fails closed", () => {
  it("a consequential tool that declares no consequence counts as O or I", async () => {
    const document = documentWith([governed("a", ENFORCED), stage("b", { tools: ["create_marketing_campaign"] })]);
    expect(actionable(await run(document, { ratification: ratifiedAs(ENFORCED) }))).toEqual(["D-3 gate:a"]);
  });

  it("an authority tool needs no exact-action checkpoint", async () => {
    const document = documentWith([governed("a", ENFORCED), stage("b", { tools: ["set_portfolio_owner"] })]);
    expect(actionable(await run(document, { ratification: ratifiedAs(ENFORCED) }))).toEqual([]);
  });
});

describe("standing reports and sidecars", () => {
  it("C-9 is not-evaluated when no direct-site facts are supplied, and a warning when they name a declared tool", async () => {
    const document = documentWith([stage("a", { tools: ["list_backlog_items"] })]);
    const without = runDesignRules(document, await resolveShapeDocument(document, sources));
    expect(without.filter((finding) => finding.rule === "C-9").map((finding) => finding.severity)).toEqual(["not-evaluated"]);
    const sites = new Map([["list_backlog_items", ["lib/example.ts:12"]]]);
    const withSites = await run(document, { directSites: sites });
    expect(actionable(withSites)).toEqual(["C-9 tool:a:list_backlog_items"]);
    expect(withSites.find((finding) => finding.rule === "C-9")?.message).toMatch(/lib\/example\.ts:12/);
  });

  it("C-8 is info on every compile", async () => {
    const findings = await run(documentWith([stage("a")]));
    expect(findings.filter((finding) => finding.rule === "C-8").map((finding) => finding.severity)).toEqual(["info"]);
  });

  it("a sidecar for another shape version is W-ORPHAN-LAYOUT; an implied-flow edge key is not an orphan", async () => {
    const layout = {
      format: "gpp-layout/0.1" as const,
      shape: "unit@2.0.0",
      nodes: { "stage:a": { x: 0, y: 0 } },
      edges: { "edge:a->stop:success:1": {} },
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const findings = await run(documentWith([stage("a")]), { layout });
    expect(actionable(findings)).toEqual(["W-ORPHAN-LAYOUT shape:unit@1.0.0"]);
    expect(findings.find((finding) => finding.rule === "W-ORPHAN-LAYOUT")?.message).toMatch(/unit@2\.0\.0/);
  });

  it("a lone join is not executable either (and is S-3)", async () => {
    const document = documentWith([stage("a"), stage("b")], {
      flow: { nodes: [{ id: "j", type: "parallel-join" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "success" }] },
    });
    const findings = actionable(await run(document));
    expect(findings).toContain("E-NOT-EXECUTABLE/parallel-split-join node:j");
    expect(findings.some((finding) => finding.startsWith("S-3 "))).toBe(true);
  });
});

describe("purity", () => {
  it("does not mutate the document or its resolution, and returns findings in diagnostic order", async () => {
    const document = documentWith([stage("a", { tools: ["set_portfolio_owner", "no_such_platform_tool"] }), governed("b")]);
    const resolution = await resolveShapeDocument(document, sources);
    const before = JSON.stringify([document, resolution]);
    const first = runDesignRules(document, resolution, { directSites: new Map() });
    expect(JSON.stringify([document, resolution])).toBe(before);
    expect(runDesignRules(document, resolution, { directSites: new Map() })).toEqual(first);
    const ids = first.map((finding) => finding.elementId);
    expect(ids).toEqual([...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
  });
});
