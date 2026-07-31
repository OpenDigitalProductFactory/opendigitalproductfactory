import { describe, expect, it, vi } from "vitest";

import { isUnattributedSession, lookupChangeOrigin } from "./origin-lookup";

const SHA = "6e7a75e6c2032d6185171fdfacfffde927cb107e";
const OTHER_SHA = "3c46e27d97781d4663d80ea097a1e9f3dd7f1cdf";
const BRANCH = "fix/platform-issue-report-index-integrity";

function evidenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cms6oz29x01x801ogb1uyp1sy",
    provider: "codex",
    target: BRANCH,
    createdAt: new Date("2026-07-29T23:04:19Z"),
    details: {
      externalSessionId: "019f974a-8e62-7f03-8556-4104f2d41cc6-gate-pir",
      evidence: {
        sha: SHA,
        branch: BRANCH,
        leaseId: "NPEL-6EF099007C",
        gatePassed: true,
        origin: {
          attribution: "attributed",
          rootSessionId: "019f974a-parent",
          isChildThread: true,
        },
      },
    },
    ...overrides,
  };
}

function leaseRow(overrides: Record<string, unknown> = {}) {
  return {
    leaseId: "NPEL-6EF099007C",
    ownerProvider: "codex",
    ownerSessionId: "019f974a-8e62-7f03-8556-4104f2d41cc6-gate-pir",
    branchName: BRANCH,
    worktreePath: "D:/DPF-worktrees/platform-issue-report-index-integrity",
    purpose: `Pre-PR local-CI gate for ${BRANCH} @ ${SHA}`,
    createdAt: new Date("2026-07-29T22:03:08Z"),
    ...overrides,
  };
}

function db(evidence: unknown[] = [], leases: unknown[] = []) {
  return {
    externalEvidenceRecord: { findMany: vi.fn().mockResolvedValue(evidence) },
    nonProductionEnvironmentLease: { findMany: vi.fn().mockResolvedValue(leases) },
  };
}

describe("lookupChangeOrigin", () => {
  it("attributes a change to its client and thread from the evidence record", async () => {
    const result = await lookupChangeOrigin(
      { shas: [SHA], branchName: BRANCH },
      { db: db([evidenceRow()], []) },
    );
    expect(result.origin?.provider).toBe("codex");
    expect(result.origin?.sessionId).toBe("019f974a-8e62-7f03-8556-4104f2d41cc6-gate-pir");
    expect(result.origin?.rootSessionId).toBe("019f974a-parent");
    expect(result.origin?.matchedOn).toBe("sha");
    expect(result.unattributed).toBe(false);
  });

  it("prefers an exact SHA match over a same-branch record from another thread", async () => {
    const otherThread = evidenceRow({
      id: "OTHER",
      details: {
        externalSessionId: "some-other-thread",
        evidence: { sha: OTHER_SHA, branch: BRANCH },
      },
      createdAt: new Date("2026-07-30T00:00:00Z"), // newer, but not this SHA
    });
    const result = await lookupChangeOrigin(
      { shas: [SHA], branchName: BRANCH },
      { db: db([otherThread, evidenceRow()], []) },
    );
    expect(result.origin?.sessionId).toBe("019f974a-8e62-7f03-8556-4104f2d41cc6-gate-pir");
    expect(result.matches).toHaveLength(2);
  });

  it("returns every thread that gated a reused branch", async () => {
    // Real case: one branch, several sessions. The caller needs to see all of
    // them rather than be handed one and told it is the answer.
    const result = await lookupChangeOrigin(
      { branchName: BRANCH },
      {
        db: db(
          [
            evidenceRow({ id: "A", details: { externalSessionId: "thread-a", evidence: { branch: BRANCH } } }),
            evidenceRow({ id: "B", details: { externalSessionId: "thread-b", evidence: { branch: BRANCH } } }),
          ],
          [],
        ),
      },
    );
    expect(result.matches.map((m) => m.sessionId)).toEqual(["thread-a", "thread-b"]);
  });

  it("falls back to the lease when no evidence record exists", async () => {
    // A cancelled or expired gate leaves a lease but no evidence.
    const result = await lookupChangeOrigin(
      { shas: [SHA], branchName: BRANCH },
      { db: db([], [leaseRow()]) },
    );
    expect(result.origin?.leaseId).toBe("NPEL-6EF099007C");
    expect(result.origin?.sha).toBe(SHA);
    expect(result.origin?.matchedOn).toBe("sha");
    expect(result.origin?.worktreePath).toContain("platform-issue-report");
  });

  it("reports nothing for a change this install never gated", async () => {
    // An outside contributor's PR. "No local origin" is the correct answer and
    // must not be dressed up as an attribution.
    const result = await lookupChangeOrigin(
      { shas: [SHA], branchName: "feat/from-a-fork" },
      { db: db([], []) },
    );
    expect(result.origin).toBeNull();
    expect(result.matches).toEqual([]);
    expect(result.unattributed).toBe(false);
  });

  it("flags a match whose thread could not be identified", async () => {
    const result = await lookupChangeOrigin(
      { shas: [SHA], branchName: BRANCH },
      {
        db: db(
          [
            evidenceRow({
              details: { externalSessionId: "gate-95708", evidence: { sha: SHA, branch: BRANCH } },
            }),
          ],
          [],
        ),
      },
    );
    expect(result.unattributed).toBe(true);
  });

  it("ranks a named thread above an unidentified one at the same match quality", async () => {
    const result = await lookupChangeOrigin(
      { branchName: BRANCH },
      {
        db: db(
          [
            evidenceRow({ id: "LEGACY", details: { externalSessionId: "gate-1", evidence: { branch: BRANCH } } }),
            evidenceRow({ id: "NAMED", details: { externalSessionId: "real-thread", evidence: { branch: BRANCH } } }),
          ],
          [],
        ),
      },
    );
    expect(result.origin?.sessionId).toBe("real-thread");
  });

  it("does not query when given neither a SHA nor a branch", async () => {
    const database = db();
    const result = await lookupChangeOrigin({}, { db: database });
    expect(result.origin).toBeNull();
    expect(database.externalEvidenceRecord.findMany).not.toHaveBeenCalled();
    expect(database.nonProductionEnvironmentLease.findMany).not.toHaveBeenCalled();
  });

  it("ignores values that are not commit SHAs", async () => {
    const database = db();
    await lookupChangeOrigin({ shas: ["not-a-sha", "HEAD"] }, { db: database });
    expect(database.externalEvidenceRecord.findMany).not.toHaveBeenCalled();
  });
});

describe("isUnattributedSession", () => {
  it("recognises the current unattributed marker", () => {
    expect(isUnattributedSession("unattributed-95708")).toBe(true);
  });

  it("recognises the legacy gate-<pid> default that looked real", () => {
    expect(isUnattributedSession("gate-95708")).toBe(true);
  });

  it("accepts a real client thread id", () => {
    expect(isUnattributedSession("019f974a-8e62-7f03-8556-4104f2d41cc6")).toBe(false);
  });

  it("does not mistake a named session that merely starts with 'gate'", () => {
    expect(isUnattributedSession("gate-v2-3c43c24c-b4ff-44cd-9fe6-7795d6290a48")).toBe(false);
  });

  it("treats a missing session as unattributed", () => {
    expect(isUnattributedSession(null)).toBe(true);
  });
});
