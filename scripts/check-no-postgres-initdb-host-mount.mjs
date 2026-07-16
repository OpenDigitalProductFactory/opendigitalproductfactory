#!/usr/bin/env node
// Ratchet guard — BI-4796D52B.
//
// Forbids ANY docker-compose service from host-bind-mounting a file into
// `/docker-entrypoint-initdb.d`. That pattern (the old
// `- ./scripts/init-inngest-db.sh:/docker-entrypoint-initdb.d/...:ro`) makes
// postgres un-startable whenever compose recreates the container under a
// project directory the Docker daemon can't resolve to a shared host path —
// most acutely the self-upgrade promoter, which runs compose with
// `--project-directory /host-source` (a path that exists only inside the
// promoter container). The recreated container then fails with
// `mounts denied: path /host-source/scripts/init-inngest-db.sh is not shared`,
// stays in state=Created, and the whole install loses its DB mid-upgrade.
//
// The sanctioned pattern is to BAKE init scripts into the image
// (docker/postgres/Dockerfile), which has no host-path dependency. This guard
// keeps the bind-mount form from creeping back.
//
// Contract: exit 0 = clean, non-zero = violation (see check-guards.mjs).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const INITDB_DIR = "/docker-entrypoint-initdb.d";

/**
 * Return the offending compose volume entries that host-bind-mount into
 * /docker-entrypoint-initdb.d. Pure + exported so the sibling self-test can
 * exercise it without a real file.
 *
 * @param {string} composeText raw docker-compose.yml contents
 * @returns {{ line: number, text: string }[]}
 */
export function findInitdbHostMounts(composeText) {
  const violations = [];
  const lines = composeText.split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    // Volume list entries look like `- <source>:<target>[:mode]`.
    if (!line.startsWith("- ")) return;
    if (!line.includes(INITDB_DIR)) return;
    const entry = line.slice(2).trim();
    // Named-volume mounts (`- somevol:/path`) can't carry init scripts and are
    // not the failure mode; a host bind has a path-like source (starts with
    // `.`, `/`, `~`, or a `${VAR}` expansion, or otherwise contains a slash).
    const source = entry.split(":")[0];
    const isHostPath =
      /^[./~]/.test(source) || source.includes("/") || source.includes("${");
    if (isHostPath) violations.push({ line: i + 1, text: line });
  });
  return violations;
}

// --- CLI ---------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const composePath = join(repoRoot, "docker-compose.yml");
  let text;
  try {
    text = readFileSync(composePath, "utf8");
  } catch (err) {
    console.error(`check-no-postgres-initdb-host-mount: cannot read ${composePath}: ${err.message}`);
    process.exit(1);
  }
  const violations = findInitdbHostMounts(text);
  if (violations.length > 0) {
    console.error(
      "Host bind mount(s) into /docker-entrypoint-initdb.d found in docker-compose.yml.",
    );
    console.error(
      "This breaks postgres recreation under `--project-directory /host-source` (self-upgrade promoter, BI-4796D52B).",
    );
    console.error("Bake init scripts into the image (docker/postgres/Dockerfile) instead:");
    for (const v of violations) console.error(`  docker-compose.yml:${v.line}: ${v.text}`);
    process.exit(1);
  }
  console.log("No /docker-entrypoint-initdb.d host bind mounts in docker-compose.yml.");
}
