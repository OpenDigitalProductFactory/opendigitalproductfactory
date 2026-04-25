import { describe, expect, it } from "vitest";
import { evaluateFingerprintRule } from "./discovery-fingerprint-rules";

describe("evaluateFingerprintRule", () => {
  it("matches when all required evidence families and expressions match", () => {
    const result = evaluateFingerprintRule(
      {
        ruleKey: "observability:prometheus-node-exporter",
        requiredEvidenceFamilies: ["prometheus_target", "process_name"],
        matchExpression: {
          all: [
            { type: "contains", path: "job", value: "node-exporter" },
            { type: "contains", path: "process", value: "node_exporter" },
          ],
        },
      },
      {
        evidenceFamilies: ["prometheus_target", "process_name"],
        normalizedEvidence: { job: "node-exporter", process: "node_exporter" },
      },
    );

    expect(result.matched).toBe(true);
  });

  it("does not match when required evidence is missing", () => {
    const result = evaluateFingerprintRule(
      {
        ruleKey: "observability:prometheus-node-exporter",
        requiredEvidenceFamilies: ["prometheus_target", "process_name"],
        matchExpression: {
          all: [{ type: "contains", path: "job", value: "node-exporter" }],
        },
      },
      {
        evidenceFamilies: ["prometheus_target"],
        normalizedEvidence: { job: "node-exporter" },
      },
    );

    expect(result.matched).toBe(false);
    expect(result.reasons).toContain("missing_required_evidence_family:process_name");
  });
});
