import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  MODEL_PROFILE_SEED_GENERATED_BY,
  toModelProfileSeedCreateData,
  type ModelProfileSeedRecord,
} from "../src/model-profile-seed";

const DATA_DIR = join(__dirname, "..", "data");

type ProviderRegistryEntry = {
  providerId: string;
  endpointType?: string;
};

describe("model profile seed contract", () => {
  it("supplies generatedBy for every exported model profile seed row", () => {
    const profiles = JSON.parse(
      readFileSync(join(DATA_DIR, "model-profiles.json"), "utf8"),
    ) as ModelProfileSeedRecord[];

    expect(profiles.length).toBeGreaterThan(0);

    for (const profile of profiles) {
      const data = toModelProfileSeedCreateData(profile);
      expect(data.generatedBy, `${profile.providerId}/${profile.modelId}`).toBe(MODEL_PROFILE_SEED_GENERATED_BY);
    }
  });

  it("keeps subscription-backed OpenAI providers on the responses endpoint contract", () => {
    const entries = JSON.parse(
      readFileSync(join(DATA_DIR, "providers-registry.json"), "utf8"),
    ) as ProviderRegistryEntry[];

    expect(entries.find((entry) => entry.providerId === "codex")?.endpointType).toBe("responses");
    expect(entries.find((entry) => entry.providerId === "chatgpt")?.endpointType).toBe("responses");
  });
});
