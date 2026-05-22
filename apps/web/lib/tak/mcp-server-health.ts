// apps/web/lib/mcp-server-health.ts
// MCP initialize handshake for all transports.

import type { McpConnectionConfig, HealthCheckResult } from "./mcp-server-types";
import { lazyChildProcess } from "@/lib/shared/lazy-node";
import { safeSpawn, type SpawnFn } from "@/lib/security/safe-spawn";
import { assertSafeOutboundUrl } from "@/lib/security/safe-fetch";

const HTTP_TIMEOUT_MS = 5_000;
const STDIO_TIMEOUT_MS = 10_000;

const MCP_INITIALIZE_REQUEST = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "dpf-health-check", version: "1.0.0" },
  },
};

function isServerless(): boolean {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
}

async function checkHttp(url: string, headers?: Record<string, string>): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    // BI-5E53A265 follow-up (CodeQL alert #38): the MCP transport URL is
    // admin-configured but still user-controlled in the SSRF sense — a
    // misconfigured (or compromised-admin) entry could point at internal
    // services or cloud-metadata IPs. assertSafeOutboundUrl gates scheme +
    // private-network. The explicit hostname-format regex below gives
    // CodeQL's js/request-forgery query a recognised sanitiser signal.
    let validated: URL;
    try {
      validated = assertSafeOutboundUrl(url);
    } catch (e) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: e instanceof Error ? e.message : "Invalid URL",
      };
    }
    if (!/^[a-z0-9][a-z0-9.-]*$/i.test(validated.hostname)) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: `Invalid hostname: ${validated.hostname}`,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    const res = await fetch(validated.href, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(MCP_INITIALIZE_REQUEST),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return { healthy: false, latencyMs, error: `HTTP ${res.status}` };
    }

    const body = await res.json();
    if (body?.result?.protocolVersion || body?.result?.serverInfo) {
      return { healthy: true, latencyMs };
    }
    if (body?.error) {
      return { healthy: false, latencyMs, error: `MCP error: ${body.error.message ?? JSON.stringify(body.error)}` };
    }
    return { healthy: true, latencyMs };
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

async function checkStdio(command: string, args?: string[], env?: Record<string, string>): Promise<HealthCheckResult> {
  if (isServerless()) {
    return { healthy: false, latencyMs: 0, error: "stdio transport not supported on serverless runtime" };
  }

  const start = Date.now();
  try {
    const { spawn } = lazyChildProcess();
    // BI-7DB95878 fix: safeSpawn enforces an allowlist on `command` and
    // strips exec-hijacking env vars (LD_PRELOAD, NODE_OPTIONS, etc.)
    // before invoking spawn. A misconfigured (or malicious) MCP entry
    // with `command: "/bin/sh"` is rejected with a structured error
    // instead of running arbitrary shell. See safe-spawn.ts for the
    // allowlist + the test suite that pins the contract.
    // Cast to the narrower (command, args, options) shape. Node's spawn
    // is overloaded — including a (command, options) form whose second
    // arg is SpawnOptions, not args[] — so a direct pass doesn't match
    // safeSpawn's signature. The runtime call is the same.
    const spawnResult = safeSpawn(spawn as unknown as SpawnFn, command, args ?? [], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (!spawnResult.ok) {
      return { healthy: false, latencyMs: Date.now() - start, error: spawnResult.error };
    }
    return new Promise<HealthCheckResult>((resolve) => {
      const proc = spawnResult.proc;
      // We requested stdio: ["pipe", "pipe", "pipe"], so stdout and stdin
      // are guaranteed non-null at runtime. The wider ChildProcess type
      // returned by safeSpawn doesn't carry the literal-tuple narrowing,
      // so we assert here. If stdio config ever changes, the !-asserts
      // become the failure surface and the tests catch it.
      const procStdout = proc.stdout!;
      const procStdin = proc.stdin!;

      const timeout = setTimeout(() => {
        proc.kill();
        resolve({ healthy: false, latencyMs: Date.now() - start, error: "Timeout" });
      }, STDIO_TIMEOUT_MS);

      let stdout = "";
      procStdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        try {
          const lines = stdout.split("\n").filter(Boolean);
          for (const line of lines) {
            const parsed = JSON.parse(line);
            if (parsed?.result?.protocolVersion || parsed?.result?.serverInfo) {
              clearTimeout(timeout);
              proc.kill();
              resolve({ healthy: true, latencyMs: Date.now() - start });
              return;
            }
          }
        } catch {
          // Not complete JSON yet
        }
      });

      proc.on("error", (err: Error) => {
        clearTimeout(timeout);
        resolve({ healthy: false, latencyMs: Date.now() - start, error: err.message });
      });

      proc.on("close", (code: number | null) => {
        clearTimeout(timeout);
        if (code !== 0 && code !== null) {
          resolve({ healthy: false, latencyMs: Date.now() - start, error: `Process exited with code ${code}` });
        }
      });

      procStdin.write(JSON.stringify(MCP_INITIALIZE_REQUEST) + "\n");
    });
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function checkMcpServerHealth(config: McpConnectionConfig): Promise<HealthCheckResult> {
  switch (config.transport) {
    case "http":
      return checkHttp(config.url, config.headers);
    case "sse":
      return checkHttp(config.url, config.headers);
    case "stdio":
      return checkStdio(config.command, config.args, config.env);
    default:
      return { healthy: false, latencyMs: 0, error: `Unknown transport: ${(config as { transport: string }).transport}` };
  }
}
