import { describe, expect, it } from "vitest";
import {
  SELF_HOSTED_STT_PROVIDER_ID,
  SPEACHES_PROVIDER_ID,
  TRANSCRIPTION_TASK_TYPE,
  TRANSCRIPTION_MODEL_SEEDS,
  TRANSCRIPTION_PROFILE_COMMON,
  RETIRED_SIDECAR_MODEL_IDS,
  transcriptionEndpointBaseline,
} from "./voice-stt-providers";

describe("transcription provider config (provider-managed speech, BI-F7E9A541)", () => {
  it("keeps the self-hosted provider id stable for existing installs", () => {
    expect(SELF_HOSTED_STT_PROVIDER_ID).toBe("speaches");
    expect(SPEACHES_PROVIDER_ID).toBe(SELF_HOSTED_STT_PROVIDER_ID);
  });

  it("uses 'transcription' as the canonical task type for routing", () => {
    expect(TRANSCRIPTION_TASK_TYPE).toBe("transcription");
  });

  describe("seeded provider set", () => {
    it("seeds more than one provider, so speech is never pinned to a single vendor", () => {
      // Per the no-provider-pinning kernel principle and the owning spec: hosted
      // providers are routing destinations, not pins.
      expect(TRANSCRIPTION_MODEL_SEEDS.length).toBeGreaterThan(1);
      const providers = new Set(TRANSCRIPTION_MODEL_SEEDS.map((s) => s.providerId));
      expect(providers.size).toBe(TRANSCRIPTION_MODEL_SEEDS.length);
    });

    it("covers a self-hosted option and at least one hosted option", () => {
      const providers = TRANSCRIPTION_MODEL_SEEDS.map((s) => s.providerId);
      expect(providers).toContain(SELF_HOSTED_STT_PROVIDER_ID);
      expect(providers.some((p) => p !== SELF_HOSTED_STT_PROVIDER_ID)).toBe(true);
    });

    it("ranks the self-hosted option above every hosted one", () => {
      // prefer-self-hosted-infrastructure: when an operator has configured their
      // own speech server, it wins the default selection.
      const selfHosted = TRANSCRIPTION_MODEL_SEEDS.find(
        (s) => s.providerId === SELF_HOSTED_STT_PROVIDER_ID,
      );
      expect(selfHosted).toBeDefined();
      for (const seed of TRANSCRIPTION_MODEL_SEEDS) {
        if (seed.providerId === SELF_HOSTED_STT_PROVIDER_ID) continue;
        expect(selfHosted!.preferenceScore).toBeGreaterThan(seed.preferenceScore);
      }
    });

    it("gives every seed a distinct preference score so default selection is deterministic", () => {
      // Endpoint resolution orders by (pinned, avgOrchestratorScore,
      // evaluationCount). All-zero baselines tie and the database picks an
      // arbitrary winner, so the seeded priors must be distinct.
      const scores = TRANSCRIPTION_MODEL_SEEDS.map((s) => s.preferenceScore);
      expect(new Set(scores).size).toBe(scores.length);
    });

    it("routes regulated data away from hosted providers", () => {
      for (const seed of TRANSCRIPTION_MODEL_SEEDS) {
        if (seed.providerId === SELF_HOSTED_STT_PROVIDER_ID) {
          expect(seed.bestFor).toContain("regulated-data");
        } else {
          expect(seed.avoidFor).toContain("regulated-data");
        }
      }
    });

    it("never seeds a model against a service DPF no longer ships", () => {
      // The whole point of BI-F7E9A541: no seeded endpoint may depend on a
      // container the platform ships, because DPF ships none.
      for (const seed of TRANSCRIPTION_MODEL_SEEDS) {
        expect(RETIRED_SIDECAR_MODEL_IDS).not.toContain(seed.modelId);
      }
    });
  });

  describe("shared ModelProfile shape", () => {
    it("declares audio-in / text-out modalities, not chat", () => {
      expect(TRANSCRIPTION_PROFILE_COMMON.inputModalities).toEqual(["audio"]);
      expect(TRANSCRIPTION_PROFILE_COMMON.outputModalities).toEqual(["text"]);
      expect(TRANSCRIPTION_PROFILE_COMMON.modelClass).toBe("transcription");
    });

    it("marks transcription capability true and chat-style capabilities false", () => {
      expect(TRANSCRIPTION_PROFILE_COMMON.capabilities.transcription).toBe(true);
      expect(TRANSCRIPTION_PROFILE_COMMON.capabilities.toolUse).toBe(false);
      expect(TRANSCRIPTION_PROFILE_COMMON.capabilities.streaming).toBe(false);
      expect(TRANSCRIPTION_PROFILE_COMMON.supportsToolUse).toBe(false);
    });

    it("marks profileSource='seed' so re-seeds refresh fields without overriding evaluated data", () => {
      expect(TRANSCRIPTION_PROFILE_COMMON.profileSource).toBe("seed");
    });

    it("every seed declares transcription in bestFor and chat in avoidFor", () => {
      for (const seed of TRANSCRIPTION_MODEL_SEEDS) {
        expect(seed.bestFor).toContain("transcription");
        expect(seed.avoidFor).toContain("chat");
      }
    });
  });

  describe("EndpointTaskPerformance baseline", () => {
    it("uses the transcription task type", () => {
      expect(transcriptionEndpointBaseline(1).taskType).toBe(TRANSCRIPTION_TASK_TYPE);
    });

    it("starts with no observed evaluations, so telemetry owns the real scores", () => {
      const baseline = transcriptionEndpointBaseline(3);
      expect(baseline.evaluationCount).toBe(0);
      expect(baseline.successCount).toBe(0);
      expect(baseline.recentScores).toEqual([]);
      expect(baseline.instructionPhase).toBe("learning");
    });

    it("carries the preference prior as the seeded orchestrator score", () => {
      expect(transcriptionEndpointBaseline(3).avgOrchestratorScore).toBe(3);
      expect(transcriptionEndpointBaseline(1).avgOrchestratorScore).toBe(1);
    });

    it("is neither pinned nor blocked, so an admin retains control", () => {
      const baseline = transcriptionEndpointBaseline(2);
      expect(baseline.pinned).toBe(false);
      expect(baseline.blocked).toBe(false);
    });
  });
});
