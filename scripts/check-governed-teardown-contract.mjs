#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function evaluateGovernedTeardownContract(input) {
  const findings = [];
  if (!/requireCapability\(\s*["']manage_platform["']\s*\)/.test(input.action)) findings.push("teardown actions must require manage_platform");
  if (!/runPostgresTrialRestore\(\s*\{[\s\S]*sourceBackupRunId/.test(input.action)) findings.push("teardown must trial-restore the exact backup receipt");
  if (!/pointer-hold/.test(`${input.action}\n${input.component}`) || !/Press and hold/.test(input.component) || !/Release to cancel/.test(input.component)) findings.push("destructive teardown must use the pointer-hold UI contract");
  if (/<input[^>]+(?:confirm|phrase)|Type\s+(?:purge|delete|confirm)/i.test(input.component)) findings.push("typed teardown confirmation is forbidden");
  if (!/timingSafeEqual/.test(input.runner)) findings.push("teardown runner must verify an authentic signature");
  if (!/removeTreeContentsNoFollow/.test(input.runner)) findings.push("teardown runner must use no-follow source deletion");
  if (!/--project-name/.test(input.runner)) findings.push("teardown Docker mutation must remain project-scoped");
  if (!/teardown_evidence_inside_source/.test(input.runner)) findings.push("teardown runner must reject evidence nested inside source");
  for (const [label, source] of [["promoter", input.dockerfile], ["portal", input.portalDockerfile]]) {
    if (!/governed-teardown\.mjs/.test(source) || !/salvage-sweep\.mjs/.test(source)) findings.push(`${label} image must carry teardown and salvage runner assets`);
  }
  if (input.mcpSources.some((source) => /name\s*:\s*["'][^"']*teardown[^"']*["']/i.test(source))) findings.push("MCP teardown verbs are forbidden; human UI confirmation is required");
  return findings;
}

async function collectMcpSources(root) {
  const sources = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (/\.(?:ts|tsx|mjs)$/.test(entry.name) && !entry.name.includes(".test.")) sources.push(await readFile(target, "utf8"));
    }
  }
  await visit(root);
  return sources;
}

async function main() {
  const root = process.cwd();
  const input = {
    action: await readFile(join(root, "apps/web/lib/actions/teardown.ts"), "utf8"),
    component: await readFile(join(root, "apps/web/components/ops/TeardownControl.tsx"), "utf8"),
    runner: await readFile(join(root, "scripts/governed-teardown.mjs"), "utf8"),
    dockerfile: await readFile(join(root, "Dockerfile.promoter"), "utf8"),
    portalDockerfile: await readFile(join(root, "Dockerfile"), "utf8"),
    mcpSources: await collectMcpSources(join(root, "apps/web/lib/mcp/packs")),
  };
  const findings = evaluateGovernedTeardownContract(input);
  if (findings.length > 0) {
    for (const finding of findings) process.stderr.write(`governed-teardown-contract: ${finding}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("governed-teardown-contract: ok\n");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`governed-teardown-contract: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
