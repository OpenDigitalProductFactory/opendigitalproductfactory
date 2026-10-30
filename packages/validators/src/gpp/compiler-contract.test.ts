import { describe, expect, it } from "vitest";
import { compileShapeDocument } from "./compile";
import type { GppDesignRulePolicy } from "./design-rule-policy";
import type { GppResolveSources } from "./resolve";
import { emitShapeModule } from "./emit";
import { parseShapeDocument } from "./parse";
import { hasBlockingDiagnostic } from "./diagnostics";

const document = {
  format: "gpp-shape/0.1", key: "fixture-report", version: "1.0.0", title: "Report", description: "Synthetic read report",
  triggers: ["claim"], stages: [{ key: "inspect", title: "Inspect", accountablePrincipalRef: "agent:fixture",
    advance: { kind: "status-change", condition: "Evidence recorded" }, evidence: ["manual-check"], tools: ["fixture_read"] }],
  stopConditions: [{ kind: "success", condition: "Read", disposition: "proceed" },
    { kind: "failure", condition: "Unavailable", disposition: "inconclusive" },
    { kind: "budget", condition: "Budget used", disposition: "awaiting-person" }],
  grants: ["read"], measures: [], budgets: [], reviewPoint: { everyDays: 1, description: "Review" }, collaborationShape: null,
};
const policy: GppDesignRulePolicy = {
  baselineGrants: [], knownStageToolGap: () => false,
  isToolAllowedByGrants: (_tool, grants) => grants.includes("read"), roomGrantsFromWorkShape: grants => [...grants],
  bindingEnforced: () => false, governedDecisionStage: () => false,
};
const sources = (): GppResolveSources => ({
  platformTools: new Set(["fixture_read"]), knownAgents: new Set(["fixture"]), grantsFor: () => ["read"],
  classify: () => ({ class: "routine-read", consequential: false, alignmentRequired: false }),
  consequence: () => null, grantRequirement: () => ["read"], importResolver: async () => false,
  shapeVersionExists: () => false,
});
const options = { sourcePath: "fixture.gpp.json", typeImport: "./consumer-contracts.js", policy };

describe("portable compiler fact boundary", () => {
  it("keeps a caller-supplied known-finding annotation blocking by default", () => {
    expect(hasBlockingDiagnostic([{ rule: "D-1", code: "D-1", severity: "error", elementId: "stage:inspect", path: "/stages/0",
      message: "An error remains an error", knownFinding: { reason: "Untrusted annotation", backlogItemId: "BI-FIXTURE" } }])).toBe(true);
  });
  it("compiles deterministically for explicit host facts and a consumer-owned destination", async () => {
    const a = await compileShapeDocument(JSON.stringify(document), sources(), options);
    const b = await compileShapeDocument(JSON.stringify(document, null, 2), sources(), options);
    expect(a).toEqual(b);
    if (!a.accepted) throw new Error(JSON.stringify(a.diagnostics));
    expect(a.accepted).toBe(true);
    expect(a.module).toContain('from "./consumer-contracts.js"');
    expect(a.module).not.toContain("pnpm --filter web");
    expect(a.diagnostics.filter(d => d.rule === "C-8").map(d => d.severity)).toEqual(["not-evaluated"]);
  });
  it("holds missing policy instead of treating absent enforcement facts as a pass", async () => {
    const result = await compileShapeDocument(JSON.stringify(document), sources(), { ...options, policy: undefined });
    expect(result.accepted).toBe(false);
    expect(result.diagnostics.some(d => d.severity === "not-evaluated")).toBe(true);
  });
  it("does not let an explicit diagnostic disposition waive mandatory fact holds", async () => {
    const child = { ...document, stages: [{ ...document.stages[0], subShape: "fixture-child@1.0.0" }] };
    const cases = [
      { label: "policy", document, sources: sources(), policy: undefined },
      { label: "registration", document, sources: { ...sources(), platformTools: new Set<string>() }, policy },
      { label: "grant mapping", document, sources: { ...sources(), grantRequirement: () => null }, policy },
      { label: "classification", document, sources: { ...sources(), classify: () => null }, policy },
      { label: "unresolved child", document: child, sources: sources(), policy },
      { label: "direct child", document: child, sources: { ...sources(), shapeVersionExists: () => true }, policy },
      { label: "transitive child", document: child, sources: { ...sources(), shapeVersionExists: () => true,
        shapeDefinition: (ref: string) => ref === "fixture-child@1.0.0" ? { grants: [], stages: [{ key: "nested", subShape: "missing-child@1.0.0" }] } : null }, policy },
      { label: "reference limit", document: child, sources: { ...sources(), shapeVersionExists: () => true,
        shapeDefinition: (ref: string) => ({ grants: [], stages: [{ key: "nested", tools: [], subShape: `${ref}-next` }] }) }, policy },
    ];
    for (const input of cases) {
      let dispositions = 0;
      const result = await compileShapeDocument(JSON.stringify(input.document), input.sources, { ...options, policy: input.policy,
        diagnosticDisposition: () => { dispositions++; return { diagnostics: [], blocking: false }; } });
      expect(result.accepted, input.label).toBe(false);
      expect(dispositions, input.label).toBe(0);
      expect(result.diagnostics.some(finding => finding.severity === "not-evaluated" || finding.severity === "error"), input.label).toBe(true);
    }
  });
  it("holds unavailable diagnostic policy without exposing host exception text", async () => {
    const result = await compileShapeDocument(JSON.stringify(document), sources(), { ...options,
      diagnosticDisposition: () => { throw new Error("PRIVATE_HOST_FINDING_POLICY"); } });
    expect(result.accepted).toBe(false);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_HOST_FINDING_POLICY");
  });
  it("holds a registered tool whose consequence classification could not be read", async () => {
    const result = await compileShapeDocument(JSON.stringify(document), { ...sources(), classify: () => null }, options);
    expect(result.accepted).toBe(false);
    expect(result.diagnostics.some(d => d.severity === "not-evaluated")).toBe(true);
  });
  it("holds an existing child whose grant and stage facts are unavailable", async () => {
    const child = { ...document, stages: [{ ...document.stages[0], subShape: "fixture-child@1.0.0" }] };
    const result = await compileShapeDocument(JSON.stringify(child), { ...sources(), shapeVersionExists: () => true }, options);
    expect(result.accepted).toBe(false);
    expect(result.diagnostics.some(d => d.rule === "D-9" && d.severity === "not-evaluated")).toBe(true);
  });
  it("holds incomplete transitive child facts rather than asserting a cycle-free graph", async () => {
    const child = { ...document, stages: [{ ...document.stages[0], subShape: "fixture-child@1.0.0" }] };
    const result = await compileShapeDocument(JSON.stringify(child), { ...sources(), shapeVersionExists: () => true,
      shapeDefinition: ref => ref === "fixture-child@1.0.0" ? { grants: [], stages: [{ key: "nested", subShape: "missing-child@1.0.0" }] } : null }, options);
    expect(result.accepted).toBe(false);
    expect(result.diagnostics.some(d => d.rule === "D-10" && d.severity === "not-evaluated")).toBe(true);
  });
  it("holds an unbounded child registry instead of overflowing or reporting a cycle-free pass", async () => {
    const child = { ...document, stages: [{ ...document.stages[0], subShape: "child-0@1.0.0" }] };
    let reads = 0;
    const result = await compileShapeDocument(JSON.stringify(child), { ...sources(), shapeVersionExists: () => true,
      shapeDefinition: ref => { reads += 1; const index = Number(ref.match(/^child-(\d+)@/)?.[1]);
        return { grants: [], stages: [{ key: "nested", tools: [], subShape: `child-${index + 1}@1.0.0` }] }; } }, options);
    expect(result.accepted).toBe(false);
    expect(reads).toBeLessThanOrEqual(1025);
    expect(result.diagnostics.some(d => d.rule === "D-10" && d.severity === "not-evaluated")).toBe(true);
  });
  it("returns a hold when a host resolve port is unavailable", async () => {
    const result = await compileShapeDocument(JSON.stringify(document), { ...sources(), grantsFor: () => { throw new Error("PRIVATE_REGISTRY_FAILURE"); } }, options);
    expect(result.accepted).toBe(false);
    expect(result.diagnostics.some(d => d.severity === "not-evaluated")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_REGISTRY_FAILURE");
  });
  it("reports host-declared transition mediation as a declaration, without claiming verification", async () => {
    const result = await compileShapeDocument(JSON.stringify(document), sources(), { ...options,
      policy: { ...policy, singleTransitionPath: "fixture transaction owner" } });
    expect(result.accepted).toBe(true);
    expect(result.diagnostics.find(d => d.rule === "C-8")).toMatchObject({ severity: "info",
      message: expect.stringContaining("not verified by this compiler") });
  });
  it("rejects executable regeneration instructions and every JavaScript line break in header metadata", () => {
    const parsed = parseShapeDocument(JSON.stringify(document));
    if (!parsed.accepted) throw new Error("fixture parse failed");
    const { format: _format, ...definition } = parsed.document;
    const header = { sourcePath: "fixture.json", digest: "sha256:fixture", typeImport: "./contracts.js" };
    expect(() => emitShapeModule(definition, { ...header, checkInstruction: 'throw new Error("injected");' })).toThrow();
    for (const field of ["sourcePath", "digest", "typeImport", "checkInstruction"] as const) {
      for (const separator of ["\n", "\r", "\u2028", "\u2029"]) {
        expect(() => emitShapeModule(definition, { ...header, [field]: `// fixture${separator}injected` })).toThrow();
      }
    }
    expect(emitShapeModule(definition, { ...header, checkInstruction: "// Regenerate fixture" })).toContain("\n// Regenerate fixture\n");
  });
});
