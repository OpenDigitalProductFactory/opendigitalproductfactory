import { describe, expect, it } from "vitest";
import {
  SPEACHES_PROVIDER_ID,
  SPEACHES_MODEL_ID,
  TRANSCRIPTION_TASK_TYPE,
  SPEACHES_MODEL_PROFILE_CONFIG,
  SPEACHES_ENDPOINT_PERFORMANCE_BASELINE,
} from "./voice-stt-providers";

describe("speaches transcription provider config", () => {
  it("identifies speaches as the canonical STT provider id", () => {
    expect(SPEACHES_PROVIDER_ID).toBe("speaches");
  });

  it("pins the default model to the compose default Whisper variant", () => {
    // Slice 1.5 default-on CPU sidecar uses hwdsl2/whisper-server with WHISPER_MODEL=base.
    // If this changes, docker-compose.yml DPF_STT_MODEL default must change in lockstep.
    expect(SPEACHES_MODEL_ID).toBe("base");
  });

  it("uses 'transcription' as the canonical task type for routing", () => {
    // Per plan Gate 2 + spec §6.7 — the routing layer dispatches on this task type.
    expect(TRANSCRIPTION_TASK_TYPE).toBe("transcription");
  });

  describe("ModelProfile shape", () => {
    it("declares audio-in / text-out modalities, not chat", () => {
      expect(SPEACHES_MODEL_PROFILE_CONFIG.inputModalities).toEqual(["audio"]);
      expect(SPEACHES_MODEL_PROFILE_CONFIG.outputModalities).toEqual(["text"]);
      expect(SPEACHES_MODEL_PROFILE_CONFIG.modelClass).toBe("transcription");
    });

    it("marks transcription capability true and chat-style capabilities false", () => {
      // Per spec §6.0 — speaches has no LLM dependency. capabilities.transcription
      // is what the routing layer reads to dispatch transcription jobs here.
      expect(SPEACHES_MODEL_PROFILE_CONFIG.capabilities.transcription).toBe(true);
      expect(SPEACHES_MODEL_PROFILE_CONFIG.capabilities.toolUse).toBe(false);
      expect(SPEACHES_MODEL_PROFILE_CONFIG.capabilities.streaming).toBe(false);
      expect(SPEACHES_MODEL_PROFILE_CONFIG.supportsToolUse).toBe(false);
    });

    it("targets the speaches provider, not a chat provider", () => {
      expect(SPEACHES_MODEL_PROFILE_CONFIG.providerId).toBe(SPEACHES_PROVIDER_ID);
      expect(SPEACHES_MODEL_PROFILE_CONFIG.modelId).toBe(SPEACHES_MODEL_ID);
    });

    it("sets bestFor to transcription tasks, avoidFor to chat tasks", () => {
      expect(SPEACHES_MODEL_PROFILE_CONFIG.bestFor).toContain("transcription");
      expect(SPEACHES_MODEL_PROFILE_CONFIG.avoidFor).toContain("chat");
    });

    it("marks profileSource='seed' so re-seeds refresh fields without overriding evaluated data", () => {
      // Mirrors the codex / chatgpt seed pattern at packages/db/src/seed.ts:1555.
      expect(SPEACHES_MODEL_PROFILE_CONFIG.profileSource).toBe("seed");
    });
  });

  describe("EndpointTaskPerformance baseline", () => {
    it("uses the transcription task type", () => {
      expect(SPEACHES_ENDPOINT_PERFORMANCE_BASELINE.taskType).toBe(TRANSCRIPTION_TASK_TYPE);
    });

    it("starts with zero evaluations so real telemetry overrides on first traffic", () => {
      expect(SPEACHES_ENDPOINT_PERFORMANCE_BASELINE.evaluationCount).toBe(0);
      expect(SPEACHES_ENDPOINT_PERFORMANCE_BASELINE.successCount).toBe(0);
      expect(SPEACHES_ENDPOINT_PERFORMANCE_BASELINE.avgOrchestratorScore).toBe(0);
    });

    it("is neither pinned nor blocked — routing picks dynamically per no-provider-pinning principle", () => {
      // Per kernel principle no-provider-pinning + plan Gate 3.
      expect(SPEACHES_ENDPOINT_PERFORMANCE_BASELINE.pinned).toBe(false);
      expect(SPEACHES_ENDPOINT_PERFORMANCE_BASELINE.blocked).toBe(false);
    });

    it("starts in the 'learning' instruction phase", () => {
      expect(SPEACHES_ENDPOINT_PERFORMANCE_BASELINE.instructionPhase).toBe("learning");
    });
  });
});
