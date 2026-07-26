import { describe, expect, it } from "vitest";

import {
  EXECUTION_EVIDENCE_KINDS,
  evidenceKindMetadata,
  normalizeExecutionEvidencePayload,
  validateExecutionEvidenceStructure,
} from "./execution-evidence";

describe("execution evidence registry", () => {
  it("maps every closed evidence kind to one dimension and polarity", () => {
    expect(EXECUTION_EVIDENCE_KINDS).toHaveLength(12);
    for (const kind of EXECUTION_EVIDENCE_KINDS) {
      const metadata = evidenceKindMetadata(kind);
      expect(metadata.dimension).toBeTruthy();
      expect(["pass", "fail", "neutral"]).toContain(metadata.polarity);
    }
  });

  it("keeps external links as supporting context rather than gate evidence", () => {
    expect(evidenceKindMetadata("external_link")).toMatchObject({
      dimension: "supporting-context",
      polarity: "neutral",
      gateEligible: false,
    });
  });

  it("requires HTTP(S) provenance for source evidence", () => {
    expect(validateExecutionEvidenceStructure("source_verified", null)).toContain("HTTP");
    expect(validateExecutionEvidenceStructure("source_verified", "file:///tmp/change")).toContain("HTTP");
    expect(validateExecutionEvidenceStructure("source_verified", "https://github.com/acme/repo/pull/42")).toBeNull();
  });

  it("normalizes the persisted activity payload without trusting unknown fields", () => {
    expect(normalizeExecutionEvidencePayload({
      evidenceKind: "migration_pass",
      url: "https://ci.example/run/1",
      body: "Applied against upgrade fixture",
      toolExecutionId: "te-1",
      callerVerdict: "trust-me",
    })).toEqual({
      evidenceKind: "migration_pass",
      url: "https://ci.example/run/1",
      body: "Applied against upgrade fixture",
      toolExecutionId: "te-1",
    });
  });

  it("rejects malformed and unknown persisted evidence", () => {
    expect(normalizeExecutionEvidencePayload(null)).toBeNull();
    expect(normalizeExecutionEvidencePayload({ evidenceKind: "made_up" })).toBeNull();
    expect(normalizeExecutionEvidencePayload({ evidenceKind: "test_pass", url: 42 })).toEqual({
      evidenceKind: "test_pass",
      url: null,
      body: null,
      toolExecutionId: null,
    });
  });
});
