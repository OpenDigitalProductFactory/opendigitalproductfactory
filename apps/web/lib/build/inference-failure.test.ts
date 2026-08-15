import { describe, expect, it } from "vitest";
import {
  classifyInferenceFailure,
  friendlyInferenceFailureMessage,
  isRawProviderError,
  isTransientInferenceFailure,
  type InferenceFailureKind,
} from "./inference-failure";

describe("classifyInferenceFailure", () => {
  it("classifies the live-repro raw connection error as connection", () => {
    // BI-F0005EB0 exact persisted content on FB-54088DED.
    expect(
      classifyInferenceFailure("API Error: Unable to connect to API (ConnectionRefused)"),
    ).toBe("connection");
  });

  it("classifies raw node connection signatures", () => {
    expect(classifyInferenceFailure("Error: connect ECONNREFUSED 127.0.0.1:12434")).toBe("connection");
    expect(classifyInferenceFailure("read ECONNRESET")).toBe("connection");
    expect(classifyInferenceFailure("Connection refused")).toBe("connection");
    expect(classifyInferenceFailure("API Error: fetch failed")).toBe("connection");
  });

  it("classifies describeToolRouteFailure friendly outputs", () => {
    // These strings must stay recognisable so the signal survives after the
    // persist-time guard rewrites a raw error into friendly copy.
    expect(
      classifyInferenceFailure(
        "Your paid AI providers (such as Claude or GPT) are briefly unavailable right now — usually a short rate-limit that clears within a minute — and this coworker uses too many tools (58 of them) for the bundled local model to run on its own. Nothing is misconfigured. Please wait a moment and try again.",
      ),
    ).toBe("rate-limit");
    expect(
      classifyInferenceFailure(
        "The AI providers are momentarily busy (usually rate-limited or overloaded). Please try again in about 30 seconds — no setup change is needed.",
      ),
    ).toBe("rate-limit");
    expect(
      classifyInferenceFailure(
        "The AI provider is temporarily unavailable. Please try again in about 30 seconds.",
      ),
    ).toBe("provider-unavailable");
    expect(
      classifyInferenceFailure(
        "No AI model that supports tools is active right now. Open Platform > AI > Providers & Routing to activate a tool-capable provider, then try again.",
      ),
    ).toBe("config");
    expect(
      classifyInferenceFailure(
        "No AI provider credentials are configured for this feature. Open Platform › AI Operations › Providers & Routing, connect a cloud provider (Claude, OpenAI, Google, or similar), then try again.",
      ),
    ).toBe("config");
    expect(
      classifyInferenceFailure(
        "No AI model can handle this request right now. No eligible model met this turn's routing requirements. The cause can be provider availability, data-policy or residency limits, capability requirements, or context size — not necessarily a disconnected provider. Open Platform > AI Operations > Providers & Routing to review the active route and provider status.",
      ),
    ).toBe("config");
  });

  it("classifies empty-response fallbacks", () => {
    expect(
      classifyInferenceFailure(
        "**Unable to process this request.** Provider local/qwen returned an empty response. Check AI Workforce settings (Platform > AI) to verify provider configuration.",
      ),
    ).toBe("empty-response");
    expect(
      classifyInferenceFailure(
        "The model (claude-3-haiku) returned an empty response and did not use any tools. This typically means it does not support the tool format required for this task. Try a different model or provider.",
      ),
    ).toBe("empty-response");
  });

  it("returns null for normal assistant content (no false positives)", () => {
    expect(classifyInferenceFailure(null)).toBeNull();
    expect(classifyInferenceFailure(undefined)).toBeNull();
    expect(classifyInferenceFailure("")).toBeNull();
    expect(classifyInferenceFailure("   ")).toBeNull();
    // Legitimate replies that merely mention errors must NOT trip the classifier.
    expect(
      classifyInferenceFailure(
        "I found the error in your validation logic — the form was rejecting valid emails. I've fixed it and added a test.",
      ),
    ).toBeNull();
    expect(
      classifyInferenceFailure(
        "Let's define it together — I'll ask a few questions about how your shop works. First, what job types do you handle most?",
      ),
    ).toBeNull();
    expect(
      classifyInferenceFailure(
        "The build hit a network of dependencies we should map before starting.",
      ),
    ).toBeNull();
  });

  it("does NOT classify deterministic context-overflow copy (retry cannot fix it)", () => {
    expect(
      classifyInferenceFailure(
        "Your conversation is too long for this AI provider. Please start a new thread to continue.",
      ),
    ).toBeNull();
    expect(
      classifyInferenceFailure(
        "That request was too large for the active AI model's context window — usually too many tools active at once, or a long conversation.",
      ),
    ).toBeNull();
  });
});

describe("isTransientInferenceFailure", () => {
  it("marks connection / rate-limit / provider-unavailable as transient", () => {
    for (const kind of ["connection", "rate-limit", "provider-unavailable"] as InferenceFailureKind[]) {
      expect(isTransientInferenceFailure(kind)).toBe(true);
    }
  });

  it("marks config / empty-response as non-transient, and null as non-transient", () => {
    expect(isTransientInferenceFailure("config")).toBe(false);
    expect(isTransientInferenceFailure("empty-response")).toBe(false);
    expect(isTransientInferenceFailure(null)).toBe(false);
  });
});

describe("isRawProviderError", () => {
  it("flags raw provider/CLI machine errors that must be hidden from users", () => {
    expect(isRawProviderError("API Error: Unable to connect to API (ConnectionRefused)")).toBe(true);
    expect(isRawProviderError("Error: connect ECONNREFUSED 127.0.0.1:12434")).toBe(true);
    expect(isRawProviderError("read ECONNRESET")).toBe(true);
    expect(isRawProviderError("API Error: fetch failed")).toBe(true);
    expect(isRawProviderError("429 Too Many Requests")).toBe(true);
    expect(isRawProviderError("HTTP 503 Service Unavailable error")).toBe(true);
  });

  it("does NOT flag curated friendly copy (that copy is intentional UX)", () => {
    // describeToolRouteFailure outputs are already user-safe — leave them alone.
    expect(
      isRawProviderError(
        "The AI providers are momentarily busy (usually rate-limited or overloaded). Please try again in about 30 seconds — no setup change is needed.",
      ),
    ).toBe(false);
    expect(
      isRawProviderError("The AI provider is temporarily unavailable. Please try again in about 30 seconds."),
    ).toBe(false);
    expect(isRawProviderError("**Unable to process this request.** Provider returned an empty response.")).toBe(false);
  });

  it("does NOT flag normal content or empties", () => {
    expect(isRawProviderError(null)).toBe(false);
    expect(isRawProviderError("")).toBe(false);
    expect(isRawProviderError("I found the error in your validation logic and fixed it.")).toBe(false);
  });
});

describe("friendlyInferenceFailureMessage", () => {
  it("returns non-empty, provider-detail-free copy for every kind", () => {
    for (const kind of [
      "connection",
      "rate-limit",
      "provider-unavailable",
      "config",
      "empty-response",
    ] as InferenceFailureKind[]) {
      const msg = friendlyInferenceFailureMessage(kind);
      expect(msg.length).toBeGreaterThan(20);
      // Never leak raw provider signatures to the user.
      expect(msg).not.toMatch(/ECONNREFUSED|ConnectionRefused|API Error:/);
    }
  });
});
