import { describe, expect, it } from "vitest";
import { NativeCliExecutionUncertainError } from "../routing/cli-owned-runner";
import { executionUncertaintyFromError, hasExecutionUncertainty } from "./execution-uncertainty";

describe("safe uncertain execution evidence", () => {
  it("retains bounded local observations without claiming remote settlement or retaining output", () => {
    const error = new NativeCliExecutionUncertainError("anthropic-sub", {
      exitCode: 1, signal: null, timedOut: false, outerProcessClosed: true,
      stdoutPresent: true, stderrPresent: true,
      stdout: "fake-private-prompt", stderr: "fake-secret", childProcessClosed: true,
    } as never);
    const evidence = executionUncertaintyFromError(error);
    expect(evidence).toMatchObject({ settlement: "unknown", diagnostics: {
      exitCode: 1, signal: null, timedOut: false, outerProcessClosed: true,
      stdoutPresent: true, stderrPresent: true, childProcessClosure: "unverified",
    } });
    expect(JSON.stringify(evidence)).not.toMatch(/fake-|childProcessClosed/);
  });
  it("holds malformed and future markers instead of interpreting them as retry authorization", () => {
    for (const marker of [false, "unknown", {}, { schemaVersion: 99 }, { settlement: "settled" }]) {
      expect(hasExecutionUncertainty({ executionUncertainty: marker })).toBe(true);
    }
    expect(hasExecutionUncertainty({})).toBe(false);
  });
});
