import { spawn } from "node:child_process";

export const GATE_CANCELLATION_GRACE_MS = 30_000;
export const GATE_CLOSE_GRACE_MS = 10_000;

// Shared by the existing pregate owner and its saved-trust startup re-exec.
// Keep the owner alive through both child closure and its existing recovery.
export async function withForegroundCancellation(run, { signalSource = process } = {}) {
  const cancellation = new AbortController();
  const interrupt = () => cancellation.abort("SIGINT");
  const terminate = () => cancellation.abort("SIGTERM");
  signalSource.on("SIGINT", interrupt); signalSource.on("SIGTERM", terminate);
  try { return await run(cancellation.signal); }
  finally {
    signalSource.removeListener("SIGINT", interrupt); signalSource.removeListener("SIGTERM", terminate);
  }
}

export function runForegroundGate(command, args, { signal, env = process.env,
  spawnImpl = spawn, platform = process.platform, cancellationGraceMs = GATE_CANCELLATION_GRACE_MS,
  closeGraceMs = GATE_CLOSE_GRACE_MS, windowsHide = false } = {}) {
  if (signal?.aborted) return Promise.resolve({ status: 130, signal: signal.reason, error: null });
  return new Promise(resolveChild => {
    let error = null, stopTimer, closeTimer, settled = false;
    const child = spawnImpl(command, args, { stdio: "inherit", env, windowsHide });
    const finish = (status, childSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(stopTimer); clearTimeout(closeTimer);
      signal?.removeEventListener("abort", cancel);
      resolveChild({ status, signal: childSignal, error });
    };
    const cancel = () => {
      // Windows console Ctrl-C already reached the gate. child.kill("SIGINT")
      // would hard-kill it before its lease/final-state writer can finish.
      if (platform !== "win32") {
        try { child.kill(signal.reason || "SIGTERM"); } catch (value) { error = value; }
      }
      stopTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill("SIGKILL"); } catch (value) { error = value; }
        } // Exact owned child handle; no PID/tree enumeration.
        if (settled) return;
        closeTimer = setTimeout(() => {
          error = new Error("Owned gate did not close after cancellation; terminal recovery is unproven");
          finish(null, signal.reason);
        }, closeGraceMs);
      }, cancellationGraceMs);
    };
    child.once("error", value => { error = value; });
    child.once("close", finish);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
