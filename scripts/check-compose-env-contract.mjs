#!/usr/bin/env node
// Compose env-contract guard — prevents the #3262 fleet-wide self-upgrade break.
//
// THE BUG IT CATCHES: PR #3262 added a portal volume
//   - ${DPF_STATE_DIR:-${HOME}/.dpf}:/dpf-state:ro
// `DPF_STATE_DIR` was never added to .env.example and the installer never wrote
// it, so every install fell back to `${HOME}/.dpf`. That is fine for a normal
// `docker compose up` (operator shell, HOME=/Users/...), but the self-upgrade
// PROMOTER runs as ROOT — ${HOME}=/root — so the mount resolved to /root/.dpf,
// which Docker Desktop refuses to share ("mounts denied"), and every upgrade
// died silently at step=migrate. Nothing in CI exercises the promoter's compose
// path, so it shipped to the whole fleet undetected.
//
// TWO STATIC RULES on every VOLUME host-path in the root compose files:
//   A. Every DPF_* var it references MUST be declared in .env.example — the
//      contract that a var the mount depends on is actually provisioned.
//   B. A host/shell var (HOME, USER, LOGNAME, HOSTNAME, PWD, USERPROFILE) may
//      appear ONLY as a fallback default, never as the PRIMARY that determines
//      the path — it resolves differently under the root-run promoter.
//
// Escape hatch: a trailing `# compose-env-allow` comment on the same line.
// Static + deterministic (no daemon), same shape as the other DPF ratchets.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SYSTEM_VARS = new Set(["HOME", "USER", "LOGNAME", "HOSTNAME", "PWD", "USERPROFILE"]);
const ALLOW_MARKER = "# compose-env-allow";

export const COMPOSE_FILES = [
  "docker-compose.yml",
  "docker-compose.linux.yml",
  "docker-compose.macos.yml",
  "docker-compose.edge.yml",
];

/** Declared keys in a .env-style file (KEY= lines, commented or not). */
export function declaredEnvKeys(text) {
  const keys = new Set();
  for (const line of (text ?? "").split(/\r?\n/)) {
    const m = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

/**
 * The host part of a compose volume value — everything up to the first `:` at
 * brace-depth 0 (so the colon inside `${A:-B}` never splits it).
 */
export function hostPartOf(volume) {
  let depth = 0;
  for (let i = 0; i < volume.length; i++) {
    const c = volume[i];
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (c === ":" && depth === 0) return volume.slice(0, i);
  }
  return volume;
}

/** Ordered var references in a `${...}` expression; first is the primary. */
export function varRefs(hostPart) {
  const refs = [];
  const re = /\$\{([A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = re.exec(hostPart))) refs.push(m[1]);
  return refs;
}

/** Pure: violations for one compose file's text given the declared env keys. */
export function findComposeEnvViolations(rel, composeText, declaredKeys) {
  const out = [];
  (composeText ?? "").split(/\r?\n/).forEach((raw, idx) => {
    if (raw.includes(ALLOW_MARKER)) return;
    const m = raw.match(/^\s*-\s+(\$\{[^#]*)/);
    if (!m) return;
    const host = hostPartOf(m[1].trim());
    if (!host.includes("${")) return;
    const refs = varRefs(host);
    if (refs.length === 0) return;
    const where = `${rel}:${idx + 1}`;
    if (SYSTEM_VARS.has(refs[0])) {
      out.push({
        where,
        message:
          `mount host-path uses \${${refs[0]}} as its PRIMARY — that is /root under the ` +
          `root-run self-upgrade promoter. Use an installer-set absolute DPF_* var as the ` +
          `primary and keep \${${refs[0]}} only as a fallback.  ${host}`,
      });
      return;
    }
    for (const v of refs) {
      if (v.startsWith("DPF_") && !declaredKeys.has(v)) {
        out.push({
          where,
          message:
            `mount host-path depends on \${${v}}, which is NOT declared in .env.example — a ` +
            `mount var installs must provide has to be documented there (and written by the ` +
            `installer), else it silently falls back and breaks the self-upgrade promoter (#3262).  ${host}`,
        });
      }
    }
  });
  return out;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const envExample = join(root, ".env.example");
  const declared = existsSync(envExample)
    ? declaredEnvKeys(readFileSync(envExample, "utf8"))
    : new Set();

  const violations = [];
  for (const rel of COMPOSE_FILES) {
    const file = join(root, rel);
    if (!existsSync(file)) continue;
    violations.push(...findComposeEnvViolations(rel, readFileSync(file, "utf8"), declared));
  }

  if (violations.length > 0) {
    console.error("Compose env-contract guard FAILED (#3262 class):\n");
    for (const v of violations) console.error(`  - ${v.where}: ${v.message}\n`);
    console.error(
      "Fix: declare the DPF_* mount var in .env.example (and have the installer write it),\n" +
        "or make the host var a fallback of an installer-set absolute DPF_* primary. A genuinely\n" +
        "safe exception can carry a trailing `# compose-env-allow` comment.",
    );
    process.exit(1);
  }
  console.log(
    `Compose env-contract OK — all volume host-path vars are declared/promoter-safe across ${COMPOSE_FILES.length} compose files.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
