import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ auth: vi.fn(), can: vi.fn(), eligible: vi.fn(), create: vi.fn(), secret: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mock.auth }));
vi.mock("@/lib/permissions", () => ({ can: mock.can }));
vi.mock("@dpf/db", () => ({ prisma: { oAuthClient: { create: mock.create } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/oauth-tokens", () => ({ prepareClientSecret: mock.secret }));
vi.mock("@/lib/auth/oauth-identity-binding", () => ({ eligibleOAuthCoworkers: mock.eligible }));
import { createOAuthCredentialsClient, listOAuthCredentialsAssistants } from "./oauth-clients";

describe("headless client assistant binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.auth.mockResolvedValue({ user: { id: "human", email: "fixture@example.invalid", isSuperuser: true } });
    mock.can.mockReturnValue(true);
    mock.eligible.mockResolvedValue([{ id: "agent-row", agentId: "AGT-EXT-CODEX", displayName: "Codex" }]);
    mock.secret.mockReturnValue({ hash: "fixture-hash", enc: "fixture-enc", plaintext: "fixture-secret" });
    mock.create.mockResolvedValue({});
  });
  it("lists current eligible semantic identities without returning database keys", async () => {
    expect(await listOAuthCredentialsAssistants()).toEqual({ ok: true, data: [{ agentId: "AGT-EXT-CODEX", displayName: "Codex" }] });
    expect(mock.eligible).toHaveBeenCalledWith("human", null, null);
  });
  it("resolves the selected semantic identity to the eligible row before persisting", async () => {
    const result = await createOAuthCredentialsClient({ clientName: "Local gate", scopes: ["dpf.read", "dpf.work"], agentId: "AGT-EXT-CODEX" });
    expect(mock.eligible).toHaveBeenCalledWith("human", null, null, undefined, { agentId: "AGT-EXT-CODEX" });
    expect(mock.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ownerUserId: "human", agentId: "agent-row", allowedScopes: ["dpf.read", "dpf.work"] }) });
    expect(result).toMatchObject({ ok: true, data: { assistant: { agentId: "AGT-EXT-CODEX", displayName: "Codex" } } });
  });
  it.each(["AGT-OTHER", "agent-row", "external-codex"])("refuses an unavailable, raw-row or mirror identity %s before preparing a secret", async agentId => {
    const result = await createOAuthCredentialsClient({ clientName: "Local gate", scopes: ["dpf.work"], agentId });
    expect(result.ok).toBe(false);
    expect(mock.secret).not.toHaveBeenCalled();
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("rechecks removed eligibility on submission", async () => {
    await listOAuthCredentialsAssistants();
    mock.eligible.mockResolvedValue([]);
    expect((await createOAuthCredentialsClient({ clientName: "Local gate", scopes: ["dpf.work"], agentId: "AGT-EXT-CODEX" })).ok).toBe(false);
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("preserves intentional account-only clients", async () => {
    expect((await createOAuthCredentialsClient({ clientName: "CI", scopes: ["dpf.read"] })).ok).toBe(true);
    expect(mock.create).toHaveBeenCalledWith({ data: expect.objectContaining({ agentId: null }) });
  });
  it("refuses an unauthorized caller before discovery or secret preparation", async () => {
    mock.can.mockReturnValue(false);
    expect((await listOAuthCredentialsAssistants()).ok).toBe(false);
    expect((await createOAuthCredentialsClient({ clientName: "CI", scopes: ["dpf.read"], agentId: "AGT-EXT-CODEX" })).ok).toBe(false);
    expect(mock.eligible).not.toHaveBeenCalled();
    expect(mock.secret).not.toHaveBeenCalled();
  });
});
