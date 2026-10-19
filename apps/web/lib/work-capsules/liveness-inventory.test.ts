import { describe, expect, it, vi } from "vitest";

import { loadCapsuleLivenessInventory } from "./liveness-inventory";

describe("loadCapsuleLivenessInventory", () => {
  it("normalizes repeated row-id backlog links in one bounded batch and never emits unresolved raw ids", async () => {
    const now = new Date("2026-10-16T00:00:00Z");
    const rooms = ["backlog-row", "backlog-row", "missing-row"].map((backlogItemId, index) => ({
      capsuleId: `WC-${index}`, backlogItemId, status: "working", updatedAt: now,
      repositoryFullName: "owner/repo", headBranch: "fix/readback", worktreePath: "D:/readback",
      baseSha: "0".repeat(40), headSha: "1".repeat(40), taskRun: null }));
    const findMany = vi.fn().mockResolvedValue([{ id: "backlog-row", itemId: "BI-EXISTING" }]);
    const db = { workroom: { findMany: vi.fn().mockResolvedValue(rooms) }, featureBuild: { findMany: vi.fn() },
      backlogItem: { findMany }, taskRun: { findMany: vi.fn().mockRejectedValue(new Error("review unavailable")) } };
    const result = await loadCapsuleLivenessInventory(db, { where: {}, take: 10 }, now);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({ where: { id: { in: ["backlog-row", "missing-row"] } },
      select: { id: true, itemId: true }, take: 2 });
    for (const row of result.capsulesAll.slice(0, 2)) expect(row.recovery).toMatchObject({ blocker: {
      action: { toolName: "get_backlog_item", args: { itemId: "BI-EXISTING" } } } });
    expect(result.capsulesAll[2].recovery).toMatchObject({ blocker: { action: null } });
  });
  it("batches metadata-linked reviews and uses the same current-source recovery view", async () => {
    const now = new Date("2026-10-16T00:00:00Z");
    const rooms = ["WC-1", "WC-2"].map(capsuleId => ({ capsuleId, status: "working", updatedAt: now,
      repositoryFullName: "owner/repo", headBranch: "fix/readback", worktreePath: "D:/readback",
      baseSha: "0".repeat(40), headSha: "1".repeat(40), taskRun: null }));
    const findMany = vi.fn().mockResolvedValue([{ id: "review-row", taskRunId: "TR-REVIEW", userId: "requester-1",
      status: "working", updatedAt: now, lastHeartbeatAt: now, progressPayload: {}, nodes: [] }]);
    const db = { workroom: { findMany: vi.fn().mockResolvedValue(rooms) }, featureBuild: { findMany: vi.fn() },
      taskRun: { findMany }, $queryRaw: vi.fn().mockResolvedValue([{ rowId: "review-row", capsuleId: "WC-1", requestBound: true, requestSchemaVersion: 2, requestArtifactType: "code-change", identityArtifactType: "code-change", identityArtifactTypePresent: true,
        sourceHeadSha: "1".repeat(40), currentHeadSha: "1".repeat(40), issuedAt: "2026-10-15T23:59:00Z" }]) };
    const result = await loadCapsuleLivenessInventory(db, { where: {}, take: 10 }, now);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 21 }));
    expect(result.capsulesAll[0].recovery).toMatchObject({ state: "working", reviewerExecution: { taskRunId: "TR-REVIEW" } });
    expect(result.capsulesAll[1].recovery).toMatchObject({ state: "actionable", reviewerExecution: null });
  });

  it("does not label an unreadable review source actionable", async () => {
    const now = new Date("2026-10-16T00:00:00Z");
    const db = { workroom: { findMany: vi.fn().mockResolvedValue([{ capsuleId: "WC-1", status: "working", updatedAt: now,
      repositoryFullName: "owner/repo", headBranch: "fix/readback", worktreePath: "D:/readback",
      baseSha: "0".repeat(40), headSha: "1".repeat(40), taskRun: null }]) }, featureBuild: { findMany: vi.fn() },
      taskRun: { findMany: vi.fn().mockRejectedValue(new Error("unavailable")) } };
    const result = await loadCapsuleLivenessInventory(db, { where: {}, take: 10 }, now);
    expect(result.capsulesAll[0].recovery).toMatchObject({ state: "unknown", blocker: { reason: "review-observation-incomplete" } });
  });
  it("uses a bounded portal read without fetching scope or activity history and preserves hold facts", async () => {
    const now = new Date("2026-10-13T00:00:00Z");
    const db = { workroom: { findMany: vi.fn().mockResolvedValue([{
      id: "row-1", capsuleId: "WC-1", status: "working", source: "manual", updatedAt: now,
      taskRun: null, workspaceState: { privateNote: "private", workroomDrive: { action: "pause", reason: "executor_writeback_unavailable" } },
    }]) }, featureBuild: { findMany: vi.fn().mockResolvedValue([]) } };
    const result = await loadCapsuleLivenessInventory(db, { where: {}, take: 200, portalSummary: true }, now);
    expect(db.workroom.findMany).toHaveBeenCalledTimes(1);
    expect(db.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200,
      select: expect.objectContaining({ id: true, scopeClaims: false, outcomeAnchor: false, activities: expect.objectContaining({ take: 1 }) }) }));
    expect(result.capsulesAll[0]).toMatchObject({ id: "row-1", drive: { action: "pause", reason: "executor_writeback_unavailable" } });
    expect(JSON.stringify(result)).not.toContain("privateNote");
  });
  it("batches scheduled targets and strips private workspace state in compact results", async () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const db = {
      workroom: { findMany: vi.fn().mockResolvedValue([{
        capsuleId: "WC-SCHEDULED", status: "working", source: "manual", updatedAt: now,
        executorKind: null, featureBuildId: null, taskRun: null,
        workspaceState: { privateNote: "secret", workroomDrive: { action: "dispatch_agent", taskId: "scheduled-1", stageKey: "read" } },
        activities: [],
      }]) },
      featureBuild: { findMany: vi.fn().mockResolvedValue([]) },
      scheduledAgentTask: { findMany: vi.fn().mockResolvedValue([{ taskId: "scheduled-1", agentId: "customer-advisor" }]) },
    };
    const result = await loadCapsuleLivenessInventory(db, { where: {}, take: 10, compact: true }, now);
    expect(db.scheduledAgentTask.findMany).toHaveBeenCalledTimes(1);
    expect(db.scheduledAgentTask.findMany).toHaveBeenCalledWith({ where: { taskId: { in: ["scheduled-1"] } }, select: { taskId: true, agentId: true } });
    expect(result.capsulesAll[0]!.attribution).toMatchObject({ invocation: "Scheduled · customer-advisor · scheduled-1 · stage read" });
    expect(result.capsulesAll[0]).not.toHaveProperty("workspaceState");
    expect(result.capsulesAll[0]).not.toHaveProperty("activities");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("selects successful history behind a paused snapshot and excludes private activity payloads", async () => {
    const now = new Date("2026-10-02T00:00:00Z");
    const db = {
      workroom: { findMany: vi.fn().mockResolvedValue([{
        capsuleId: "WC-PAUSED", status: "draft", updatedAt: now, featureBuildId: null,
        workspaceState: { workroomDrive: { action: "pause" } },
        activities: [{ kind: "workroom-drive", payload: { action: "dispatch_agent", reason: "agent_stage", agentId: "original-agent", taskId: "task", stageKey: "read", privateNote: "private-history" } }],
      }]) },
      featureBuild: { findMany: vi.fn().mockResolvedValue([]) },
      scheduledAgentTask: { findMany: vi.fn().mockResolvedValue([{ taskId: "task", agentId: "reassigned-agent" }]) },
    };
    const result = await loadCapsuleLivenessInventory(db, { where: {}, take: 10 }, now);
    expect(result.capsulesAll[0]!.attribution).toEqual({ executor: "original-agent", invocation: "Scheduled · original-agent · task · stage read" });
    expect(JSON.stringify(result)).not.toContain("private-history");
    expect(result.capsulesAll[0]).not.toHaveProperty("activities");
    expect(db.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ activities: {
      orderBy: { recordedAt: "desc" }, take: 1,
      where: { OR: [
        { kind: { in: ["concierge-sweep", "embedding-coverage"] } },
        { kind: "workroom-drive", AND: [
          { payload: { path: ["action"], equals: "dispatch_agent" } },
          { payload: { path: ["reason"], equals: "agent_stage" } },
        ] },
      ] },
      select: { kind: true, payload: true },
    } }) }));
  });
  it("loads the linked TaskRun independently and projects a terminal turn over a stale session", async () => {
    const now = new Date("2026-08-24T18:00:00.000Z");
    const db = {
      workroom: { findMany: vi.fn().mockResolvedValue([{
        capsuleId: "WC-TERMINAL-TURN", title: "Terminal turn", status: "working",
        source: "external-adoption", executorKind: "codex-desktop", executorRef: "session-stale",
        leaseHolderPrincipalId: "principal-1", repositoryFullName: "owner/repo",
        decisionScope: null, portfolioRole: null, servedPersona: null, activityKind: null,
        outcomeAnchor: {}, servesPortfolioRoles: [], dependsOnPortfolioRoles: [],
        headBranch: "fix/x", baseSha: "0000000000000000000000000000000000000000",
        headSha: "1111111111111111111111111111111111111111", worktreePath: "D:/x",
        pullRequestUrl: null, pullRequestNumber: null,
        leaseExpiresAt: new Date("2026-08-24T19:00:00.000Z"), lastSyncedAt: null,
        updatedAt: now, featureBuildId: null,
        taskRun: { taskRunId: "TR-TERMINAL", status: "completed", updatedAt: new Date("2026-08-24T17:55:00.000Z") },
      }]) },
      taskRun: { findMany: vi.fn().mockResolvedValue([]) },
      featureBuild: { findMany: vi.fn().mockResolvedValue([]) },
      nonProductionEnvironmentLease: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await loadCapsuleLivenessInventory(db, { where: {}, take: 10 }, now);

    expect(result.capsulesAll[0]).toMatchObject({
      capsuleId: "WC-TERMINAL-TURN",
      liveness: "execution-terminal",
      isReapable: true,
      recovery: {
        state: "terminal",
        prerequisite: null,
        reviewerExecution: {
          taskRunId: "TR-TERMINAL",
          status: "completed",
          pending: false,
        },
      },
    });
    expect(db.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ taskRun: { select: expect.objectContaining({ taskRunId: true, status: true, updatedAt: true, initiatingAgentId: true, currentAgentId: true, parentTaskRunId: true }) } }),
    }));
  });

  it("returns the same exact author repair used by transition recovery", async () => {
    const now = new Date("2026-08-24T18:00:00.000Z");
    const db = {
      workroom: { findMany: vi.fn().mockResolvedValue([{
        capsuleId: "WC-MISSING-BASE", title: "Missing base", status: "ready",
        source: "external-adoption", executorKind: "codex-desktop", executorRef: "session",
        leaseHolderPrincipalId: "principal-1", repositoryFullName: "owner/repo",
        decisionScope: null, portfolioRole: null, servedPersona: null, activityKind: null,
        outcomeAnchor: {}, servesPortfolioRoles: [], dependsOnPortfolioRoles: [],
        baseSha: null, headSha: "1111111111111111111111111111111111111111",
        headBranch: "fix/x", worktreePath: "D:/x", pullRequestUrl: null, pullRequestNumber: null,
        leaseExpiresAt: new Date("2026-08-24T19:00:00.000Z"), lastSyncedAt: null,
        updatedAt: now, featureBuildId: null, taskRun: null,
      }]) },
      featureBuild: { findMany: vi.fn().mockResolvedValue([]) },
      nonProductionEnvironmentLease: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await loadCapsuleLivenessInventory(db, { where: {}, take: 10 }, now);

    expect(result.capsulesAll[0]).toMatchObject({
      recovery: {
        state: "blocked",
        reviewerExecution: null,
        prerequisite: {
          accountableRole: "artifact-resolver",
          missingFields: ["baseSha"],
          retainedFields: { headSha: "1111111111111111111111111111111111111111" },
          repair: {
            toolName: "adopt_worktree",
            packet: {
              repositoryFullName: "owner/repo",
              headBranch: "fix/x",
              worktreePath: "D:/x",
              headSha: "1111111111111111111111111111111111111111",
            },
          },
        },
      },
    });
  });

  it("keeps stored, live, reapable, and history counts distinct", async () => {
    const now = new Date("2026-08-24T18:00:00.000Z");
    const base = {
      title: "Room", source: "external-adoption", executorKind: "codex-desktop",
      decisionScope: null, portfolioRole: null, servedPersona: null, activityKind: null,
      outcomeAnchor: {}, servesPortfolioRoles: [], dependsOnPortfolioRoles: [], headBranch: "feat/x",
      worktreePath: "D:/x", pullRequestUrl: null, pullRequestNumber: null, lastSyncedAt: null,
      updatedAt: now, featureBuildId: null,
    };
    const db = {
      workroom: { findMany: vi.fn().mockResolvedValue([
        { ...base, capsuleId: "WC-LIVE", status: "working", leaseExpiresAt: new Date("2026-08-24T19:00:00.000Z") },
        { ...base, capsuleId: "WC-EXPIRED", status: "working", leaseExpiresAt: new Date("2026-08-22T17:00:00.000Z") }, // ~2 days ago — past the 24h resume grace
        { ...base, capsuleId: "WC-DONE", status: "complete", leaseExpiresAt: null },
      ]) },
      featureBuild: { findMany: vi.fn().mockResolvedValue([]) },
      nonProductionEnvironmentLease: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await loadCapsuleLivenessInventory(db, { where: {}, take: 100 }, now);

    expect(result.livenessSummary).toEqual({
      scanned: 3,
      // WC-LIVE holds a valid lease with lastSyncedAt null, so it is HELD but
      // not demonstrably working — live counts it, working does not
      // (BI-7271460C).
      live: 1,
      working: 0,
      history: 2,
      reapable: 1,
      byLiveness: { "leased-idle": 1, "lease-expired": 1, terminal: 1 },
      heavyLane: { executing: 0, nextReady: 0, dormant: 0 },
      progressSlo: { oldestWaitMs: null, maxNoTransitionMs: null },
    });
  });

  it("projects exact durable waits into liveness, lane state, and progress SLOs", async () => {
    const now = new Date("2026-08-24T18:00:00.000Z");
    const db = {
      workroom: { findMany: vi.fn().mockResolvedValue([{
        capsuleId: "WC-WAIT", title: "Waiting", status: "working", source: "external-adoption",
        executorKind: "codex-desktop", decisionScope: null, portfolioRole: null, servedPersona: null,
        activityKind: null, outcomeAnchor: {}, servesPortfolioRoles: [], dependsOnPortfolioRoles: [],
        headBranch: "fix/wait", worktreePath: "D:/wait", pullRequestUrl: null, pullRequestNumber: null,
        leaseExpiresAt: new Date("2026-08-24T17:00:00.000Z"), lastSyncedAt: null,
        updatedAt: new Date("2026-08-24T16:00:00.000Z"), featureBuildId: null,
      }]) },
      featureBuild: { findMany: vi.fn().mockResolvedValue([]) },
      nonProductionEnvironmentLease: { findMany: vi.fn().mockResolvedValue([
        { leaseId: "NPEL-A", environmentKey: "local-integration-ci", status: "queued", worktreePath: "D:/wait", branchName: "fix/wait", queuedAt: new Date("2026-08-24T17:00:00.000Z"), admittedAt: null, heartbeatAt: null, updatedAt: new Date("2026-08-24T17:00:00.000Z") },
        { leaseId: "NPEL-B", environmentKey: "local-integration-ci", status: "queued", worktreePath: "D:/other", branchName: "fix/other", queuedAt: new Date("2026-08-24T17:30:00.000Z"), admittedAt: null, heartbeatAt: null, updatedAt: new Date("2026-08-24T17:30:00.000Z") },
      ]) },
    };

    const result = await loadCapsuleLivenessInventory(db, { where: {}, take: 100 }, now);

    expect(result.capsulesAll[0]).toMatchObject({ liveness: "durable-wait", isLive: true, isReapable: false });
    expect(result.livenessSummary.heavyLane).toEqual({ executing: 0, nextReady: 1, dormant: 1 });
    expect(result.livenessSummary.progressSlo).toEqual({ oldestWaitMs: 3_600_000, maxNoTransitionMs: 3_600_000 });
  });

  it("reads a room's PR follow-through from its workspace state: red and waiting on a person is stalled (BI-88341B5D)", async () => {
    const now = new Date("2026-10-06T18:00:00.000Z");
    const db = {
      workroom: { findMany: vi.fn().mockResolvedValue([{
        capsuleId: "WC-RED", title: "Red PR", status: "working", source: "external-adoption",
        executorKind: "codex-desktop", decisionScope: null, portfolioRole: null, servedPersona: null,
        activityKind: null, outcomeAnchor: {}, servesPortfolioRoles: [], dependsOnPortfolioRoles: [],
        headBranch: "feat/red", worktreePath: "D:/red", pullRequestUrl: "https://github.com/o/r/pull/9", pullRequestNumber: 9,
        leaseExpiresAt: new Date("2026-10-04T17:00:00.000Z"), lastSyncedAt: null,
        updatedAt: new Date("2026-10-06T17:55:00.000Z"), featureBuildId: null,
        workspaceState: { prDelivery: {
          schemaVersion: 1, status: "checking", repository: "o/r", prNumber: 9, prUrl: "https://github.com/o/r/pull/9",
          lastObservedAt: "2026-10-06T17:55:00.000Z",
          followThrough: { hold: "awaiting-person" },
        } },
      }]) },
      featureBuild: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await loadCapsuleLivenessInventory(db, { where: {}, take: 100 }, now);

    expect(result.capsulesAll[0]).toMatchObject({ liveness: "stalled", isLive: true, isReapable: false });
    expect(result.capsulesAll[0]).not.toHaveProperty("workspaceState");
  });
});
