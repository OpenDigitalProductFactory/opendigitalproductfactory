import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

type ProviderRegistryEntry = {
  providerId: string;
  authMethod?: string;
  supportedAuthMethods?: string[];
  costPerformanceNotes?: string;
  userFacing?: { authExplained?: string };
  supportsToolUse?: boolean;
};

type ModelProfileSeed = {
  providerId: string;
  modelId: string;
  supportsToolUse?: boolean;
  capabilities?: { toolUse?: boolean };
};

const DATA_DIR = join(__dirname, "..", "data");

describe("anthropic-sub tool contract", () => {
  it("marks anthropic-sub as platform-tool capable in providers-registry", () => {
    const entries = JSON.parse(
      readFileSync(join(DATA_DIR, "providers-registry.json"), "utf8"),
    ) as ProviderRegistryEntry[];

    const anthropicSub = entries.find((entry) => entry.providerId === "anthropic-sub");
    expect(anthropicSub).toBeDefined();
    expect(anthropicSub?.supportsToolUse).toBe(true);
  });

  it("presents anthropic-sub as an OAuth subscription provider, not an API-key provider", () => {
    const entries = JSON.parse(
      readFileSync(join(DATA_DIR, "providers-registry.json"), "utf8"),
    ) as ProviderRegistryEntry[];

    const anthropicSub = entries.find((entry) => entry.providerId === "anthropic-sub");
    expect(anthropicSub).toBeDefined();
    expect(anthropicSub?.authMethod).toBe("oauth2_authorization_code");
    expect(anthropicSub?.supportedAuthMethods).toEqual(["oauth2_authorization_code"]);
    expect(anthropicSub?.costPerformanceNotes).not.toContain("setup-token");
    expect(anthropicSub?.userFacing?.authExplained).not.toContain("subscription token");
  });

  it("marks active anthropic-sub seeded model profiles as platform-tool capable", () => {
    const profiles = JSON.parse(
      readFileSync(join(DATA_DIR, "model-profiles.json"), "utf8"),
    ) as Array<ModelProfileSeed & { modelStatus?: string }>;

    const anthropicSubProfiles = profiles.filter(
      (profile) => profile.providerId === "anthropic-sub" && profile.modelStatus === "active",
    );
    expect(anthropicSubProfiles.length).toBeGreaterThan(0);

    for (const profile of anthropicSubProfiles) {
      expect(profile.supportsToolUse, `${profile.modelId} top-level supportsToolUse`).toBe(true);
      expect(profile.capabilities?.toolUse, `${profile.modelId} capabilities.toolUse`).toBe(true);
    }
  });
});
