import { describe, it, expect } from "vitest";
import { classifyDispatchFailure } from "./dispatch-failure-class";

// BI-8C44DB49. A dispatch that cannot succeed must not be retried. On the live
// install ~8 builds each re-dispatched a deliberation ~100 times against a
// routing contract no endpoint could satisfy, producing 5,026 stalled TaskRuns
// in four days and holding the self-upgrade quiescence gate open permanently.
// The retry was never the bug — failing to tell "try again" from "cannot ever
// work" was.

function err(name: string, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { name }, extra);
}

describe("structural failures — retrying cannot help", () => {
  it("classifies an unmet agent capability floor, and names the capability", () => {
    const verdict = classifyDispatchFailure(
      err(
        "NoEligibleEndpointsError",
        "No eligible endpoints for task 'conversation': No endpoint satisfies agent capability floor (EP-AGENT-CAP-002). Missing: toolUse. (3 endpoint(s) excluded)",
        { missingCapability: "toolUse", excludedCount: 3 },
      ),
    );
    expect(verdict.retryable).toBe(false);
    expect(verdict.code).toBe("capability-floor-unmet");
    // The operator-facing reason must name the real constraint. Reporting this
    // as "no providers are configured" is what sent this investigation down the
    // wrong path for hours — the install had 3 endpoints, all excluded.
    expect(verdict.missingCapability).toBe("toolUse");
    expect(verdict.summary).toMatch(/toolUse/);
    expect(verdict.summary).not.toMatch(/no providers are configured/i);
  });

  it("classifies a served-context overflow from the local endpoint", () => {
    const verdict = classifyDispatchFailure(
      err(
        "Error",
        'All endpoints failed for conversation. Attempts: [{"endpointId":"local","error":"HTTP 400 from local: {\\"error\\":{\\"code\\":400,\\"message\\":\\"request (29362 tokens) exceeds the available context size (24576 tokens), try increasing it\\",\\"type\\":\\"exceed_context_size_error\\"}}"}]',
      ),
    );
    expect(verdict.retryable).toBe(false);
    expect(verdict.code).toBe("context-overflow");
  });

  it("classifies no eligible endpoints without a capability floor", () => {
    const verdict = classifyDispatchFailure(
      err("NoEligibleEndpointsError", "No eligible endpoints for task 'conversation': all endpoints disabled"),
    );
    expect(verdict.retryable).toBe(false);
    expect(verdict.code).toBe("no-eligible-endpoint");
  });

  it("classifies a residency/sensitivity refusal", () => {
    const verdict = classifyDispatchFailure(
      err("NoAllowedProvidersForSensitivityError", "No allowed providers for sensitivity 'restricted'"),
    );
    expect(verdict.retryable).toBe(false);
    expect(verdict.code).toBe("sensitivity-unsatisfiable");
  });
});

describe("transient failures — retrying is legitimate", () => {
  it.each([
    ["rate limit", "HTTP 429 from openai: rate_limit_exceeded"],
    ["upstream 5xx", "HTTP 503 from anthropic: overloaded_error"],
    ["timeout", "ETIMEDOUT connecting to endpoint"],
    ["socket reset", "read ECONNRESET"],
  ])("keeps %s retryable", (_label, message) => {
    const verdict = classifyDispatchFailure(err("Error", message));
    expect(verdict.retryable).toBe(true);
    expect(verdict.code).toBe("transient");
  });

  it("defaults an unrecognised failure to retryable rather than settling work as impossible", () => {
    // Fail SAFE for the build, not for the fleet: a wrong "structural" verdict
    // silently abandons recoverable work, which is worse than one extra retry.
    // The attempt ceiling is what bounds the unknown case.
    const verdict = classifyDispatchFailure(err("Error", "something nobody has seen before"));
    expect(verdict.retryable).toBe(true);
    expect(verdict.code).toBe("transient");
  });

  it("survives a non-Error throw without claiming structural knowledge", () => {
    expect(classifyDispatchFailure("just a string").retryable).toBe(true);
    expect(classifyDispatchFailure(null).retryable).toBe(true);
    expect(classifyDispatchFailure(undefined).retryable).toBe(true);
  });
});

describe("attempt ceiling — bounds what the classifier cannot", () => {
  it("stops re-dispatching once the ceiling is reached even when transient", () => {
    expect(classifyDispatchFailure(err("Error", "HTTP 429"), { attempt: 1 }).shouldRedispatch).toBe(true);
    expect(classifyDispatchFailure(err("Error", "HTTP 429"), { attempt: 5 }).shouldRedispatch).toBe(true);
    // ~100 attempts per build is what produced the flood; the ceiling makes an
    // unrecognised-but-permanent failure cost a bounded number of runs.
    expect(classifyDispatchFailure(err("Error", "HTTP 429"), { attempt: 6 }).shouldRedispatch).toBe(false);
  });

  it("never re-dispatches a structural failure, even on the first attempt", () => {
    const verdict = classifyDispatchFailure(
      err("NoEligibleEndpointsError", "Missing: toolUse", { missingCapability: "toolUse" }),
      { attempt: 1 },
    );
    expect(verdict.shouldRedispatch).toBe(false);
  });
});
