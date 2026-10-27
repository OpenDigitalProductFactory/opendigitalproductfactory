import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { observeCliProcess } from "./cli-process-observation";
import { NativeCliExecutionUncertainError } from "./cli-owned-runner";
import { executionUncertaintyFromError } from "../shared/execution-uncertainty";

function fixture(script: string, timeoutMs = 5000) {
  return new Promise<Parameters<Parameters<typeof observeCliProcess>[1]["onClose"]>[0]>((resolve, reject) => {
    const proc = spawn(process.execPath, ["-e", script], { stdio: "pipe" });
    observeCliProcess(proc, { timeoutMs, onClose: resolve, onError: reject });
  });
}

describe("native CLI host process observation", () => {
  it("observes a real failed process while keeping output out of durable uncertainty", async () => {
    const result = await fixture("process.stdout.write('fake-private-output'); process.stderr.write('fake-private-error'); process.exitCode = 1;");
    expect(result).toMatchObject({ code: 1, stdout: "fake-private-output", stderr: "fake-private-error",
      diagnostics: { exitCode: 1, outerProcessClosed: true, stdoutPresent: true, stderrPresent: true,
        timedOut: false, childProcessClosure: "unverified" } });
    const evidence = executionUncertaintyFromError(new NativeCliExecutionUncertainError("fixture", result.diagnostics));
    expect(JSON.stringify(evidence)).not.toContain("fake-private");
    expect(evidence.settlement).toBe("unknown");
  });
  it("waits for a real outer close after timeout without claiming the remote child settled", async () => {
    const result = await fixture("setTimeout(() => {}, 10000)", 100);
    expect(result.diagnostics).toMatchObject({ timedOut: true, outerProcessClosed: true, childProcessClosure: "unverified" });
  });
  it("does not trust printable child-closure claims", async () => {
    const result = await fixture("process.stdout.write(JSON.stringify({ childProcessClosed: true, settlement: 'settled' }));");
    expect(result.diagnostics.childProcessClosure).toBe("unverified");
  });
});
