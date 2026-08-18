import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDefaultProviderConnection } from "./provider-connection";
import { readCanonicalPrismaSchema } from "./schema-source";

type TrustCatalog = {
  category: string;
  jurisdictions: string[];
  externalEgress: string;
  supportsZdr: boolean | null;
  supportsNoTraining: boolean | null;
  supportsRegionalRouting: boolean | null;
  supportedRegions: string[];
  regionalEndpoints: unknown[];
};

type ProviderEntry = {
  providerId: string;
  catalogProviderId?: string;
  trustCatalog?: TrustCatalog & Record<string, unknown>;
};

const dataDir = join(import.meta.dirname, "..", "data");
const registry = JSON.parse(
  readFileSync(join(dataDir, "providers-registry.json"), "utf8"),
) as ProviderEntry[];
const byId = new Map(registry.map((entry) => [entry.providerId, entry]));

describe("provider trust registry", () => {
  it.each([
    "anthropic",
    "anthropic-sub",
    "openai",
    "zai",
    "zai-coding",
    "chatgpt",
    "codex",
    "azure-openai",
    "gemini",
    "bedrock",
    "local",
    "ollama",
    "openrouter",
    "litellm",
  ])("declares conservative catalog trust facts for %s", (providerId) => {
    const entry = byId.get(providerId);
    expect(entry?.catalogProviderId).toBeTruthy();
    expect(entry?.trustCatalog).toEqual(expect.objectContaining({
      category: expect.any(String),
      jurisdictions: expect.any(Array),
      externalEgress: expect.any(String),
      supportedRegions: expect.any(Array),
      regionalEndpoints: expect.any(Array),
    }));
    expect(entry?.trustCatalog).toHaveProperty("supportsZdr");
    expect(entry?.trustCatalog).toHaveProperty("supportsNoTraining");
    expect(entry?.trustCatalog).toHaveProperty("supportsRegionalRouting");
  });

  it("groups channel aliases under a vendor catalog identity", () => {
    expect(byId.get("anthropic")?.catalogProviderId).toBe("anthropic");
    expect(byId.get("anthropic-sub")?.catalogProviderId).toBe("anthropic");
    expect(byId.get("openai")?.catalogProviderId).toBe("openai");
    expect(byId.get("chatgpt")?.catalogProviderId).toBe("openai");
    expect(byId.get("codex")?.catalogProviderId).toBe("openai");
    expect(byId.get("zai-coding")?.catalogProviderId).toBe("zai");
  });

  it("does not put connection evidence or account claims in vendor facts", () => {
    for (const entry of registry) {
      expect(entry.trustCatalog).not.toEqual(expect.objectContaining({
        accountClass: expect.anything(),
        contractEvidence: expect.anything(),
        entitlements: expect.anything(),
        evidenceStatus: expect.anything(),
      }));
    }
  });

  it("declares local execution as non-egress and routers as router egress", () => {
    expect(byId.get("local")?.trustCatalog?.externalEgress).toBe("none");
    expect(byId.get("ollama")?.trustCatalog?.externalEgress).toBe("none");
    expect(byId.get("openrouter")?.trustCatalog).toMatchObject({
      category: "router",
      externalEgress: "router-cloud",
      supportsZdr: true,
      supportsNoTraining: true,
      supportsRegionalRouting: true,
      regionalEndpoints: [{
        region: "eu",
        baseUrl: "https://eu.openrouter.ai/api/v1",
        requiresEnterpriseEnablement: true,
      }],
      routerPassThrough: {
        exposesUnderlyingProvider: true,
        supportsProviderAllowlist: true,
        supportsProviderBlocklist: true,
        supportsZdrFilter: true,
        supportsDataCollectionDeny: true,
        supportsBoundedFallbacks: true,
      },
    });
  });
});

describe("provider connection schema", () => {
  const schema = readCanonicalPrismaSchema();
  const migration = readFileSync(
    join(
      import.meta.dirname,
      "..",
      "prisma",
      "migrations",
      "20260719233000_ai_provider_connection",
      "migration.sql",
    ),
    "utf8",
  );

  it("keeps connection posture separate from ModelProvider catalog ownership", () => {
    expect(schema).toMatch(/model AiProviderConnection\s*\{/);
    expect(schema).toMatch(/providerId\s+String/);
    expect(schema).toMatch(/connectionId\s+String\s+@unique/);
    expect(schema).toMatch(/provider\s+ModelProvider\s+@relation/);
    expect(schema).toContain("@@index([providerId, status])");
    expect(schema).toContain("@@index([supplierContractId])");
  });

  it("backfills model channels without creating connections for transcription services", () => {
    expect(migration).toContain("WHERE mp.\"endpointType\" <> 'transcription'");
    expect(migration).toContain("'provider-default-' || mp.\"providerId\"");
    expect(migration).toContain("'unreviewed'");
  });
});

describe("default provider connection", () => {
  it.each([
    ["openai", "direct", "api_key", undefined, "direct-api", "api-key"],
    ["chatgpt", "direct", "oauth2_authorization_code", "responses", "subscription-cli", "oauth"],
    ["azure-openai", "direct", "api_key", undefined, "cloud-tenant", "api-key"],
    ["openrouter", "router", "api_key", undefined, "hosted-router", "api-key"],
    ["local", "direct", "none", undefined, "local-runtime", "local"],
  ] as const)("creates a conservative %s connection", (providerId, category, providerAuth, endpointType, executionChannel, authMethod) => {
    expect(buildDefaultProviderConnection({
      providerId,
      name: providerId,
      category,
      authMethod: providerAuth,
      ...(endpointType ? { endpointType } : {}),
    })).toMatchObject({
      connectionId: `provider-default-${providerId}`,
      executionChannel,
      authMethod,
      commercialBasis: providerAuth === "oauth2_authorization_code"
        ? "subscription-included"
        : providerId === "local"
          ? "local-compute"
          : "unknown",
    });
  });

  it("does not create an LLM connection for transcription", () => {
    expect(buildDefaultProviderConnection({
      providerId: "speaches",
      name: "Local STT",
      category: "direct",
      authMethod: "none",
      endpointType: "transcription",
    })).toBeUndefined();
  });
});
