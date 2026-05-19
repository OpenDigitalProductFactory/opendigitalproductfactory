import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { SPEACHES_MODEL_ID } from "../src/voice-stt-providers";

const DATA_DIR = join(__dirname, "..", "data");
const REPO_ROOT = join(__dirname, "..", "..", "..");
const LEGACY_MODEL_ID = "Systran/faster-distil-whisper-large-v3";

type ProviderRegistryEntry = {
  providerId: string;
  name?: string;
  baseUrl?: string;
  costPerformanceNotes?: string;
};

function loadSpeachesProvider(): ProviderRegistryEntry {
  const entries = JSON.parse(
    readFileSync(join(DATA_DIR, "providers-registry.json"), "utf8"),
  ) as ProviderRegistryEntry[];
  const provider = entries.find((entry) => entry.providerId === "speaches");
  expect(provider).toBeDefined();
  return provider!;
}

describe("voice STT provider seed contract", () => {
  it("keeps the seeded model aligned to the default whisper-server model", () => {
    expect(SPEACHES_MODEL_ID).toBe("base");
  });

  it("keeps the provider registry aligned to the whisper-server sidecar port and model", () => {
    const provider = loadSpeachesProvider();
    const serializedProvider = JSON.stringify(provider);

    expect(provider.name).toBe("Local STT (whisper-server)");
    expect(provider.baseUrl).toBe("http://dpf-stt:9000");
    expect(provider.costPerformanceNotes).toContain("Default model: base");
    expect(serializedProvider).not.toContain("http://dpf-stt:8000");
    expect(serializedProvider).not.toContain(LEGACY_MODEL_ID);
  });

  it("keeps docker-compose on the same internal port and model as the seed", () => {
    const compose = readFileSync(join(REPO_ROOT, "docker-compose.yml"), "utf8");

    expect(compose).toContain("WHISPER_MODEL: ${DPF_STT_MODEL:-base}");
    expect(compose).toContain("http://localhost:9000/v1/models");
    expect(compose).toContain('"127.0.0.1:8765:9000"');
  });
});
