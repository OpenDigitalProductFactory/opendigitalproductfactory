import { describe, expect, it, vi } from "vitest";

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

  it("resolves explicit buildId through landed WorkCapsule.featureBuildId linkage", async () => {
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
    expect(db.workCapsule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { featureBuildId: "build-row-1" },
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
});

function createDbMock(overrides: {
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
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        isSuperuser: true,
        groups: [{ platformRole: { roleId: "HR-000" } }],
      }),
    },
    principalAlias: {
      findFirst: vi.fn().mockResolvedValue({
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
    workCapsule: {
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
    workCapsuleActivity: {
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
