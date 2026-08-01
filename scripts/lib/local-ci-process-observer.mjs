import { spawn, spawnSync } from "node:child_process";
import { freemem, loadavg, totalmem } from "node:os";

import { BoundedTextTail } from "./bounded-text-tail.mjs";

const DEFAULT_SAMPLE_INTERVAL_MS = 5_000;
const MAX_HOST_SAMPLES = 120;

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

export function createObservedProcessRunner({
  spawnImpl = spawn,
  sampleHost = hostProcessSample,
  stdout = process.stdout,
  stderr = process.stderr,
  sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS,
  outputTailBytes = 64 * 1024,
  onProgress = () => {},
} = {}) {
  return function runObservedProcess({ command, args, env = process.env, observation = {} }) {
    return new Promise((resolveAttempt) => {
      const output = new BoundedTextTail(outputTailBytes);
      const hostSamples = [];
      const startedAt = new Date().toISOString();
      let spawnError = null;
      const child = spawnImpl(command, args, {
        env,
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      const sample = () => {
        if (child.pid && hostSamples.length < MAX_HOST_SAMPLES) {
          const host = sampleHost(child.pid);
          hostSamples.push(host);
          onProgress({
            ...observation,
            childPid: child.pid,
            host,
            outputTail: output.toString(),
          });
        }
      };
      sample();
      const sampler = setInterval(sample, sampleIntervalMs);
      sampler.unref();

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
        clearInterval(sampler);
        sample();
        resolveAttempt({
          ...observation,
          status,
          signal,
          error: spawnError,
          outputTail: output.toString(),
          childPid: child.pid ?? null,
          hostSamples,
          startedAt,
          completedAt: new Date().toISOString(),
        });
      });
    });
  };
}
