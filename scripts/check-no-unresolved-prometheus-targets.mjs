#!/usr/bin/env node
/**
 * M1 name-set referential integrity — infra tier (BI-47629B5B,
 * docs/superpowers/plans/2026-08-16-late-defect-detection-hardening-plan.md).
 *
 * A Prometheus scrape target is a hardcoded name-set entry that gates behavior:
 * `up == 0` for a target that no longer exists fires ContainerDown/health
 * banners forever. Two shipped incidents in this class:
 *   - BI-31FDC859: a scrape job kept targeting a retired service, producing a
 *     permanent false "Memory offline" banner;
 *   - BI-7988DAD8: the portal probed a sidecar on a path it never served
 *     (name-shaped config drifting from the thing it names).
 *
 * This guard asserts every ACTIVE (non-commented) scrape target host in
 * monitoring/prometheus/*.yml resolves to a service name or container_name
 * defined in the docker-compose*.yml files shipped at the repo root, or to one
 * of the deliberate non-compose hosts (localhost self-scrape,
 * host.docker.internal for native host exporters).
 *
 * The union of ALL root compose files is the resolution universe on purpose:
 * which overlay mounts which prometheus file is substrate-specific, but a
 * target matching NO compose file on any substrate is exactly the retired-
 * service drift this guard exists to refuse.
 *
 *   node scripts/check-no-unresolved-prometheus-targets.mjs   # check (CI)
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROMETHEUS_DIR = join(REPO_ROOT, "monitoring", "prometheus");

/**
 * Hosts that legitimately resolve outside compose: Prometheus's own
 * self-scrape, and the Docker Desktop / native-host bridge used by the
 * windows_exporter job. Additions here need the same "why is this not a
 * compose service" rationale.
 */
export const NON_COMPOSE_HOSTS = Object.freeze(["localhost", "host.docker.internal"]);

/**
 * Active (non-commented) scrape targets from a Prometheus config source.
 * Handles both inline arrays (`- targets: ["a:1", "b:2"]`) and block lists
 * (`- targets:` followed by `- "a:1"` items). Returns {job, host, target}.
 */
export function parseScrapeTargets(source) {
  const out = [];
  let job = null;
  let inTargetsBlock = false;
  let targetsIndent = 0;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed === "") continue;
    const indent = line.length - line.trimStart().length;

    const jobMatch = /^-?\s*job_name:\s*["']?([^"']+?)["']?\s*$/.exec(trimmed);
    if (jobMatch) {
      job = jobMatch[1];
      inTargetsBlock = false;
      continue;
    }

    const inline = /^-?\s*targets:\s*\[(.*)\]\s*$/.exec(trimmed);
    if (inline) {
      for (const m of inline[1].matchAll(/["']([^"']+)["']/g)) {
        out.push(toTarget(job, m[1]));
      }
      inTargetsBlock = false;
      continue;
    }

    if (/^-?\s*targets:\s*$/.test(trimmed)) {
      inTargetsBlock = true;
      targetsIndent = indent;
      continue;
    }

    if (inTargetsBlock) {
      const item = /^-\s*["']?([^"'\s]+?)["']?\s*$/.exec(trimmed);
      if (item && indent > targetsIndent) {
        out.push(toTarget(job, item[1]));
        continue;
      }
      inTargetsBlock = false;
    }
  }
  return out;
}

function toTarget(job, target) {
  const host = target.replace(/:\d+$/, "");
  return { job: job ?? "(no job_name)", host, target };
}

/**
 * Service names and container_name values a compose file defines. Top-level
 * `services:` children only — nested keys (environment, labels…) sit deeper
 * than the two-space service indent.
 */
export function parseComposeServiceNames(source) {
  const names = new Set();
  let inServices = false;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed === "") continue;
    if (/^[A-Za-z_-]+:/.test(line)) {
      // A new top-level key: entering or leaving the services block.
      inServices = line.startsWith("services:");
      continue;
    }
    if (!inServices) continue;
    const svc = /^  ([A-Za-z0-9._-]+):\s*(#.*)?$/.exec(line);
    if (svc) names.add(svc[1]);
    const containerName = /^\s+container_name:\s*["']?([A-Za-z0-9._-]+)["']?\s*$/.exec(line);
    if (containerName) names.add(containerName[1]);
  }
  return names;
}

/**
 * Pure evaluation: every scrape target host in every prometheus config must be
 * a compose-defined service/container name or a listed non-compose host.
 * Returns a list of error strings.
 */
export function evaluatePrometheusTargets({ prometheusConfigs, composeSources }) {
  const errors = [];
  const resolvable = new Set(NON_COMPOSE_HOSTS);
  for (const src of composeSources) {
    for (const name of parseComposeServiceNames(src)) resolvable.add(name);
  }
  if (resolvable.size === NON_COMPOSE_HOSTS.length) {
    errors.push("no compose service names found — compose parsing is broken or the compose files moved");
    return errors;
  }
  for (const { path, source } of prometheusConfigs) {
    const targets = parseScrapeTargets(source);
    if (targets.length === 0) {
      errors.push(`${path}: no active scrape targets parsed — the config moved or the parser regressed`);
      continue;
    }
    for (const { job, host, target } of targets) {
      if (!resolvable.has(host)) {
        errors.push(
          `${path}: job "${job}" scrapes "${target}" but "${host}" is not a service/container in any docker-compose*.yml — a retired or renamed service here fires a permanent false down-alert (BI-31FDC859)`,
        );
      }
    }
  }
  return errors;
}

function loadInputs() {
  const prometheusConfigs = readdirSync(PROMETHEUS_DIR)
    .filter((f) => /^prometheus.*\.ya?ml$/.test(f))
    .map((f) => {
      const path = join("monitoring", "prometheus", f);
      const source = readFileSync(join(PROMETHEUS_DIR, f), "utf8");
      return { path, source };
    })
    .filter(({ source }) => /^scrape_configs:/m.test(source));
  const composeSources = readdirSync(REPO_ROOT)
    .filter((f) => /^docker-compose.*\.ya?ml$/.test(f))
    .map((f) => readFileSync(join(REPO_ROOT, f), "utf8"));
  return { prometheusConfigs, composeSources };
}

function main() {
  const { prometheusConfigs, composeSources } = loadInputs();
  if (prometheusConfigs.length === 0) {
    console.error("no Prometheus scrape configs found under monitoring/prometheus/ — the guard's discovery regressed");
    process.exit(1);
  }
  const errors = evaluatePrometheusTargets({ prometheusConfigs, composeSources });
  if (errors.length > 0) {
    console.error("Prometheus scrape-target referential integrity failed (M1, BI-47629B5B):\n");
    for (const e of errors) console.error(`  - ${e}`);
    console.error(
      "\nEvery scrape target must name a service defined in a root docker-compose*.yml",
    );
    console.error(
      "(or a listed NON_COMPOSE_HOSTS entry). Retiring a service means retiring its",
    );
    console.error("scrape job in the same change — comment it out with the rationale.");
    process.exit(1);
  }
  console.log(
    `Prometheus scrape-target referential integrity OK — ${prometheusConfigs.length} config(s), every active target resolves to a compose service or a listed non-compose host.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
