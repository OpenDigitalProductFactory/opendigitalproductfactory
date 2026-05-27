#!/usr/bin/env node
/**
 * CLI entry point that runs the live MCP read-only `tools/list` probe and the
 * kernel-principle smoke probe, then emits a single JSON document on stdout
 * the shell adapter merges into install-state.json.
 *
 * Usage (run via tsx from the workspace):
 *   pnpm --filter @dpf/bootstrap exec tsx src/agent-toolchain/cli/run-probes.ts \
 *     --mcp-endpoint <url> \
 *     [--token <bearer>] \
 *     [--mcp-timeout-ms <int>] \
 *     [--smoke-timeout-ms <int>]
 *
 * Output (stdout):
 *   {
 *     "mcpReadiness": <McpReadinessProbeResult>,
 *     "smokeTest":    <SmokeTestResult>,
 *     "smokeClient":  "claude" | "codex" | null
 *   }
 *
 * Diagnostics go to stderr. The bearer token is accepted only via the
 * `--token` flag and never logged or echoed; the result objects contain no
 * bearer values per the probes' redaction contract.
 *
 * Token handling: the bearer is passed as a flag (rather than read from the
 * environment) so the shell adapter can scope its lifetime exactly to this
 * subprocess and avoid leaking it into other tsx invocations. The adapter is
 * responsible for not echoing the flag value to logs.
 */

import { runMcpReadinessProbe, runSmokeProbe } from "../probes";

type ParsedArgs = {
  values: Record<string, string>;
  flags: Set<string>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags.add(arg.slice(2));
    } else {
      values[arg.slice(2)] = next;
      i++;
    }
  }
  return { values, flags };
}

function requireArg(values: Record<string, string>, key: string): string {
  const v = values[key];
  if (!v) {
    process.stderr.write(`run-probes: missing required --${key}\n`);
    process.exit(64);
  }
  return v;
}

const { values, flags } = parseArgs(process.argv.slice(2));

if (flags.has("help") || flags.has("h")) {
  process.stderr.write(
    "Usage: tsx run-probes.ts --mcp-endpoint <url> [--token <bearer>] [--mcp-timeout-ms <int>] [--smoke-timeout-ms <int>]\n",
  );
  process.exit(0);
}

const endpoint = requireArg(values, "mcp-endpoint");
const token = values["token"] ?? "";
const mcpTimeoutMs = values["mcp-timeout-ms"] ? Number(values["mcp-timeout-ms"]) : undefined;
const smokeTimeoutMs = values["smoke-timeout-ms"] ? Number(values["smoke-timeout-ms"]) : undefined;

async function main() {
  process.stderr.write(`[dpf-bootstrap] running MCP readiness probe -> ${endpoint}\n`);
  const mcpReadiness = await runMcpReadinessProbe({
    endpoint,
    token,
    timeoutMs: mcpTimeoutMs,
  });
  process.stderr.write(`[dpf-bootstrap] MCP probe result: ${JSON.stringify({ ok: mcpReadiness.ok, reason: mcpReadiness.ok ? null : mcpReadiness.reason })}\n`);

  process.stderr.write(`[dpf-bootstrap] running kernel-principle smoke probe\n`);
  const smoke = await runSmokeProbe({
    hasToken: token.length > 0,
    timeoutMs: smokeTimeoutMs,
  });
  process.stderr.write(`[dpf-bootstrap] smoke probe (${smoke.client}) result: ${smoke.result.result}\n`);

  const output = {
    mcpReadiness,
    smokeTest: smoke.result,
    smokeClient: smoke.client,
  };
  process.stdout.write(JSON.stringify(output, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`run-probes: ERROR ${(err as Error).message}\n`);
  process.exit(1);
});
