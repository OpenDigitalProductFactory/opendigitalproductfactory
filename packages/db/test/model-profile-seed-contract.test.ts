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
  oauthClientId?: string | null;
  oauthRedirectUri?: string | null;
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

  // Regression guard for the ChatGPT OAuth `unknown_error` bug. The upstream
  // OAuth client only accepts pre-registered redirect URIs; sibling providers
  // sharing the client_id must agree on the URI. See
  // docs/triage/2026-05-23-chatgpt-oauth-unknown-error.md.
  it("aligns oauthRedirectUri across providers sharing the same oauthClientId", () => {
    const entries = JSON.parse(
      readFileSync(join(DATA_DIR, "providers-registry.json"), "utf8"),
    ) as ProviderRegistryEntry[];

    const byClient = new Map<string, ProviderRegistryEntry[]>();
    for (const entry of entries) {
      if (!entry.oauthClientId) continue;
      const bucket = byClient.get(entry.oauthClientId) ?? [];
      bucket.push(entry);
      byClient.set(entry.oauthClientId, bucket);
    }

    for (const [clientId, members] of byClient.entries()) {
      if (members.length < 2) continue;
      const uniqueUris = new Set(members.map((m) => m.oauthRedirectUri ?? "<null>"));
      expect(uniqueUris.size, `client ${clientId} → ${members.map((m) => `${m.providerId}=${m.oauthRedirectUri ?? "<null>"}`).join(", ")}`).toBe(1);
    }
  });
});
