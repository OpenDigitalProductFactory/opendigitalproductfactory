#!/usr/bin/env node
// Compose bind-posture guard (BI-FEE77B68, kernel decision DI-946636F6E8F6).
//
// Every host-published port in docker-compose.yml must bind through
// ${DPF_HOST_BIND_ADDRESS:-127.0.0.1}. Short syntax ("3000:3000") publishes on
// every interface, which put the admin login, postgres and redis on the LAN of
// every install (GitHub issue #4337). One variable governs the whole file so
// the posture cannot regress one service at a time.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const BIND_VAR = "DPF_HOST_BIND_ADDRESS";
export const BIND_DEFAULT = "127.0.0.1";
export const REQUIRED_HOST_PART = `\${${BIND_VAR}:-${BIND_DEFAULT}}`;
export const GUARDED_FILES = ["docker-compose.yml"];

/** Returns the `- "host:container"` port entries under each `ports:` block. */
export function portEntries(text) {
  const out = [];
  let inPorts = false;
  let portsIndent = -1;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (/^\s*ports:\s*$/.test(line)) {
      inPorts = true;
      portsIndent = indent;
      continue;
    }
    if (inPorts) {
      if (indent <= portsIndent) {
        inPorts = false;
      } else {
        const m = line.trim().match(/^-\s*"?([^"]+?)"?\s*$/);
        if (m) out.push({ line: i + 1, value: m[1].trim() });
        continue;
      }
    }
  }
  return out;
}

/** The host part of a port mapping: everything before the last two colon-separated fields. */
export function hostPartOfMapping(value) {
  // Split on colons outside ${...} so "${A:-${B:-127.0.0.1}}:636:636" keeps its host part whole.
  const fields = [];
  let depth = 0;
  let current = "";
  for (const c of value) {
    if (c === "{") depth += 1;
    else if (c === "}") depth = Math.max(0, depth - 1);
    if (c === ":" && depth === 0) {
      fields.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  fields.push(current);
  if (fields.length < 3) return null; // "host:container" or bare "container"
  return fields.slice(0, -2).join(":");
}

/** A service may keep its own override as long as it falls back to the host variable. */
const SERVICE_OVERRIDE_RE = /^\$\{DPF_[A-Z0-9_]+_BIND_ADDRESS:-\$\{DPF_HOST_BIND_ADDRESS:-127\.0\.0\.1\}\}$/;

/** Accepted host parts: the host variable, a per-service override nested on it,
 *  or a hardcoded loopback (stricter than the default, so never a regression). */
export function hostPartIsAcceptable(host) {
  return host === REQUIRED_HOST_PART || host === BIND_DEFAULT || SERVICE_OVERRIDE_RE.test(host ?? "");
}

export function findBindPostureViolations(file, text) {
  const violations = [];
  for (const entry of portEntries(text)) {
    const host = hostPartOfMapping(entry.value);
    if (hostPartIsAcceptable(host)) continue;
    violations.push({
      file,
      line: entry.line,
      value: entry.value,
      message:
        host === null
          ? `publishes "${entry.value}" on every interface; write "${REQUIRED_HOST_PART}:${entry.value}"`
          : `binds "${entry.value}" to "${host}"; the host part must be "${REQUIRED_HOST_PART}"`,
    });
  }
  return violations;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const violations = GUARDED_FILES.flatMap((file) =>
    findBindPostureViolations(file, readFileSync(join(root, file), "utf8")),
  );
  if (violations.length === 0) {
    console.log(`compose-bind-posture: OK (${GUARDED_FILES.join(", ")} publish only through ${REQUIRED_HOST_PART})`);
    return;
  }
  console.error(`compose-bind-posture: ${violations.length} violation(s)`);
  for (const v of violations) console.error(`  ${v.file}:${v.line} ${v.message}`);
  console.error(`Operators opt into LAN exposure with ${BIND_VAR}=0.0.0.0 in .env; the shipped default is loopback.`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
