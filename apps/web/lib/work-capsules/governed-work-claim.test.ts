import { describe, expect, it, vi } from "vitest";

import { claimGovernedBacklogWorkspace } from "./governed-work-claim";
import type { CapsuleDb } from "./work-capsule-store-types";

const actor = { userId: "user-1", agentId: "AGT-1", principalId: "PRN-1" };
const CANONICAL_DESIGN_PATH = "docs/superpowers/specs/2026-08-22-entry-design.md";
const CANONICAL_BLOB_SHA = "9f2c1d4e6b8a0c2e4f6a8b0c2d4e6f8a0b2c4d6e";
const discoverCanonicalArtifact = vi.fn().mockResolvedValue({
  resolved: true,
  path: CANONICAL_DESIGN_PATH,
  providerBlobId: CANONICAL_BLOB_SHA,
});
const input = {
  backlogItemId: "BI-ENTRY",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  headBranch: "feat/entry",
  worktreePath: "D:\\DPF-worktrees\\entry",
  baseBranch: "main",
  executorKind: "codex-desktop" as const,
  executorRef: "session-1",
};

function database(activities: unknown[] = []) {
  const db = {
    backlogItem: {
      findFirst: vi.fn().mockResolvedValue({
        id: "row-bi",
        itemId: "BI-ENTRY",
        type: "portfolio",
        source: "user-request",
        workType: "feature",
        scopeKind: "platform",
        archetypeCategories: [],
        archetypeIds: [],
        activeBuild: null,
      }),
      update: vi.fn(),
    },
    backlogItemActivity: {
      findMany: vi.fn().mockResolvedValue(activities),
      create: vi.fn().mockResolvedValue({ id: "decision-row" }),
    },
    workroom: {
      create: vi.fn(),
      // Honour the `where` clause rather than answering unconditionally: the room
      // on this branch carries NO item binding, which is the state a room is
      // actually in before any claim has succeeded for its item. A mock that
      // answers regardless of the query cannot tell the old lookup from the new
      // one, so it would pass either way and prove nothing (BI-512214EA).
      findFirst: vi.fn().mockImplementation((args?: { where?: { backlogItemId?: string } }) =>
        Promise.resolve(args?.where?.backlogItemId ? null : {
          capsuleId: "WC-ENTRY",
          repositoryFullName: input.repositoryFullName,
          headBranch: input.headBranch,
          headSha: "1111111111111111111111111111111111111111",
          baseSha: "3333333333333333333333333333333333333333",
          archivedAt: null,
        })),
      // Recovery matches rooms on branch identity (BI-512214EA), so the default
      // room here carries NO backlogItemId — the state a room is actually in
      // before a claim has ever succeeded for its item.
      findUnique: vi.fn().mockResolvedValue({
        id: "row-wc",
        capsuleId: "WC-ENTRY",
        backlogItemId: "BI-ENTRY",
        status: "ready",
        archivedAt: null,
        repositoryFullName: input.repositoryFullName,
        headBranch: input.headBranch,
        worktreePath: input.worktreePath,
        executorKind: input.executorKind,
        executorRef: input.executorRef,
        leaseHolderPrincipalId: actor.principalId,
        leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      }),
      findMany: vi.fn().mockResolvedValue([{
        capsuleId: "WC-ENTRY",
        repositoryFullName: input.repositoryFullName,
        headBranch: input.headBranch,
        headSha: "1111111111111111111111111111111111111111",
        baseSha: "3333333333333333333333333333333333333333",
        backlogItemId: null,
      }]),
      update: vi.fn(),
    },
    workroomActivity: {
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue({
        payload: {
          schemaVersion: 1,
          intent: "design",
          policyVersion: "initiative-readiness.v1",
          subject: { kind: "backlog-item", id: "BI-ENTRY" },
        },
      }),
    },
    agentToolGrant: {
      findMany: vi.fn().mockResolvedValue([
        {
          grantKey: "initiative_design_review",
          agent: {
            agentId: "AGT-INDEPENDENT-REVIEWER",
            displayName: "Independent Design Reviewer",
            status: "active",
            archived: false,
            lifecycleStage: "production",
          },
        },
      ]),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db as unknown as CapsuleDb;
}

describe("claimGovernedBacklogWorkspace", () => {
  // BI-512214EA. Recovery used to require a Workroom already bound to the item,
  // but that binding is written by the successful-claim path — so a refused
  // claim could never find one, and every reviewer route came back empty. These
  // two pin the branch-identity match and its preference order.
  it("resolves a dispatch context from a room on the branch with no item binding", async () => {
    const db = database();
    const result = await claimGovernedBacklogWorkspace({
      db,
      input,
      actor,
      workIntent: null,
      now: new Date("2026-08-22T00:00:00.000Z"),
      dependencies: { claimWorkspace: vi.fn(), discoverCanonicalArtifact },
    });

    expect(result.ok).toBe(false);
    const routes = result.ok ? [] : result.data.recovery.reviewerRoutes;
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every((route) => route.workroomId === "WC-ENTRY")).toBe(true);
    expect(result.ok ? [] : result.data.recovery.escalations)
      .not.toContainEqual(expect.objectContaining({ reason: "dispatch-context-required" }));
  });

  it("prefers a room bound to this item over one merely sharing its branch", async () => {
    const db = database();
    (db as unknown as { workroom: { findMany: ReturnType<typeof vi.fn> } }).workroom.findMany
      .mockResolvedValueOnce([
        {
          capsuleId: "WC-BRANCH-ONLY",
          repositoryFullName: input.repositoryFullName,
          headBranch: input.headBranch,
          headSha: "2222222222222222222222222222222222222222",
          backlogItemId: null,
        },
        {
          capsuleId: "WC-BOUND",
          repositoryFullName: input.repositoryFullName,
          headBranch: input.headBranch,
          headSha: "3333333333333333333333333333333333333333",
          baseSha: "4444444444444444444444444444444444444444",
          backlogItemId: "BI-ENTRY",
        },
      ]);

    const result = await claimGovernedBacklogWorkspace({
      db,
      input,
      actor,
      workIntent: null,
      now: new Date("2026-08-22T00:00:00.000Z"),
      dependencies: { claimWorkspace: vi.fn(), discoverCanonicalArtifact },
    });

    const routes = result.ok ? [] : result.data.recovery.reviewerRoutes;
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every((route) => route.workroomId === "WC-BOUND")).toBe(true);
    expect(routes.every((route) => route.headSha === "3333333333333333333333333333333333333333")).toBe(true);
  });

  it("records a denial without mutating workspace state for a legacy implementation claim", async () => {
    const db = database();
    const claimWorkspace = vi.fn();

    const result = await claimGovernedBacklogWorkspace({
      db,
      input,
      actor,
      workIntent: null,
      now: new Date("2026-08-22T00:00:00.000Z"),
      dependencies: { claimWorkspace, discoverCanonicalArtifact },
    });

    expect(discoverCanonicalArtifact).toHaveBeenCalledWith({
      repositoryFullName: input.repositoryFullName,
      baseSha: "3333333333333333333333333333333333333333",
      headSha: "1111111111111111111111111111111111111111",
    });
    expect(result).toMatchObject({
      ok: false,
      data: {
        code: "initiative_not_ready",
        workIntent: "implementation",
        recovery: {
          reviewerRoutes: expect.arrayContaining([expect.objectContaining({
            toolName: "record_initiative_design_review",
            gate: "design-spec",
            targetAgentId: "AGT-INDEPENDENT-REVIEWER",
            independent: true,
            workroomId: "WC-ENTRY",
            repositoryFullName: input.repositoryFullName,
            branchName: input.headBranch,
            headSha: "1111111111111111111111111111111111111111",
            requestCoworker: {
              targetAgent: "AGT-INDEPENDENT-REVIEWER",
              objective: expect.stringContaining("BI-ENTRY"),
              questionPacketSummary: "design-spec for BI-ENTRY at 111111111111",
              requestKey: "initiative-readiness:BI-ENTRY:design-spec:1111111111111111111111111111111111111111",
              tier: 2,
              enteredVia: "handoff",
              requiredToolNames: ["record_initiative_design_review", "read_source_at_version"],
              initiativeReviewBinding: {
                writerToolName: "record_initiative_design_review",
                itemId: "BI-ENTRY",
                gate: "design-spec",
                expectedCurrentBaselineId: null,
                artifactRef: {
                  kind: "repo-blob-at-commit",
                  repositoryFullName: input.repositoryFullName,
                  commitSha: "1111111111111111111111111111111111111111",
                  path: CANONICAL_DESIGN_PATH,
                  providerBlobId: CANONICAL_BLOB_SHA,
                },
              },
            },
          })]),
        },
      },
    });
    const designRoute = result.ok
      ? undefined
      : result.data.recovery.reviewerRoutes.find((route) => route.gate === "design-spec");
    expect(designRoute?.requestCoworker.objective).toContain("BI-ENTRY");
    expect(designRoute?.requestCoworker.objective).toContain("WC-ENTRY");
    expect(designRoute?.requestCoworker.objective).toContain(input.repositoryFullName);
    expect(designRoute?.requestCoworker.objective).toContain(input.headBranch);
    expect(designRoute?.requestCoworker.objective).toContain("1111111111111111111111111111111111111111");
    expect(designRoute?.requestCoworker.objective).toContain("record_initiative_design_review");
    expect(designRoute?.requestCoworker.objective).toContain("independently");
    expect(claimWorkspace).not.toHaveBeenCalled();
    expect(db.backlogItemActivity?.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "initiative_readiness_decision" }),
    }));
  });

  it("returns an explicit escalation when no independently eligible receipt grant exists", async () => {
    const db = database();
    (db.agentToolGrant!.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        grantKey: "initiative_design_review",
        agent: {
          agentId: actor.agentId,
          displayName: "Current Author",
          status: "active",
          archived: false,
          lifecycleStage: "production",
        },
      },
    ]);

    const result = await claimGovernedBacklogWorkspace({
      db,
      input,
      actor,
      workIntent: "implementation",
      now: new Date("2026-08-22T00:00:00.000Z"),
      dependencies: { claimWorkspace: vi.fn(), discoverCanonicalArtifact },
    });

    expect(result).toMatchObject({
      ok: false,
      data: {
        recovery: {
          escalations: expect.arrayContaining([expect.objectContaining({
            grant: "initiative_design_review",
            reason: "no-eligible-reviewer",
            nextAction: expect.stringContaining("Assign or activate"),
          })]),
        },
      },
    });
  });

  it("atomically declares design intent and returns exact readback for governed design work", async () => {
    const db = database();
    const claimWorkspace = vi.fn().mockResolvedValue({
      capsuleId: "WC-ENTRY",
      backlogItemId: "BI-ENTRY",
      headBranch: input.headBranch,
      worktreePath: input.worktreePath,
      claimed: true,
      conflict: null,
    });
    const declareIntent = vi.fn().mockResolvedValue({ id: "intent-row" });

    const result = await claimGovernedBacklogWorkspace({
      db,
      input,
      actor,
      workIntent: "design",
      now: new Date("2026-08-22T00:00:00.000Z"),
      dependencies: { claimWorkspace, declareIntent, discoverCanonicalArtifact },
    });

    expect(result).toMatchObject({
      ok: true,
      data: { workIntent: "design", readiness: { verdict: "allowed" } },
    });
    expect(declareIntent).toHaveBeenCalledWith(expect.objectContaining({
      capsuleId: "WC-ENTRY",
      intent: "design",
      subject: { kind: "backlog-item", id: "BI-ENTRY" },
    }));
    expect(result.ok && result.data.readback).toMatchObject({
      capsuleId: "WC-ENTRY",
      backlogItemId: "BI-ENTRY",
      executorRef: "session-1",
      workIntent: "design",
    });
  });

  it("rolls back an allowed claim when exact readback does not match the requested session", async () => {
    const db = database();
    const claimWorkspace = vi.fn().mockResolvedValue({
      capsuleId: "WC-ENTRY",
      backlogItemId: "BI-ENTRY",
      headBranch: input.headBranch,
      worktreePath: input.worktreePath,
      claimed: true,
      conflict: null,
    });
    const declareIntent = vi.fn().mockResolvedValue({ id: "intent-row" });
    (db.workroom.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      capsuleId: "WC-ENTRY",
      backlogItemId: "BI-ENTRY",
      status: "ready",
      archivedAt: null,
      repositoryFullName: input.repositoryFullName,
      headBranch: input.headBranch,
      worktreePath: input.worktreePath,
      executorKind: input.executorKind,
      executorRef: "foreign-session",
      leaseHolderPrincipalId: actor.principalId,
      leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });

    const result = await claimGovernedBacklogWorkspace({
      db,
      input,
      actor,
      workIntent: "design",
      now: new Date("2026-08-22T00:00:00.000Z"),
      dependencies: { claimWorkspace, declareIntent, discoverCanonicalArtifact },
    });

    expect(result).toMatchObject({ ok: false, data: { code: "capsule_identity_mismatch" } });
    expect(db.$transaction).toHaveBeenCalled();
  });

  // BI-69BBC446. The observed failure: WC-0BE07607's branch and head matched the
  // claim exactly and its lease had expired nine hours earlier, but the blocker
  // said "the recorded branch and head no longer match. Re-sync with
  // adopt_worktree(headBranch, headSha)". Re-syncing changed nothing, because
  // nothing was wrong with the branch or the head, and the branch stayed
  // unclaimable for two days. A remedy that names the wrong field is worse than
  // one that names none — it is actionable, and it is wrong.
  it("names the expired lease, and does not blame the branch or head, when only the lease is stale", async () => {
    const db = database();
    const claimWorkspace = vi.fn().mockResolvedValue({
      capsuleId: "WC-ENTRY",
      backlogItemId: "BI-ENTRY",
      headBranch: input.headBranch,
      worktreePath: input.worktreePath,
      claimed: true,
      conflict: null,
    });
    const declareIntent = vi.fn().mockResolvedValue({ id: "intent-row" });
    (db.workroom.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      capsuleId: "WC-ENTRY",
      backlogItemId: "BI-ENTRY",
      status: "ready",
      archivedAt: null,
      repositoryFullName: input.repositoryFullName,
      // Branch, worktree and executor all match the claim exactly.
      headBranch: input.headBranch,
      worktreePath: input.worktreePath,
      executorKind: input.executorKind,
      executorRef: input.executorRef,
      leaseHolderPrincipalId: actor.principalId,
      // The one thing that differs.
      leaseExpiresAt: new Date("2026-08-21T15:00:00.000Z"),
    });

    const result = await claimGovernedBacklogWorkspace({
      db,
      input,
      actor,
      workIntent: "design",
      now: new Date("2026-08-22T00:00:00.000Z"),
      dependencies: { claimWorkspace, declareIntent, discoverCanonicalArtifact },
    });

    expect(result.ok).toBe(false);
    const message = result.ok ? "" : String(result.error);
    expect(message).toContain("lease expired at 2026-08-21T15:00:00.000Z");
    expect(message).toContain("heartbeat_workroom");
    // The whole point: it must not send the caller re-syncing a correct branch.
    expect(message).not.toContain("recorded branch");
    expect(message).not.toContain("adopt_worktree");
  });

  it("names the differing field when the executor ref is foreign", async () => {
    const db = database();
    const claimWorkspace = vi.fn().mockResolvedValue({
      capsuleId: "WC-ENTRY",
      backlogItemId: "BI-ENTRY",
      headBranch: input.headBranch,
      worktreePath: input.worktreePath,
      claimed: true,
      conflict: null,
    });
    const declareIntent = vi.fn().mockResolvedValue({ id: "intent-row" });
    (db.workroom.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      capsuleId: "WC-ENTRY",
      backlogItemId: "BI-ENTRY",
      status: "ready",
      archivedAt: null,
      repositoryFullName: input.repositoryFullName,
      headBranch: input.headBranch,
      worktreePath: input.worktreePath,
      executorKind: input.executorKind,
      executorRef: "foreign-session",
      leaseHolderPrincipalId: actor.principalId,
      leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });

    const result = await claimGovernedBacklogWorkspace({
      db,
      input,
      actor,
      workIntent: "design",
      now: new Date("2026-08-22T00:00:00.000Z"),
      dependencies: { claimWorkspace, declareIntent, discoverCanonicalArtifact },
    });

    expect(result.ok).toBe(false);
    const message = result.ok ? "" : String(result.error);
    expect(message).toContain("executor ref");
    expect(message).toContain("foreign-session");
  });
});
