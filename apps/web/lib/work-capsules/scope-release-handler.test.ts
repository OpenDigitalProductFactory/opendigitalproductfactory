import { beforeEach, describe, expect, it, vi } from "vitest";

const { release, heartbeat, readDecision } = vi.hoisted(() => ({
  release: vi.fn(), heartbeat: vi.fn(), readDecision: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: { authorizationDecisionLog: { findUnique: readDecision } } }));
vi.mock("./handler-actor", () => ({ workCapsuleActor: vi.fn(async () => ({
  userId: "user-a", agentId: "agent-a", principalId: "principal-a",
})) }));
vi.mock("./work-capsule-store", async (original) => ({
  ...await original<typeof import("./work-capsule-store")>(),
  releaseWorkCapsuleScope: release, heartbeatWorkCapsule: heartbeat,
}));

import { releaseCapsuleScopeTool } from "./mcp-handlers";
import { OWN_SCOPE_RELEASE_REASON } from "./scope-release-authorization";

const claims = [{ kind: "path", value: "file.ts" }];
const params = { capsuleId: "WC-A", claims };
const context = { agentId: "agent-a", authorityDecisionId: "AUTH-current" };
const decision = { actionKey: "release_workroom_scope", actorRef: "agent-a", humanContextRef: "user-a",
  agentContextRef: "agent-a", decision: "allow", rationale: {
    consequenceRefinement: { declared: "authority", reason: OWN_SCOPE_RELEASE_REASON },
  } };

describe("scope release handler uses current monitor evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    release.mockResolvedValue({ capsuleId: "WC-A" });
    heartbeat.mockResolvedValue({ capsuleId: "WC-A" });
    readDecision.mockResolvedValue(decision);
  });
  it("passes only the server-proven ordinary restriction to the mutation", async () => {
    expect((await releaseCapsuleScopeTool(params, "user-a", context)).success).toBe(true);
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ capsuleId: "WC-A", claims,
      ownScopeOnly: true, actor: expect.objectContaining({ principalId: "principal-a" }) }));
    expect(readDecision).toHaveBeenCalledWith(expect.objectContaining({ where: { decisionId: "AUTH-current" } }));
  });
  it("cannot turn client parameters into an execution permit", async () => {
    await expect(releaseCapsuleScopeTool({ ...params, authorityDecisionId: "AUTH-forged",
      ownScopeOnly: false, approvedAuthorityEnvelopeId: "ENV-forged" }, "user-a", { agentId: "agent-a" })).rejects.toThrow("unavailable");
    expect(release).not.toHaveBeenCalled();
    expect(heartbeat).not.toHaveBeenCalled();
    expect(readDecision).not.toHaveBeenCalled();
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
