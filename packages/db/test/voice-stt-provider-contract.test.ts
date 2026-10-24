import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  SELF_HOSTED_STT_PROVIDER_ID,
  TRANSCRIPTION_MODEL_SEEDS,
} from "../src/voice-stt-providers";

const DATA_DIR = join(__dirname, "..", "data");
const REPO_ROOT = join(__dirname, "..", "..", "..");
const LEGACY_MODEL_ID = "Systran/faster-distil-whisper-large-v3";

type ProviderRegistryEntry = {
  providerId: string;
  name?: string;
  baseUrl?: string | null;
  authMethod?: string;
  costPerformanceNotes?: string;
};

function loadProviders(): ProviderRegistryEntry[] {
  return JSON.parse(
    readFileSync(join(DATA_DIR, "providers-registry.json"), "utf8"),
  ) as ProviderRegistryEntry[];
}

function loadCompose(): string {
  return readFileSync(join(REPO_ROOT, "docker-compose.yml"), "utf8");
}

/**
 * Speech is provider-managed (BI-F7E9A541). These are the guards that keep it
 * that way — the failure they prevent is a third party's registry housekeeping
 * blocking every DPF release, which happened three times.
 *
 * Owning spec: docs/superpowers/specs/2026-09-09-speech-provider-managed-design.md
 */
describe("provider-managed speech contract", () => {
  describe("shipped Compose ships no speech engine", () => {
    it("declares no dpf-stt service", () => {
      const compose = loadCompose();
      expect(compose).not.toMatch(/^\s{2}dpf-stt:/m);
    });

    it("pins no third-party image by digest", () => {
      // A digest-pinned third-party image is unreachable the moment its
      // publisher prunes it. The release manifest guard covers images behind
      // optional profiles (verify-compose-image-manifests.mjs passes
      // --profile "*"), so even an opt-in service blocks :latest promotion for
      // every install. DPF's own images are published by DPF and tagged by
      // release, so they are not pinned this way either.
      const compose = loadCompose();
      const digestPins = compose
        .split("\n")
        .filter((line) => line.includes("@sha256:") && !line.trimStart().startsWith("#"));
      expect(digestPins).toEqual([]);
    });

    it("declares no speech-model volume for a service it no longer runs", () => {
      const compose = loadCompose();
      expect(compose).not.toContain("dpf_stt_models");
    });
  });

  describe("self-hosted speech is an operator choice, not a shipped service", () => {
    it("leaves the self-hosted provider's base URL for the operator to supply", () => {
      const provider = loadProviders().find(
        (entry) => entry.providerId === SELF_HOSTED_STT_PROVIDER_ID,
      );
      expect(provider).toBeDefined();
      // Null, not a DPF service address: DPF ships no speech container, so it
      // cannot honestly default to one. Precedent: azure-openai, bedrock, litellm.
      expect(provider!.baseUrl ?? null).toBeNull();
      expect(JSON.stringify(provider)).not.toContain("dpf-stt");
    });

    it("carries no reference to the retired sidecar model", () => {
      expect(JSON.stringify(loadProviders())).not.toContain(LEGACY_MODEL_ID);
    });
  });

  describe("enablement follows provider configuration", () => {
    it("seeds a transcription model for more than one provider", () => {
      // Endpoint resolution skips any candidate whose provider is not active,
      // so seeding several keeps voice available to whichever the operator
      // configures, without pinning the platform to one vendor.
      expect(TRANSCRIPTION_MODEL_SEEDS.length).toBeGreaterThan(1);
    });

    it("seeds no model that depends on a service DPF ships", () => {
      const compose = loadCompose();
      for (const seed of TRANSCRIPTION_MODEL_SEEDS) {
        expect(compose).not.toContain(`${seed.providerId}:`);
      }
    });
  });

  describe("the digest watcher is retired with the pin it watched", () => {
    it("registers no watcher test in the policy guards", () => {
      const guards = readFileSync(
        join(REPO_ROOT, "scripts", "lib", "ci-policy-guards.mjs"),
        "utf8",
      );
      expect(guards).not.toContain("re-resolve-stt-digest");
      expect(guards).not.toContain("stt-digest-watch");
    });
  });
});
