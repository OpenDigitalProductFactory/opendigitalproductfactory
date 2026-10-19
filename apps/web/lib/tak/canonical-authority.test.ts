import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  agent: { findFirst: vi.fn(), findMany: vi.fn() },
  agentToolGrant: { upsert: vi.fn(), deleteMany: vi.fn() },
  agentToolGrantRevocation: { upsert: vi.fn(), deleteMany: vi.fn() },
  toolExecution: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: db }));
import { resolveCoworkerAgent, manageCoworkerToolGrant } from "./coworker-tool-grant-core";
import { getAgentGrantSummaries, getAgentToolGrantsAsync, isToolAllowedByGrants } from "./agent-grants";
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
  it("projects saved canonical grants and revocations for both summary identities", async () => {
    db.agent.findMany.mockResolvedValue([
      { ...canonical, toolGrants: alias.toolGrants }, alias,
    ]);
    const summaries = await getAgentGrantSummaries();
    expect(summaries.map(row => row.agentId)).toEqual([canonical.agentId, alias.agentId]);
    for (const row of summaries) expect(row.grants).toEqual(["registry_read"]);
  });
  it("never reports a granted alias as authority when its canonical record is missing", async () => {
    db.agent.findMany.mockResolvedValue([alias]);
    expect((await getAgentGrantSummaries())[0].grants).toEqual([]);
  });
  it("surfaces an unavailable summary read instead of reporting seeded grants", async () => {
    db.agent.findMany.mockRejectedValue(new Error("authority unavailable"));
    await expect(getAgentGrantSummaries()).rejects.toThrow("authority unavailable");
  });
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
  it("retires the duplicate authority after approval, keeping execution aliases", async () => {
    const preview = await previewCoworkerGrantReconciliation("external-codex");
    await reconcileCoworkerGrants({ coworkerRef: "external-codex", digest: preview.digest,
      choices: [{ grantKey: "release_plan_read", source: "canonical" }], approvedBy: "admin" });
    expect(db.agentToolGrant.deleteMany).toHaveBeenCalledWith({ where: { agentId: "alias" } });
    expect(db.agentToolGrantRevocation.deleteMany).toHaveBeenCalledWith({ where: { agentId: "alias" } });
  });
  it("does not treat an empty retired alias as a conflicting permission record", async () => {
    db.agent.findFirst.mockImplementation(async ({ where }) => where.agentId === canonical.agentId
      ? canonical : { ...alias, toolGrants: [], toolGrantRevocations: [] });
    expect((await previewCoworkerGrantReconciliation("external-codex")).differences).toEqual([]);
  });
  it("does nothing when rerun after retirement", async () => {
    db.agent.findFirst.mockImplementation(async ({ where }) => where.agentId === canonical.agentId
      ? canonical : { ...alias, toolGrants: [], toolGrantRevocations: [] });
    const preview = await previewCoworkerGrantReconciliation("external-codex");
    await reconcileCoworkerGrants({ coworkerRef: "external-codex", digest: preview.digest, choices: [], approvedBy: "admin" });
    expect(db.toolExecution.create).not.toHaveBeenCalled();
    expect(db.agentToolGrant.deleteMany).not.toHaveBeenCalled();
  });
  it("audits original provenance before retiring duplicates", async () => {
    const preview = await previewCoworkerGrantReconciliation("external-codex");
    await reconcileCoworkerGrants({ coworkerRef: "external-codex", digest: preview.digest,
      choices: [{ grantKey: "release_plan_read", source: "canonical" }], approvedBy: "approver" });
    const audit = db.toolExecution.create.mock.calls.find(([a]) => a.data.parameters.grantKey === "release_plan_read")![0].data;
    expect(audit.userId).toBe("approver");
    expect(audit.result.alias.grant.grantedBy).toBe("admin");
    expect(audit.result.canonical.revocation.revokedBy).toBe("u2");
    expect(db.toolExecution.create.mock.invocationCallOrder[0]).toBeLessThan(db.agentToolGrant.deleteMany.mock.invocationCallOrder[0]);
  });
  it("tombstones a deliberately retained absence so seed cannot resurrect the rejected grant", async () => {
    db.agent.findFirst.mockImplementation(async ({ where }) => where.agentId === canonical.agentId
      ? { ...canonical, toolGrantRevocations: [] } : alias);
    const preview = await previewCoworkerGrantReconciliation("external-codex");
    await reconcileCoworkerGrants({ coworkerRef: "external-codex", digest: preview.digest,
      choices: [{ grantKey: "release_plan_read", source: "canonical" }], approvedBy: "admin" });
    expect(db.agentToolGrantRevocation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { agentId: "canonical", grantKey: "release_plan_read", revokedBy: "admin" }, update: {} }));
    expect(db.agentToolGrant.upsert).not.toHaveBeenCalled();
  });
  it("moves a revocation-only assertion with its original actor and time without adding access", async () => {
    const revocation = { id: "old-removal", agentId: "alias", grantKey: "inventory_read", revokedBy: "original-admin", revokedAt: new Date(42) };
    db.agent.findFirst.mockImplementation(async ({ where }) => where.agentId === canonical.agentId
      ? canonical : { ...alias, toolGrants: [], toolGrantRevocations: [revocation] });
    const preview = await previewCoworkerGrantReconciliation("external-codex");
    expect(preview.differences).toEqual([]);
    await reconcileCoworkerGrants({ coworkerRef: "external-codex", digest: preview.digest, choices: [], approvedBy: "admin" });
    expect(db.agentToolGrantRevocation.upsert).toHaveBeenCalledWith(expect.objectContaining({ create:
      { agentId: "canonical", grantKey: "inventory_read", revokedBy: "original-admin", revokedAt: new Date(42) } }));
    expect(db.agentToolGrant.upsert).not.toHaveBeenCalled();
  });
  it("does not retire anything when the provenance audit fails", async () => {
    const preview = await previewCoworkerGrantReconciliation("external-codex");
    db.toolExecution.create.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(reconcileCoworkerGrants({ coworkerRef: "external-codex", digest: preview.digest,
      choices: [{ grantKey: "release_plan_read", source: "canonical" }], approvedBy: "admin" })).rejects.toThrow("audit unavailable");
    expect(db.agentToolGrant.deleteMany).not.toHaveBeenCalled();
    expect(db.agentToolGrantRevocation.deleteMany).not.toHaveBeenCalled();
  });
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
    expect(db.agentToolGrantRevocation.deleteMany).not.toHaveBeenCalledWith({ where: { agentId: "canonical", grantKey: "release_plan_read" } });
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
