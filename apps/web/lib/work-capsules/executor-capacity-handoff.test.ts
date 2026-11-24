import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedEffect } from "@/lib/workroom-runtime/workroom-effect-store";
import { assertPlanLimitHandoffCurrent, recordPlanLimitHandoff } from "./executor-capacity-handoff.server";

const { db, access, recordNote, assess, execute, receipt } = vi.hoisted(() => ({
  db: { workroom: { findUnique: vi.fn() }, providerCapacityStatus: { findMany: vi.fn() },
    aiProviderConnection: { findMany: vi.fn(), findUnique: vi.fn() } },
  access: vi.fn(), recordNote: vi.fn(), assess: vi.fn(), execute: vi.fn(), receipt: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: access }));
vi.mock("./workroom-lease", () => ({ recordExecutorCapacityNote: recordNote }));
vi.mock("./bounded-handoff-tool", () => ({ prepareBoundedHandoff: vi.fn() }));
vi.mock("./bounded-handoff", async importOriginal => ({
  ...await importOriginal<typeof import("./bounded-handoff")>(),
  assessBoundedHandoff: assess, executeBoundedHandoff: execute,
}));
vi.mock("./receipted-tool", () => ({
  commandDb: () => db,
  receiptedWorkroomTool: (kind: string, handler: (params: unknown) => unknown) =>
    (params: unknown, userId: string, context: unknown) => {
      receipt(kind, params, userId, context);
      return handler(params);
    },
}));

const now = new Date("2026-11-13T19:30:00.000Z");
const observedAt = now.toISOString();
const resetAt = "2026-11-17T03:54:00.000Z";
const workspaceState = {
  executorCheckpoint: { nextAction: "Run the gate", capacity: { provider: "codex", resetAt, recordedAt: observedAt } },
  runtimeSession: { provider: "codex", tokenId: "tok", generation: "gen", lastHeartbeatAt: observedAt,
    actor: { userId: "user", principalId: "owner" } },
};
const room = {
  id: "room", capsuleId: "WC-1", status: "ready", executorKind: "codex-desktop", executorRef: "codex-thread",
  leaseHolderPrincipalId: "owner", leaseExpiresAt: new Date("2026-11-13T20:00:00.000Z"),
  lastSyncedAt: null, workspaceState, repositoryFullName: null, headSha: null, headBranch: null, featureBuildId: null,
  objective: "Deliver the change",
};
const effect: ClaimedEffect = {
  id: "effect-1", commandKey: "turn-event", kind: "record-plan-limit", attemptCount: 1, maxAttempts: 3,
  workCapsuleId: "room", capsuleId: "WC-1", processBound: false, sessionGeneration: null,
  payload: { provider: "codex", error: "You've hit your usage limit.", observedAt, generation: "gen" },
};

beforeEach(() => {
  vi.resetAllMocks();
  db.workroom.findUnique.mockResolvedValue(room);
  db.providerCapacityStatus.findMany.mockResolvedValue([]);
  db.aiProviderConnection.findMany.mockResolvedValue([]);
  db.aiProviderConnection.findUnique.mockResolvedValue(null);
  access.mockResolvedValue({ decision: { level: "action" }, authorityContext: {
    humanPrincipal: { id: "owner" }, agentPrincipal: { id: "source-agent" },
  } });
  execute.mockResolvedValue({ success: true, data: { handoff: { requestId: "handoff-1", state: "pending-acknowledgement" } } });
});

describe("plan-limit handoff", () => {
  it("submits the same receipted request key on retry and prefers the owner's eligible connection", async () => {
    db.aiProviderConnection.findMany.mockResolvedValue([{ providerId: "anthropic-sub", connectionId: "claude-account",
      executionChannel: "subscription-cli", authMethod: "oauth", capacityStatus: null, quotaStatus: null, ownedHealth: null }]);
    await expect(recordPlanLimitHandoff(effect, now)).resolves.toMatchObject({ handoff: { state: "pending-acknowledgement" } });
    await recordPlanLimitHandoff({ ...effect, attemptCount: 2 }, now);
    expect(db.aiProviderConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      organization: { topAccountablePrincipalId: "owner" },
    }) }));
    expect(receipt.mock.calls).toHaveLength(2);
    expect(receipt.mock.calls[0]).toEqual(receipt.mock.calls[1]);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ command: expect.objectContaining({
      phase: "request", commandId: "plan-limit:effect-1", targetAgentId: "AGT-EXT-CLAUDE", toExecutorRef: "claude-account",
      handoffManifest: expect.objectContaining({ connectionId: "claude-account", nextAction: "Run the gate" }),
    }) }));
  });

  it("uses the bare executor alternative for a heartbeat and refuses acknowledgement after early recovery", async () => {
    await recordPlanLimitHandoff({ ...effect, payload: { checkpoint: { provider: "codex", resetAt }, userId: "user",
      principalId: "owner", agentId: "AGT-EXT-CODEX", observedAt } }, now);
    const command = execute.mock.calls[0][0].command;
    expect(command).toMatchObject({ phase: "request", toExecutorKind: "claude-desktop", toExecutorRef: "claude-desktop" });
    expect(recordNote).not.toHaveBeenCalled();
    const later = new Date(now.getTime() + 1000);
    db.providerCapacityStatus.findMany.mockResolvedValue([{ providerId: "codex", state: "available", lastObservedAt: later,
      lastSuccessAt: later, retryAt: null }]);
    await expect(assertPlanLimitHandoffCurrent(db as never, room, command, "owner", later)).rejects.toMatchObject({
      code: "handoff-plan-limit-cleared",
    });
  });

  it("skips effects superseded by activity or a new runtime generation", async () => {
    db.workroom.findUnique.mockResolvedValueOnce({ ...room, lastSyncedAt: new Date(now.getTime() + 1000) })
      .mockResolvedValueOnce({ ...room, workspaceState: { ...workspaceState, runtimeSession: { ...workspaceState.runtimeSession, generation: "next" } } });
    await expect(recordPlanLimitHandoff(effect, now)).resolves.toEqual({});
    await expect(recordPlanLimitHandoff(effect, now)).resolves.toEqual({});
    expect(execute).not.toHaveBeenCalled();
  });

  it("arms a wait at the observed reset without renewing and offers immediately", async () => {
    recordNote.mockResolvedValue(room);
    const limited = { ...effect, payload: { ...effect.payload, error: "Usage limit. Try again at Nov 17, 2026 3:54 AM" } };
    await expect(recordPlanLimitHandoff(limited, now)).resolves.toMatchObject({ resetAt, summary: expect.stringContaining("expected back by") });
    expect(recordNote).toHaveBeenCalledWith(expect.objectContaining({
      capsuleId: "WC-1", capacity: { provider: "codex", resetAt }, now,
    }));
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
