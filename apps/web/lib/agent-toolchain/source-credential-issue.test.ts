import { describe, expect, it, vi } from "vitest";
import { grantsForPublicScopes } from "@/lib/auth/oauth-scope-map";
import { issueSourceCredentialsClientForCaller } from "./source-credential-issue";

const scopes = ["dpf.read", "dpf.work", "dpf.build"] as const;
const caller = { apiTokenId: "own-token", authSource: "oauth", tokenScope: "write", tokenGrantScopes: grantsForPublicScopes([...scopes]), agentId: "AGT-EXT-CODEX" };
function harness() {
  const store = { eligible: vi.fn(async () => ({ id: "agent-row", agentId: caller.agentId })), rows: vi.fn(async () => []),
    create: vi.fn(async () => {}), decrypt: () => "dpfocs_fixture", prepareSecret: vi.fn(() => ({ plaintext: "dpfocs_fixture", hash: "fixture-hash", enc: "encrypted-fixture" })) };
  const withOwnerLock = vi.fn(async (_user, _actor, run) => run(store));
  return { store, deps: { withOwnerLock } };
}
describe("caller's own source credential", () => {
  it("derives the owner/actor from the authenticated call and checks eligibility inside the owner lock", async () => {
    const { deps, store } = harness();
    const result = await issueSourceCredentialsClientForCaller("human", caller, deps);
    expect(result.success).toBe(true);
    expect(deps.withOwnerLock).toHaveBeenCalledWith("human", caller.agentId, expect.any(Function));
    expect(store.eligible).toHaveBeenCalledTimes(1);
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: "human", agentId: "agent-row", allowedScopes: scopes }));
    expect(result.data).toMatchObject({ ownerUserId: "human", assistantId: caller.agentId, agentBound: true });
    expect(result.message).not.toContain("dpfocs_fixture");
  });
  it.each([
    { authSource: "session-jwt" }, { apiTokenId: undefined }, { agentId: undefined },
    { tokenScope: "read" }, { tokenGrantScopes: grantsForPublicScopes(["dpf.read", "dpf.work"]) },
  ])("refuses unbound or insufficient callers before touching the credential store: %j", async change => {
    const { deps } = harness();
    expect((await issueSourceCredentialsClientForCaller("human", { ...caller, ...change }, deps)).success).toBe(false);
    expect(deps.withOwnerLock).not.toHaveBeenCalled();
  });
  it("refuses removed eligibility without creating or reading a stored secret", async () => {
    const { deps, store } = harness();
    store.eligible.mockResolvedValue(null as never);
    expect((await issueSourceCredentialsClientForCaller("human", caller, deps)).success).toBe(false);
    expect(store.rows).not.toHaveBeenCalled();
    expect(store.prepareSecret).not.toHaveBeenCalled();
  });
  it("does not leak underlying store or crypto errors", async () => {
    const { deps } = harness();
    deps.withOwnerLock.mockRejectedValue(new Error("sensitive fixture detail"));
    const result = await issueSourceCredentialsClientForCaller("human", caller, deps);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain("sensitive fixture detail");
  });
});
