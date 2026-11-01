import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { NativeCliDiagnostics } from "../shared/execution-uncertainty";

/** Share host lifetime observation; provider-specific failure policy stays in each adapter. */
export function observeCliProcess(proc: ChildProcessWithoutNullStreams, input: {
  timeoutMs: number;
  onClose: (observation: { code: number | null; stdout: string; stderr: string; diagnostics: NativeCliDiagnostics }) => void;
  onError: (error: Error, observation: { started: boolean; diagnostics: NativeCliDiagnostics }) => void;
}): void {
  let stdout = "", stderr = "", timedOut = false, finished = false, spawned = false;
  proc.on("spawn", () => { spawned = true; });
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
    // The container supervisor independently owns its child and cleanup.
  }, input.timeoutMs);
  proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
  proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
  proc.on("close", (code, signal) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    input.onClose({ code, stdout, stderr, diagnostics: {
      exitCode: code, signal, timedOut, outerProcessClosed: true,
      stdoutPresent: stdout.trim().length > 0, stderrPresent: stderr.trim().length > 0,
      childProcessClosure: "unverified",
    } });
  });
  proc.on("error", (error) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    input.onError(error, { started: spawned || proc.pid !== undefined || stdout.length > 0 || stderr.length > 0,
      diagnostics: { exitCode: null, signal: null, timedOut, outerProcessClosed: false,
        stdoutPresent: stdout.trim().length > 0, stderrPresent: stderr.trim().length > 0,
        childProcessClosure: "unverified" } });
  });
}
