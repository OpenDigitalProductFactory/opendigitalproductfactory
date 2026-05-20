import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  taskRun: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  agentThread: {
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  agentMessage: {
    create: vi.fn(),
  },
  backlogItem: {
    findUnique: vi.fn(),
  },
  backlogItemActivity: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: prismaMocks,
}));

vi.mock("@/lib/tak/task-records", () => ({
  createTaskArtifact: vi.fn(),
}));

vi.mock("@/lib/work-capsules/work-capsule-store", () => ({
  recordWorkCapsuleEvidence: vi.fn(),
}));

vi.mock("@/lib/actions/agent-thread-dispatcher", () => ({
  dispatchAgentThread: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { createTaskArtifact } from "@/lib/tak/task-records";
import { recordWorkCapsuleEvidence } from "@/lib/work-capsules/work-capsule-store";
import { dispatchAgentThread } from "@/lib/actions/agent-thread-dispatcher";
import { prisma } from "@dpf/db";
import { invokePortalContextHiveCandidate } from "./portal-context-hive";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockCreateTaskArtifact = createTaskArtifact as ReturnType<typeof vi.fn>;
const mockRecordWorkCapsuleEvidence = recordWorkCapsuleEvidence as ReturnType<typeof vi.fn>;
const mockDispatchAgentThread = dispatchAgentThread as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as unknown as typeof prismaMocks;

describe("invokePortalContextHiveCandidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: {
        id: "user-1",
        platformRole: "HR-000",
        isSuperuser: true,
      },
    });
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof prismaMocks) => Promise<unknown>) => fn(mockPrisma));
    mockPrisma.taskRun.findUnique.mockResolvedValue({
      id: "parent-row-1",
      taskRunId: "TR-PARENT",
      userId: "user-1",
      threadId: "thread-parent",
      contextId: "ctx-build-1",
      buildId: "FB-1",
      routeContext: "/build",
    });
    mockPrisma.agentThread.create.mockResolvedValue({ id: "thread-child" });
    mockPrisma.agentThread.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.agentMessage.create.mockResolvedValue({ id: "message-1" });
    mockPrisma.taskRun.create.mockResolvedValue({
      id: "child-row-1",
      taskRunId: "TR-HIVE-NEW",
      threadId: "thread-child",
    });
    mockPrisma.taskRun.update.mockResolvedValue({});
    mockPrisma.backlogItem.findUnique.mockResolvedValue({ id: "backlog-row-1" });
    mockPrisma.backlogItemActivity.create.mockResolvedValue({ id: "backlog-activity-1" });
    mockCreateTaskArtifact.mockResolvedValue({ id: "artifact-row-1", artifactId: "ta_123" });
    mockRecordWorkCapsuleEvidence.mockResolvedValue({ id: "activity-1" });
    mockDispatchAgentThread.mockResolvedValue(undefined);
  });

  it("reuses an existing non-terminal child TaskRun for the same parent, context, and hive role", async () => {
    mockPrisma.taskRun.findFirst.mockResolvedValue({
      id: "child-row-existing",
      taskRunId: "TR-HIVE-EXISTING",
      threadId: "thread-existing",
      status: "working",
    });

    const result = await invokePortalContextHiveCandidate(makeInput());

    expect(result).toEqual({
      ok: true,
      reused: true,
      taskRunId: "TR-HIVE-EXISTING",
      threadId: "thread-existing",
    });
    expect(mockPrisma.taskRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          parentTaskRunId: "TR-PARENT",
          contextId: "ctx-build-1",
          status: expect.objectContaining({
            notIn: expect.arrayContaining(["completed", "failed", "cancelled", "canceled"]),
          }),
          a2aMetadata: {
            path: ["hiveMindRole"],
            equals: "architect",
          },
        }),
      }),
    );
    expect(mockPrisma.taskRun.create).not.toHaveBeenCalled();
    expect(mockCreateTaskArtifact).not.toHaveBeenCalled();
  });

  it("creates a child TaskRun with hive metadata, request artifact, evidence, and dispatch when none exists", async () => {
    mockPrisma.taskRun.findFirst.mockResolvedValue(null);

    const result = await invokePortalContextHiveCandidate(makeInput());

    expect(result).toEqual({
      ok: true,
      reused: false,
      taskRunId: "TR-HIVE-NEW",
      threadId: "thread-child",
    });
    expect(mockPrisma.taskRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          threadId: "thread-child",
          contextId: "ctx-build-1",
          buildId: "FB-1",
          parentTaskRunId: "TR-PARENT",
          initiatingAgentId: "AGT-ARCH",
          currentAgentId: "AGT-ARCH",
          routeContext: "/build",
          source: "coworker",
          status: "submitted",
          a2aMetadata: expect.objectContaining({
            trigger: "portal-context-hive",
            hiveMindContextId: "hive:TR-PARENT:ctx-build-1:architect",
            hiveMindRole: "architect",
            buildId: "FB-1",
            capsuleId: "WC-1",
            backlogItemId: "BI-1",
            epicId: "EP-1",
          }),
        }),
        select: { id: true, taskRunId: true, threadId: true },
      }),
    );
    expect(mockCreateTaskArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        taskRunId: "TR-HIVE-NEW",
        taskRunRecordId: "child-row-1",
        artifactType: "hive_invocation_request",
        name: "Portal context hive invocation",
      }),
    );
    expect(mockRecordWorkCapsuleEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        capsuleId: "WC-1",
        evidence: expect.objectContaining({
          kind: "note",
          summary: "Architect Review asked to review the current portal context.",
        }),
      }),
    );
    expect(mockPrisma.backlogItemActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          backlogItemId: "backlog-row-1",
          kind: "portal-context-hive-invoked",
          summary: "Architect Review asked to review the current portal context.",
          recordedById: "user-1",
          recordedByAgentId: "AGT-ARCH",
        }),
      }),
    );
    expect(mockDispatchAgentThread).toHaveBeenCalledWith("thread-child", "user-1");
  });
});

function makeInput() {
  return {
    parentTaskRunId: "TR-PARENT",
    contextId: "ctx-build-1",
    routeContext: "/build",
    envelopeId: "env-1",
    candidate: {
      agentId: "AGT-ARCH",
      label: "Architect Review",
      role: "architect" as const,
      reason: "Matches current build context.",
      taskType: "analysis" as const,
    },
    anchors: {
      buildId: "FB-1",
      capsuleId: "WC-1",
      backlogItemId: "BI-1",
      epicId: "EP-1",
    },
  };
}
