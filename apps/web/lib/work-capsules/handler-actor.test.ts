import { beforeEach, expect, it, vi } from "vitest";
const identity = vi.hoisted(() => ({ ensureAgentPrincipalIdentity: vi.fn(), syncUserPrincipal: vi.fn() }));
vi.mock("@/lib/identity/principal-linking", () => identity);
import { workCapsuleActor } from "./handler-actor";

beforeEach(() => {
  vi.resetAllMocks();
  identity.ensureAgentPrincipalIdentity.mockResolvedValue({ id: "assistant" });
  identity.syncUserPrincipal.mockImplementation(async (id: string) => ({ id: `principal-${id}` }));
});
it("keeps OAuth work ownership with each human while attributing the assistant", async () => {
  const context = { agentId: "AGT-EXT-CLAUDE", authSource: "oauth" };
  expect(await workCapsuleActor("alice", context)).toMatchObject({ principalId: "principal-alice", agentPrincipalId: "assistant" });
  expect(await workCapsuleActor("bob", context)).toMatchObject({ principalId: "principal-bob", agentPrincipalId: "assistant" });
});
it("fails closed when the authorizing human cannot be resolved", async () => {
  identity.syncUserPrincipal.mockRejectedValue(new Error("unavailable"));
  await expect(workCapsuleActor("alice", { agentId: "AGT-EXT-CLAUDE", authSource: "oauth" })).rejects.toThrow();
});
it("preserves the existing in-platform coworker actor", async () => {
  expect(await workCapsuleActor("alice", { agentId: "AGT-INTERNAL" })).toEqual({ userId: "alice", agentId: "AGT-INTERNAL", principalId: "assistant" });
});
