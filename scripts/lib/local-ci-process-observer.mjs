import { spawn, spawnSync } from "node:child_process";
import { freemem, loadavg, totalmem } from "node:os";

import { BoundedTextTail } from "./bounded-text-tail.mjs";

const DEFAULT_SAMPLE_INTERVAL_MS = 5_000;
const MAX_HOST_SAMPLES = 120;

function errorEvidence(error) {
  return error
    ? {
        name: error.name ?? "Error",
        code: error.code ?? null,
        message: error.message ?? String(error),
      }
    : null;
}

export function descendantProcesses(rootPid, {
  platform = process.platform,
  spawnSyncImpl = spawnSync,
} = {}) {
  try {
    if (platform === "win32") {
      const script = [
        `$root = ${Number(rootPid)}`,
        "$rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name)",
        "$ids = [System.Collections.Generic.HashSet[uint32]]::new()",
        "[void]$ids.Add([uint32]$root)",
        "do { $before = $ids.Count; foreach ($row in $rows) { if ($ids.Contains([uint32]$row.ParentProcessId)) { [void]$ids.Add([uint32]$row.ProcessId) } } } while ($ids.Count -gt $before)",
        "$rows | Where-Object { $ids.Contains([uint32]$_.ProcessId) } | ConvertTo-Json -Compress",
      ].join("; ");
      const result = spawnSyncImpl("powershell.exe", ["-NoProfile", "-Command", script], {
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
      });
      if (result.status !== 0 || !result.stdout.trim()) return [];
      const parsed = JSON.parse(result.stdout);
      return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
        pid: Number(row.ProcessId),
        parentPid: Number(row.ParentProcessId),
        name: String(row.Name ?? "unknown"),
      }));
    }

    const result = spawnSyncImpl("ps", ["-eo", "pid=,ppid=,comm="], {
      encoding: "utf8",
      timeout: 5_000,
    });
    if (result.status !== 0) return [];
    const rows = result.stdout.split(/\r?\n/).map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      return match
        ? { pid: Number(match[1]), parentPid: Number(match[2]), name: match[3] }
        : null;
    }).filter(Boolean);
    const ids = new Set([Number(rootPid)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        if (ids.has(row.parentPid) && !ids.has(row.pid)) {
          ids.add(row.pid);
          changed = true;
        }
      }
    }
    return rows.filter((row) => ids.has(row.pid));
  } catch {
    return [];
  }
}

export function hostProcessSample(childPid) {
  return {
    observedAt: new Date().toISOString(),
    freeMemoryBytes: freemem(),
    totalMemoryBytes: totalmem(),
    loadAverage: loadavg(),
    descendants: descendantProcesses(childPid),
  };
}

export function terminateProcessTree(rootPid, {
  platform = process.platform,
  force = false,
  spawnSyncImpl = spawnSync,
  killImpl = process.kill,
} = {}) {
  if (!Number.isInteger(Number(rootPid)) || Number(rootPid) <= 0) {
    return { ok: false, force, error: { name: "Error", code: "invalid-pid", message: "A positive child PID is required" } };
  }

  if (platform === "win32") {
    const args = ["/PID", String(rootPid), "/T", ...(force ? ["/F"] : [])];
    try {
      const result = spawnSyncImpl("taskkill.exe", args, {
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
      });
      return {
        ok: result.status === 0,
        force,
        command: "taskkill.exe",
        args,
        status: result.status ?? null,
        signal: result.signal ?? null,
        error: errorEvidence(result.error),
      };
    } catch (error) {
      return { ok: false, force, command: "taskkill.exe", args, error: errorEvidence(error) };
    }
  }

  const signal = force ? "SIGKILL" : "SIGTERM";
  const groupPid = -Number(rootPid);
  try {
    killImpl(groupPid, signal);
    return { ok: true, force, signal, groupPid };
  } catch (error) {
    return { ok: false, force, signal, groupPid, error: errorEvidence(error) };
  }
}

export function createObservedProcessRunner({
  spawnImpl = spawn,
  sampleHost = hostProcessSample,
  stdout = process.stdout,
  stderr = process.stderr,
  sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS,
  outputTailBytes = 64 * 1024,
  onProgress = () => {},
  maxDurationMs = null,
  terminationGraceMs = 10_000,
  closeGraceMs = 10_000,
  terminateProcessTreeImpl = terminateProcessTree,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  now = () => new Date().toISOString(),
  platform = process.platform,
} = {}) {
  return function runObservedProcess({ command, args, env = process.env, observation = {}, cwd, shell = platform === "win32", signal: cancellationSignal }) {
    if (cancellationSignal?.aborted) return Promise.resolve({ ...observation, status: null,
      signal: null, error: null, cancelled: true, childPid: null, outputTail: "", hostSamples: [],
      startedAt: now(), completedAt: now(), deadlineExceeded: false });
    return new Promise((resolveAttempt) => {
      const output = new BoundedTextTail(outputTailBytes);
      const hostSamples = [];
      const startedAt = now();
      const boundedDurationMs = Number.isInteger(maxDurationMs) && maxDurationMs > 0
        ? maxDurationMs
        : null;
      const deadlineAt = boundedDurationMs === null
        ? null
        : new Date(Date.parse(startedAt) + boundedDurationMs).toISOString();
      let spawnError = null;
      let progressError = null;
      const notify = event => {
        try { onProgress(event); } catch (error) { progressError ??= error; }
      };
      let settled = false;
      let deadlineExceeded = false;
      let cancelled = false;
      let stopAttemptedAt = null;
      let stopResult = null;
      let forceAttemptedAt = null;
      let forceResult = null;
      let closeTimedOutAt = null;
      let deadlineTimer = null;
      let forceTimer = null;
      let closeTimer = null;
      const child = spawnImpl(command, args, {
        env,
        cwd,
        shell,
        detached: platform !== "win32" && boundedDurationMs !== null,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      const sample = () => {
        if (child.pid) {
          const host = sampleHost(child.pid);
          hostSamples.push(host);
          if (hostSamples.length > MAX_HOST_SAMPLES) hostSamples.shift();
          notify({
            ...observation,
            childPid: child.pid,
            host,
            outputTail: output.toString(),
          });
        }
      };
      sample();
      const sampler = setIntervalImpl(sample, sampleIntervalMs);
      sampler.unref();

      const finish = (status, signal, { closeTimedOut = false } = {}) => {
        if (settled) return;
        settled = true;
        clearIntervalImpl(sampler);
        clearTimeoutImpl(deadlineTimer);
        clearTimeoutImpl(forceTimer);
        clearTimeoutImpl(closeTimer);
        cancellationSignal?.removeEventListener("abort", abort);
        sample();
        resolveAttempt({
          ...observation,
          status,
          signal,
          error: spawnError ?? progressError,
          outputTail: output.toString(),
          childPid: child.pid ?? null,
          hostSamples,
          startedAt,
          completedAt: now(),
          maxDurationMs: boundedDurationMs,
          deadlineAt,
          deadlineExceeded,
          cancelled,
          stopAttemptedAt,
          stopResult,
          forceAttemptedAt,
          forceResult,
          closeTimedOutAt,
          closeTimedOut,
        });
      };
      const stopTree = (force) => {
        if (platform === "win32" && (child.exitCode != null || child.signalCode != null)) return { ok: false, force,
          error: { code: "owned-process-exited", message: "Owned child exited; do not target a reused PID." } };
        try {
          return terminateProcessTreeImpl(child.pid, { force });
        } catch (error) {
          return { ok: false, force, error: errorEvidence(error) };
        }
      };

      child.stdout.on("data", (chunk) => {
        output.append(chunk);
        stdout.write(chunk);
      });
      child.stderr.on("data", (chunk) => {
        output.append(chunk);
        stderr.write(chunk);
      });
      child.once("error", (error) => {
        spawnError = error;
      });
      child.once("close", (status, signal) => {
        finish(status, signal);
      });

      const stop = reason => {
          if (settled || stopAttemptedAt) return;
          deadlineExceeded = reason === "timeout";
          cancelled = reason === "cancelled";
          sample();
          stopAttemptedAt = now();
          stopResult = stopTree(false);
          notify({
            ...observation,
            childPid: child.pid ?? null,
            deadlineExceeded,
            maxDurationMs: boundedDurationMs,
            deadlineAt,
            stopAttemptedAt,
            stopResult,
            outputTail: output.toString(),
          });
          forceTimer = setTimeoutImpl(() => {
            if (settled) return;
            forceAttemptedAt = now();
            forceResult = stopTree(true);
            notify({
              ...observation,
              childPid: child.pid ?? null,
              deadlineExceeded,
              maxDurationMs: boundedDurationMs,
              deadlineAt,
              stopAttemptedAt,
              stopResult,
              forceAttemptedAt,
              forceResult,
              outputTail: output.toString(),
            });
            closeTimer = setTimeoutImpl(() => {
              if (settled) return;
              closeTimedOutAt = now();
              finish(null, null, { closeTimedOut: true });
            }, closeGraceMs);
          }, terminationGraceMs);
      };
      const abort = () => stop("cancelled");
      cancellationSignal?.addEventListener("abort", abort, { once: true });
      if (cancellationSignal?.aborted) abort();
      if (boundedDurationMs !== null) deadlineTimer = setTimeoutImpl(() => stop("timeout"), boundedDurationMs);
    });
  };
}
