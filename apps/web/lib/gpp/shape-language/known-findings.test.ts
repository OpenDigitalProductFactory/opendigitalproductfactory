import { describe, expect, it } from "vitest";
import { applyKnownFindings, KNOWN_FINDING_ELIGIBLE_RULES, type KnownFinding } from "./known-findings";
import { hasBlockingDiagnostic, type GppDiagnostic } from "@dpf/validators/gpp/diagnostics";
import { compileShapeDocument } from "./dpf-toolkit";
import type { GppResolveSources } from "@dpf/validators/gpp/resolve";

const diagnostic: GppDiagnostic = { rule: "D-1", code: "D-1", elementId: "stage:plan", path: "/stages/0", severity: "error", message: "ungated entry", tools: ["publish", "merge"] };
const entry: KnownFinding = { rule: "D-1", code: "D-1", elementId: "stage:plan", tools: ["merge", "publish"], reason: "Existing source divergence", backlogItemId: "BI-12345678" };

describe("declared-flow shrink-only findings", () => {
  it("pins the exact eligible rules", () => {
    expect(KNOWN_FINDING_ELIGIBLE_RULES).toEqual([{ rule: "C-1" }, { rule: "D-1" }, { rule: "D-2" }, { rule: "D-3" }, { rule: "D-6" }, { rule: "C-3" }, { rule: "C-7", code: "C-7/SANDBOX-CONTAINMENT" }]);
  });
  it("matches exact identity and tool sets without changing severity or input", () => {
    const result = applyKnownFindings([diagnostic], [entry]);
    expect(result.diagnostics[0]).toEqual({ ...diagnostic, knownFinding: { reason: entry.reason, backlogItemId: entry.backlogItemId } });
    expect(diagnostic).not.toHaveProperty("knownFinding");
    expect(result.staleKnownFindings).toEqual([]);
    // Annotation is data; only the explicit DPF declared-flow disposition tolerates it.
    expect(hasBlockingDiagnostic(result.diagnostics)).toBe(true);
    for (const changed of [{ code: "D-2" }, { elementId: "stage:build" }, { tools: ["merge", "publish", "extra"] }]) {
      const mismatch = applyKnownFindings([{ ...diagnostic, ...changed } as GppDiagnostic], [entry]);
      expect(mismatch.staleKnownFindings).toEqual([entry]);
      expect(hasBlockingDiagnostic(mismatch.diagnostics)).toBe(true);
    }
    expect(hasBlockingDiagnostic([...result.diagnostics, diagnostic])).toBe(true);
  });
  it.each(["D-8", "D-7", "E-NOT-EXECUTABLE", "S-1", "S-2", "S-3", "S-4", "S-5", "S-6", "C-2", "D-5", "C-4", "D-4", "PARSE", "SCHEMA", "C-7/ENFORCEMENT-ENTRY", "C-7/RESOLVER"])("refuses ineligible %s even when stale", (rule) => {
    const bad = rule.startsWith("C-7/") ? { ...entry, rule: "C-7", code: rule } : { ...entry, rule, code: rule };
    expect(() => applyKnownFindings([], [bad as KnownFinding])).toThrow(/eligible/);
  });
  it.each([{ reason: " " }, { backlogItemId: "1234" }, { code: "D-8" }, { tools: ["merge", "merge"] }])("validates sidecar data at runtime: %j", (patch) => {
    expect(() => applyKnownFindings([], [{ ...entry, ...patch } as KnownFinding])).toThrow();
  });
  it.each([{ knownFindings: [] }, { sandboxStages: new Set<string>() }])("refuses declared-flow options outside that source root", async (options) => {
    await expect(compileShapeDocument("{}", {} as GppResolveSources, { sourcePath: "apps/web/lib/work-management/shape-documents/fake.gpp.json", ...options })).rejects.toThrow(/declared-flows/);
  });
});
