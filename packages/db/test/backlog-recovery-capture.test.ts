import { describe, expect, it } from "vitest";

import {
  buildBacklogRecoveryBundle,
  buildWorkroomCaptureRecord,
  parseBacklogRecoveryBundle,
  planWorkroomRestore,
  workroomRestorePlanBalances,
  type BacklogCaptureEpicRow,
  type BacklogCaptureItemRow,
  type WorkroomCaptureRecord,
  type WorkroomCaptureRow,
} from "../src/backlog-recovery-bundle";

const CAPTURED_AT = "2026-08-22T10:00:00.000Z";

function epicRow(overrides: Partial<BacklogCaptureEpicRow> = {}): BacklogCaptureEpicRow {
  return {
    epicId: "EP-TEST0001",
    title: "Test epic",
    description: "An epic captured for recovery.",
    status: "in-progress",
    scopeKind: "platform",
    scopeRationale: "Platform substrate shared by every archetype.",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function itemRow(overrides: Partial<BacklogCaptureItemRow> = {}): BacklogCaptureItemRow {
  return {
    itemId: "BI-TEST0001",
    epicId: "EP-TEST0001",
    title: "Capture unfinished work",
    body: "Unfinished work must survive a teardown.",
    status: "open",
    type: "product",
    workType: "feature",
    source: "user-request",
    effortSize: "medium",
    triageOutcome: "build",
    scopeKind: "platform",
    scopeRationale: "Platform substrate shared by every archetype.",
    createdAt: new Date("2026-08-02T00:00:00.000Z"),
    activities: [],
    ...overrides,
  };
}

function capture(items: BacklogCaptureItemRow[], epic = epicRow()) {
  return buildBacklogRecoveryBundle({
    bundleId: "capture-test",
    description: "Captured from a development installation before teardown.",
    capturedAt: CAPTURED_AT,
    repository: "OpenDigitalProductFactory/opendigitalproductfactory",
    planPath: "docs/superpowers/plans/2026-08-22-instance-identity-and-purpose.md",
    epic,
    items,
  });
}

function build(items: BacklogCaptureItemRow[], epic = epicRow()) {
  const { bundle } = capture(items, epic);
  if (!bundle) throw new Error("expected a bundle");
  return bundle;
}

describe("buildBacklogRecoveryBundle", () => {
  it("produces a bundle that reconciles — anything captured can be restored", () => {
    const bundle = build([itemRow()]);
    // The round-trip is the contract: parse is what recovery runs on import.
    expect(() => parseBacklogRecoveryBundle(JSON.parse(JSON.stringify(bundle)))).not.toThrow();
    expect(bundle.items).toHaveLength(1);
    expect(bundle.source.capturedAt).toBe(CAPTURED_AT);
  });

  it("captures every unfinished status so no in-flight work is dropped", () => {
    const bundle = build([
      itemRow({ itemId: "BI-TRIAGE01", status: "triaging" }),
      itemRow({ itemId: "BI-OPEN0001", status: "open" }),
      itemRow({ itemId: "BI-PROG0001", status: "in-progress" }),
    ]);
    expect(bundle.items.map((item) => item.itemId)).toEqual([
      "BI-TRIAGE01",
      "BI-OPEN0001",
      "BI-PROG0001",
    ]);
  });

  it("projects a stored resolution into the status_change the invariant requires", () => {
    const bundle = build([
      itemRow({
        itemId: "BI-DONE0001",
        status: "done",
        resolution: "Shipped in PR #1234.",
        completedAt: new Date("2026-08-10T00:00:00.000Z"),
        activities: [
          {
            id: "ACT-EV",
            kind: "evidence",
            summary: "Verification evidence recorded at completion.",
            recordedAt: new Date("2026-08-10T00:00:00.000Z"),
            payload: { check: "pregate" },
          },
        ],
      }),
    ]);
    const activity = bundle.items[0]?.activities.find((entry) => entry.kind === "status_change");
    expect(activity?.payload.resolution).toBe("Shipped in PR #1234.");
    expect(bundle.items[0]?.completedAt).toBe("2026-08-10T00:00:00.000Z");
  });

  it("keeps an existing status_change rather than adding a second one", () => {
    const bundle = build([
      itemRow({
        itemId: "BI-DONE0002",
        status: "done",
        resolution: "Superseded.",
        completedAt: new Date("2026-08-11T00:00:00.000Z"),
        activities: [
          {
            id: "ACT-EV",
            kind: "evidence",
            summary: "Verification evidence recorded at completion.",
            recordedAt: new Date("2026-08-10T00:00:00.000Z"),
            payload: { check: "pregate" },
          },
          {
            id: "ACT-1",
            kind: "status_change",
            summary: "Closed as superseded.",
            recordedAt: new Date("2026-08-11T00:00:00.000Z"),
            payload: { resolution: "Superseded." },
          },
        ],
      }),
    ]);
    const changes = bundle.items[0]?.activities.filter((entry) => entry.kind === "status_change");
    expect(changes).toHaveLength(1);
  });

  it("gives every activity a stable, item-scoped recovery key", () => {
    const bundle = build([
      itemRow({
        activities: [
          {
            id: "ACT-9",
            kind: "comment",
            summary: "Noted.",
            recordedAt: new Date("2026-08-03T00:00:00.000Z"),
            payload: { note: "hello" },
          },
        ],
      }),
    ]);
    expect(bundle.items[0]?.activities[0]?.recoveryKey).toBe("bi-test0001-act-9");
  });

  it("drops an unserialisable payload instead of failing the capture", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const bundle = build([
      itemRow({
        activities: [
          {
            id: "ACT-C",
            kind: "comment",
            summary: "Cyclic payload.",
            recordedAt: CAPTURED_AT,
            payload: cyclic,
          },
        ],
      }),
    ]);
    expect(bundle.items[0]?.activities[0]?.payload).toEqual({});
  });

  it("omits completedAt and resolution for work that is not done", () => {
    const bundle = build([
      itemRow({ status: "open", resolution: "not applicable", completedAt: new Date() }),
    ]);
    expect(bundle.items[0]?.completedAt).toBeUndefined();
    expect(bundle.items[0]?.resolution).toBeUndefined();
  });

  it("is deterministic — the same rows produce the same bundle", () => {
    expect(build([itemRow()])).toEqual(build([itemRow()]));
  });

  it("reports a done item it cannot represent instead of dropping it silently", () => {
    const result = capture([
      itemRow({
        itemId: "BI-DONE0003",
        status: "done",
        resolution: "Closed.",
        completedAt: new Date("2026-08-12T00:00:00.000Z"),
      }),
    ]);
    expect(result.bundle).toBeNull();
    expect(result.skipped).toEqual([
      { itemId: "BI-DONE0003", reason: "done-item-has-no-evidence-activity" },
    ]);
  });

  it("never invents evidence for a completed item", () => {
    const result = capture([
      itemRow({ itemId: "BI-DONE0004", status: "done", resolution: "Closed." }),
    ]);
    expect(result.bundle).toBeNull();
    expect(result.skipped).toHaveLength(1);
  });
});

describe("payload sanitisation", () => {
  it("strips install-local identifiers instead of failing the capture", () => {
    const result = buildBacklogRecoveryBundle({
      bundleId: "capture-sensitive",
      description: "Capture with install-local identifiers in a payload.",
      capturedAt: CAPTURED_AT,
      repository: "OpenDigitalProductFactory/opendigitalproductfactory",
      planPath: "docs/superpowers/plans/2026-08-22-instance-identity-and-purpose.md",
      epic: epicRow(),
      items: [
        itemRow({
          activities: [
            {
              id: "ACT-S",
              kind: "comment",
              summary: "Carries local ids.",
              recordedAt: CAPTURED_AT,
              payload: {
                principalId: "PRN-123",
                agentId: "AG-9",
                note: "kept",
                nested: { userId: "U-1", detail: "also kept" },
              },
            },
          ],
        }),
      ],
    });
    const payload = result.bundle?.items[0]?.activities[0]?.payload;
    expect(payload).toEqual({ note: "kept", nested: { detail: "also kept" } });
  });
});

function room(overrides: Partial<WorkroomCaptureRow> = {}): WorkroomCaptureRow {
  return {
    capsuleId: "WC-00000001",
    title: "Work on BI-TEST0001",
    objective: "Claim-at-start binding for BI-TEST0001",
    status: "working",
    source: "external-adoption",
    executorKind: "claude-desktop",
    executorRef: "worktree:D:/DPF-worktrees/test",
    backlogItemId: "BI-TEST0001",
    epicId: "EP-TEST0001",
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    baseBranch: "main",
    baseSha: null,
    headBranch: "fix/test",
    headSha: "abc123",
    worktreePath: "D:/DPF-worktrees/test",
    pullRequestUrl: null,
    pullRequestNumber: null,
    contributionMode: "private",
    branchTaxonomy: "fix",
    idempotencyKey: null,
    scopeClaims: [],
    workspaceState: {},
    verificationState: {},
    leaseHolderPrincipalId: "principal-1",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-02T00:00:00.000Z"),
    lastSyncedAt: null,
    archivedAt: null,
    activities: [],
    ...overrides,
  };
}

describe("buildWorkroomCaptureRecord", () => {

  it("keeps every Workroom, counts the branch-bound and open ones, and sorts deterministically", () => {
    const record = buildWorkroomCaptureRecord(
      [
        room({ capsuleId: "WC-B", status: "abandoned", headBranch: null }),
        room({
          capsuleId: "WC-A",
          activities: [
            { id: "act-2", kind: "evidence", summary: "later", payload: {}, recordedAt: new Date("2026-09-02T00:00:00.000Z") },
            { id: "act-1", kind: "claim", summary: "earlier", payload: { branch: "fix/test" }, recordedAt: new Date("2026-09-01T00:00:00.000Z") },
          ],
        }),
      ],
      CAPTURED_AT,
    );

    expect(record.schemaVersion).toBe(1);
    expect(record.capturedAt).toBe(CAPTURED_AT);
    expect(record.workroomCount).toBe(2);
    expect(record.boundBranchCount).toBe(1);
    expect(record.openCount).toBe(1);
    expect(record.workrooms.map((r) => r.capsuleId)).toEqual(["WC-A", "WC-B"]);
    expect(record.workrooms[0]?.activities.map((a) => a.id)).toEqual(["act-1", "act-2"]);
    expect(record.workrooms[0]?.createdAt).toBe("2026-09-01T00:00:00.000Z");
    expect(record.workrooms[1]?.headBranch).toBeNull();
    // A JSON round-trip loses nothing the rebind slice will need.
    const parsed = JSON.parse(JSON.stringify(record)) as WorkroomCaptureRecord;
    expect(parsed.workrooms[0]?.worktreePath).toBe("D:/DPF-worktrees/test");
    expect(parsed.workrooms[0]?.activities[0]?.payload).toEqual({ branch: "fix/test" });
  });
});

describe("planWorkroomRestore", () => {
  function record(rooms: Partial<WorkroomCaptureRow>[]): WorkroomCaptureRecord {
    return buildWorkroomCaptureRecord(
      rooms.map((over) => room(over)),
      CAPTURED_AT,
    );
  }
  const allPresent = () => true;
  const nonePresent = () => false;

  it("restores a captured room whose worktree still exists, under its captured status", () => {
    const plan = planWorkroomRestore({
      record: record([{ capsuleId: "WC-A", status: "working" }]),
      existingCapsuleIds: [],
      worktreeExists: allPresent,
    });

    expect(plan.restore.map((a) => [a.capsuleId, a.status])).toEqual([["WC-A", "working"]]);
    expect(plan.archiveMissingWorktree).toEqual([]);
    expect(workroomRestorePlanBalances(plan)).toBe(true);
  });

  // "We destroyed the evidence" is not the same claim as "this never existed".
  it("restores a room whose worktree is gone as archived, with the reason recorded", () => {
    const plan = planWorkroomRestore({
      record: record([{ capsuleId: "WC-GONE", status: "working", worktreePath: "D:/DPF-worktrees/gone" }]),
      existingCapsuleIds: [],
      worktreeExists: nonePresent,
    });

    expect(plan.restore).toEqual([]);
    expect(plan.archiveMissingWorktree).toHaveLength(1);
    expect(plan.archiveMissingWorktree[0]?.status).toBe("archived");
    expect(plan.archiveMissingWorktree[0]?.archivedReason).toContain("D:/DPF-worktrees/gone");
    expect(plan.archiveMissingWorktree[0]?.archivedReason).toContain("no longer exists");
    // The room and its history still come back.
    expect(plan.archiveMissingWorktree[0]?.room.capsuleId).toBe("WC-GONE");
    expect(workroomRestorePlanBalances(plan)).toBe(true);
  });

  it("leaves a room this install already has alone, so a re-run is a no-op", () => {
    const rec = record([{ capsuleId: "WC-A" }, { capsuleId: "WC-B" }]);
    const first = planWorkroomRestore({ record: rec, existingCapsuleIds: [], worktreeExists: allPresent });
    expect(first.restore).toHaveLength(2);

    const applied = first.restore.map((a) => a.capsuleId);
    const second = planWorkroomRestore({ record: rec, existingCapsuleIds: applied, worktreeExists: allPresent });
    expect(second.restore).toEqual([]);
    expect(second.skipped.map((s) => s.capsuleId)).toEqual(["WC-A", "WC-B"]);
    expect(workroomRestorePlanBalances(second)).toBe(true);
  });

  it("restores a room with no worktree path under its captured status", () => {
    const plan = planWorkroomRestore({
      record: record([{ capsuleId: "WC-BUILDSTUDIO", status: "verifying", worktreePath: null }]),
      existingCapsuleIds: [],
      // Would archive everything if it were consulted; it must not be.
      worktreeExists: nonePresent,
    });

    expect(plan.restore.map((a) => a.status)).toEqual(["verifying"]);
    expect(plan.archiveMissingWorktree).toEqual([]);
  });

  it("accounts for every captured room across the three buckets", () => {
    const plan = planWorkroomRestore({
      record: record([
        { capsuleId: "WC-KEEP", worktreePath: "D:/here" },
        { capsuleId: "WC-GONE", worktreePath: "D:/gone" },
        { capsuleId: "WC-HAVE" },
      ]),
      existingCapsuleIds: ["WC-HAVE"],
      worktreeExists: (p) => p === "D:/here",
    });

    expect(plan.capturedCount).toBe(3);
    expect(plan.restore).toHaveLength(1);
    expect(plan.archiveMissingWorktree).toHaveLength(1);
    expect(plan.skipped).toHaveLength(1);
    expect(workroomRestorePlanBalances(plan)).toBe(true);
  });

  it("carries the activity history through the restore", () => {
    const plan = planWorkroomRestore({
      record: record([
        {
          capsuleId: "WC-A",
          activities: [
            { id: "act-1", kind: "claim", summary: "claimed", payload: { branch: "fix/test" }, recordedAt: new Date("2026-09-01T00:00:00.000Z") },
          ],
        },
      ]),
      existingCapsuleIds: [],
      worktreeExists: allPresent,
    });

    expect(plan.restore[0]?.room.activities).toHaveLength(1);
    expect(plan.restore[0]?.room.activities[0]?.payload).toEqual({ branch: "fix/test" });
  });
});
