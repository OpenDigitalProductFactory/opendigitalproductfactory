import { describe, expect, it, vi } from "vitest";
import {
  activateFingerprintRule,
  recordFingerprintReview,
  upsertFingerprintObservation,
} from "./discovery-fingerprint-store";

describe("discovery fingerprint store helpers", () => {
  it("upserts observations with local raw evidence and redacted normalized evidence", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "obs_1" });
    const db = {
      discoveryFingerprintObservation: { upsert },
    };

    await upsertFingerprintObservation(db, {
      observationKey: "run:1:target:9100",
      sourceKind: "prometheus",
      signalClass: "service",
      rawEvidenceLocal: { banner: "prod-acme-sql-01.internal.example.com 10.0.4.15" },
      normalizedEvidence: { banner: "[redacted-hostname] [redacted-ip]" },
      redactionStatus: "redacted",
      evidenceFamilies: ["prometheus_target"],
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { observationKey: "run:1:target:9100" },
        create: expect.objectContaining({
          rawEvidenceLocal: { banner: "prod-acme-sql-01.internal.example.com 10.0.4.15" },
          normalizedEvidence: { banner: "[redacted-hostname] [redacted-ip]" },
          redactionStatus: "redacted",
        }),
      }),
    );
  });

  it("creates review events for observation decisions", async () => {
    const create = vi.fn().mockResolvedValue({ id: "review_1" });
    const db = {
      discoveryFingerprintReview: { create },
    };

    await recordFingerprintReview(db, {
      observationId: "obs_1",
      reviewerType: "ai_coworker",
      reviewerId: "AGT-190",
      decision: "human_review",
      previousStatus: "pending",
      nextStatus: "needs_human_review",
      reason: "manual_conflict",
      auditPayload: { route: "daily_triage" },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        observationId: "obs_1",
        reviewerType: "ai_coworker",
        nextStatus: "needs_human_review",
      }),
    });
  });

  it("activates an approved rule and links the source observation", async () => {
    const updateRule = vi.fn().mockResolvedValue({ id: "rule_1" });
    const updateObservation = vi.fn().mockResolvedValue({ id: "obs_1" });
    const db = {
      discoveryFingerprintRule: { update: updateRule },
      discoveryFingerprintObservation: { update: updateObservation },
    };

    await activateFingerprintRule(db, {
      ruleId: "rule_1",
      observationId: "obs_1",
    });

    expect(updateRule).toHaveBeenCalledWith({
      where: { id: "rule_1" },
      data: { status: "active" },
    });
    expect(updateObservation).toHaveBeenCalledWith({
      where: { id: "obs_1" },
      data: {
        approvedRuleId: "rule_1",
        decisionStatus: "approved",
      },
    });
  });
});
