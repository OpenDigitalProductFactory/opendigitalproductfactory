import { describe, expect, it } from "vitest";

import { evaluateCompletionEvidence } from "./completion-evidence-policy";
import {
  EXECUTION_EVIDENCE_KINDS,
  evidenceKindMetadata,
  normalizeExecutionEvidencePayload,
  validateExecutionEvidenceStructure,
} from "./execution-evidence";

describe("execution evidence registry", () => {
  it("maps every closed evidence kind to one dimension and polarity", () => {
    expect(EXECUTION_EVIDENCE_KINDS).toHaveLength(13);
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

  it("records a blocked or failed manual check as manual_fail, which the completion policy blocks on", () => {
    expect(evidenceKindMetadata("manual_fail")).toEqual({
      dimension: "manual",
      polarity: "fail",
      gateEligible: false,
    });
    const verdict = evaluateCompletionEvidence({
      item: { id: "row-1", itemId: "BI-1", status: "in-progress", workType: "chore" },
      rawManifest: { workClass: "operational", evidenceActivityIds: ["manual-pass"] },
      evidence: [
        {
          id: "manual-pass",
          itemId: "row-1",
          evidenceKind: "manual_check",
          recordedAt: new Date("2026-07-26T09:00:00.000Z"),
          structurallyValid: true,
        },
        {
          id: "manual-fail",
          itemId: "row-1",
          evidenceKind: "manual_fail",
          recordedAt: new Date("2026-07-26T11:00:00.000Z"),
          structurallyValid: true,
        },
      ],
      activeBuildEvidence: null,
      evidenceCutoff: new Date("2026-07-25T12:00:00.000Z"),
      now: new Date("2026-07-26T12:00:00.000Z"),
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.currentFailures).toEqual([
      { dimension: "manual", evidenceActivityId: "manual-fail", evidenceKind: "manual_fail" },
    ]);
    expect(verdict.blockers).toContainEqual(expect.objectContaining({
      code: "newer-failure",
      dimension: "manual",
      evidenceActivityId: "manual-fail",
    }));
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
