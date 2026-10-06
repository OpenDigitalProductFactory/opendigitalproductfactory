import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  agent: { findFirst: vi.fn() },
  agentToolGrant: { upsert: vi.fn(), deleteMany: vi.fn() },
  agentToolGrantRevocation: { upsert: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: db }));
import { resolveCoworkerAgent, manageCoworkerToolGrant } from "./coworker-tool-grant-core";
import { getAgentToolGrantsAsync, isToolAllowedByGrants } from "./agent-grants";
import { previewCoworkerGrantReconciliation, reconcileCoworkerGrants } from "./coworker-grant-reconciliation";
const canonical = { id: "canonical", agentId: "AGT-EXT-CODEX", slugId: null, displayName: "Codex",
  toolGrants: [{ id: "g1", agentId: "canonical", grantKey: "registry_read", grantedBy: "u1", grantedAt: new Date(0) }],
  toolGrantRevocations: [{ id: "r1", agentId: "canonical", grantKey: "release_plan_read", revokedBy: "u2", revokedAt: new Date(0) }] };
const alias = { ...canonical, id: "alias", agentId: "external-codex", toolGrantRevocations: [],
  toolGrants: [...canonical.toolGrants, { id: "g2", agentId: "alias", grantKey: "release_plan_read", grantedBy: "admin", grantedAt: new Date(1) }] };

beforeEach(() => {
  vi.resetAllMocks();
  db.agent.findFirst.mockImplementation(async ({ where }) => {
    if (where.agentId === canonical.agentId) return structuredClone(canonical);
    if (where.agentId === alias.agentId || where.OR?.some((entry: { id?: string }) => entry.id === alias.id)) return structuredClone(alias);
    return null;
  });
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
});

describe("canonical authority across references and requests", () => {
  it.each(["AGT-EXT-CODEX", "external-codex", "alias"])("%s resolves only the canonical authority owner", async (ref) => {
    expect((await resolveCoworkerAgent(ref))?.id).toBe("canonical");
  });
  it("fails closed when canonical provisioning is missing, even with a granted alias", async () => {
    db.agent.findFirst.mockResolvedValue(alias);
    // A real exact-key query cannot return the alias for the canonical id.
    db.agent.findFirst.mockImplementation(async ({ where }) => where.agentId === alias.agentId ? alias : null);
    expect(await resolveCoworkerAgent("external-codex")).toBeNull();
    expect(await getAgentToolGrantsAsync("external-codex")).toEqual([]);
  });
  it("does not union the alias grant and honors a canonical tombstone", async () => {
    const grants = await getAgentToolGrantsAsync("external-codex");
    expect(grants).toEqual(["registry_read"]);
    expect(isToolAllowedByGrants("get_quiescence_status", grants)).toBe(false);
    expect(isToolAllowedByGrants("request_self_upgrade", grants)).toBe(false);
  });
  it("re-reads grant and revoke state on each request/reconnect", async () => {
    db.agent.findFirst.mockResolvedValueOnce({ ...canonical, toolGrants: alias.toolGrants, toolGrantRevocations: [] })
      .mockResolvedValueOnce(canonical);
    expect(await getAgentToolGrantsAsync("external-codex")).toContain("release_plan_read");
    expect(await getAgentToolGrantsAsync("AGT-EXT-CODEX")).not.toContain("release_plan_read");
  });
  it("blocks self-grants through aliases", async () => {
    expect(await manageCoworkerToolGrant({ coworkerRef: "external-codex", grantKey: "release_plan_read",
      action: "grant", callerAgentId: "AGT-EXT-CODEX", grantedBy: "admin" })).toMatchObject({ code: "self_target_denied" });
    expect(db.agentToolGrant.upsert).not.toHaveBeenCalled();
  });
});

describe("administrator conflict reconciliation", () => {
  it("previews a grant-versus-revocation conflict without writes", async () => {
    const preview = await previewCoworkerGrantReconciliation("external-codex");
    expect(preview.differences).toEqual([{ grantKey: "release_plan_read", canonical: "revoked", alias: "granted" }]);
    expect(db.agentToolGrant.upsert).not.toHaveBeenCalled();
  });
  it("requires an explicit choice for every conflict", async () => {
    const preview = await previewCoworkerGrantReconciliation("external-codex");
    await expect(reconcileCoworkerGrants({ coworkerRef: "external-codex", digest: preview.digest, choices: [], approvedBy: "admin" }))
      .rejects.toThrow("Choose a source");
    expect(db.agentToolGrant.upsert).not.toHaveBeenCalled();
  });
  it("keeping canonical authority preserves its revocation", async () => {
    const preview = await previewCoworkerGrantReconciliation("external-codex");
    await reconcileCoworkerGrants({ coworkerRef: "external-codex", digest: preview.digest,
      choices: [{ grantKey: "release_plan_read", source: "canonical" }], approvedBy: "admin" });
    expect(db.agentToolGrant.upsert).not.toHaveBeenCalled();
    expect(db.agentToolGrantRevocation.deleteMany).not.toHaveBeenCalled();
  });
  it("applies an approved legacy grant only to canonical authority atomically", async () => {
    const preview = await previewCoworkerGrantReconciliation("external-codex");
    await reconcileCoworkerGrants({ coworkerRef: "external-codex", digest: preview.digest,
      choices: [{ grantKey: "release_plan_read", source: "alias" }], approvedBy: "admin" });
    expect(db.agentToolGrant.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ agentId: "canonical", grantKey: "release_plan_read", grantedBy: "admin" }) }));
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });
  it("rejects stale preview, including changes to provenance", async () => {
    const preview = await previewCoworkerGrantReconciliation("external-codex");
    db.agent.findFirst.mockResolvedValueOnce({ ...canonical, toolGrants: [{ ...canonical.toolGrants[0], grantedBy: "someone-else" }] })
      .mockResolvedValueOnce(alias);
    await expect(reconcileCoworkerGrants({ coworkerRef: "external-codex", digest: preview.digest,
      choices: [{ grantKey: "release_plan_read", source: "alias" }], approvedBy: "admin" })).rejects.toThrow("changed after preview");
    expect(db.agentToolGrant.upsert).not.toHaveBeenCalled();
  });
});
