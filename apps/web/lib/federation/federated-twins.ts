// Federated twin identity (BI-91FC6B9A).
//
// The same platform defect can be open here twice: once as this install's own
// item and once as a work-sync mirror of the paired install's item. Both carry
// the same intake origin marker (`[origin:<kind>:<id>]`) because both were filed
// by the same front door for the same observation. Twinship is derived from
// those markers alone, so it needs no schema and no write to the peer's record.
//
// Spec: docs/superpowers/specs/2026-10-28-federated-twin-identity-design.md

import {
  FEDERATED_WORK_ORIGIN_MARKER_SQL_PREFIX,
  hasFederatedWorkOriginMarker,
} from "@dpf/db/federated-work-contract";

const ORIGIN_MARKER = /\[origin:([^:\]\r\n]+):([^\]\r\n]+)\]/g;
const FEDERATED_WORK_ORIGIN = /\[origin:federatedWork:(inst_[^:\]\r\n]+):([^\]\r\n]+)\]/;

/** Origin kinds that say where a row came from, not what it observed. */
const FEDERATION_ORIGIN_KINDS: ReadonlySet<string> = new Set(["federatedWork", "federatedDemand"]);

/** Statuses at which an item no longer carries open work. */
export const TWIN_TERMINAL_STATUSES = ["done", "retired", "deferred"] as const;

/** The activity kind recording a twin on this install's own item. */
export const FEDERATED_TWIN_ACTIVITY_KIND = "federated_twin";

export type FederatedWorkClaim = { active: boolean; since: string | null; workrooms: number };

export type TwinCandidate = {
  id: string;
  itemId: string;
  status: string;
  body: string | null;
};

export type FederatedTwin = {
  itemId: string;
  status: string;
  marker: string;
  /** Set when the twin is the paired install's mirror. */
  peer: { installationId: string; itemId: string } | null;
  claim: FederatedWorkClaim | null;
};

/** Every intake origin marker in a body, whole (`[origin:kind:id]`), federation markers excluded. */
export function intakeOriginMarkers(body: string | null): string[] {
  if (!body) return [];
  const markers = new Set<string>();
  for (const match of body.matchAll(ORIGIN_MARKER)) {
    if (!FEDERATION_ORIGIN_KINDS.has(match[1]!)) markers.add(match[0]);
  }
  return [...markers];
}

export function isFederatedMirror(body: string | null): boolean {
  return hasFederatedWorkOriginMarker(body);
}

export function federatedWorkOrigin(body: string | null): { installationId: string; itemId: string } | null {
  const match = body ? FEDERATED_WORK_ORIGIN.exec(body) : null;
  return match ? { installationId: match[1]!, itemId: match[2]! } : null;
}

/**
 * The twins of `item` among `candidates`: open rows sharing an intake origin
 * marker where exactly one side is a mirror. Two local items sharing a marker
 * are intake's concern (it folds them); two mirrors are the peer's.
 */
export function resolveTwins(
  item: TwinCandidate,
  candidates: readonly TwinCandidate[],
  claims: ReadonlyMap<string, FederatedWorkClaim> = new Map(),
): FederatedTwin[] {
  const markers = new Set(intakeOriginMarkers(item.body));
  if (markers.size === 0) return [];
  const itemIsMirror = isFederatedMirror(item.body);
  const twins: FederatedTwin[] = [];
  for (const candidate of candidates) {
    if (candidate.id === item.id) continue;
    if ((TWIN_TERMINAL_STATUSES as readonly string[]).includes(candidate.status)) continue;
    if (isFederatedMirror(candidate.body) === itemIsMirror) continue;
    const marker = intakeOriginMarkers(candidate.body).find((m) => markers.has(m));
    if (!marker) continue;
    twins.push({
      itemId: candidate.itemId,
      status: candidate.status,
      marker,
      peer: federatedWorkOrigin(candidate.body),
      claim: claims.get(candidate.itemId) ?? null,
    });
  }
  return twins;
}

/** A peer twin (or the item itself, when it is a mirror) the paired install is working. */
export function peerWorkInProgress(twin: Pick<FederatedTwin, "status" | "peer" | "claim">): boolean {
  return twin.peer !== null && (twin.status === "in-progress" || twin.claim?.active === true);
}

/** Read the peer's claim from a mirror row payload, tolerating peers that send none. */
export function claimFromMirrorPayload(payload: unknown): FederatedWorkClaim | null {
  if (!payload || typeof payload !== "object") return null;
  const claim = (payload as { claim?: unknown }).claim;
  if (!claim || typeof claim !== "object") return null;
  const { active, since, workrooms } = claim as Record<string, unknown>;
  if (typeof active !== "boolean") return null;
  return {
    active,
    since: typeof since === "string" ? since : null,
    workrooms: typeof workrooms === "number" && Number.isInteger(workrooms) && workrooms >= 0 ? workrooms : 0,
  };
}

// ─── Loaders ────────────────────────────────────────────────────────────────

export type FederatedTwinDb = {
  backlogItem: { findMany(args: unknown): Promise<TwinCandidate[]> };
  federatedRecordMirror: {
    findMany(args: unknown): Promise<Array<{ localRecordRef: string | null; payload: unknown }>>;
  };
};

const CANDIDATE_SELECT = { id: true, itemId: true, status: true, body: true } as const;

/** Open rows carrying any of `markers`. */
async function loadCandidates(db: Pick<FederatedTwinDb, "backlogItem">, markers: readonly string[]): Promise<TwinCandidate[]> {
  if (markers.length === 0) return [];
  return db.backlogItem.findMany({
    where: {
      status: { notIn: [...TWIN_TERMINAL_STATUSES] },
      OR: markers.map((marker) => ({ body: { contains: marker } })),
    },
    select: CANDIDATE_SELECT,
  });
}

async function loadPeerClaims(db: FederatedTwinDb, itemIds: readonly string[]): Promise<Map<string, FederatedWorkClaim>> {
  const claims = new Map<string, FederatedWorkClaim>();
  if (itemIds.length === 0) return claims;
  const rows = await db.federatedRecordMirror.findMany({
    where: { recordType: "backlog-item", canonicalSide: "peer", localRecordRef: { in: [...itemIds] } },
    select: { localRecordRef: true, payload: true },
  });
  for (const row of rows) {
    const claim = claimFromMirrorPayload(row.payload);
    if (row.localRecordRef && claim) claims.set(row.localRecordRef, claim);
  }
  return claims;
}

/** The twins of one item, with the peer's claim on each mirror twin. */
export async function loadFederatedTwins(db: FederatedTwinDb, item: TwinCandidate): Promise<FederatedTwin[]> {
  const candidates = await loadCandidates(db, intakeOriginMarkers(item.body));
  const mirrorIds = candidates.filter((c) => isFederatedMirror(c.body)).map((c) => c.itemId);
  return resolveTwins(item, candidates, await loadPeerClaims(db, mirrorIds));
}

/** The peer's claim on a mirror itself (the item being claimed IS the peer's record). */
export async function loadMirrorClaim(db: FederatedTwinDb, itemId: string): Promise<FederatedWorkClaim | null> {
  return (await loadPeerClaims(db, [itemId])).get(itemId) ?? null;
}

export type TwinActivityDb = {
  backlogItem: { findMany(args: unknown): Promise<TwinCandidate[]> };
  backlogItemActivity: {
    findMany(args: unknown): Promise<Array<{ backlogItemId: string; payload: unknown }>>;
    create(args: unknown): Promise<unknown>;
  };
};

type MirrorRef = { itemId: string; peerStatus: string; body: string | null };

/**
 * Record each twin on this install's own item, once per (local item, mirror)
 * pair. Never writes the mirror: the peer owns it. Returns how many twin
 * records were written. Runs for unchanged mirrors too, so a first cycle
 * backfills the twins that predate it.
 */
export async function recordFederatedTwins(db: TwinActivityDb, mirrors: readonly MirrorRef[], now: Date): Promise<number> {
  const markedMirrors = mirrors
    .map((mirror) => ({ mirror, markers: intakeOriginMarkers(mirror.body), peer: federatedWorkOrigin(mirror.body) }))
    .filter((entry) => entry.markers.length > 0 && entry.peer !== null);
  if (markedMirrors.length === 0) return 0;

  const owned = (await loadCandidates(db, [...new Set(markedMirrors.flatMap((entry) => entry.markers))]))
    .filter((candidate) => !isFederatedMirror(candidate.body));
  if (owned.length === 0) return 0;

  const recorded = new Set<string>();
  for (const row of await db.backlogItemActivity.findMany({
    where: { kind: FEDERATED_TWIN_ACTIVITY_KIND, backlogItemId: { in: owned.map((item) => item.id) } },
    select: { backlogItemId: true, payload: true },
  })) {
    const peerItemId = (row.payload as { peerItemId?: unknown } | null)?.peerItemId;
    if (typeof peerItemId === "string") recorded.add(`${row.backlogItemId}\x00${peerItemId}`);
  }

  let written = 0;
  for (const { mirror, markers, peer } of markedMirrors) {
    for (const local of owned) {
      const marker = intakeOriginMarkers(local.body).find((m) => markers.includes(m));
      if (!marker || recorded.has(`${local.id}\x00${mirror.itemId}`)) continue;
      await db.backlogItemActivity.create({
        data: {
          backlogItemId: local.id,
          kind: FEDERATED_TWIN_ACTIVITY_KIND,
          summary: `Same defect is tracked on the paired installation as ${mirror.itemId} (${mirror.peerStatus})`,
          payload: { peerInstallationId: peer!.installationId, peerItemId: mirror.itemId, peerStatus: mirror.peerStatus, marker, observedAt: now.toISOString() },
        },
      });
      recorded.add(`${local.id}\x00${mirror.itemId}`);
      written++;
    }
  }
  return written;
}

/** Where-clause fragment: rows this install owns (not work-sync mirrors).
 *  NULL-safe: `NOT (body LIKE …)` is NULL for a NULL body, so the null arm is explicit. */
export function ownedRowBodyWhere(): { OR: Array<{ body: null } | { NOT: { body: { contains: string } } }> } {
  return { OR: [{ body: null }, { NOT: { body: { contains: FEDERATED_WORK_ORIGIN_MARKER_SQL_PREFIX } } }] };
}
