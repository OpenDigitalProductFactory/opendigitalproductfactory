import { describe, expect, it } from "vitest";
import { NativeCliExecutionUncertainError } from "../routing/cli-owned-runner";
import { executionUncertaintyFromError, hasExecutionUncertainty } from "./execution-uncertainty";

describe("safe uncertain execution evidence", () => {
  it.each([1, 3])("holds the original markerless writer wait at attempt %s", (attempt) => {
    const original = { terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer",
      writerToolName: "record_initiative_design_review", resumeMode: "same-taskrun", attempt,
      observedAt: "2026-10-15T22:15:48.811Z" } };
    const snapshot = structuredClone(original);
    expect(hasExecutionUncertainty(original)).toBe(true);
    expect(original).toEqual(snapshot);
  });
  it.each([
    { capacityDeferred: true }, { capacityDeferred: "future" },
    { writerRejection: {} }, { writerRejection: { schemaVersion: 99, error: "rejected", message: "Rejected", observedAt: "2026-10-15T22:15:48.811Z" } },
  ])("does not let malformed recovery evidence clear a legacy wait (%j)", (extra) => {
    expect(hasExecutionUncertainty({ terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer",
      writerToolName: "record_initiative_design_review", resumeMode: "same-taskrun", attempt: 1,
      observedAt: "2026-10-15T22:15:48.811Z", ...extra } })).toBe(true);
  });
  it("requires a capability refusal to bind the same writer and observation", () => {
    expect(hasExecutionUncertainty({ terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer",
      writerToolName: "record_initiative_design_review", resumeMode: "same-taskrun", attempt: 1,
      observedAt: "2026-10-15T22:15:48.811Z" }, terminalWriterDispatchFailure: {
        schemaVersion: 1, code: "required-terminal-writer-not-enforceable", writerToolName: "another-writer",
        observedAt: "2026-10-15T22:15:48.811Z" } })).toBe(true);
  });
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
  it("carries useful bounded terminal hints through the error boundary without retaining the CLI payload", () => {
    const evidence = executionUncertaintyFromError(new NativeCliExecutionUncertainError("anthropic-sub", {
      exitCode: 1, signal: null, timedOut: false, outerProcessClosed: true,
      stdoutPresent: true, stderrPresent: false, childProcessClosure: "unverified",
      terminalResult: { status: "error", type: "result", subtype: "error_during_execution", isError: true, hint: "auth",
        result: "PRIVATE_OUTPUT", errors: ["PRIVATE_SECRET"], session_id: "PRIVATE_SESSION" },
    } as never));
    expect(evidence).toMatchObject({ settlement: "unknown", diagnostics: { terminalResult: {
      status: "error", type: "result", subtype: "error_during_execution", isError: true, hint: "auth" } } });
    expect(JSON.stringify(evidence)).not.toContain("PRIVATE");
  });
});
