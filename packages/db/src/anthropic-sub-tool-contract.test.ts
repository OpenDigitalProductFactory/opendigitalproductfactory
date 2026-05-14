import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

type ProviderRegistryEntry = {
  providerId: string;
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
