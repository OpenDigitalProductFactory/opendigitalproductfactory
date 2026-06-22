#!/usr/bin/env node
// scripts/sbom/check-new-dependencies.mjs
//
// The New Dependency Gate — kernel-selected #1 of the package-acquisition
// hardening program (principle_decide 2026-06-20: composite 9.39, margin 1.72,
// confidence high; top pulls "Least privilege / deny by default", "Build Gate
// Mandatory", "Never adopt an unvetted external tool"). The kernel also ranked a
// manual vetting *checklist* LAST — it scored negative on "Do the work; don't
// task the operator" — so this gate AUTOMATES the front door instead: nothing
// becomes a direct dependency without a deliberate, recorded acknowledgement.
//
// What it does: fails a PR that adds a DIRECT dependency (a package a workspace
// declares) not already acknowledged in sbom/dependency-allowlist.json. New
// transitive packages ride in via direct deps and are covered by the OSV scan
// (scan-dependencies.mjs) + reduction guard (check-sbom-drift.mjs); the
// *acquisition decision* lives at the direct-dep boundary, which is what this
// governs. Pure Node, network-free — safe as a required CI check.
//
// Vetting a new dependency before you acknowledge it: provenance (npm
// attestation), package age + download count, maintainer count, license,
// `pnpm scan:deps` (OSV), and whether an existing dependency already covers it.
// Record the outcome in the allowlist entry's `note`.
//
// Usage:
//   node scripts/sbom/check-new-dependencies.mjs                  # gate (CI / pre-PR)
//   node scripts/sbom/check-new-dependencies.mjs --update-allowlist  # acknowledge current set

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listDirectDependencies } from "./generate-platform-sbom.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALLOWLIST_PATH = join(ROOT, "sbom", "dependency-allowlist.json");
const update = process.argv.includes("--update-allowlist");

function loadAllowlist() {
  try {
    return JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  } catch {
    return null;
  }
}

const NOTE = "Acknowledged DIRECT dependencies. The New Dependency Gate (scripts/sbom/check-new-dependencies.mjs) fails a PR that adds a direct dependency not listed here, so every acquired package is a deliberate, recorded decision. Add an entry ONLY after vetting: npm provenance attestation, package age + downloads, maintainer count, license, `pnpm scan:deps` (OSV), and whether an existing dep already covers it — record the outcome in `note`. See docs/architecture/dependency-reduction-routine.md.";

function main() {
  const current = listDirectDependencies(ROOT); // Map<name,{workspaces:Set,kinds:Set}>
  const today = new Date().toISOString().slice(0, 10);

  if (update) {
    const prior = loadAllowlist()?.dependencies ?? {};
    const dependencies = {};
    for (const name of [...current.keys()].sort()) {
      const info = current.get(name);
      dependencies[name] = prior[name] ?? {
        added: today,
        workspaces: [...info.workspaces].sort(),
        kinds: [...info.kinds].sort(),
        note: "bootstrap — pre-existing dependency, acknowledged in bulk",
      };
    }
    writeFileSync(ALLOWLIST_PATH, JSON.stringify({ note: NOTE, dependencies }, null, 2) + "\n");
    process.stdout.write(`Allowlist updated: ${ALLOWLIST_PATH} (${Object.keys(dependencies).length} direct deps acknowledged)\n`);
    return;
  }

  const allow = loadAllowlist();
  if (!allow) {
    process.stderr.write(`::error::No dependency allowlist at ${ALLOWLIST_PATH}. Seed it with: node scripts/sbom/check-new-dependencies.mjs --update-allowlist\n`);
    process.exit(1);
  }
  const acknowledged = new Set(Object.keys(allow.dependencies || {}));
  const newNames = [...current.keys()].filter((n) => !acknowledged.has(n)).sort();
  const removed = [...acknowledged].filter((n) => !current.has(n)).sort();

  if (removed.length) {
    process.stdout.write(`Note: ${removed.length} acknowledged dep(s) no longer declared (prune from allowlist when convenient): ${removed.slice(0, 20).join(", ")}\n`);
  }

  if (newNames.length) {
    process.stderr.write(
      [
        `::error::${newNames.length} new direct dependenc${newNames.length === 1 ? "y" : "ies"} not acknowledged in sbom/dependency-allowlist.json:`,
        ...newNames.map((n) => {
          const info = current.get(n);
          return `    - ${n}  (${[...info.kinds].join("/")} in ${[...info.workspaces].join(", ")})`;
        }),
        "",
        "  Acquiring a new package adds supply-chain surface. Before acknowledging, vet it:",
        "    provenance · package age + downloads · maintainers · license · `pnpm scan:deps` (OSV) · is it already covered?",
        "  Then record the decision:",
        "    node scripts/sbom/check-new-dependencies.mjs --update-allowlist   (edit the entry's `note` with what you found)",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  process.stdout.write(`OK — no new direct dependencies (${acknowledged.size} acknowledged).\n`);
}

main();
