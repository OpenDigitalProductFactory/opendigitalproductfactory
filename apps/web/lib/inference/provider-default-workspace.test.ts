import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  credentialEntry: { findUnique: vi.fn(), upsert: vi.fn() },
  complianceEvidence: { updateMany: vi.fn() },
  aiProviderConnection: { update: vi.fn(), updateMany: vi.fn() },
  modelProvider: { update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: db, setProviderStatusWithDefaultConnection: vi.fn() }));
import { configureDefaultProviderWorkspace } from "./provider-account-management";

describe("default workspace account proofs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation(async (run) => run(db));
    db.credentialEntry.findUnique.mockResolvedValue({ providerWorkspaceId: "wrkspc_accountA", providerConnection: { id: "default-a" } });
  });

  it.each(["wrkspc_accountB", null])("invalidates previous workspace proofs when changing to %s", async (workspace) => {
    await configureDefaultProviderWorkspace("anthropic", workspace);
    expect(db.complianceEvidence.updateMany).toHaveBeenCalledWith({ where: { providerConnectionId: "default-a", claimKey: { not: null }, status: "active" }, data: { status: "superseded" } });
    expect(db.aiProviderConnection.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "default-a" }, data: expect.objectContaining({ accessibleModelIds: [], modelsVerifiedAt: null, accountClass: "unknown", evidenceStatus: "unreviewed", entitlements: {} }) }));
    expect(db.aiProviderConnection.updateMany).toHaveBeenCalledWith({ where: { id: "default-a", status: { not: "disabled" } }, data: { status: "unconfigured" } });
    expect(db.modelProvider.update).toHaveBeenCalledWith({ where: { providerId: "anthropic" }, data: { sensitivityClearance: ["public"] } });
    expect(db.credentialEntry.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { providerWorkspaceId: workspace, status: "pending" } }));
    expect(db.aiProviderConnection.update.mock.invocationCallOrder[0]).toBeLessThan(db.credentialEntry.upsert.mock.invocationCallOrder[0]);
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("preserves proofs for the same workspace", async () => {
    await configureDefaultProviderWorkspace("anthropic", "wrkspc_accountA");
    expect(db.complianceEvidence.updateMany).not.toHaveBeenCalled();
    expect(db.aiProviderConnection.update).not.toHaveBeenCalled();
    expect(db.modelProvider.update).not.toHaveBeenCalled();
  });
});
