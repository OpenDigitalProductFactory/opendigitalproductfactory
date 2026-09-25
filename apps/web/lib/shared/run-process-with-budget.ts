import { spawn } from "node:child_process";

/** Exit code reported for a process killed at its budget (GNU `timeout` convention). */
export const PROCESS_TIMEOUT_EXIT_CODE = 124;

export type BudgetedProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** stdout exactly as the process wrote it; `stdout` is its UTF-8 decoding. */
  stdoutBytes: Buffer;
  /** True when the process was stopped because its stdout passed `maxStdoutBytes`. */
  outputLimitExceeded: boolean;
};

export type BudgetedProcessOptions = {
  timeoutMs: number;
  /**
   * Name of the container the process runs, if any. Killing a local `docker
   * run` client does not stop the daemon-side container, so on a timeout or an
   * output overrun the container is force-removed by this name.
   */
  containerName?: string;
  /** Bytes written to the child's stdin, which is then closed. */
  stdin?: Buffer;
  /** Marker written to stderr on a timeout, as `[<label>]`. */
  timeoutLabel?: string;
  /** Stop the process once its stdout grows past this many bytes. */
  maxStdoutBytes?: number;
  /** Removes a container by name. Defaults to `docker rm -f <name>`. */
  removeContainer?: (name: string) => Promise<void>;
};

/**
 * Force-remove a container by name. Best-effort and never throws: it is the
 * cleanup half of a kill, so a daemon that is already gone is not an error.
 */
export async function forceRemoveContainer(name: string): Promise<void> {
  if (!name) return;
  await new Promise<void>((resolve) => {
    try {
      const child = spawn("docker", ["rm", "-f", name], { env: { ...process.env } });
      child.stdout?.on("data", () => {});
      child.stderr?.on("data", () => {});
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    } catch {
      resolve();
    }
  });
}

/**
 * Spawn a process under a hard wall-clock budget. On expiry: kill the child,
 * force-remove `containerName` (so a daemon-side container actually stops —
 * killing the local client does not), and resolve with exit 124 and a
 * `[<timeoutLabel>]` marker on stderr. Rejects only when the process cannot be
 * spawned at all. Shared by the self-upgrade promoter and the document
 * converter (BI-52E565DA).
 */
export async function runProcessWithBudget(
  command: string,
  args: string[],
  opts: BudgetedProcessOptions,
): Promise<BudgetedProcessResult> {
  const removeContainer = opts.removeContainer ?? forceRemoveContainer;
  const label = opts.timeoutLabel ?? "promoter-timeout";
  return new Promise((done, reject) => {
    const child = spawn(command, args, { env: { ...process.env }, shell: false });

    const chunks: Buffer[] = [];
    let stdoutLength = 0;
    let stderr = "";
    let settled = false;
    let outputLimitExceeded = false;

    const result = (exitCode: number): BudgetedProcessResult => {
      const stdoutBytes = Buffer.concat(chunks);
      return { exitCode, stdout: stdoutBytes.toString("utf8"), stderr, stdoutBytes, outputLimitExceeded };
    };

    const stop = (exitCode: number) => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      void removeContainer(opts.containerName ?? "").finally(() => done(result(exitCode)));
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const seconds = Math.round(opts.timeoutMs / 1000);
      stderr += `\n[${label}] process did not finish within ${seconds}s — killed and container force-removed.`;
      stop(PROCESS_TIMEOUT_EXIT_CODE);
    }, opts.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      const limit = opts.maxStdoutBytes;
      if (limit !== undefined && stdoutLength + chunk.length > limit) {
        settled = true;
        clearTimeout(timer);
        outputLimitExceeded = true;
        stderr += `\n[output-limit] stdout passed ${limit} bytes — killed and container force-removed.`;
        stop(1);
        return;
      }
      chunks.push(chunk);
      stdoutLength += chunk.length;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk;
    });

    if (opts.stdin) {
      // A child that exits before reading all of stdin raises EPIPE here; its
      // exit code is the verdict, not the broken pipe.
      child.stdin.on("error", () => {});
      child.stdin.end(opts.stdin);
    }

    child.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(result(code ?? 1));
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}
