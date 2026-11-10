import { beforeEach, describe, expect, it, vi } from "vitest";

const { release, heartbeat, readDecision, receipts, tx } = vi.hoisted(() => {
  const receipts = new Map<string, Record<string, unknown>>();
  const tx = { $queryRaw: async () => [{ id: "row-a" }], $executeRaw: async () => 0,
    workroomActivity: {
      findFirst: async ({ where }: { where: { commandKey: string } }) => receipts.get(where.commandKey) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { receipts.set(data.commandKey as string, { kind: data.kind, payload: data.payload }); return data; },
    } };
  return { release: vi.fn(), heartbeat: vi.fn(), readDecision: vi.fn(), receipts, tx };
});
vi.mock("@dpf/db", () => ({ prisma: { ...tx, $transaction: async (fn: (db: unknown) => Promise<unknown>) => fn(tx), authorizationDecisionLog: { findUnique: readDecision } } }));
vi.mock("./handler-actor", () => ({ workCapsuleActor: vi.fn(async () => ({
  userId: "user-a", agentId: "agent-a", principalId: "principal-a",
})) }));
vi.mock("./work-capsule-store", async (original) => ({
  ...await original<typeof import("./work-capsule-store")>(),
  releaseWorkCapsuleScope: release, heartbeatWorkCapsule: heartbeat,
}));

import { workCapsulesPack } from "@/lib/mcp/packs/work-capsules-pack";
import { releaseCapsuleScopeTool } from "./mcp-handlers";
import { OWN_SCOPE_RELEASE_REASON } from "./scope-release-authorization";

const claims = [{ kind: "path", value: "file.ts", intent: "edit", recordedByPrincipalId: "principal-a", releaseEpoch: "00000000-0000-4000-8000-000000000001" }];
const params = { capsuleId: "WC-A", expectedRoomId: "row-a", claims };
const context = { agentId: "agent-a", authorityDecisionId: "AUTH-current" };
const decision = { actionKey: "release_workroom_scope", actorRef: "agent-a", humanContextRef: "user-a",
  agentContextRef: "agent-a", decision: "allow", rationale: {
    consequenceRefinement: { declared: "authority", reason: OWN_SCOPE_RELEASE_REASON },
  } };

describe("scope release handler uses current monitor evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks(); receipts.clear();
    release.mockResolvedValue({ capsuleId: "WC-A" });
    heartbeat.mockResolvedValue({ capsuleId: "WC-A" });
    readDecision.mockResolvedValue(decision);
  });
  it("replays the original result across both release aliases without a second effect", async () => {
    const command = { ...params, commandId: "original-release" };
    const first = await workCapsulesPack.handlers.release_workroom_scope!(command, "user-a", context);
    const replay = await workCapsulesPack.handlers.release_capsule_scope!(command, "user-a", context);
    expect(replay).toEqual(first); expect(first.success).toBe(true);
    expect(release).toHaveBeenCalledOnce(); expect(heartbeat).toHaveBeenCalledOnce(); expect(receipts.size).toBe(1);
  });
  it("passes only the server-proven ordinary restriction to the mutation", async () => {
    expect((await releaseCapsuleScopeTool(params, "user-a", context)).success).toBe(true);
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ capsuleId: "WC-A", claims,
      ownScopeOnly: true, actor: expect.objectContaining({ principalId: "principal-a" }) }));
    expect(readDecision).toHaveBeenCalledWith(expect.objectContaining({ where: { decisionId: "AUTH-current" } }));
  });
  it("cannot turn client parameters into an execution permit", async () => {
    await expect(releaseCapsuleScopeTool({ ...params, authorityDecisionId: "AUTH-forged",
      ownScopeOnly: false, approvedAuthorityEnvelopeId: "ENV-forged" }, "user-a", { agentId: "agent-a" })).resolves.toMatchObject({ success: false, error: "invalid_input" });
    expect(release).not.toHaveBeenCalled();
    expect(heartbeat).not.toHaveBeenCalled();
    expect(readDecision).not.toHaveBeenCalled();
  });
  it("requires the server decision even for a complete valid request", async () => {
    await expect(releaseCapsuleScopeTool(params, "user-a", { agentId: "agent-a" })).rejects.toThrow("unavailable");
    expect(release).not.toHaveBeenCalled(); expect(heartbeat).not.toHaveBeenCalled();
  });
  it("refuses cross-user decision reuse before mutation or lease renewal", async () => {
    readDecision.mockResolvedValue({ ...decision, humanContextRef: "user-b" });
    await expect(releaseCapsuleScopeTool(params, "user-a", context)).rejects.toThrow("does not match");
    expect(release).not.toHaveBeenCalled();
    expect(heartbeat).not.toHaveBeenCalled();
  });
  it("retains genuinely authorized non-refined authority execution", async () => {
    readDecision.mockResolvedValue({ ...decision, rationale: { escalationReason: "damaging-action" } });
    expect((await releaseCapsuleScopeTool(params, "user-a", context)).success).toBe(true);
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ ownScopeOnly: false }));
  });
});
