#!/usr/bin/env node
/**
 * BI-4F3AB6B3 — born-bounded resource budgets gate.
 *
 * Requires every service listed under alwaysOnServices in
 * config/install-resource-budgets.json to declare deploy.resources.limits
 * (memory + cpus) in docker-compose.yml. Optional profile services are
 * reported but not hard-failed unless they appear without profiles and without
 * a budget entry (always-on uncapped creep).
 *
 * Usage:
 *   node scripts/check-compose-resource-budgets.mjs
 *   node scripts/check-compose-resource-budgets.mjs --check
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUDGET_PATH = join(ROOT, "config/install-resource-budgets.json");
const COMPOSE_PATH = join(ROOT, "docker-compose.yml");

/**
 * Minimal YAML service-block extractor for docker-compose.yml.
 * Avoids a yaml dependency: we only need service names + whether a limits block
 * appears under each service's deploy.resources tree before the next top-level
 * service key.
 */
export function extractServiceBlocks(composeText) {
  const lines = composeText.split(/\r?\n/);
  /** @type {Map<string, string>} */
  const blocks = new Map();
  let current = null;
  let buf = [];
  let inServices = false;

  for (const line of lines) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (/^[a-zA-Z]/.test(line) && !line.startsWith(" ")) {
      // left services section (volumes/networks top-level)
      if (current) blocks.set(current, buf.join("\n"));
      break;
    }
    const svc = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
    if (svc) {
      if (current) blocks.set(current, buf.join("\n"));
      current = svc[1];
      buf = [line];
      continue;
    }
    if (current) buf.push(line);
  }
  if (current) blocks.set(current, buf.join("\n"));
  return blocks;
}

export function serviceHasResourceLimits(blockText) {
  // Accept either deploy.resources.limits.{memory,cpus} or classic mem_limit/cpus.
  const hasDeployLimits =
    /deploy:\s*[\s\S]*resources:\s*[\s\S]*limits:\s*[\s\S]*memory:\s*\S+/m.test(
      blockText,
    ) &&
    /deploy:\s*[\s\S]*resources:\s*[\s\S]*limits:\s*[\s\S]*cpus:\s*\S+/m.test(
      blockText,
    );
  const hasClassic =
    /mem_limit:\s*\S+/m.test(blockText) && /cpus:\s*\S+/m.test(blockText);
  return hasDeployLimits || hasClassic;
}

export function evaluateResourceBudgets({ budget, composeText }) {
  const blocks = extractServiceBlocks(composeText);
  const errors = [];
  const notes = [];

  const alwaysOn = budget.alwaysOnServices ?? {};
  for (const [service, spec] of Object.entries(alwaysOn)) {
    const block = blocks.get(service);
    if (!block) {
      errors.push(
        `always-on budget lists "${service}" but docker-compose.yml has no such service`,
      );
      continue;
    }
    if (!serviceHasResourceLimits(block)) {
      errors.push(
        `always-on service "${service}" has no deploy.resources.limits (or mem_limit/cpus); budget expects memory=${spec.memory} cpus=${spec.cpus}`,
      );
    } else {
      notes.push(`bounded: ${service} (budget memory=${spec.memory} cpus=${spec.cpus})`);
    }
  }

  // Flag always-on-looking services (restart: unless-stopped, no profiles) that
  // are missing from the budget catalog — release-gate creep detection.
  for (const [name, block] of blocks.entries()) {
    if (alwaysOn[name]) continue;
    if (budget.optionalProfileServices?.[name]) continue;
    const hasProfiles = /profiles:\s*\[/.test(block);
    const alwaysRestart = /restart:\s*unless-stopped/.test(block);
    if (alwaysRestart && !hasProfiles && !serviceHasResourceLimits(block)) {
      errors.push(
        `uncapped always-on service "${name}" is not in config/install-resource-budgets.json — declare a budget or add a profile`,
      );
    }
  }

  return { ok: errors.length === 0, errors, notes };
}

export function sizeWslCeilings(host, policy = {}) {
  const p = {
    memoryShareOfHost: 0.5,
    minMemoryGb: 8,
    maxMemoryGb: 32,
    leaveOsHeadroomGb: 8,
    processorShareOfHost: 0.75,
    minProcessors: 2,
    autoMemoryReclaim: "gradual",
    ...policy,
  };
  const hostRamGb = Number(host.totalMemoryGb);
  const hostCpus = Number(host.logicalProcessors);
  if (!Number.isFinite(hostRamGb) || hostRamGb <= 0) {
    throw new Error("host.totalMemoryGb must be a positive number");
  }
  if (!Number.isFinite(hostCpus) || hostCpus <= 0) {
    throw new Error("host.logicalProcessors must be a positive number");
  }

  const shareGb = Math.floor(hostRamGb * p.memoryShareOfHost);
  const headroomCapped = Math.floor(hostRamGb - p.leaveOsHeadroomGb);
  let memoryGb = Math.min(shareGb, headroomCapped, p.maxMemoryGb);
  memoryGb = Math.max(memoryGb, Math.min(p.minMemoryGb, headroomCapped));
  memoryGb = Math.max(1, memoryGb);

  let processors = Math.floor(hostCpus * p.processorShareOfHost);
  processors = Math.max(p.minProcessors, processors);
  processors = Math.min(hostCpus, processors);

  return {
    memoryGb,
    processors,
    autoMemoryReclaim: p.autoMemoryReclaim,
  };
}

function main() {
  const budget = JSON.parse(readFileSync(BUDGET_PATH, "utf8"));
  const composeText = readFileSync(COMPOSE_PATH, "utf8");
  const result = evaluateResourceBudgets({ budget, composeText });
  for (const n of result.notes) console.log(`[resource-budgets] ${n}`);
  if (!result.ok) {
    console.error("[resource-budgets] FAILED:");
    for (const e of result.errors) console.error(`  • ${e}`);
    process.exit(1);
  }
  console.log("[resource-budgets] always-on services are born-bounded. OK");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
