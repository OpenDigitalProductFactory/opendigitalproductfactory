#!/usr/bin/env node
// Compose Recreate-Class Guard (BI-22A2CA0D, part of BI-C54E691E).
//
// Every service in every shipped docker-compose*.yml declares, on the service
// itself, how the self-upgrade promoter may converge it when its rendered
// config changes:
//
//   labels:
//     dpf.recreate-class: stateless | data-owner | managed
//
//   stateless   recreated after the portal swap when its config hash differs
//   data-owner  owns data the portal depends on (postgres, redis, the CA);
//               recreated only when changed, before the swap, behind the
//               recovery point
//   managed     has its own lifecycle step (portal, sandbox, one-shot init
//               jobs, the promoter); convergence leaves it alone
//
// Why: #6020 gave portal-tls a reaping init and attested "auto-converges",
// but nothing in the promoter knew portal-tls could be recreated, so the fix
// never reached the live install (2026-10-06, 11,844 zombie processes).
// The label lives with the service so overlay services, which the capability
// catalog does not model, are covered too (WWMD DI-3A94F2D28550).
//
// A service may be re-declared by overlays; it needs the class in at least one
// file, and every file that states a class must agree.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { parseComposeServices } from "./check-capability-compose-profiles.mjs";
import { gitText } from "./lib/git.mjs";

export const RECREATE_CLASS_LABEL = "dpf.recreate-class";
export const RECREATE_CLASSES = new Set(["stateless", "data-owner", "managed"]);

/** @param {Record<string, string>} files compose file path → source */
export function checkComposeRecreateClasses(files) {
  const errors = [];
  /** @type {Map<string, { files: string[], classes: Array<{ file: string, value: string }> }>} */
  const byService = new Map();
  for (const [file, source] of Object.entries(files)) {
    for (const [name, service] of parseComposeServices(source)) {
      const entry = byService.get(name) ?? { files: [], classes: [] };
      entry.files.push(file);
      const value = service.labels?.[RECREATE_CLASS_LABEL];
      if (value !== undefined) {
        if (!RECREATE_CLASSES.has(value)) errors.push(`invalid_recreate_class:${name} (${file}): ${value}`);
        else entry.classes.push({ file, value });
      }
      byService.set(name, entry);
    }
  }
  for (const [name, entry] of byService) {
    if (entry.classes.length === 0) {
      if (!errors.some((error) => error.startsWith(`invalid_recreate_class:${name} `))) {
        errors.push(`unclassified_compose_service:${name} (${entry.files.join(", ")}): add labels: ${RECREATE_CLASS_LABEL}: stateless|data-owner|managed`);
      }
      continue;
    }
    const [first, ...rest] = entry.classes;
    for (const other of rest) {
      if (other.value !== first.value) {
        errors.push(`conflicting_recreate_class:${name}: ${first.value} (${first.file}) vs ${other.value} (${other.file})`);
      }
    }
  }
  return errors;
}

function trackedComposeFiles() {
  return gitText(["ls-files", "docker-compose*.yml"]).split("\n").filter(Boolean);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const files = Object.fromEntries(trackedComposeFiles().map((file) => [file, readFileSync(file, "utf8")]));
  const errors = checkComposeRecreateClasses(files);
  if (errors.length > 0) {
    console.error(`[compose-recreate-class] ${errors.length} service(s) the self-upgrade cannot classify:`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`[compose-recreate-class] OK: every service in ${Object.keys(files).length} compose file(s) declares ${RECREATE_CLASS_LABEL}.`);
}
