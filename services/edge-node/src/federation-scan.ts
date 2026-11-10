// Federation-candidate scan loop.
//
// `recordNearbyFederationCandidates` had exactly one caller — the Edge Node
// submission route — and the shipping Edge Node never called it. The nearby list
// could therefore never be populated, and the whole zero-touch pairing chain
// (design §5.4-§5.10) waited on an input nothing produced. This is that input.
//
// It runs beside the sweep loop rather than inside it, on a much shorter cadence,
// because the Authority expires a candidate after two minutes while the sweep
// runs every five: a candidate produced by the sweep would be absent from the
// nearby list more often than present.
//
// Env:
//   DPF_FEDERATION_SCAN            0 | false | off to disable. Default: on.
//   DPF_FEDERATION_SCAN_HOSTS      Comma-separated hosts to probe. When set, the
//                                  ARP cache is not consulted. Required on Docker
//                                  Desktop, where a container sees only Docker's
//                                  own network (edge-node deployment matrix).
//   DPF_FEDERATION_SCAN_ENDPOINTS  Comma-separated `scheme:port` pairs.
//                                  Default: https:443,http:3000 — the TLS overlay
//                                  and the plain compose install.
//   DPF_FEDERATION_SCAN_INTERVAL_SEC  Cadence. Default 90.
//   DPF_FEDERATION_SCAN_MAX_TARGETS   Probe ceiling per pass. Default 256.
//
// Design: docs/superpowers/specs/2026-08-23-zero-touch-organization-federation-design.md §5.11

import { isFederationScopedEndpoint, type FederationCandidate } from "./lib/federation-contract";

import { AuthorityHttpError, type AuthorityApiClient } from "./api-client";
import { readArpCache, type ArpAdapter } from "./collectors/arp";
import {
  buildFederationProbeAdapter,
  probeAdvertisedInstallId,
  probeFederationPeer,
  type FederationProbeAdapter,
} from "./collectors/federation-probe";
import type { EdgeNodeConfig } from "./config";
import type { EdgeNodeState } from "./state";

/** Cadence. The Authority expires a candidate after 120s; 90s keeps margin. */
export const DEFAULT_SCAN_INTERVAL_SEC = 90;

/** Probe ceiling for one pass. A truncated pass says so rather than looking complete. */
export const DEFAULT_MAX_TARGETS = 256;

/** Simultaneous probes. Most attempts are a refused connection and return at once. */
export const DEFAULT_CONCURRENCY = 16;

/** The Authority refuses a snapshot larger than this, so the loop never sends one. */
const MAX_CANDIDATES_PER_SNAPSHOT = 50;

export type ScanEndpoint = { scheme: "http" | "https"; port: number };

export const DEFAULT_SCAN_ENDPOINTS: readonly ScanEndpoint[] = [
  // The TLS overlay's Caddy listener — the transport a peer must use to be
  // eligible for anything but a human confirmation.
  { scheme: "https", port: 443 },
  // The plain compose install's published portal port.
  { scheme: "http", port: 3000 },
];

export type FederationScanSettings = {
  enabled: boolean;
  intervalSec: number;
  endpoints: ScanEndpoint[];
  /** Explicit hosts, or null to derive targets from the ARP cache. */
  hosts: string[] | null;
  maxTargets: number;
};

// The portal's `envFlagDisabled` vocabulary, restated because the Edge Node
// deploys as its own artifact and cannot import from apps/web. An operator who
// learns one form of "off" must not find the other half of the feature ignoring
// it, so the token list is kept identical rather than approximated.
const OFF_TOKENS = ["0", "false", "no", "off"];

function readFlag(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === undefined || !OFF_TOKENS.includes(value);
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Parse a `scheme:port` list.
 *
 * A malformed entry is dropped rather than defaulted, so an operator who mistypes
 * one endpoint keeps the others instead of silently getting the built-in list
 * back. An entirely unusable list falls back to the default.
 */
export function parseScanEndpoints(raw: string | undefined): ScanEndpoint[] {
  if (!raw || raw.trim().length === 0) return [...DEFAULT_SCAN_ENDPOINTS];
  const parsed: ScanEndpoint[] = [];
  for (const entry of raw.split(",")) {
    const [scheme, port] = entry.trim().toLowerCase().split(":");
    if (scheme !== "http" && scheme !== "https") continue;
    const portNumber = Number.parseInt(port ?? "", 10);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) continue;
    if (parsed.some((e) => e.scheme === scheme && e.port === portNumber)) continue;
    parsed.push({ scheme, port: portNumber });
  }
  return parsed.length > 0 ? parsed : [...DEFAULT_SCAN_ENDPOINTS];
}

/** Read the loop's settings from the environment. Pure; the loop injects them. */
export function resolveFederationScanSettings(
  env: NodeJS.ProcessEnv = process.env,
): FederationScanSettings {
  const hosts = (env.DPF_FEDERATION_SCAN_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
  return {
    enabled: readFlag(env.DPF_FEDERATION_SCAN),
    intervalSec: readPositiveInt(env.DPF_FEDERATION_SCAN_INTERVAL_SEC, DEFAULT_SCAN_INTERVAL_SEC),
    endpoints: parseScanEndpoints(env.DPF_FEDERATION_SCAN_ENDPOINTS),
    hosts: hosts.length > 0 ? hosts : null,
    maxTargets: readPositiveInt(env.DPF_FEDERATION_SCAN_MAX_TARGETS, DEFAULT_MAX_TARGETS),
  };
}

export type ScanTargets = {
  origins: string[];
  /** How many origins the ceiling removed. Zero means the pass covered everything. */
  dropped: number;
};

/**
 * Build the origins to probe from a host list and an endpoint list.
 *
 * Every origin is checked against the SAME scope rule the Authority accepts by,
 * so a host outside the local segment is never dialled — not merely never
 * submitted. An Edge Node is on the network to describe its own segment, and a
 * scanner that could be pointed at a routable address would be a request-forgery
 * primitive wearing a discovery hat.
 */
export function buildScanTargets(input: {
  hosts: readonly string[];
  endpoints: readonly ScanEndpoint[];
  maxTargets: number;
}): ScanTargets {
  const origins: string[] = [];
  let refused = 0;
  for (const host of input.hosts) {
    const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    for (const endpoint of input.endpoints) {
      const origin = `${endpoint.scheme}://${authority}:${endpoint.port}`;
      if (!isFederationScopedEndpoint(origin)) {
        refused += 1;
        continue;
      }
      if (!origins.includes(origin)) origins.push(origin);
    }
  }
  const kept = origins.slice(0, input.maxTargets);
  return { origins: kept, dropped: refused + (origins.length - kept.length) };
}

/** Probe every target, at most `concurrency` at a time. */
export async function scanFederationCandidates(input: {
  origins: readonly string[];
  probe: (origin: string) => Promise<FederationCandidate | null>;
  concurrency?: number;
  /** This install's own advertised id, so it never reports itself as a peer. */
  selfDiscoveryId?: string | null;
}): Promise<FederationCandidate[]> {
  const concurrency = Math.max(1, input.concurrency ?? DEFAULT_CONCURRENCY);
  const found = new Map<string, FederationCandidate>();
  let next = 0;

  async function worker(): Promise<void> {
    while (next < input.origins.length) {
      const origin = input.origins[next++]!;
      const candidate = await input.probe(origin);
      if (!candidate) continue;
      // An install reached by two addresses is one peer, not two; and it is
      // never its own peer.
      if (input.selfDiscoveryId && candidate.discoveryId === input.selfDiscoveryId) continue;
      const key = `${candidate.discoveryId}\u0000${candidate.endpoint}`;
      if (!found.has(key)) found.set(key, candidate);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, input.origins.length) }, () => worker()),
  );
  // Stable order so an unchanged network produces an unchanged snapshot.
  return [...found.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint));
}

export type FederationScanOptions = {
  config: EdgeNodeConfig;
  api: AuthorityApiClient;
  state: EdgeNodeState;
  settings?: FederationScanSettings;
  probeAdapter?: FederationProbeAdapter;
  arpAdapter?: ArpAdapter;
  sleep?: (ms: number) => Promise<void>;
  log?: (level: "info" | "warn" | "error", msg: string) => void;
  now?: () => Date;
  /** Stop after N passes (test seam). */
  maxIterations?: number;
};

/**
 * Run the scan loop.
 *
 * Fire-and-forget, like the metrics loop: discovery is optional and eventually
 * consistent, so a failed pass must never take down heartbeat or host discovery.
 * Nothing here retries — the next pass is ninety seconds away and the Authority's
 * candidate cache is ephemeral anyway, so a stale re-post would be worth less
 * than a fresh observation.
 */
export async function runFederationScanLoop(opts: FederationScanOptions): Promise<void> {
  const log = opts.log ?? defaultLog;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? (() => new Date());
  const settings = opts.settings ?? resolveFederationScanSettings();
  const { config, api, state } = opts;

  if (!settings.enabled) {
    log("info", "Federation scan disabled by DPF_FEDERATION_SCAN; nearby peers will not be reported.");
    return;
  }

  const probeAdapter = opts.probeAdapter ?? buildFederationProbeAdapter();
  const probe = (origin: string) => probeFederationPeer(origin, probeAdapter);

  // Learn this install's own advertised id once per pass, from the Authority it
  // is enrolled against. Without it the node reports its own portal as a peer the
  // moment the portal is reachable by a second address.
  async function resolveSelfDiscoveryId(): Promise<string | null> {
    return probeAdvertisedInstallId(config.authorityUrl.replace(/\/+$/, ""), probeAdapter);
  }

  let iterations = 0;
  while (true) {
    if (opts.maxIterations !== undefined && iterations >= opts.maxIterations) return;
    iterations += 1;

    if (state.trustState !== "trusted") {
      log(
        "warn",
        `Federation scan skipped because trustState=${state.trustState}; nearby peers are reported once the node is trusted.`,
      );
      await sleep(settings.intervalSec * 1000);
      continue;
    }

    try {
      const hosts = settings.hosts ?? (await hostsFromArpCache(opts.arpAdapter, log));
      const targets = buildScanTargets({
        hosts,
        endpoints: settings.endpoints,
        maxTargets: settings.maxTargets,
      });
      if (targets.dropped > 0) {
        // A silent cap reads as "we looked everywhere". Say what was left out.
        log(
          "warn",
          `Federation scan covered ${targets.origins.length} origins; ${targets.dropped} were skipped (outside the local segment, or past the ${settings.maxTargets}-target ceiling).`,
        );
      }
      if (targets.origins.length > 0) {
        const selfDiscoveryId = await resolveSelfDiscoveryId();
        if (!selfDiscoveryId) {
          // Fail CLOSED. Self-exclusion is a value comparison, so a null id makes
          // the guard vanish and this install publishes ITSELF as a peer -- seen
          // live on 2026-09-05, one flaky self-probe in ~80 passes submitting two
          // candidates that were both this portal. Skipping a pass costs one
          // observation; reporting yourself pollutes every operator's pairing list.
          log(
            "warn",
            "Federation scan skipped this pass: could not read this install's own advertisement, so a peer cannot be told apart from self.",
          );
        } else {
          const candidates = await scanFederationCandidates({
            origins: targets.origins,
            probe,
            selfDiscoveryId,
          });
          await submitCandidates({ api, state, candidates, observedAt: now(), log });
        }
      }
    } catch (err) {
      log("warn", `Federation scan pass failed: ${(err as Error).message}`);
    }

    await sleep(settings.intervalSec * 1000);
  }
}

async function hostsFromArpCache(
  adapter: ArpAdapter | undefined,
  log: (level: "info" | "warn" | "error", msg: string) => void,
): Promise<string[]> {
  const { entries, warnings } = adapter ? await readArpCache(adapter) : await readArpCache();
  for (const warning of warnings) log("warn", `Federation scan: ${warning}`);
  return [...new Set(entries.map((entry) => entry.ip))];
}

async function submitCandidates(args: {
  api: AuthorityApiClient;
  state: EdgeNodeState;
  candidates: FederationCandidate[];
  observedAt: Date;
  log: (level: "info" | "warn" | "error", msg: string) => void;
}): Promise<void> {
  const { api, state, candidates, observedAt, log } = args;
  if (candidates.length === 0) return;
  if (candidates.length > MAX_CANDIDATES_PER_SNAPSHOT) {
    log(
      "warn",
      `Federation scan found ${candidates.length} peers; reporting the first ${MAX_CANDIDATES_PER_SNAPSHOT}, which is the Authority's snapshot ceiling.`,
    );
  }
  try {
    await api.submitFederationCandidates(state.nodeToken, {
      observedAt: observedAt.toISOString(),
      candidates: candidates.slice(0, MAX_CANDIDATES_PER_SNAPSHOT),
    });
    log("info", `Federation candidates submitted: ${Math.min(candidates.length, MAX_CANDIDATES_PER_SNAPSHOT)} nearby peer(s).`);
  } catch (err) {
    if (err instanceof AuthorityHttpError) {
      log(
        "warn",
        `Federation candidate submission refused (HTTP ${err.status} error=${err.errorCode ?? "unknown"}): ${err.message}`,
      );
      return;
    }
    log("warn", `Federation candidate submission failed: ${(err as Error).message}`);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultLog(level: "info" | "warn" | "error", msg: string): void {
  const ts = new Date().toISOString();
  const line = `${ts} [${level}] ${msg}`;
  if (level === "error") console.error(line);
  else console.log(line);
}
