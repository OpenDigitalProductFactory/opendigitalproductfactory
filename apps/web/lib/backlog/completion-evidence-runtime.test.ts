import { describe, expect, it, vi } from "vitest";

import {
  resolveCompletionEvidence,
  type ResolveCompletionEvidenceResult,
} from "./completion-evidence-runtime";

function evaluated(result: ResolveCompletionEvidenceResult) {
  expect(result.kind).toBe("evaluated");
  if (result.kind !== "evaluated") throw new Error("expected evaluated completion evidence");
  return result;
}

function db() {
  return {
    backlogItem: { findUnique: vi.fn() },
    backlogItemActivity: { findMany: vi.fn() },
  };
}

const manifest = {
  workClass: "implementation",
  evidenceActivityIds: ["source"],
  useActiveBuildEvidence: true,
  ux: { disposition: "verified" },
  migration: { disposition: "not-applicable", reason: "No database schema or persisted data changed." },
};

describe("resolveCompletionEvidence", () => {
  it("resolves item evidence and reuses canonical Build Studio verification", async () => {
    const fake = db();
    fake.backlogItem.findUnique.mockResolvedValue({
      id: "row-1",
      itemId: "BI-1",
      status: "in-progress",
      workType: "feature",
      claimedAt: new Date("2026-07-25T00:00:00Z"),
      createdAt: new Date("2026-07-20T00:00:00Z"),
      activeBuild: {
        verificationOut: { typecheckPassed: true, testsFailed: 0, buildPassed: true },
        uxVerificationStatus: "complete",
      },
    });
    fake.backlogItemActivity.findMany.mockResolvedValue([
      {
        id: "source",
        backlogItemId: "row-1",
        kind: "evidence",
        recordedAt: new Date("2026-07-26T10:00:00Z"),
        payload: {
          evidenceKind: "source_verified",
          url: "https://github.com/acme/repo/pull/1",
        },
      },
    ]);

    const result = await resolveCompletionEvidence(fake, {
      itemId: "BI-1",
      rawManifest: manifest,
      now: new Date("2026-07-26T12:00:00Z"),
    });

    expect(evaluated(result).verdict.allowed).toBe(true);
    expect(fake.backlogItemActivity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 250,
        orderBy: { recordedAt: "desc" },
      }),
    );
  });

  it("does not treat skipped UX as verified", async () => {
    const fake = db();
    fake.backlogItem.findUnique.mockResolvedValue({
      id: "row-1",
      itemId: "BI-1",
      status: "in-progress",
      workType: "feature",
      claimedAt: new Date("2026-07-25T00:00:00Z"),
      createdAt: new Date("2026-07-20T00:00:00Z"),
      activeBuild: {
        verificationOut: { typecheckPassed: true, testsFailed: 0, buildPassed: true },
        uxVerificationStatus: "skipped",
      },
    });
    fake.backlogItemActivity.findMany.mockResolvedValue([
      {
        id: "source",
        backlogItemId: "row-1",
        kind: "evidence",
        recordedAt: new Date("2026-07-26T10:00:00Z"),
        payload: {
          evidenceKind: "source_verified",
          url: "https://github.com/acme/repo/pull/1",
        },
      },
    ]);

    const result = await resolveCompletionEvidence(fake, {
      itemId: "BI-1",
      rawManifest: manifest,
      now: new Date("2026-07-26T12:00:00Z"),
    });

    const verdict = evaluated(result).verdict;
    expect(verdict.allowed).toBe(false);
    expect(verdict.blockers).toContainEqual(expect.objectContaining({ dimension: "ux" }));
  });

  it("loads referenced foreign evidence so the policy distinguishes it from dangling evidence", async () => {
    const fake = db();
    fake.backlogItem.findUnique.mockResolvedValue({
      id: "row-1",
      itemId: "BI-1",
      status: "in-progress",
      workType: "feature",
      claimedAt: null,
      createdAt: new Date("2026-07-20T00:00:00Z"),
      activeBuild: null,
    });
    fake.backlogItemActivity.findMany.mockResolvedValue([
      {
        id: "foreign",
        backlogItemId: "row-2",
        kind: "evidence",
        recordedAt: new Date("2026-07-26T10:00:00Z"),
        payload: { evidenceKind: "source_verified", url: "https://example.com/pr/2" },
      },
    ]);

    const result = await resolveCompletionEvidence(fake, {
      itemId: "BI-1",
      rawManifest: {
        ...manifest,
        useActiveBuildEvidence: false,
        evidenceActivityIds: ["foreign"],
        ux: { disposition: "not-applicable", reason: "No user interface files or routes changed." },
      },
      now: new Date("2026-07-26T12:00:00Z"),
    });

    expect(evaluated(result).verdict.blockers.map((entry) => entry.code)).toContain("foreign-evidence");
  });

  it("fails structurally-invalid source evidence", async () => {
    const fake = db();
    fake.backlogItem.findUnique.mockResolvedValue({
      id: "row-1",
      itemId: "BI-1",
      status: "in-progress",
      workType: "feature",
      claimedAt: null,
      createdAt: new Date("2026-07-20T00:00:00Z"),
      activeBuild: null,
    });
    fake.backlogItemActivity.findMany.mockResolvedValue([
      {
        id: "source",
        backlogItemId: "row-1",
        kind: "evidence",
        recordedAt: new Date("2026-07-26T10:00:00Z"),
        payload: { evidenceKind: "source_verified", url: null },
      },
    ]);

    const result = await resolveCompletionEvidence(fake, {
      itemId: "BI-1",
      rawManifest: {
        ...manifest,
        useActiveBuildEvidence: false,
        evidenceActivityIds: ["source"],
        ux: { disposition: "not-applicable", reason: "No user interface files or routes changed." },
      },
      now: new Date("2026-07-26T12:00:00Z"),
    });
    expect(evaluated(result).verdict.blockers.map((entry) => entry.code)).toContain("invalid-evidence");
  });

  it("returns not-found without querying activities", async () => {
    const fake = db();
    fake.backlogItem.findUnique.mockResolvedValue(null);
    const result = await resolveCompletionEvidence(fake, {
      itemId: "BI-MISSING",
      rawManifest: manifest,
      now: new Date("2026-07-26T12:00:00Z"),
    });
    expect(result).toEqual({ kind: "not-found", itemId: "BI-MISSING" });
    expect(fake.backlogItemActivity.findMany).not.toHaveBeenCalled();
  });

  it("keeps an already-done retry idempotent without loading evidence", async () => {
    const fake = db();
    fake.backlogItem.findUnique.mockResolvedValue({
      id: "row-1",
      itemId: "BI-1",
      status: "done",
      workType: "feature",
      claimedAt: new Date("2026-07-25T00:00:00Z"),
      createdAt: new Date("2026-07-20T00:00:00Z"),
      activeBuild: null,
    });
    const result = await resolveCompletionEvidence(fake, {
      itemId: "BI-1",
      rawManifest: null,
      now: new Date("2026-07-26T12:00:00Z"),
    });
    expect(evaluated(result).verdict).toMatchObject({ allowed: true, noOp: true });
    expect(fake.backlogItemActivity.findMany).not.toHaveBeenCalled();
  });
});
