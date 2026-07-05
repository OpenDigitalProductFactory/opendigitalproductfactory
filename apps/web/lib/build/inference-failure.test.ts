import { describe, expect, it } from "vitest";
import {
  CANONICAL_INFERENCE_FAILURE_MESSAGE,
  detectFailedInferenceTurn,
  isInferenceFailureContent,
  sanitizeAssistantContent,
} from "./inference-failure";

// BI-F0005EB0 — the shared failure-classifier that the persist (write) and
// custodian/progress-visibility (read) sides both depend on. These lock the
// signatures so the two sides cannot drift.

describe("isInferenceFailureContent", () => {
  const failures = [
    "API Error: Unable to connect to API (ConnectionRefused)",
    "Unable to connect to the API",
    "Research encountered an issue: ECONNREFUSED 127.0.0.1:12434",
    "All endpoints failed for coworker. Attempts: [{...}]",
    "No endpoint available for internal: no active model",
    "No eligible endpoints for toolUse",
    CANONICAL_INFERENCE_FAILURE_MESSAGE,
  ];
  for (const f of failures) {
    it(`flags: ${f.slice(0, 44)}`, () => {
      expect(isInferenceFailureContent(f)).toBe(true);
    });
  }

  const normals = [
    "Here's the plan: I'll add last-updated timestamps to the build list rows.",
    "Research completed. Please describe what you'd like me to focus on.",
    "",
    null,
    undefined,
    "The API returned 200 and everything looks connected and healthy.",
  ];
  for (const n of normals) {
    it(`passes normal content: ${String(n).slice(0, 40)}`, () => {
      expect(isInferenceFailureContent(n)).toBe(false);
    });
  }
});

describe("sanitizeAssistantContent (d — never persist raw errors)", () => {
  it("rewrites a raw provider error to the canonical message + keeps an excerpt", () => {
    const raw = "API Error: Unable to connect to API (ConnectionRefused)";
    const out = sanitizeAssistantContent(raw);
    expect(out.wasFailure).toBe(true);
    expect(out.content).toBe(CANONICAL_INFERENCE_FAILURE_MESSAGE);
    expect(out.content).not.toContain("ConnectionRefused");
    expect(out.errorExcerpt).toContain("ConnectionRefused");
  });

  it("passes normal content through untouched", () => {
    const raw = "Research completed. What should I focus on?";
    const out = sanitizeAssistantContent(raw);
    expect(out.wasFailure).toBe(false);
    expect(out.content).toBe(raw);
    expect(out.errorExcerpt).toBeNull();
  });

  it("round-trips: the sanitized canonical message is still detected as a failure", () => {
    const out = sanitizeAssistantContent("ECONNREFUSED");
    expect(isInferenceFailureContent(out.content)).toBe(true);
    // re-sanitizing the canonical message is idempotent (no double excerpt)
    const again = sanitizeAssistantContent(out.content);
    expect(again.content).toBe(CANONICAL_INFERENCE_FAILURE_MESSAGE);
    expect(again.errorExcerpt).toBeNull();
  });
});

describe("detectFailedInferenceTurn (a — newest assistant turn wins)", () => {
  it("detects when the most recent assistant message is a failure", () => {
    const messages = [
      { role: "assistant", content: "API Error: Unable to connect to API (ConnectionRefused)", createdAt: "2026-07-05T10:00:00Z" },
      { role: "user", content: "add timestamps", createdAt: "2026-07-05T09:59:00Z" },
    ];
    const r = detectFailedInferenceTurn(messages);
    expect(r).not.toBeNull();
    expect(r?.errorExcerpt).toContain("ConnectionRefused");
    expect(r?.observedAt).toBe("2026-07-05T10:00:00.000Z");
  });

  it("returns null when a newer successful assistant turn recovered it", () => {
    const messages = [
      { role: "assistant", content: "Here's the design doc draft.", createdAt: "2026-07-05T10:05:00Z" },
      { role: "assistant", content: "ECONNREFUSED", createdAt: "2026-07-05T10:00:00Z" },
    ];
    expect(detectFailedInferenceTurn(messages)).toBeNull();
  });

  it("returns null with no assistant messages", () => {
    expect(detectFailedInferenceTurn([{ role: "user", content: "hi", createdAt: null }])).toBeNull();
  });
});
