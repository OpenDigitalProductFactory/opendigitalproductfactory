/**
 * Side-effect probe runners for the agent-toolchain bootstrap.
 *
 * These are the only functions in @dpf/bootstrap that touch the network or
 * spawn child processes. Everything else in the package is pure planning
 * (data-in / data-out). Keeping the side-effect surface this small lets the
 * tests use targeted FS / fetch / child_process mocks without polluting the
 * planning-library tests.
 *
 * Bearer-token discipline: the probes never embed bearer values in their
 * results. `runMcpReadinessProbe` accepts a token but only sends it in the
 * HTTP Authorization header; the returned `McpReadinessProbeResult` never
 * contains the token. `runSmokeProbe` passes transcripts through
 * `redactTranscriptForPersistence` before returning.
 */

import { spawn } from "node:child_process";

import { interpretMcpReadinessResponse } from "./mcp-readiness-probe";
import {
  interpretSmokeResponse,
  redactTranscriptForPersistence,
  renderSmokeTestScenario,
} from "./smoke-test";
import type {
  McpReadinessProbeResult,
  SmokeTestResult,
} from "./types";

const DEFAULT_MCP_TIMEOUT_MS = 5_000;
const DEFAULT_SMOKE_TIMEOUT_MS = 60_000;

/**
 * Run the read-only MCP `tools/list` probe.
 *
 * Returns `{ ok: false, reason: "no_token", httpStatus: null }` when the
 * caller has no bearer; otherwise POSTs an MCP `tools/list` JSON-RPC envelope
 * and interprets the response via `interpretMcpReadinessResponse`.
 */
export async function runMcpReadinessProbe(args: {
  endpoint: string;
  /** Bearer token. Empty string means no token configured. */
  token: string;
  /** Caller-supplied fetch (defaults to globalThis.fetch). For test injection. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in milliseconds. Defaults to 5 seconds. */
  timeoutMs?: number;
  /** Current time, ISO. Defaults to `new Date().toISOString()`. */
  observedAt?: string;
}): Promise<McpReadinessProbeResult> {
  const observedAt = args.observedAt ?? new Date().toISOString();

  if (!args.token) {
    return { ok: false, reason: "no_token", httpStatus: null };
  }

  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const timeoutMs = args.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(args.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
      signal: controller.signal,
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    return interpretMcpReadinessResponse(response.status, body, observedAt);
  } catch (err) {
    // AbortError or network failure both map to endpoint_unreachable.
    void err;
    return { ok: false, reason: "endpoint_unreachable", httpStatus: null };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Result of a single CLI's smoke probe attempt.
 */
export type ClientSmokeResult = {
  client: "claude" | "codex";
  result: SmokeTestResult;
};

/**
 * Run the kernel-principle smoke probe against detected CLIs.
 *
 * Detects `claude` and `codex` on PATH (via `which` / `where`). For each
 * present CLI, invokes the documented one-shot mode with the
 * `renderSmokeTestScenario` prompt, captures stdout (bearer-redacted), and
 * interprets the response via `interpretSmokeResponse`.
 *
 * Skipped if neither CLI is on PATH OR if the caller indicates no token is
 * configured (the smoke prompt asks the agent to use governed tools; without
 * a token even a kernel-aware agent has nothing to reach for).
 */
export async function runSmokeProbe(args: {
  hasToken: boolean;
  /** Override path lookup for tests. */
  cliPath?: { claude?: string; codex?: string };
  /** Per-invocation timeout in milliseconds. Defaults to 60 seconds. */
  timeoutMs?: number;
  /** Test-mode spawn override; defaults to `node:child_process` `spawn`. */
  spawnImpl?: typeof spawn;
}): Promise<ClientSmokeResult> {
  if (!args.hasToken) {
    return { client: "claude", result: { result: "skipped", reason: "no_token" } };
  }

  const scenario = renderSmokeTestScenario();
  const timeoutMs = args.timeoutMs ?? DEFAULT_SMOKE_TIMEOUT_MS;
  const spawnFn = args.spawnImpl ?? spawn;

  // Prefer claude (the operator's primary client today). Codex follows in a
  // future iteration when its one-shot flag is stabilized.
  const claudeCmd = args.cliPath?.claude ?? "claude";

  const claudePresent = await hasOnPath(claudeCmd);
  if (!claudePresent) {
    // Fall through to codex.
    const codexCmd = args.cliPath?.codex ?? "codex";
    const codexPresent = await hasOnPath(codexCmd);
    if (!codexPresent) {
      return {
        client: "claude",
        result: { result: "skipped", reason: "claude_not_on_path" },
      };
    }
    // Codex one-shot invocation; flag set documented per developers.openai.com/codex
    return {
      client: "codex",
      result: await invokeOneShot(spawnFn, codexCmd, [
        "exec",
        "--print",
        scenario.prompt,
      ], timeoutMs, scenario),
    };
  }

  return {
    client: "claude",
    result: await invokeOneShot(spawnFn, claudeCmd, [
      "--print",
      "--output-format=text",
      scenario.prompt,
    ], timeoutMs, scenario),
  };
}

async function hasOnPath(cmd: string): Promise<boolean> {
  // Use absolute-path test directly when cmd contains a path separator
  // (test injection or operator-pinned path).
  if (cmd.includes("/") || cmd.includes("\\")) {
    try {
      const { existsSync } = await import("node:fs");
      return existsSync(cmd);
    } catch {
      return false;
    }
  }
  // Use `where` on Windows, `command -v` elsewhere. Both exit non-zero when
  // the binary is absent.
  const probe = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? [cmd] : ["-v", cmd];
  try {
    const { spawn } = await import("node:child_process");
    return await new Promise<boolean>((resolve) => {
      const child = spawn(probe, args, { stdio: "ignore", shell: false });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    });
  } catch {
    return false;
  }
}

async function invokeOneShot(
  spawnFn: typeof spawn,
  cmd: string,
  cliArgs: string[],
  timeoutMs: number,
  scenario: ReturnType<typeof renderSmokeTestScenario>,
): Promise<SmokeTestResult> {
  return new Promise<SmokeTestResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawnFn(cmd, cliArgs, { stdio: ["ignore", "pipe", "pipe"] });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve({
        result: "failed",
        transcript: redactTranscriptForPersistence(stdout),
        reason: `CLI did not respond within ${timeoutMs}ms.`,
      });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        result: "failed",
        transcript: redactTranscriptForPersistence(stdout + stderr),
        reason: `CLI spawn error: ${err.message}`,
      });
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve({
          result: "failed",
          transcript: redactTranscriptForPersistence(stdout + stderr),
          reason: `CLI exited ${code}`,
        });
        return;
      }
      resolve(interpretSmokeResponse(stdout, scenario));
    });
  });
}
