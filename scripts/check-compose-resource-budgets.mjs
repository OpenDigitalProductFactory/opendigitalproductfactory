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

const GIB = 1024 ** 3;

/** Compose memory limit ("2g", "512m", "1G") in bytes, or null when unreadable. */
export function parseMemoryBytes(value) {
  const match = /^(\d+(?:\.\d+)?)([kmg])b?$/i.exec(String(value ?? "").trim());
  if (!match) return null;
  const unit = { k: 1024, m: 1024 ** 2, g: GIB }[match[2].toLowerCase()];
  return Math.round(Number(match[1]) * unit);
}

/**
 * BI-48EACCB0 (BI-903FB5F9 slice B, WWMD DI-9DEEEA173B48): the largest VM this
 * budget will size must still admit a local-CI build, i.e. hold the always-on
 * stack's memory limits, the builder's measured admission reserve and the
 * admission floor. Evidence decides the VM size; this guard makes a change to
 * any of the three that would leave local-CI unadmittable on every install
 * fail here instead of surfacing as a pool that never opens.
 */
export function evaluateLocalCiFit({ budget, builderReserveBytes, floorBytes }) {
  const maxMemoryGb = Number(budget?.host?.wsl?.maxMemoryGb);
  const limits = Object.values(budget?.alwaysOnServices ?? {}).map((spec) => parseMemoryBytes(spec?.memory));
  if (
    !Number.isFinite(maxMemoryGb) || maxMemoryGb <= 0
    || limits.length === 0 || limits.some((bytes) => bytes === null)
    || !Number.isFinite(builderReserveBytes) || builderReserveBytes <= 0
    || !Number.isFinite(floorBytes) || floorBytes < 0
  ) {
    return { ok: false, message: "local-CI fit cannot be evaluated: the budget, builder reserve or admission floor is unreadable" };
  }
  const vmBytes = maxMemoryGb * GIB;
  const alwaysOnBytes = limits.reduce((sum, bytes) => sum + bytes, 0);
  const headroomBytes = vmBytes - alwaysOnBytes - builderReserveBytes - floorBytes;
  const gib = (bytes) => (bytes / GIB).toFixed(2);
  const arithmetic = `${maxMemoryGb} GiB VM - ${gib(alwaysOnBytes)} always-on - ${gib(builderReserveBytes)} builder reserve - ${gib(floorBytes)} floor`;
  return headroomBytes >= 0
    ? { ok: true, alwaysOnBytes, headroomBytes, message: `local-CI fits the largest budgeted VM: ${arithmetic} = ${gib(headroomBytes)} GiB headroom` }
    : { ok: false, alwaysOnBytes, headroomBytes, message: `the largest budgeted VM cannot admit a local-CI build: ${arithmetic}, short by ${gib(-headroomBytes)} GiB` };
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

async function main() {
  const budget = JSON.parse(readFileSync(BUDGET_PATH, "utf8"));
  const composeText = readFileSync(COMPOSE_PATH, "utf8");
  const result = evaluateResourceBudgets({ budget, composeText });
  // Sources of truth, read rather than copied: the measured builder reserve and
  // the admission floor the pool applies.
  const slotResources = JSON.parse(readFileSync(join(ROOT, "apps/web/lib/nonprod/local-ci-slot-resources.json"), "utf8"));
  const { derivedLocalCiPoolConfig } = await import("../apps/web/lib/nonprod/local-ci-pool-policy.ts");
  const fit = evaluateLocalCiFit({
    budget,
    builderReserveBytes: slotResources.builderPolicy.admissionReserveBytes,
    floorBytes: derivedLocalCiPoolConfig(1).ceilings.minAvailableMemoryBytes,
  });
  if (fit.ok) result.notes.push(fit.message);
  else { result.ok = false; result.errors.push(fit.message); }
  for (const n of result.notes) console.log(`[resource-budgets] ${n}`);
  if (!result.ok) {
    console.error("[resource-budgets] FAILED:");
    for (const e of result.errors) console.error(`  • ${e}`);
    process.exit(1);
  }
  console.log("[resource-budgets] always-on services are born-bounded. OK");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
