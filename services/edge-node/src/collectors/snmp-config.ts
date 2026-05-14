// SNMP target configuration for the C3 collector.
//
// SNMP needs more than one or two values per device — version, port,
// community string (v2c) or a USM tuple (v3) — so we config it via a
// JSON file rather than env vars. Two reasons:
//
//   1. SNMPv3 has auth + priv passwords. Env vars are visible to
//      anyone who can `docker inspect` the container; a bind-mounted
//      0600 JSON file is the conventional way to scope secret access
//      to the runtime UID.
//   2. Each device has its own credentials. Comma-encoded env-var
//      lists become unreadable past two or three targets.
//
// Operator workflow:
//
//   1. Create /etc/dpf-edge/snmp.json on the host (mode 0600 or 0640
//      with the dpf group), populate with target list.
//   2. Bind-mount it into the container at the path pointed to by
//      DPF_EDGE_SNMP_CONFIG (default /etc/dpf-edge/snmp.json).
//   3. Restart the edge-node service.
//
// Default behavior with NO config file present: C3 is a no-op — zero
// targets, zero polls. The collector is opt-in by configuration; an
// operator who hasn't decided which devices to poll gets exactly the
// behavior they expect (nothing).
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § Edge Node capability envelope — capability.discovery.network

import { readFileSync, statSync } from "node:fs";

/** Resolved per-target configuration. */
export type SnmpTarget =
  | {
      host: string;
      version: "2c";
      community: string;
      port: number;
      timeoutMs: number;
    }
  | {
      host: string;
      version: "3";
      user: string;
      authProtocol: "MD5" | "SHA";
      authPassword: string;
      privProtocol: "DES" | "AES";
      privPassword: string;
      port: number;
      timeoutMs: number;
    };

export type SnmpConfigResolution = {
  /** Resolved targets — empty list = collector no-op. */
  targets: SnmpTarget[];
  /** Non-fatal config warnings (bad fields, file perms, etc.). */
  warnings: string[];
  /** Where the targets came from; "none" when no config was found. */
  source: "file" | "none";
};

/** Adapter for tests — replaces fs + env. */
export type SnmpConfigAdapter = {
  env: NodeJS.ProcessEnv;
  readFile: (path: string) => string;
  statMode: (path: string) => number;
};

const DEFAULT_ADAPTER: SnmpConfigAdapter = {
  env: process.env,
  readFile: (p) => readFileSync(p, "utf8"),
  statMode: (p) => statSync(p).mode & 0o777,
};

const DEFAULT_CONFIG_PATH = "/etc/dpf-edge/snmp.json";
const DEFAULT_PORT = 161;
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Resolve the SNMP target list. Pure function modulo the adapter.
 *
 * Failure modes:
 *   - File missing → empty targets, source="none" (operator hasn't
 *     opted in; collector is a no-op).
 *   - File present but world-readable → warning + still read (we
 *     surface the perms issue; we don't refuse to start, since the
 *     operator may intentionally have looser perms in dev).
 *   - File present but invalid JSON → warning + empty targets.
 *   - File present, valid JSON, but no valid targets → warning +
 *     empty targets.
 */
export function resolveSnmpConfig(
  adapter: SnmpConfigAdapter = DEFAULT_ADAPTER,
): SnmpConfigResolution {
  const path = adapter.env.DPF_EDGE_SNMP_CONFIG ?? DEFAULT_CONFIG_PATH;
  const warnings: string[] = [];

  // Check perms first — informational warning only.
  let modeBits: number | null = null;
  try {
    modeBits = adapter.statMode(path);
  } catch {
    // File doesn't exist (most common case — operator hasn't opted in).
    return { targets: [], warnings, source: "none" };
  }

  if (modeBits !== null && (modeBits & 0o077) !== 0) {
    warnings.push(
      `snmp: config file ${path} is group/world-readable (mode 0${modeBits.toString(8).padStart(3, "0")}); ` +
        `SNMPv3 credentials in it are exposed. Recommend chmod 0600 ${path}.`,
    );
  }

  // Read + parse.
  let raw: string;
  try {
    raw = adapter.readFile(path);
  } catch (err) {
    warnings.push(
      `snmp: config file ${path} exists but is unreadable: ${(err as Error).message}`,
    );
    return { targets: [], warnings, source: "none" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    warnings.push(
      `snmp: config file ${path} is not valid JSON: ${(err as Error).message}`,
    );
    return { targets: [], warnings, source: "file" };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { targets?: unknown }).targets)
  ) {
    warnings.push(
      `snmp: config file ${path} must be a JSON object with a "targets" array`,
    );
    return { targets: [], warnings, source: "file" };
  }

  const rawTargets = (parsed as { targets: unknown[] }).targets;
  const targets: SnmpTarget[] = [];
  for (let i = 0; i < rawTargets.length; i++) {
    const t = rawTargets[i];
    const validated = validateTarget(t, i, warnings);
    if (validated !== null) targets.push(validated);
  }

  if (targets.length === 0 && rawTargets.length > 0) {
    warnings.push(
      `snmp: config file ${path} contained ${rawTargets.length} target(s) but none were valid`,
    );
  }

  return { targets, warnings, source: "file" };
}

function validateTarget(
  raw: unknown,
  index: number,
  warnings: string[],
): SnmpTarget | null {
  if (typeof raw !== "object" || raw === null) {
    warnings.push(`snmp: target[${index}] is not an object — skipped`);
    return null;
  }
  const t = raw as Record<string, unknown>;

  const host = stringField(t, "host");
  if (host === null) {
    warnings.push(`snmp: target[${index}] missing required "host" — skipped`);
    return null;
  }

  const version = t.version;
  const port = numberField(t, "port") ?? DEFAULT_PORT;
  const timeoutMs = numberField(t, "timeoutMs") ?? DEFAULT_TIMEOUT_MS;
  if (port < 1 || port > 65535) {
    warnings.push(
      `snmp: target[${index}] (${host}) port out of range — skipped`,
    );
    return null;
  }
  if (timeoutMs < 100 || timeoutMs > 60_000) {
    warnings.push(
      `snmp: target[${index}] (${host}) timeoutMs out of range (100..60000) — skipped`,
    );
    return null;
  }

  if (version === "2c") {
    const community = stringField(t, "community");
    if (community === null) {
      warnings.push(
        `snmp: target[${index}] (${host}) v2c requires "community" — skipped`,
      );
      return null;
    }
    return { host, version: "2c", community, port, timeoutMs };
  }

  if (version === "3") {
    const user = stringField(t, "user");
    const authProtocol = t.authProtocol;
    const authPassword = stringField(t, "authPassword");
    const privProtocol = t.privProtocol;
    const privPassword = stringField(t, "privPassword");
    if (
      user === null ||
      authPassword === null ||
      privPassword === null ||
      (authProtocol !== "MD5" && authProtocol !== "SHA") ||
      (privProtocol !== "DES" && privProtocol !== "AES")
    ) {
      warnings.push(
        `snmp: target[${index}] (${host}) v3 requires user, authProtocol (MD5|SHA), authPassword, privProtocol (DES|AES), privPassword — skipped`,
      );
      return null;
    }
    return {
      host,
      version: "3",
      user,
      authProtocol,
      authPassword,
      privProtocol,
      privPassword,
      port,
      timeoutMs,
    };
  }

  warnings.push(
    `snmp: target[${index}] (${host}) version must be "2c" or "3" — skipped`,
  );
  return null;
}

function stringField(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function numberField(o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
