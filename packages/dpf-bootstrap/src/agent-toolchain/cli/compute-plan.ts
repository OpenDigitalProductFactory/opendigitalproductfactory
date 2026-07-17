#!/usr/bin/env node
/**
 * CLI entry point invoked by the PowerShell and Bash shell adapters to get a
 * combined agent-toolchain plan as JSON. The adapter then applies the plan.
 *
 * Usage (run via tsx from the workspace):
 *   pnpm --filter @dpf/bootstrap exec tsx src/agent-toolchain/cli/compute-plan.ts \
 *     --repo-root <path> \
 *     --codex-config <path> \
 *     --claude-plugins <path> \
 *     --kernel-principles <path> \
 *     --contributor-memory <path> \
 *     --project-slug <slug> \
 *     --mcp-endpoint <url> \
 *     --expected-dpf-platform-version <version> \
 *     [--claude-cli-present] [--codex-cli-present] [--grok-cli-present] [--antigravity-cli-present] [--has-token] \
 *     [--reconcile-stale-entries] [--full-tier]
 *
 * The flags map 1:1 onto `ComputeAgentToolchainPlanOptions`. Output is a
 * single JSON document on stdout — the adapter parses and applies. Diagnostic
 * messages go to stderr.
 *
 * No bearer values are accepted or emitted by this CLI. Token presence is
 * communicated as a boolean flag only; the adapter inspects the env var itself.
 *
 * This file is a side-effect script — it is not imported by tests. The
 * `bridge.ts` module it depends on is tested directly via vitest.
 */

import {
  computeAgentToolchainPlan,
  summarizePlan,
  type ComputeAgentToolchainPlanOptions,
} from "../bridge";

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
    process.stderr.write(`compute-plan: missing required --${key}\n`);
    process.exit(64);
  }
  return v;
}

const { values, flags } = parseArgs(process.argv.slice(2));

if (flags.has("help") || flags.has("h")) {
  process.stderr.write(
    "Usage: tsx compute-plan.ts --repo-root <p> --codex-config <p> --claude-plugins <p> --grok-config <p> ...\n",
  );
  process.exit(0);
}

const options: ComputeAgentToolchainPlanOptions = {
  repoRoot: requireArg(values, "repo-root"),
  codexConfigPath: requireArg(values, "codex-config"),
  claudePluginsPath: requireArg(values, "claude-plugins"),
  grokConfigPath: values["grok-config"] || "",  // optional for now; wired by sh/ps1
  antigravityConfigPath: values["antigravity-config"] || "",  // optional; wired by sh/ps1
  kernelPrinciplesDir: requireArg(values, "kernel-principles"),
  contributorMemoryDir: requireArg(values, "contributor-memory"),
  projectSlug: requireArg(values, "project-slug"),
  mcpEndpoint: requireArg(values, "mcp-endpoint"),
  expectedDpfPlatformVersion: requireArg(values, "expected-dpf-platform-version"),
  claudeCliPresent: flags.has("claude-cli-present"),
  codexCliPresent: flags.has("codex-cli-present"),
  grokCliPresent: flags.has("grok-cli-present"),
  antigravityCliPresent: flags.has("antigravity-cli-present"),
  hasToken: flags.has("has-token"),
  reconcileStaleEntries: flags.has("reconcile-stale-entries"),
  commandmentTierOnly: !flags.has("full-tier"),
  installTimeBaseline: values["install-time-baseline"],
};

try {
  const plan = computeAgentToolchainPlan(options);
  process.stderr.write(`[dpf-bootstrap] ${summarizePlan(plan)}\n`);
  process.stdout.write(JSON.stringify(plan, null, 2));
  process.stdout.write("\n");
  process.exit(0);
} catch (err) {
  process.stderr.write(`compute-plan: ERROR ${(err as Error).message}\n`);
  process.exit(1);
}
