import { describe, expect, it } from "vitest";

import { err, ok } from "@/lib/shared/action-result";

import {
  reconcileInitiativeObjectives,
  selectEligibleObjectiveEvidenceActivityIds,
  type ObjectiveReconciliationActivity,
} from "./objective-reconciliation";

const recordedAt = (minute: number) => new Date(`2026-08-22T08:${String(minute).padStart(2, "0")}:00.000Z`);

function activity(
  id: string,
  kind: string,
  payload: Record<string, unknown>,
  minute: number,
): ObjectiveReconciliationActivity {
  return { id, kind, payload, recordedAt: recordedAt(minute) };
}

describe("reconcileInitiativeObjectives", () => {
  it("requires live passed evidence for every objective and acceptance statement", () => {
    const result = reconcileInitiativeObjectives({
      itemId: "BI-READY",
      activities: [
        activity("BASE-1", "initiative_scope_baseline", {
          schemaVersion: 1,
          baselineId: "BASE-1",
          supersedesBaselineId: null,
          artifactDigest: "sha256:design",
          subject: { kind: "backlog-item", id: "BI-READY" },
          objectiveStatements: [{ objectiveId: "OBJ-1" }],
          acceptanceStatements: [{ acceptanceId: "AC-1" }],
        }, 1),
        activity("MAP-1", "initiative_objective_mapping", {
          schemaVersion: 1,
          proposalId: "MAP-1",
          subject: { kind: "backlog-item", id: "BI-READY" },
          baselineId: "BASE-1",
          artifactDigest: "sha256:design",
          mappings: [
            { objectiveId: "OBJ-1", evidenceRefs: ["E-TEST"] },
            { objectiveId: "AC-1", evidenceRefs: ["E-ACCEPT"] },
          ],
        }, 2),
        activity("E-TEST", "evidence", { evidenceKind: "test_pass" }, 3),
        activity("E-ACCEPT", "evidence", { evidenceKind: "manual_check" }, 4),
      ],
    });

    expect(result).toEqual({
      state: "pass",
      baselineId: "BASE-1",
      evidenceRefs: ["E-ACCEPT", "E-TEST"],
      requiredStatementIds: ["AC-1", "OBJ-1"],
    });
  });

  it("fails closed when an acceptance statement is not mapped", () => {
    const result = reconcileInitiativeObjectives({
      itemId: "BI-MISSING",
      activities: [
        activity("BASE-1", "initiative_scope_baseline", {
          schemaVersion: 1,
          baselineId: "BASE-1",
          supersedesBaselineId: null,
          artifactDigest: "sha256:design",
          subject: { kind: "backlog-item", id: "BI-MISSING" },
          objectiveStatements: [{ objectiveId: "OBJ-1" }],
          acceptanceStatements: [{ acceptanceId: "AC-1" }],
        }, 1),
        activity("MAP-1", "initiative_objective_mapping", {
          schemaVersion: 1,
          proposalId: "MAP-1",
          subject: { kind: "backlog-item", id: "BI-MISSING" },
          baselineId: "BASE-1",
          artifactDigest: "sha256:design",
          mappings: [{ objectiveId: "OBJ-1", evidenceRefs: ["E-TEST"] }],
        }, 2),
        activity("E-TEST", "evidence", { evidenceKind: "test_pass" }, 3),
      ],
    });

    expect(result.state).toBe("missing");
    expect(result.requiredStatementIds).toEqual(["AC-1", "OBJ-1"]);
  });

  it("denies malformed or ambiguous baseline and foreign evidence graphs", () => {
    const ambiguous = reconcileInitiativeObjectives({
      itemId: "BI-CONFLICT",
      activities: [
        activity("BASE-1", "initiative_scope_baseline", {
          schemaVersion: 1,
          baselineId: "BASE-1",
          supersedesBaselineId: null,
          artifactDigest: "one",
          subject: { kind: "backlog-item", id: "BI-CONFLICT" },
          objectiveStatements: [{ objectiveId: "OBJ-1" }],
          acceptanceStatements: [],
        }, 1),
        activity("BASE-2", "initiative_scope_baseline", {
          schemaVersion: 1,
          baselineId: "BASE-2",
          supersedesBaselineId: null,
          artifactDigest: "two",
          subject: { kind: "backlog-item", id: "BI-CONFLICT" },
          objectiveStatements: [{ objectiveId: "OBJ-1" }],
          acceptanceStatements: [],
        }, 2),
      ],
    });
    expect(ambiguous.state).toBe("conflict");

    const foreign = reconcileInitiativeObjectives({
      itemId: "BI-FOREIGN",
      activities: [
        activity("BASE-1", "initiative_scope_baseline", {
          schemaVersion: 1,
          baselineId: "BASE-1",
          supersedesBaselineId: null,
          artifactDigest: "one",
          subject: { kind: "backlog-item", id: "BI-FOREIGN" },
          objectiveStatements: [{ objectiveId: "OBJ-1" }],
          acceptanceStatements: [],
        }, 1),
        activity("MAP-1", "initiative_objective_mapping", {
          schemaVersion: 1,
          proposalId: "MAP-1",
          subject: { kind: "backlog-item", id: "BI-FOREIGN" },
          baselineId: "BASE-1",
          artifactDigest: "one",
          mappings: [{ objectiveId: "OBJ-1", evidenceRefs: ["E-OTHER"] }],
        }, 2),
        { ...activity("E-OTHER", "evidence", { evidenceKind: "test_pass" }, 3), backlogItemId: "someone-else" },
      ],
    });
    expect(foreign.state).toBe("missing");
  });

  it("keeps a malformed newest mapping recoverable without falling back to an older pass", () => {
    const result = reconcileInitiativeObjectives({
      itemId: "BI-CORRECTABLE",
      activities: [
        activity("BASE-1", "initiative_scope_baseline", {
          schemaVersion: 1,
          baselineId: "BASE-1",
          supersedesBaselineId: null,
          artifactDigest: "sha256:design",
          subject: { kind: "backlog-item", id: "BI-CORRECTABLE" },
          objectiveStatements: [{ objectiveId: "OBJ-1" }],
          acceptanceStatements: [],
        }, 1),
        activity("MAP-VALID-OLD", "initiative_objective_mapping", {
          schemaVersion: 1,
          proposalId: "MAP-VALID-OLD",
          subject: { kind: "backlog-item", id: "BI-CORRECTABLE" },
          baselineId: "BASE-1",
          artifactDigest: "sha256:design",
          mappings: [{ objectiveId: "OBJ-1", evidenceRefs: ["E-PASS"] }],
        }, 2),
        activity("E-PASS", "evidence", { evidenceKind: "test_pass" }, 3),
        activity("MAP-BAD-NEW", "initiative_objective_mapping", {
          schemaVersion: 1,
          proposalId: "MAP-BAD-NEW",
          subject: { kind: "backlog-item", id: "BI-CORRECTABLE" },
          baselineId: "BASE-1",
          artifactDigest: "sha256:design",
          mappings: [{
            objectiveId: "OBJ-1",
            evidenceRefs: ["docs/superpowers/specs/not-an-activity.md"],
          }],
        }, 4),
      ],
    });

    expect(result).toEqual({
      state: "missing",
      baselineId: "BASE-1",
      evidenceRefs: ["docs/superpowers/specs/not-an-activity.md"],
      requiredStatementIds: ["OBJ-1"],
    });
  });
});

describe("selectEligibleObjectiveEvidenceActivityIds", () => {
  it("returns only bounded same-item post-baseline passing activities", () => {
    const result = selectEligibleObjectiveEvidenceActivityIds({
      itemId: "BI-2B619BC9",
      itemRowId: "row-bi-2b",
      baselineRecordedAt: recordedAt(10),
      activities: [
        { ...activity("cmtnr924q", "evidence", { evidenceKind: "test_pass" }, 11), backlogItemId: "row-bi-2b" },
        { ...activity("cmtnr926e", "evidence", { evidenceKind: "build_pass" }, 12), backlogItemId: "BI-2B619BC9" },
        { ...activity("cmtnr9295", "evidence", { evidenceKind: "manual_check" }, 13), backlogItemId: "row-bi-2b" },
        { ...activity("cmtnr927v", "evidence", { evidenceKind: "source_verified" }, 14), backlogItemId: "row-bi-2b" },
        { ...activity("pre-baseline", "evidence", { evidenceKind: "test_pass" }, 9), backlogItemId: "row-bi-2b" },
        { ...activity("failed", "evidence", { evidenceKind: "test_fail" }, 15), backlogItemId: "row-bi-2b" },
        { ...activity("foreign", "evidence", { evidenceKind: "test_pass" }, 15), backlogItemId: "row-other" },
        activity("unbound", "evidence", { evidenceKind: "test_pass" }, 15),
      ],
      maximumActivityCount: 20,
    });

    expect(result).toEqual(ok({
      activityIds: ["cmtnr924q", "cmtnr926e", "cmtnr927v", "cmtnr9295"],
    }));
  });

  it("fails closed instead of truncating an unbounded activity set", () => {
    const result = selectEligibleObjectiveEvidenceActivityIds({
      itemId: "BI-BOUND",
      baselineRecordedAt: recordedAt(1),
      activities: [
        activity("E-1", "evidence", { evidenceKind: "test_pass" }, 2),
        activity("E-2", "evidence", { evidenceKind: "test_pass" }, 3),
      ],
      maximumActivityCount: 1,
    });

    expect(result).toEqual(err("evidence-limit-exceeded"));
  });
});
