// BI-84C1F526 (AC-GROK, DI-4B843FAF62F9) — the agent obtains the caller's own
// Grok credentials client through MCP, never a personal access token, and never
// wider than the credential it called with.
import { describe, expect, it, vi } from "vitest";

import { grantsForPublicScopes } from "@/lib/auth/oauth-scope-map";
import { GROK_CREDENTIALS_CLIENT_NAME, GROK_CREDENTIAL_SCOPES } from "@/lib/auth/grok-credentials-client";

import { issueGrokCredentialsClientForCaller, type GrokCredentialIssueDeps } from "./grok-credential-issue";

const FULL = grantsForPublicScopes([...GROK_CREDENTIAL_SCOPES]);

function deps(rows: Array<Record<string, unknown>> = []): GrokCredentialIssueDeps & { create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async () => {});
  return {
    rows: vi.fn(async () => rows as never),
    create,
    decrypt: (enc: string) => enc.replace(/^enc:/, ""),
    prepareSecret: () => ({ plaintext: "dpfocs_new", hash: "h", enc: "enc:dpfocs_new" }),
  };
}

const caller = { apiTokenId: "tok-1", authSource: "oauth", tokenScope: "write", tokenGrantScopes: FULL };

describe("issueGrokCredentialsClientForCaller", () => {
  it("creates the caller's own credentials client when none exists", async () => {
    const d = deps();
    const result = await issueGrokCredentialsClientForCaller("user-1", caller, d);
    expect(result.success).toBe(true);
    const client = result.data!.credentialsClient as { clientId: string; clientSecret: string };
    expect(client.clientId).toMatch(/^dpfoc_/);
    expect(client.clientSecret).toBe("dpfocs_new");
    expect(result.data!.created).toBe(true);
    expect(d.create).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: "user-1", registrationKind: "credentials" }));
    expect(result.message).not.toContain("dpfocs_new");
  });

  it("returns the existing client instead of minting a second one", async () => {
    const d = deps([{
      oAuthClientId: "dpfoc_existing", clientName: GROK_CREDENTIALS_CLIENT_NAME, registrationKind: "credentials",
      ownerUserId: "user-1", revokedAt: null, allowedScopes: [...GROK_CREDENTIAL_SCOPES], clientSecretEnc: "enc:dpfocs_old",
    }]);
    const result = await issueGrokCredentialsClientForCaller("user-1", caller, d);
    expect(result.data).toMatchObject({ credentialsClient: { clientId: "dpfoc_existing", clientSecret: "dpfocs_old" }, created: false });
    expect(d.create).not.toHaveBeenCalled();
  });

  it("refuses a caller without its own external credential", async () => {
    const result = await issueGrokCredentialsClientForCaller("user-1", { ...caller, authSource: "session-jwt" }, deps());
    expect(result).toMatchObject({ success: false, error: "own_credential_required" });
    expect((await issueGrokCredentialsClientForCaller("user-1", { ...caller, apiTokenId: undefined }, deps())).error).toBe("own_credential_required");
  });

  it("refuses to issue a credential wider than the caller's", async () => {
    const narrow = { ...caller, tokenGrantScopes: grantsForPublicScopes(["dpf.read", "dpf.work"]) };
    const d = deps();
    const result = await issueGrokCredentialsClientForCaller("user-1", narrow, d);
    expect(result).toMatchObject({ success: false, error: "wider_than_caller" });
    expect(String(result.message)).toContain("sandbox_execute");
    expect(d.create).not.toHaveBeenCalled();
    expect((await issueGrokCredentialsClientForCaller("user-1", { ...caller, tokenScope: "read" }, deps())).error).toBe("wider_than_caller");
  });
});
