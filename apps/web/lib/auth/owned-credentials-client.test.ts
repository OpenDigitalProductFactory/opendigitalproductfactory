import { describe, expect, it, vi } from "vitest";
import { ensureOwnedCredentialsClient } from "./owned-credentials-client";

const profile = { name: "DPF source connection (AGT-EXT-CODEX)", label: "source", scopes: ["dpf.read", "dpf.work", "dpf.build"], binding: "exact" as const };
function fixture(overrides: Record<string, unknown> = {}) {
  return { oAuthClientId: "dpfoc_old", clientName: profile.name, registrationKind: "credentials", ownerUserId: "human", revokedAt: null,
    allowedScopes: [...profile.scopes], clientSecretEnc: "encrypted-fixture", agentId: "agent-row", ...overrides };
}
function harness(initial = [] as ReturnType<typeof fixture>[]) {
  const rows = [...initial];
  return { ownerUserId: "human", profile, rows: async () => rows, agent: async () => "agent-row",
    create: vi.fn(async (row) => { rows.push({ ...row, revokedAt: null }); }), bindAgent: vi.fn(),
    prepareSecret: vi.fn(() => ({ plaintext: "dpfocs_fixture", hash: "fixture-hash", enc: "encrypted-fixture" })),
    decrypt: vi.fn(() => "dpfocs_fixture"), newClientId: () => "dpfoc_new" };
}
describe("strict owned source credentials", () => {
  it("creates once and returns the same owner/assistant client on the next call", async () => {
    const deps = harness();
    expect(await ensureOwnedCredentialsClient(deps)).toMatchObject({ clientId: "dpfoc_new", created: true, agentBound: true });
    expect(await ensureOwnedCredentialsClient(deps)).toMatchObject({ clientId: "dpfoc_new", created: false, agentBound: true });
    expect(deps.create).toHaveBeenCalledTimes(1);
    expect(deps.create).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: "human", agentId: "agent-row", allowedScopes: profile.scopes }));
  });
  it.each([
    { agentId: "other-agent" }, { agentId: null }, { allowedScopes: ["dpf.admin"] }, { oAuthClientId: "not-a-credentials-client" },
  ])("refuses an existing conflicting source client rather than rebinding or minting another: %j", async change => {
    const deps = harness([fixture(change)]);
    await expect(ensureOwnedCredentialsClient(deps)).rejects.toThrow(/conflict/);
    expect(deps.create).not.toHaveBeenCalled();
    expect(deps.bindAgent).not.toHaveBeenCalled();
    expect(deps.decrypt).not.toHaveBeenCalled();
  });
  it("refuses ambiguous active matches", async () => {
    const deps = harness([fixture(), fixture({ oAuthClientId: "dpfoc_duplicate" })]);
    await expect(ensureOwnedCredentialsClient(deps)).rejects.toThrow(/ambiguous/);
    expect(deps.decrypt).not.toHaveBeenCalled();
  });
  it("refuses missing actor eligibility before preparing a credential", async () => {
    const deps = { ...harness(), agent: async () => null };
    await expect(ensureOwnedCredentialsClient(deps)).rejects.toThrow(/eligible/);
    expect(deps.prepareSecret).not.toHaveBeenCalled();
  });
  it("leaves revoked rows revoked and never returns another owner's secret", async () => {
    const revoked = fixture({ revokedAt: new Date(0) });
    const deps = harness([revoked, fixture({ ownerUserId: "other" })]);
    expect(await ensureOwnedCredentialsClient(deps)).toMatchObject({ created: true, clientId: "dpfoc_new" });
    expect(revoked.revokedAt).not.toBeNull();
    expect(deps.decrypt).not.toHaveBeenCalled();
  });
  it("does not create a replacement when the matching stored secret is unreadable", async () => {
    const deps = { ...harness([fixture()]), decrypt: () => null };
    await expect(ensureOwnedCredentialsClient(deps)).rejects.toThrow(/cannot be read/);
    expect(deps.create).not.toHaveBeenCalled();
  });
});
