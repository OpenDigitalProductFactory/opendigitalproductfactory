import { describe, expect, it } from "vitest";
import {
  classifyBiasPrompt,
  ON_ORG_TRANSCRIPTION_PROVIDERS,
  type BiasClassificationToken,
} from "./bias-classification-gate";

/**
 * Voice Input Slice 1 / Task 4 — bias-prompt classification gate tests.
 *
 * The gate is the only off-org PII-leak boundary for transcription. Slice 1
 * callers always pass an empty bias prompt (the cleanup pass + vocabulary
 * bias is Slice 2). Implementing the gate now means Slice 2 can populate
 * the bias without re-touching the route or the call-site.
 *
 * Per spec §6.7 step 4 + §7.4:
 *   - On-org providers (speaches, whisper-cpp-local) receive the bias verbatim.
 *   - Off-org providers (Groq, Deepgram, AssemblyAI, etc.) receive only the
 *     subset of bias tokens classified as `public` or `internal-low`.
 *     `confidential` and `restricted` tokens are stripped.
 *   - `redacted` is true if any token was stripped.
 */

describe("bias classification gate", () => {
  describe("empty bias", () => {
    it("returns empty + classification 'empty' + redacted=false", () => {
      const result = classifyBiasPrompt({
        bias: [],
        providerId: "speaches",
      });
      expect(result.prompt).toBe("");
      expect(result.classification).toBe("empty");
      expect(result.redacted).toBe(false);
    });

    it("treats undefined bias as empty", () => {
      const result = classifyBiasPrompt({
        bias: undefined,
        providerId: "groq",
      });
      expect(result.prompt).toBe("");
      expect(result.classification).toBe("empty");
      expect(result.redacted).toBe(false);
    });
  });

  describe("on-org provider (speaches)", () => {
    it("returns the full prompt verbatim regardless of classification", () => {
      const bias: BiasClassificationToken[] = [
        { text: "Daisy", classification: "internal-low" },
        { text: "API_SECRET_KEY", classification: "confidential" },
        { text: "Kubernetes", classification: "public" },
      ];
      const result = classifyBiasPrompt({
        bias,
        providerId: "speaches",
      });
      expect(result.prompt).toBe("Daisy API_SECRET_KEY Kubernetes");
      expect(result.classification).toBe("on-org");
      expect(result.redacted).toBe(false);
    });

    it("recognizes whisper-cpp-local as on-org too", () => {
      const bias: BiasClassificationToken[] = [
        { text: "ConfidentialProject", classification: "confidential" },
      ];
      const result = classifyBiasPrompt({
        bias,
        providerId: "whisper-cpp-local",
      });
      expect(result.prompt).toBe("ConfidentialProject");
      expect(result.classification).toBe("on-org");
      expect(result.redacted).toBe(false);
    });

    it("exposes the on-org provider allow-list so admin tooling can verify it", () => {
      // Public API for inspection / admin UI display.
      expect(ON_ORG_TRANSCRIPTION_PROVIDERS).toContain("speaches");
      expect(ON_ORG_TRANSCRIPTION_PROVIDERS).toContain("whisper-cpp-local");
    });
  });

  describe("off-org provider (Groq, Deepgram, AssemblyAI)", () => {
    it("strips confidential tokens, keeps public + internal-low", () => {
      const bias: BiasClassificationToken[] = [
        { text: "Kubernetes", classification: "public" },
        { text: "API_SECRET_KEY", classification: "confidential" },
        { text: "Daisy", classification: "internal-low" },
      ];
      const result = classifyBiasPrompt({
        bias,
        providerId: "groq",
      });
      expect(result.prompt).toBe("Kubernetes Daisy");
      expect(result.classification).toBe("off-org");
      expect(result.redacted).toBe(true);
    });

    it("strips restricted tokens", () => {
      const bias: BiasClassificationToken[] = [
        { text: "PublicTerm", classification: "public" },
        { text: "CustomerPII", classification: "restricted" },
      ];
      const result = classifyBiasPrompt({
        bias,
        providerId: "deepgram",
      });
      expect(result.prompt).toBe("PublicTerm");
      expect(result.redacted).toBe(true);
    });

    it("strips unclassified tokens by default (fail-safe)", () => {
      const bias: BiasClassificationToken[] = [
        { text: "KnownPublic", classification: "public" },
        // Unclassified — treat as confidential by default.
        { text: "UnknownTerm", classification: "unclassified" },
      ];
      const result = classifyBiasPrompt({
        bias,
        providerId: "assemblyai",
      });
      expect(result.prompt).toBe("KnownPublic");
      expect(result.redacted).toBe(true);
    });

    it("returns prompt='' + redacted=false when all tokens were public/internal-low", () => {
      const bias: BiasClassificationToken[] = [
        { text: "Foo", classification: "public" },
        { text: "Bar", classification: "internal-low" },
      ];
      const result = classifyBiasPrompt({
        bias,
        providerId: "groq",
      });
      expect(result.prompt).toBe("Foo Bar");
      expect(result.classification).toBe("off-org");
      expect(result.redacted).toBe(false);
    });

    it("returns prompt='' + redacted=true when every token was stripped", () => {
      const bias: BiasClassificationToken[] = [
        { text: "Confidential1", classification: "confidential" },
        { text: "Confidential2", classification: "restricted" },
      ];
      const result = classifyBiasPrompt({
        bias,
        providerId: "groq",
      });
      expect(result.prompt).toBe("");
      expect(result.redacted).toBe(true);
    });
  });

  describe("unknown provider (defense in depth)", () => {
    it("treats unknown providers as off-org — fail-safe to redaction", () => {
      const bias: BiasClassificationToken[] = [
        { text: "Foo", classification: "public" },
        { text: "Secret", classification: "confidential" },
      ];
      const result = classifyBiasPrompt({
        bias,
        providerId: "some-new-provider-we-havent-classified-yet",
      });
      expect(result.prompt).toBe("Foo");
      expect(result.classification).toBe("off-org");
      expect(result.redacted).toBe(true);
    });
  });
});
