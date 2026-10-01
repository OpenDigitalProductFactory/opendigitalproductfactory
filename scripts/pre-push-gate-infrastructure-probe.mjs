#!/usr/bin/env node
// pre-push-gate-infrastructure-probe.mjs — CLI the pre-push hook runs when the
// override reason is `gate-infrastructure-unavailable` (BI-02E5F2A1).
//
// Re-attempts the gate's own lease claim and prints ONE JSON line on stdout:
//   { ok: true,  evidence: {...} }            exit 0 — infrastructure failed; the
//                                              hook embeds `evidence` in the
//                                              gate-UNRUN record
//   { ok: false, outcome, refusal, details? } exit 1 — the claim succeeded or was
//                                              refused by a healthy server; the
//                                              override is refused
// Usage errors exit 2. Human-readable lines go to stderr only.
//
// Logic lives in scripts/lib/pre-push-gate-infrastructure-probe.mjs; this file
// is the process boundary.

import { parseArgs as utilParseArgs } from "node:util";
import { resolveWorktreeContext } from "./pregate-status.mjs";
import { createLocalCiSlotManifest } from "./lib/local-ci-slot-manifest.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";
import { probeGateInfrastructure } from "./lib/pre-push-gate-infrastructure-probe.mjs";

function usage() {
  process.stderr.write(
    "usage: node scripts/pre-push-gate-infrastructure-probe.mjs [--branch <name>] [--sha <sha>] [--mcp-url <url>]\n",
  );
}

export function parseArgs(argv, env = process.env) {
  const { values } = utilParseArgs({
    args: argv,
    options: {
      branch: { type: "string" },
      sha: { type: "string" },
      "mcp-url": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return null;
  return {
    branch: values.branch ?? "",
    sha: values.sha ?? "",
    mcpUrl: values["mcp-url"] ?? (env.DPF_MCP_URL || "http://127.0.0.1:3000/api/mcp/v1"),
  };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    usage();
    process.exit(2);
  }
  if (!options) { usage(); process.exit(2); }

  const context = resolveWorktreeContext();
  if (!context) {
    process.stderr.write("pre-push-gate-infrastructure-probe: not inside a git worktree\n");
    process.exit(2);
  }
  const manifest = createLocalCiSlotManifest({
    slotKey: process.env.DPF_LOCAL_CI_SLOT_KEY || "slot-0",
    rootClone: context.rootClone,
    gitCommonDir: context.gitCommonDir,
    candidateGitDir: context.candidateGitDir,
  });

  const result = await probeGateInfrastructure({
    mcpUrl: options.mcpUrl,
    branch: options.branch || context.headBranch,
    sha: options.sha || context.headSha,
    worktreePath: context.worktreePath,
    portalUrl: manifest.portal.url,
    ports: [manifest.portal.port, manifest.postgres.hostPort],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.ok) {
    process.stderr.write(
      `[pre-push-gate] infrastructure failure captured: ${result.evidence.kind} — ${result.evidence.message}\n`,
    );
    process.exit(0);
  }
  process.stderr.write(`[pre-push-gate] ${result.refusal}\n`);
  process.exit(1);
}

if (isEntryModule(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`pre-push-gate-infrastructure-probe: ${error?.stack || error}\n`);
    process.exit(2);
  });
}
