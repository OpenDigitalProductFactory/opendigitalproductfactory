import * as SecureStore from "expo-secure-store";
import type { InstanceDescriptor } from "@dpf/types";

/**
 * Runtime server (install) configuration.
 *
 * DPF installs one-org-per-install on the customer's own hardware, each at its
 * own URL. A single app-store binary therefore cannot hard-code where to
 * connect — the user points the app at their organization's install, the same
 * pattern Mastodon / Nextcloud / Home Assistant use.
 *
 * This module is the single source of truth for the active install URL. It is
 * read synchronously (`getServerUrl`) by every network caller and persisted
 * across launches via secure storage. See the design at
 * docs/superpowers/specs/2026-06-14-native-mobile-archetype-apps-design.html (§6).
 */

const STORAGE_KEY = "dpf_server_url";

/** Build-time fallback; used until the user connects to their org's install. */
const DEFAULT_SERVER_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

let currentUrl: string = DEFAULT_SERVER_URL;
let configured = false;

/**
 * Canonicalize a user-entered install URL: trim, default the scheme to https
 * (a LAN/localhost install can still be typed with an explicit `http://`),
 * validate, and strip any trailing slash. Throws on empty/invalid input.
 */
export function normalizeServerUrl(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) throw new Error("Server URL is required");

  // Reject an explicit non-http(s) scheme rather than silently coercing it.
  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") {
      throw new Error(`Unsupported URL scheme: ${scheme}`);
    }
  }
  // No scheme typed → default to https (a LAN/localhost install can be typed
  // with an explicit http:// and is preserved).
  const withScheme = schemeMatch ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(`Invalid server URL: ${raw}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${parsed.protocol}`);
  }
  if (!parsed.host) throw new Error(`Invalid server URL: ${raw}`);

  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(
    /\/+$/,
    "",
  );
}

/** Active install base URL (synchronous, in-memory). */
export function getServerUrl(): string {
  return currentUrl;
}

/** True once the user has connected to a specific install this session/launch. */
export function isServerConfigured(): boolean {
  return configured;
}

/**
 * Hydrate the persisted install URL into memory at app start. Must be awaited
 * before the first network call. Falls back to the default on any read error.
 */
export async function loadServerUrl(): Promise<string> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    if (stored) {
      currentUrl = stored;
      configured = true;
    }
  } catch {
    // Keep the default; persistence is best-effort.
  }
  return currentUrl;
}

/** Persist and switch the active install URL. Returns the normalized value. */
export async function setServerUrl(raw: string): Promise<string> {
  const normalized = normalizeServerUrl(raw);
  currentUrl = normalized;
  configured = true;
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, normalized);
  } catch {
    // In-memory switch still applies even if persistence fails.
  }
  return normalized;
}

/** Forget the configured install (e.g. on "disconnect"); resets to the default. */
export async function clearServerUrl(): Promise<void> {
  currentUrl = DEFAULT_SERVER_URL;
  configured = false;
  try {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}

// InstanceDescriptor (the /.well-known/dpf-instance.json wire shape) is the
// shared contract from @dpf/types; re-exported here for callers of this module.
export type { InstanceDescriptor };

/**
 * Fetch and validate the instance descriptor for a candidate URL. Used by the
 * "Connect to your organization" flow to confirm a reachable, genuine DPF
 * install before persisting the URL. Throws if unreachable or malformed.
 */
export async function fetchInstanceDescriptor(
  rawUrl: string,
): Promise<InstanceDescriptor> {
  const baseUrl = normalizeServerUrl(rawUrl);
  const res = await fetch(`${baseUrl}/.well-known/dpf-instance.json`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Not a reachable DPF install (HTTP ${res.status})`);
  }
  const data = (await res.json()) as Partial<InstanceDescriptor> | null;
  if (
    !data ||
    typeof data.instanceId !== "string" ||
    typeof data.apiVersion !== "string"
  ) {
    throw new Error("Response is not a valid DPF instance descriptor");
  }
  return {
    instanceId: data.instanceId,
    orgName: typeof data.orgName === "string" ? data.orgName : "DPF",
    archetype: data.archetype,
    apiVersion: data.apiVersion,
    authModes: Array.isArray(data.authModes) ? data.authModes : ["password"],
    capabilities: data.capabilities,
    branding: data.branding,
  };
}
