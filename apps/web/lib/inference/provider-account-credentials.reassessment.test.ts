import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountExecutionVersion } from "../routing/provider-account-candidates";

const db = vi.hoisted(() => ({
  credentialEntry: { findUnique: vi.fn(), updateMany: vi.fn() },
  aiProviderConnection: { findUnique: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("@/lib/credential-crypto", () => ({
  decryptSecret: (value: string) => value === "enc:bad" ? null : value.replace("enc:", ""),
}));
import { readReassessmentProviderAuthHeaders } from "./provider-account-credentials";

function account(secretRef = "enc:key") {
  return { connectionId: "provider-default-anthropic", providerId: "anthropic", status: "active",
    authMethod: "api-key", executionChannel: "direct-api", credentialEntryId: "credential-1",
    credentialEntry: { id: "credential-1", status: "pending", updatedAt: new Date("2026-10-01"), secretRef,
      clientSecret: null, refreshToken: null, cachedToken: null, providerWorkspaceId: null },
    accessibleModelIds: ["model-1"], modelsVerifiedAt: null, evidenceStatus: "operator-attested" };
}
function input(row = account()) {
  return { providerId: "anthropic", authMethod: "api_key", authHeader: "x-api-key",
    connectionId: row.connectionId, expectedExecutionVersion: accountExecutionVersion(row) };
}
describe("restricted review credential reads", () => {
  beforeEach(() => vi.resetAllMocks());
  it("uses only the already selected existing API key without modifying its status", async () => {
    const row = account(); db.aiProviderConnection.findUnique.mockResolvedValue(row);
    await expect(readReassessmentProviderAuthHeaders(input(row))).resolves.toMatchObject({ "x-api-key": "key" });
    expect(db.credentialEntry.findUnique).not.toHaveBeenCalled();
    expect(db.credentialEntry.updateMany).not.toHaveBeenCalled();
  });
  it("refuses failed decryption without the normal key_rotated write", async () => {
    const row = account("enc:bad"); db.aiProviderConnection.findUnique.mockResolvedValue(row);
    await expect(readReassessmentProviderAuthHeaders(input(row))).rejects.toThrow(/credential/i);
    expect(db.credentialEntry.updateMany).not.toHaveBeenCalled();
  });
  it("refuses a changed selected revision without reading a default credential", async () => {
    const row = account(); db.aiProviderConnection.findUnique.mockResolvedValue({ ...row, credentialEntryId: "new" });
    await expect(readReassessmentProviderAuthHeaders(input(row))).rejects.toThrow(/changed/i);
    expect(db.credentialEntry.findUnique).not.toHaveBeenCalled();
  });
  it.each(["oauth2_client_credentials", "oauth2_authorization_code", "unsupported", null])(
    "refuses %s before account or token preparation", async authMethod => {
      await expect(readReassessmentProviderAuthHeaders({ ...input(), authMethod })).rejects.toThrow(/auth/i);
      expect(db.aiProviderConnection.findUnique).not.toHaveBeenCalled();
    });
  it("allows the existing no-auth HTTP posture without looking up any credentials", async () => {
    await expect(readReassessmentProviderAuthHeaders({ ...input(), authMethod: "none" })).resolves.toEqual({ "Content-Type": "application/json" });
    expect(db.aiProviderConnection.findUnique).not.toHaveBeenCalled();
  });
  it("never aliases a missing selected account", async () => {
    db.aiProviderConnection.findUnique.mockResolvedValue(null);
    await expect(readReassessmentProviderAuthHeaders(input())).rejects.toThrow(/connection/i);
    expect(db.credentialEntry.findUnique).not.toHaveBeenCalled();
  });
});
