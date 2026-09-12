import { describe, it, expect } from "vitest";

import { shouldExitWithLocalToolCallDiagnostic } from "./local-tool-call-diagnostic";
import { shouldNudge } from "./agentic-loop";

describe("shouldExitWithLocalToolCallDiagnostic (BI-2FA5A874)", () => {
  const base = {
    shouldNudgeNow: true,
    iteration: 0,
    executedToolCount: 0,
    providerId: "local",
    requireTools: false,
  };

  it("exits with the diagnostic for an ordinary local text-only iteration-0 turn", () => {
    // FB-71FB3A53: unchanged. Nudging a small local model here just burns
    // iterations, and the diagnostic is a legitimate answer for the caller.
    expect(shouldExitWithLocalToolCallDiagnostic(base)).toBe(true);
  });

  it("does NOT exit when the caller requires a tool call, so the one nudge is spent", () => {
    // Text cannot satisfy the contract, so giving up without ever nudging makes
    // the capability unreachable rather than merely degraded.
    expect(shouldExitWithLocalToolCallDiagnostic({ ...base, requireTools: true })).toBe(false);
  });

  it("leaves every other guard condition intact", () => {
    expect(shouldExitWithLocalToolCallDiagnostic({ ...base, shouldNudgeNow: false })).toBe(false);
    expect(shouldExitWithLocalToolCallDiagnostic({ ...base, iteration: 1 })).toBe(false);
    expect(shouldExitWithLocalToolCallDiagnostic({ ...base, executedToolCount: 2 })).toBe(false);
    expect(shouldExitWithLocalToolCallDiagnostic({ ...base, providerId: "anthropic" })).toBe(false);
    expect(shouldExitWithLocalToolCallDiagnostic({ ...base, providerId: null })).toBe(false);
  });

  it("agrees with shouldNudge that a requireTools text-only turn must be nudged", () => {
    // The two decisions have to line up: shouldNudge says nudge, and this guard
    // must not then throw that decision away. That disagreement was the defect.
    const nudge = shouldNudge({
      continuationNudges: 0,
      iteration: 0,
      maxIterations: 10,
      hasTools: true,
      executedToolCount: 0,
      responseLength: 15_000,
      responseText: "Let me think carefully about this task. ".repeat(200),
      requireToolExecution: true,
      isConversationalRoute: false,
    });
    expect(nudge).toBe(true);
    expect(shouldExitWithLocalToolCallDiagnostic({ ...base, requireTools: true })).toBe(false);
  });
});
