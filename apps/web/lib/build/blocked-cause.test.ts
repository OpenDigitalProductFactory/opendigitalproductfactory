import { describe, expect, it } from "vitest";
import { classifyBlockedCause } from "./blocked-cause";

describe("classifyBlockedCause", () => {
  it("treats a mid-work timeout as infrastructure — the case that stranded builds", () => {
    expect(
      classifyBlockedCause({ content: "Error: request timed out after 600000ms", exitCode: 1 }),
    ).toBe("infrastructure");
  });

  it.each([
    ["ECONNRESET", "read ECONNRESET"],
    ["connection refused", "connect: connection refused"],
    ["503", "upstream returned 503"],
    ["service unavailable", "Service Unavailable"],
    ["overloaded", "Error: provider overloaded, please retry"],
    ["rate limit", "429 rate limit exceeded, retry-after: 30"],
    ["SIGKILL", "Process terminated by SIGKILL"],
    ["out of memory", "FATAL ERROR: JavaScript heap out of memory"],
    ["fetch failed", "TypeError: fetch failed"],
    ["socket hang up", "Error: socket hang up"],
  ])("classifies %s as infrastructure", (_label, content) => {
    expect(classifyBlockedCause({ content, exitCode: 1 })).toBe("infrastructure");
  });

  it("empty output is a process that died before it could speak", () => {
    expect(classifyBlockedCause({ content: "", exitCode: 1 })).toBe("infrastructure");
    expect(classifyBlockedCause({ content: "   \n  ", exitCode: 1 })).toBe("infrastructure");
  });

  it.each([137, 143, 124])("exit code %i is the harness killing the process, not a verdict", (exitCode) => {
    expect(classifyBlockedCause({ content: "partial work written to src/foo.ts", exitCode })).toBe(
      "infrastructure",
    );
  });

  it("a considered refusal stays substantive — retrying will not answer it", () => {
    expect(
      classifyBlockedCause({
        content:
          "I cannot complete this task. The spec does not say whether refunds should be prorated, " +
          "and both readings change the schema. This needs a product decision before I write code.",
        exitCode: 1,
      }),
    ).toBe("substantive");
  });

  it("a failing test report is substantive — the run finished and reported", () => {
    expect(
      classifyBlockedCause({
        content: "Test Suites: 1 failed, 4 passed\n3 tests failed\nExpected 200, received 404",
        exitCode: 1,
      }),
    ).toBe("substantive");
  });

  it("a missing dependency the agent found is substantive, not transport", () => {
    expect(
      classifyBlockedCause({
        content: "Cannot proceed: the referenced module @dpf/billing does not exist in this repo.",
        exitCode: 1,
      }),
    ).toBe("substantive");
  });

  it("is biased toward infrastructure on ambiguity — one extra run beats a permanent strand", () => {
    // A substantive report that also mentions a timeout resolves to infrastructure.
    // Cost: one bounded re-dispatch. The opposite error strands the build forever.
    expect(
      classifyBlockedCause({
        content: "Implemented the handler, but the integration test timed out waiting for the DB.",
        exitCode: 1,
      }),
    ).toBe("infrastructure");
  });
});
