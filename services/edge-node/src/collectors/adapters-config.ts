// Configuration loader for the optional vendor adapter collectors
// (UniFi, Kasa, Starlink, Home Assistant). Each adapter has its own
// block in a single JSON file; the absence of a block means "don't
// run". The file path defaults to /etc/dpf-edge/adapters.json and is
// overridable via the DPF_EDGE_ADAPTERS_CONFIG env var.
//
// The pattern matches snmp-config.ts intentionally — adapters carry
// secrets (API keys, controller passwords) and a 0600 bind-mounted
// JSON file is the conventional way to scope secret access to the
// runtime UID. The collector is opt-in: with no file, every adapter
// is a no-op and no warning fires.
//
// Spec: docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md
//   § 4.3 UniFi Adapter — Activation

import { readFileSync, statSync } from "node:fs";

export type UnifiAdapterConfig = {
  controllerUrl: string;
  apiKey: string;
  site: string;
  tlsInsecure: boolean;
};

export type AdaptersConfig = {
  unifi?: UnifiAdapterConfig;
  // Future adapters (kasa, starlink, homeAssistant) will land alongside
  // UniFi as additional optional fields; each gets its own validator
  // below and the loader returns whatever was provided.
};

export type AdaptersConfigResolution = {
  config: AdaptersConfig;
  /** Non-fatal config warnings (bad fields, file perms, missing keys). */
  warnings: string[];
  /** Where the config came from — "none" when no file was found. */
  source: "file" | "none";
};

/** Adapter for tests — replaces fs + env. */
export type AdaptersConfigAdapter = {
  env: NodeJS.ProcessEnv;
  readFile: (path: string) => string;
  statMode: (path: string) => number;
};

const DEFAULT_ADAPTER: AdaptersConfigAdapter = {
  env: process.env,
  readFile: (p) => readFileSync(p, "utf8"),
  statMode: (p) => statSync(p).mode & 0o777,
};

const DEFAULT_CONFIG_PATH = "/etc/dpf-edge/adapters.json";

/**
 * Resolve the adapters configuration. Pure function modulo the adapter.
 *
 * Failure modes (mirrors snmp-config.ts):
 *   - File missing → empty config, source="none".
 *   - File present but world-readable → warning + still read.
 *   - File present but invalid JSON → warning + empty config.
 *   - Block present but invalid fields → warning + that adapter skipped;
 *     other adapters still load.
 */
export function resolveAdaptersConfig(
  adapter: AdaptersConfigAdapter = DEFAULT_ADAPTER,
): AdaptersConfigResolution {
  const path = adapter.env.DPF_EDGE_ADAPTERS_CONFIG ?? DEFAULT_CONFIG_PATH;
  const warnings: string[] = [];

  let modeBits: number | null = null;
  try {
    modeBits = adapter.statMode(path);
  } catch {
    return { config: {}, warnings, source: "none" };
  }

  if (modeBits !== null && (modeBits & 0o077) !== 0) {
    warnings.push(
      `adapters: config file ${path} is group/world-readable (mode 0${modeBits.toString(8).padStart(3, "0")}); ` +
        `API keys and credentials in it are exposed. Recommend chmod 0600 ${path}.`,
    );
  }

  let raw: string;
  try {
    raw = adapter.readFile(path);
  } catch (err) {
    warnings.push(
      `adapters: config file ${path} exists but is unreadable: ${(err as Error).message}`,
    );
    return { config: {}, warnings, source: "none" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    warnings.push(
      `adapters: config file ${path} is not valid JSON: ${(err as Error).message}`,
    );
    return { config: {}, warnings, source: "file" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    warnings.push(`adapters: config file ${path} must be a JSON object`);
    return { config: {}, warnings, source: "file" };
  }

  const config: AdaptersConfig = {};
  const root = parsed as Record<string, unknown>;

  const unifi = validateUnifi(root.unifi, warnings);
  if (unifi !== null) config.unifi = unifi;

  return { config, warnings, source: "file" };
}

function validateUnifi(raw: unknown, warnings: string[]): UnifiAdapterConfig | null {
  if (raw === undefined) return null;
  if (typeof raw !== "object" || raw === null) {
    warnings.push(`adapters: "unifi" block must be an object — skipped`);
    return null;
  }
  const t = raw as Record<string, unknown>;

  const controllerUrl = stringField(t, "controllerUrl");
  if (controllerUrl === null) {
    warnings.push(`adapters: unifi.controllerUrl is required (e.g. "https://192.168.1.1") — skipped`);
    return null;
  }
  if (!/^https?:\/\//i.test(controllerUrl)) {
    warnings.push(
      `adapters: unifi.controllerUrl must start with http:// or https:// — skipped`,
    );
    return null;
  }
  const trimmedUrl = controllerUrl.replace(/\/+$/, "");

  const apiKey = stringField(t, "apiKey");
  if (apiKey === null) {
    warnings.push(`adapters: unifi.apiKey is required — skipped`);
    return null;
  }

  const site = stringField(t, "site") ?? "default";
  const tlsInsecure = booleanField(t, "tlsInsecure") ?? false;

  return { controllerUrl: trimmedUrl, apiKey, site, tlsInsecure };
}

function stringField(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function booleanField(o: Record<string, unknown>, key: string): boolean | null {
  const v = o[key];
  return typeof v === "boolean" ? v : null;
}
