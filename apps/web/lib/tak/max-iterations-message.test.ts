import { describe, expect, it } from "vitest";

import { buildMaxIterationsExhaustedMessage } from "./max-iterations-message";

describe("buildMaxIterationsExhaustedMessage (BI-F4D3B9E9d)", () => {
  const anyTools = [{ name: "query_backlog", result: { ok: true } as never }];

  it("says 'unavailable' only when a dispatch actually failed", () => {
    const msg = buildMaxIterationsExhaustedMessage({
      downgradeReason: "provider-unavailable",
      executedTools: anyTools,
    });
    expect(msg).toContain("My usual AI was unavailable");
    // BI-FB184D69: raw tool names are engineer detail and stay on the trace.
    expect(msg).not.toContain("query_backlog");
  });

  it("never claims 'unavailable' when the provider was merely ineligible", () => {
    const msg = buildMaxIterationsExhaustedMessage({
      downgradeReason: "not-eligible",
      executedTools: anyTools,
    });
    // The exact contradiction with the downgrade banner.
    expect(msg).not.toContain("was unavailable");
    expect(msg).toContain("wasn't a fit for this particular request");
  });

  it("does not tell an owner to connect a provider they already have connected", () => {
    const msg = buildMaxIterationsExhaustedMessage({
      downgradeReason: "not-eligible",
      executedTools: anyTools,
    });
    // Old copy: "Connecting a stronger provider (Claude, Gemini, or OpenAI)…"
    expect(msg).not.toMatch(/connecting a stronger provider/i);
    // BI-FB184D69: with no cause supplied it must not guess that brevity helps.
    expect(msg).not.toMatch(/shorter request/i);
    expect(msg).toMatch(/what ruled it out/i);
  });

  it("points at restoring the failed provider when one genuinely failed", () => {
    const msg = buildMaxIterationsExhaustedMessage({
      downgradeReason: "provider-unavailable",
      executedTools: anyTools,
    });
    expect(msg).toContain("Platform > AI > Providers");
  });

  it("adds no downgrade lead at all on a healthy-provider exhaustion", () => {
    const msg = buildMaxIterationsExhaustedMessage({
      downgradeReason: null,
      executedTools: anyTools,
    });
    expect(msg).not.toMatch(/my usual ai/i);
    expect(msg).toMatch(/^I worked through several attempts/);
    expect(msg).toMatch(/smaller piece/i);
  });

  it("falls back to a generic work note when no tools ran", () => {
    const msg = buildMaxIterationsExhaustedMessage({
      downgradeReason: null,
      executedTools: [],
    });
    expect(msg).toContain("I couldn't complete a final answer");
  });

  // BI-FB184D69. The reported owner tested the old advice directly — a nine-word
  // prompt — and spent six more minutes reaching the identical failure. Length is
  // not the axis a data-boundary decision turns on.
  it("never suggests brevity when a data boundary is what excluded the route", () => {
    for (const cause of ["residency", "clearance"] as const) {
      const msg = buildMaxIterationsExhaustedMessage({
        downgradeReason: "not-eligible",
        cause,
        executedTools: anyTools,
      });
      expect(msg).not.toMatch(/shorter/i);
      expect(msg).not.toMatch(/narrower/i);
      expect(msg).toMatch(/data-handling rule/i);
    }
  });

  it("does suggest brevity when the context window really was the limit", () => {
    const msg = buildMaxIterationsExhaustedMessage({
      downgradeReason: "not-eligible",
      cause: "context-window",
      executedTools: anyTools,
    });
    expect(msg).toMatch(/shorter/i);
  });

  it("always names the safety limit rather than an opaque failure", () => {
    for (const downgradeReason of ["provider-unavailable", "not-eligible", null] as const) {
      const msg = buildMaxIterationsExhaustedMessage({ downgradeReason, executedTools: anyTools });
      expect(msg).toContain("safety limit");
    }
  });
});
