import type { GppDesignRulePolicy, GppGate, GppResolveSources, GppShapeDocument, GateRatificationEntry } from "../kernel/gpp/browser.js";

export function routineDocument(): GppShapeDocument {
  return {
    format: "gpp-shape/0.1", key: "synthetic-read", version: "1.2.3",
    title: "Synthetic read", description: "Local protocol fixture; no customer or production facts.",
    triggers: ["claim"],
    stages: [{ key: "read", title: "Read synthetic input", accountablePrincipalRef: "agent:synthetic-reader",
      advance: { kind: "status-change", condition: "The synthetic observation is recorded." },
      evidence: ["source-verified"], tools: ["read_synthetic"] }],
    stopConditions: [
      { kind: "success", condition: "The fixture completed.", disposition: "proceed" },
      { kind: "failure", condition: "Input unavailable.", disposition: "inconclusive" },
      { kind: "budget", condition: "Fixture allowance exhausted.", disposition: "awaiting-person" },
    ],
    grants: ["synthetic:read", "synthetic:report"], measures: [],
    budgets: [{ kind: "findings-per-run", limit: 1, unit: "fixture" }],
    reviewPoint: { everyDays: 1, description: "Examine this synthetic run." }, collaborationShape: null,
  };
}

export const humanGate: GppGate = {
  authority: "wwwd", mode: "enforced", blocking: true, resolution: "accountable-human",
  checkpoint: { role: "person:synthetic-owner", exactAction: true },
};
export const ratification: Readonly<Record<string, GateRatificationEntry>> = {
  "synthetic-report": { status: "ratified", proposed: humanGate, basis: "Supplied synthetic fact, never a real ruling.",
    decisionId: "DI-000000000000", ratifiedAt: "2026-10-18" },
};
export function governedDocument(): GppShapeDocument {
  return {
    ...routineDocument(), key: "synthetic-report", collaborationShape: "outward-review",
    stages: [
      { key: "approve", title: "Review the exact synthetic report", accountablePrincipalRef: "person:synthetic-owner",
        advance: { kind: "governed-decision", condition: "A separate synthetic human observation is recorded.", decisionScope: "synthetic-report", gate: humanGate },
        evidence: ["decision-record"], tools: [] },
      { key: "report", title: "Prepare the synthetic report observation", accountablePrincipalRef: "agent:synthetic-writer",
        advance: { kind: "governed-decision", condition: "A separately admitted exact observation is recorded.", decisionScope: "synthetic-report", gate: humanGate },
        evidence: ["decision-record"], tools: ["write_synthetic_report"],
        binding: { id: "synthetic-report-binding", version: 7, enforcement: "shadow", subjectScope: "synthetic-data", validity: { until: "stage-exit" } } },
    ],
  };
}

export function sources(): GppResolveSources {
  return {
    platformTools: new Set(["read_synthetic", "write_synthetic_report"]),
    knownAgents: new Set(["synthetic-reader", "synthetic-writer"]),
    grantsFor: (id) => id === "synthetic-reader" ? ["synthetic:read"] : id === "synthetic-writer" ? ["synthetic:report"] : [],
    classify: (name) => name === "read_synthetic" ? { class: "routine-read", consequential: false, alignmentRequired: false }
      : name === "write_synthetic_report" ? { class: "consequential-mutation", consequential: true, alignmentRequired: true } : null,
    consequence: (name) => name === "write_synthetic_report" ? "outward" : null,
    grantRequirement: (name) => name === "read_synthetic" ? ["synthetic:read"] : name === "write_synthetic_report" ? ["synthetic:report"] : null,
    importResolver: async () => false, shapeVersionExists: () => false, shapeDefinition: () => null,
  };
}
export const policy: GppDesignRulePolicy = {
  baselineGrants: [], knownStageToolGap: () => false,
  isToolAllowedByGrants: (name, grants) => name === "read_synthetic" ? grants.includes("synthetic:read")
    : name === "write_synthetic_report" && grants.includes("synthetic:report"),
  roomGrantsFromWorkShape: (grants) => [...grants], bindingEnforced: () => false,
  governedDecisionStage: (definition, key) => definition.stages.some((stage) => stage.key === key
    && stage.advance.kind === "governed-decision" && stage.evidence.includes("decision-record")),
};
export function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export function equal(actual: unknown, expected: unknown, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
