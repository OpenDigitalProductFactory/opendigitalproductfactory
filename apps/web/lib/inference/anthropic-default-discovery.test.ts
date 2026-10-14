import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ provider: vi.fn(), credential: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { modelProvider: { findUnique: mocks.provider } } }));
vi.mock("./provider-account-credentials", () => ({
  findProviderCredential: mocks.credential,
  resolveCredentialProviderId: (id: string) => id,
}));
vi.mock("@/lib/credential-crypto", () => ({ decryptSecret: (value: string) => value, encryptSecret: (value: string) => value }));
vi.mock("./discovered-model-inventory", () => ({ persistDiscoveredInventory: vi.fn().mockResolvedValue({ discovered: 1, newCount: 1 }) }));

import { discoverModelsInternal } from "./ai-provider-internals";

afterEach(() => vi.unstubAllGlobals());

it.each(["wrkspc_AccountA", null])("default Anthropic discovery uses its credential workspace %s", async (workspace) => {
  mocks.provider.mockResolvedValue({
    providerId: "anthropic", authMethod: "api_key", authHeader: "x-api-key",
    baseUrl: "https://api.anthropic.com", families: [], enabledFamilies: [], supportedAuthMethods: [],
  });
  mocks.credential.mockResolvedValue({ secretRef: "test-key", providerWorkspaceId: workspace });
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "claude-test" }] })));
  vi.stubGlobal("fetch", fetchMock);

  expect(await discoverModelsInternal("anthropic")).toMatchObject({ discovered: 1 });
  const headers = fetchMock.mock.calls[0][1].headers;
  expect(headers["x-api-key"]).toBe("test-key");
  expect(headers["anthropic-workspace-id"]).toBe(workspace ?? undefined);
  expect(mocks.credential).toHaveBeenLastCalledWith("anthropic", undefined);
});
