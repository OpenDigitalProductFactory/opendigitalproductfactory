// EP-ZERO-CONFIG-FEDERATION — the addresses trusted peers reach us at.
//
// A member installation must refuse a join file intended for another host
// (spec §4 invariant 3), so it needs to know its own reachable addresses
// without an operator typing one. Inside the portal container the network
// interfaces show only the Docker bridge, PUBLIC_URL is usually unset on a
// LAN install, and an agent's MCP client arrives over loopback. The one
// zero-config source that is always right is the Host header a TRUSTED
// same-organization peer used when it called us: that address is, by
// construction, one a peer reaches us at.
//
// This module records those hosts (bounded, throttled) in PlatformConfig and
// hands them back as part of the install's own-address set.

import { isRecord } from "@/lib/shared/coerce";

export const FEDERATION_REACHED_AT_CONFIG = "federation.reachedat.v1";
const MAX_HOSTS = 16;
/** A host seen again within this window is not rewritten. */
const REWRITE_INTERVAL_MS = 10 * 60_000;

export interface ReachedAtDb {
  platformConfig: {
    findUnique(args: unknown): Promise<{ value: unknown } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
}

interface ReachedAtV1 {
  schemaVersion: 1;
  hosts: Record<string, string>;
}

function parse(value: unknown): ReachedAtV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.hosts)) return { schemaVersion: 1, hosts: {} };
  const hosts: Record<string, string> = {};
  for (const [host, seen] of Object.entries(value.hosts)) if (typeof seen === "string") hosts[host] = seen;
  return { schemaVersion: 1, hosts };
}

/** Normalise a Host header to a lower-case hostname without port; null when it is not one. */
export function hostnameFromHostHeader(header: string | null | undefined): string | null {
  const raw = header?.split(",")[0]?.trim();
  if (!raw || raw.length > 260) return null;
  try {
    const hostname = new URL(`http://${raw}`).hostname.toLowerCase();
    return hostname || null;
  } catch {
    return null;
  }
}

/** Record that a trusted peer reached us at `hostHeader`. Throttled; never throws. */
export async function recordReachedAtHost(db: ReachedAtDb, hostHeader: string | null | undefined, now: Date = new Date()): Promise<void> {
  const hostname = hostnameFromHostHeader(hostHeader);
  if (!hostname || hostname === "localhost" || hostname.startsWith("127.") || hostname === "::1") return;
  try {
    const row = await db.platformConfig.findUnique({ where: { key: FEDERATION_REACHED_AT_CONFIG }, select: { value: true } });
    const current = parse(row?.value);
    const last = current.hosts[hostname] ? Date.parse(current.hosts[hostname]!) : Number.NaN;
    if (Number.isFinite(last) && now.getTime() - last < REWRITE_INTERVAL_MS) return;
    const entries = Object.entries({ ...current.hosts, [hostname]: now.toISOString() })
      .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]))
      .slice(0, MAX_HOSTS);
    const value: ReachedAtV1 = { schemaVersion: 1, hosts: Object.fromEntries(entries) };
    await db.platformConfig.upsert({
      where: { key: FEDERATION_REACHED_AT_CONFIG },
      create: { key: FEDERATION_REACHED_AT_CONFIG, value },
      update: { value },
    });
  } catch {
    // Best effort: a missed record costs nothing today and is retried on the next call.
  }
}

/** Hostnames trusted peers have reached us at, most recent first. */
export async function readReachedAtHosts(db: ReachedAtDb): Promise<string[]> {
  try {
    const row = await db.platformConfig.findUnique({ where: { key: FEDERATION_REACHED_AT_CONFIG }, select: { value: true } });
    return Object.entries(parse(row?.value).hosts)
      .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]))
      .map(([host]) => host);
  } catch {
    return [];
  }
}
