import { describe, expect, it, vi } from "vitest";

// Keep the envelope hermetic: the queue-attention resolver reads QueueMetricSnapshot
// via the live client; stub it so this suite never touches an ambient DB.
vi.mock("./queue-awareness-resolver", () => ({
  resolveQueueAttention: vi.fn().mockResolvedValue([]),
}));

// BI-AE6AFE3D: loadBuildStudioCapability hits live Prisma (modelProfile /
// modelProvider / buildEngine). When a sub-resolver soft-timeouts, the
// cancelled-but-still-running promise can emit prisma:error console output
// *after* the test returns → EnvironmentTeardownError
// "Closing rpc while onUserConsoleLog was pending". Stub the capability
// loader so this suite never opens a real DB connection.
vi.mock("@/lib/build/build-studio-capability", () => ({
  loadBuildStudioCapability: vi.fn().mockResolvedValue({
    ok: true,
    satisfyingProviderNames: ["test-provider"],
  }),
}));

import {
  bucketPortalContextTimestamp,
  createPortalContextEnvelopeId,
  portalContextCacheTags,
} from "./cache";
import { resolvePortalContextEnvelopeUncached } from "./index";
import type { PortalContextInput } from "./types";

describe("portal context cache helpers", () => {
  it("buckets timestamps to 30 second windows", () => {
    const bucket = bucketPortalContextTimestamp(new Date("2026-05-17T18:23:41.123Z"));

    expect(bucket.toISOString()).toBe("2026-05-17T18:23:30.000Z");
  });

  it("creates deterministic envelope IDs from route object anchors and user", () => {
    const input: PortalContextInput = {
      pathname: "/build",
      routeContext: "/build",
      buildId: "FB-123",
      capsuleId: "WC-456",
      threadId: "thread-789",
    };
    const bucket = new Date("2026-05-17T18:23:30.000Z");

    expect(createPortalContextEnvelopeId(input, "user-1", bucket)).toBe(
      createPortalContextEnvelopeId(input, "user-1", bucket),
    );
    expect(createPortalContextEnvelopeId(input, "user-2", bucket)).not.toBe(
      createPortalContextEnvelopeId(input, "user-1", bucket),
    );
  });

  it("returns broad and entity cache tags without empty tag entries", () => {
    const tags = portalContextCacheTags(
      { pathname: "/build", routeContext: "/build", buildId: "FB-123", capsuleId: null },
      "user-1",
    );

    expect(tags).toEqual(["portal-context", "portal-context:user:user-1", "portal-context:build:FB-123"]);
  });

  it("returns entity-specific tags for every anchored work object", () => {
    const tags = portalContextCacheTags(
      {
        pathname: "/build/work/WC-123",
        routeContext: "/build/work",
        buildId: "FB-123",
        capsuleId: "WC-123",
        threadId: "thread-789",
      },
      "user-1",
    );

    expect(tags).toEqual([
      "portal-context",
      "portal-context:user:user-1",
      "portal-context:build:FB-123",
      "portal-context:capsule:WC-123",
      "portal-context:thread:thread-789",
    ]);
  });
});

describe("resolvePortalContextEnvelopeUncached", () => {
  it("resolves /build without buildId as route-only context with no_active_build signal", async () => {
    const envelope = await resolvePortalContextEnvelopeUncached(
      { pathname: "/build", routeContext: "/build" },
      "user-1",
      {
        now: () => new Date("2026-05-17T18:23:41.123Z"),
        db: createDbMock(),
        getRouteDataContext: vi.fn().mockResolvedValue("Build route summary"),
      },
    );

    expect(envelope.route.routeContext).toBe("/build");
    expect(envelope.route.domain).toBe("Build Studio");
    expect(envelope.work.featureBuild).toBeNull();
    expect(envelope.work.capsule).toBeNull();
    expect(envelope.attention).toContainEqual(
      expect.objectContaining({
        kind: "no_active_build",
        severity: "info",
      }),
    );
    expect(envelope.promptDigest).toContain("Route: /build");
    expect(envelope.promptDigest).toContain("Attention: no_active_build(info)");
  });

  it("resolves explicit buildId through landed Workroom.featureBuildId linkage", async () => {
    const db = createDbMock({
      featureBuild: {
        id: "build-row-1",
        buildId: "FB-123",
        title: "Build the thing",
        phase: "implement",
        status: "working",
        threadId: "thread-1",
        acceptanceMet: null,
        verificationOut: { tests: "pending" },
      },
      capsule: {
        id: "capsule-row-1",
        capsuleId: "WC-123",
        title: "Build capsule",
        status: "working",
        executorKind: "build-studio",
        leaseExpiresAt: new Date("2026-05-17T19:00:00.000Z"),
        scopeClaims: ["apps/web/lib/portal-context"],
        headBranch: "feat/portal-context-overlay-hive-mind",
        headSha: "abc123",
        worktreePath: "D:/DPF/.worktrees/portal-context-overlay-hive-mind",
        backlogItemId: "backlog-row-1",
        epicId: "epic-row-1",
        taskRunId: "task-row-1",
      },
      backlogItem: {
        id: "backlog-row-1",
        itemId: "BI-D52D4E25",
        title: "Portal context overlay implementation",
        status: "in-progress",
        epicId: "epic-row-1",
      },
      epic: {
        id: "epic-row-1",
        epicId: "EP-CAPSULE",
        title: "Work Capsules",
        status: "in-progress",
      },
      taskRun: {
        id: "task-row-1",
        taskRunId: "TR-123",
        contextId: "ctx-123",
        status: "working",
        authorityScope: { mode: "proposal" },
        parentTaskRunId: null,
      },
      agentThread: {
        id: "thread-1",
        contextKey: "coworker:/build",
      },
    });

    const envelope = await resolvePortalContextEnvelopeUncached(
      { pathname: "/build", routeContext: "/build", buildId: "FB-123" },
      "user-1",
      {
        now: () => new Date("2026-05-17T18:23:41.123Z"),
        db,
        getRouteDataContext: vi.fn().mockResolvedValue(null),
      },
    );

    expect(envelope.work.featureBuild?.buildId).toBe("FB-123");
    expect(envelope.work.capsule?.capsuleId).toBe("WC-123");
    expect(envelope.work.backlogItem?.backlogItemId).toBe("BI-D52D4E25");
    expect(envelope.work.epic?.epicId).toBe("EP-CAPSULE");
    expect(envelope.work.taskRun?.taskRunId).toBe("TR-123");
    expect(envelope.authority.proposalModeActive).toBe(true);
    expect(db.workroom.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { featureBuildId: "build-row-1" },
      }),
    );
  });

  it("lets the capsule executor principal act on the active capsule without broad platform role", async () => {
    const db = createDbMock({
      user: {
        id: "user-1",
        isSuperuser: false,
        groups: [],
      },
      principalAlias: {
        principal: { principalId: "principal-1" },
      },
      capsule: {
        id: "capsule-row-1",
        capsuleId: "WC-123",
        title: "Owned capsule",
        status: "working",
        executorKind: "codex",
        executorRef: "principal-1",
        leaseHolderPrincipalId: "principal-1",
        leaseExpiresAt: new Date("2026-05-17T19:00:00.000Z"),
        scopeClaims: [
          {
            kind: "path",
            value: "apps/web/lib/portal-context",
            intent: "edit",
            recordedAt: "2026-05-17T18:00:00.000Z",
            recordedByPrincipalId: "principal-1",
          },
        ],
      },
    });

    const envelope = await resolvePortalContextEnvelopeUncached(
      { pathname: "/build/work/WC-123", routeContext: "/build/work", capsuleId: "WC-123" },
      "user-1",
      {
        now: () => new Date("2026-05-17T18:23:41.123Z"),
        db,
        getRouteDataContext: vi.fn().mockResolvedValue(null),
      },
    );

    expect(envelope.work.capsule?.capsuleId).toBe("WC-123");
    expect(envelope.authority.canActOnCapsule).toBe(true);
  });

  it("keeps proposal mode inactive for an anchored build when the current task is not in proposal mode", async () => {
    const db = createDbMock({
      featureBuild: {
        id: "build-row-1",
        buildId: "FB-123",
        title: "Build the thing",
        phase: "build",
        status: "working",
        threadId: "thread-1",
      },
      capsule: {
        id: "capsule-row-1",
        capsuleId: "WC-123",
        title: "Build capsule",
        status: "working",
        executorKind: "build-studio",
        leaseExpiresAt: new Date("2026-05-17T19:00:00.000Z"),
        featureBuildId: "build-row-1",
        taskRunId: "task-row-1",
      },
      taskRun: {
        id: "task-row-1",
        taskRunId: "TR-123",
        contextId: "ctx-123",
        status: "working",
        authorityScope: { mode: "execute" },
        parentTaskRunId: null,
      },
      agentThread: {
        id: "thread-1",
        contextKey: "coworker:/build",
      },
    });

    const envelope = await resolvePortalContextEnvelopeUncached(
      { pathname: "/build", routeContext: "/build", buildId: "FB-123" },
      "user-1",
      {
        now: () => new Date("2026-05-17T18:23:41.123Z"),
        db,
        getRouteDataContext: vi.fn().mockResolvedValue(null),
      },
    );

    expect(envelope.authority.proposalModeActive).toBe(false);
  });

  it("emits build_stalled for a build-phase FeatureBuild with no recent activity", async () => {
    const db = createDbMock({
      featureBuild: {
        id: "build-row-1",
        buildId: "FB-STALE",
        title: "Stale build",
        phase: "build",
        status: "working",
        updatedAt: new Date("2026-05-17T17:40:00.000Z"),
      },
    });

    const envelope = await resolvePortalContextEnvelopeUncached(
      { pathname: "/build", routeContext: "/build", buildId: "FB-STALE" },
      "user-1",
      {
        now: () => new Date("2026-05-17T18:23:41.123Z"),
        db,
        getRouteDataContext: vi.fn().mockResolvedValue(null),
      },
    );

    expect(envelope.attention).toContainEqual(
      expect.objectContaining({
        kind: "build_stalled",
        severity: "warning",
      }),
    );
  });

  it("uses the agent registry for hive-mind recommendations", async () => {
    const db = createDbMock({
      agents: [
        {
          agentId: "AGT-CONTEXT-ARCH",
          name: "Context Architect",
          description: "Anchors Build Studio work to capsules and backlog context.",
          valueStream: "integrate",
          role: "architect",
          skills: [
            {
              label: "Anchor work context",
              description: "Connect route context, Build Studio, Work Capsules, and backlog anchors.",
              capability: "view_platform",
              taskType: "analysis",
            },
          ],
          toolGrants: [{ grantKey: "view_platform" }],
        },
      ],
    });

    const envelope = await resolvePortalContextEnvelopeUncached(
      { pathname: "/build", routeContext: "/build" },
      "user-1",
      {
        now: () => new Date("2026-05-17T18:23:41.123Z"),
        db,
        getRouteDataContext: vi.fn().mockResolvedValue(null),
      },
    );

    expect(db.agent.findMany).toHaveBeenCalled();
    expect(envelope.coworkers.map((candidate) => candidate.agentId)).toContain("AGT-CONTEXT-ARCH");
    expect(envelope.coworkers.map((candidate) => candidate.agentId)).not.toContain("work-context-architect");
  });

  it("returns a partial envelope with source_unavailable when a sub-resolver fails", async () => {
    const db = createDbMock({
      featureBuild: {
        id: "build-row-1",
        buildId: "FB-123",
        title: "Build with offline capsule source",
        phase: "implement",
        status: "working",
      },
    });
    db.workroom.findFirst.mockRejectedValueOnce(new Error("capsule source offline"));

    const envelope = await resolvePortalContextEnvelopeUncached(
      { pathname: "/build", routeContext: "/build", buildId: "FB-123" },
      "user-1",
      {
        now: () => new Date("2026-05-17T18:23:41.123Z"),
        db,
        getRouteDataContext: vi.fn().mockResolvedValue(null),
      },
    );

    expect(envelope.route.routeContext).toBe("/build");
    expect(envelope.work.featureBuild).toBeNull();
    expect(envelope.attention).toContainEqual(
      expect.objectContaining({
        kind: "source_unavailable",
        severity: "warning",
      }),
    );
    expect(envelope.promptDigest).toContain("Attention: source_unavailable(warning)");
  });

  it("returns a partial envelope with envelope_timeout when a sub-resolver exceeds the soft timeout", async () => {
    const db = createDbMock();
    db.featureBuild.findUnique.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(null), 50)),
    );

    const envelope = await resolvePortalContextEnvelopeUncached(
      { pathname: "/build", routeContext: "/build", buildId: "FB-SLOW" },
      "user-1",
      {
        now: () => new Date("2026-05-17T18:23:41.123Z"),
        db,
        getRouteDataContext: vi.fn().mockResolvedValue(null),
        resolverTimeoutMs: 5,
      },
    );

    expect(envelope.route.routeContext).toBe("/build");
    expect(envelope.attention).toContainEqual(
      expect.objectContaining({
        kind: "envelope_timeout",
        severity: "warning",
      }),
    );
    expect(envelope.attention).toContainEqual(
      expect.objectContaining({
        kind: "source_unavailable",
        severity: "warning",
      }),
    );
  });
});

function createDbMock(overrides: {
  user?: Record<string, unknown> | null;
  principalAlias?: Record<string, unknown> | null;
  featureBuild?: Record<string, unknown> | null;
  capsule?: Record<string, unknown> | null;
  backlogItem?: Record<string, unknown> | null;
  epic?: Record<string, unknown> | null;
  taskRun?: Record<string, unknown> | null;
  agentThread?: Record<string, unknown> | null;
  agents?: Array<Record<string, unknown>>;
} = {}) {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(overrides.user ?? {
        id: "user-1",
        isSuperuser: true,
        groups: [{ platformRole: { roleId: "HR-000" } }],
      }),
    },
    principalAlias: {
      findFirst: vi.fn().mockResolvedValue(overrides.principalAlias ?? {
        principal: { principalId: "principal-1" },
      }),
    },
    organization: {
      findFirst: vi.fn().mockResolvedValue({
        id: "org-row-1",
        orgId: "ORG-1",
        name: "Digital Product Factory",
        storefrontConfig: { archetypeId: "software-platform-operator" },
      }),
    },
    featureBuild: {
      findUnique: vi.fn().mockResolvedValue(overrides.featureBuild ?? null),
    },
    workroom: {
      findUnique: vi.fn().mockResolvedValue(overrides.capsule ?? null),
      findFirst: vi.fn().mockResolvedValue(overrides.capsule ?? null),
    },
    backlogItem: {
      findUnique: vi.fn().mockResolvedValue(overrides.backlogItem ?? null),
    },
    epic: {
      findUnique: vi.fn().mockResolvedValue(overrides.epic ?? null),
    },
    taskRun: {
      findUnique: vi.fn().mockResolvedValue(overrides.taskRun ?? null),
      findFirst: vi.fn().mockResolvedValue(overrides.taskRun ?? null),
    },
    agentThread: {
      findUnique: vi.fn().mockResolvedValue(overrides.agentThread ?? null),
    },
    agent: {
      findMany: vi.fn().mockResolvedValue(overrides.agents ?? []),
    },
    workroomActivity: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    backlogItemActivity: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    toolExecutionReceipt: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    taskArtifact: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    externalEvidenceRecord: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}
