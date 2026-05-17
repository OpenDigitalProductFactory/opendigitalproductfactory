import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeConfidence } from "./confidence-normalize";

/**
 * Voice Input Slice 1 / Task 5 — confidence normalization tests.
 *
 * Whisper-family engines return per-segment `avg_logprob` and `no_speech_prob`.
 * Hosted providers (Deepgram, AssemblyAI) emit `confidence` directly as 0-1.
 * The route projects all of these to a single 0-1 number so downstream
 * thresholds (§7.2, §10 Q3) operate on a uniform scale.
 *
 * Per spec §6.5 formula table:
 *
 *   | Provider family                                   | Formula                                                |
 *   | Whisper / faster-whisper / speaches / whisper.cpp | clamp(exp(mean(segment.avg_logprob)), 0, 1)            |
 *   |                                                   | fallback to (1 - no_speech_prob) if segments empty      |
 *   | Deepgram Nova-3                                   | channels[0].alternatives[0].confidence (already 0-1)   |
 *   | AssemblyAI                                        | confidence (already 0-1)                                |
 */

const WHISPER_FIXTURE = JSON.parse(
  readFileSync(
    join(__dirname, "..", "..", "app", "api", "transcribe", "__fixtures__", "whisper-segments.json"),
    "utf-8",
  ),
);

describe("normalizeConfidence", () => {
  describe("whisper family (speaches / faster-whisper / whisper.cpp / Groq Whisper)", () => {
    it("computes clamp(exp(mean(avg_logprob)), 0, 1) from segments", () => {
      // Fixture has avg_logprob values [-0.142, -0.213].
      // mean = -0.1775; exp(-0.1775) ≈ 0.8374
      const result = normalizeConfidence(WHISPER_FIXTURE, "speaches");
      expect(result.source).toBe("normalized");
      expect(result.value).not.toBeNull();
      expect(result.value!).toBeGreaterThan(0.8);
      expect(result.value!).toBeLessThan(0.9);
    });

    it("clamps to [0, 1]", () => {
      // Pathological case — a very confident segment with avg_logprob = +0.5.
      // exp(0.5) > 1, must clamp to 1.
      const result = normalizeConfidence(
        {
          segments: [{ avg_logprob: 0.5, no_speech_prob: 0.0 }],
        },
        "speaches",
      );
      expect(result.value).toBe(1);
      expect(result.source).toBe("normalized");
    });

    it("falls back to (1 - no_speech_prob) when segments is empty", () => {
      const result = normalizeConfidence(
        {
          segments: [],
          no_speech_prob: 0.15,
        },
        "speaches",
      );
      expect(result.value).toBeCloseTo(0.85, 4);
      expect(result.source).toBe("normalized");
    });

    it("recognizes whisper.cpp, faster-whisper, groq-whisper, whisper-cpp-local providers", () => {
      const raw = WHISPER_FIXTURE;
      expect(normalizeConfidence(raw, "whisper-cpp-local").source).toBe("normalized");
      expect(normalizeConfidence(raw, "faster-whisper").source).toBe("normalized");
      expect(normalizeConfidence(raw, "groq").source).toBe("normalized");
      expect(normalizeConfidence(raw, "groq-whisper").source).toBe("normalized");
    });
  });

  describe("deepgram (native 0-1 confidence)", () => {
    it("reads channels[0].alternatives[0].confidence directly", () => {
      const result = normalizeConfidence(
        {
          results: {
            channels: [
              {
                alternatives: [{ confidence: 0.943, transcript: "hello" }],
              },
            ],
          },
        },
        "deepgram",
      );
      expect(result.value).toBeCloseTo(0.943, 4);
      expect(result.source).toBe("native");
    });
  });

  describe("assemblyai (native 0-1 confidence)", () => {
    it("reads top-level confidence directly", () => {
      const result = normalizeConfidence(
        {
          confidence: 0.876,
          text: "hello",
        },
        "assemblyai",
      );
      expect(result.value).toBeCloseTo(0.876, 4);
      expect(result.source).toBe("native");
    });
  });

  describe("unavailable", () => {
    it("returns value=null + source='unavailable' when whisper has no segments and no no_speech_prob", () => {
      const result = normalizeConfidence({ text: "hello" }, "speaches");
      expect(result.value).toBeNull();
      expect(result.source).toBe("unavailable");
    });

    it("returns value=null + source='unavailable' for unknown provider with unknown shape", () => {
      const result = normalizeConfidence({ text: "hello" }, "some-future-provider");
      expect(result.value).toBeNull();
      expect(result.source).toBe("unavailable");
    });

    it("handles null raw safely", () => {
      const result = normalizeConfidence(null, "speaches");
      expect(result.value).toBeNull();
      expect(result.source).toBe("unavailable");
    });
  });
});
