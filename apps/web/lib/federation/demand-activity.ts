// EP-DELIVERY-FLOW · BI-77A2E4D1 — federated demand sync-activity read model.
//
// Answers the operator's plain question: "how can I see what's actually
// happening, and where did the data originate?" The Connections page manages
// LINKS; this surfaces the DEMAND that has actually crossed them — each mirrored
// record with its ORIGIN (this installation vs. which peer), its DIRECTION
// (outbound/inbound), its sync status, and, when a delivery is stuck, the
// operator-facing reason (so a "peer responded 422" is visible in the UI instead
// of buried in the database).
//
// The mapping is pure and dependency-free (exhaustively unit-testable); only
// `listRecentDemandSyncActivity` touches the database.

import type { PrismaClient } from "@dpf/db";

/** canonicalSide "local" ⇒ this installation originated the item (we deliver it
 *  outward). "peer" ⇒ the peer originated it (we received it). */
export type DemandSyncDirection = "outbound" | "inbound";

/** Operator-legible lifecycle state, derived from the mirror's raw sync fields. */
export type DemandSyncStatus =
  | "delivered"
  | "pending"
  | "failed"
  | "conflict"
  | "dead-lettered";

export interface DemandSyncActivityRow {
  mirrorId: string;
  /** The kind of record that crossed (today: "demand"). */
  recordType: string;
  /** Redacted, human-facing label for the item (title-only; body never crosses). */
  title: string;
  direction: DemandSyncDirection;
  /** Where the item ORIGINATED — "This installation" or the peer's display name. */
  originLabel: string;
  /** The other end of the connection (the peer's display name). */
  peerLabel: string;
  status: DemandSyncStatus;
  /** Why it is stuck, when it is (delivery error or conflict reason); else null. */
  detail: string | null;
  attempts: number;
  /** Most recent activity instant, ISO — for "last updated" display + ordering. */
  lastActivityISO: string;
}

/** The subset of a FederatedRecordMirror row this read model needs. Keeping it
 *  structural (not the Prisma type) lets the mapper be tested without a DB. */
export interface DemandMirrorInput {
  mirrorId: string;
  federationLinkId: string;
  recordType: string;
  canonicalSide: string;
  syncStatus: string;
  conflictReason: string | null;
  deliveryAttempts: number;
  lastDeliveryError: string | null;
  deadLetteredAt: Date | null;
  lastDeliveryAt: Date | null;
  lastSyncedAt: Date | null;
  updatedAt: Date;
  payload: unknown;
}

export interface DemandDeliveryJobInput {
  sourceId: string | null;
  status: string;
  attemptCount: number;
  nextAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
  completedAt: Date | null;
}

const LOCAL_INSTALLATION_LABEL = "This installation";

/** Pull a safe, human-facing title out of the stored envelope payload. The
 *  federation contract is title-only across an org boundary, so a title is the
 *  most descriptive thing we can honestly show; fall back to a neutral label. */
export function extractDemandTitle(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const direct = p.title;
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    const envelope = p.envelope;
    if (envelope && typeof envelope === "object") {
      const nested = (envelope as Record<string, unknown>).title;
      if (typeof nested === "string" && nested.trim()) return nested.trim();
    }
    const content = p.content;
    if (content && typeof content === "object") {
      const nested = (content as Record<string, unknown>).title;
      if (typeof nested === "string" && nested.trim()) return nested.trim();
    }
  }
  return "(demand item)";
}

/** Derive the operator-legible status. Order matters: a dead-letter or an
 *  unresolved conflict outranks the raw syncStatus; a pending row that carries a
 *  delivery error is a live failure the operator should see, not silent. */
export function deriveDemandSyncStatus(input: DemandMirrorInput): DemandSyncStatus {
  if (input.deadLetteredAt) return "dead-lettered";
  if (input.conflictReason) return "conflict";
  const s = input.syncStatus.toLowerCase();
  if (s === "synced" || s === "acknowledged" || s === "delivered") return "delivered";
  if (input.lastDeliveryError) return "failed";
  return "pending";
}

function lastActivity(input: DemandMirrorInput): Date {
  return input.lastDeliveryAt ?? input.lastSyncedAt ?? input.updatedAt;
}

/** Pure mapper: one mirror row → one activity row, resolving the origin against a
 *  linkId→display-name lookup the caller supplies. */
export function toDemandSyncActivityRow(
  input: DemandMirrorInput,
  linkDisplayNameById: ReadonlyMap<string, string>,
  deliveryJob?: DemandDeliveryJobInput,
): DemandSyncActivityRow {
  const peerLabel = linkDisplayNameById.get(input.federationLinkId) ?? "Unknown connection";
  const direction: DemandSyncDirection =
    input.canonicalSide === "local" ? "outbound" : "inbound";
  const originLabel = direction === "outbound" ? LOCAL_INSTALLATION_LABEL : peerLabel;
  const status = deliveryJob?.status === "failed"
    ? "dead-lettered"
    : deliveryJob?.status === "queued" || deliveryJob?.status === "in-progress"
      ? deliveryJob.lastError ? "failed" : "pending"
      : deriveDemandSyncStatus(input);
  const jobActivity = deliveryJob?.lastAttemptAt ?? deliveryJob?.completedAt ?? null;
  return {
    mirrorId: input.mirrorId,
    recordType: input.recordType,
    title: extractDemandTitle(input.payload),
    direction,
    originLabel,
    peerLabel,
    status,
    detail: deliveryJob?.lastError ?? input.lastDeliveryError ?? input.conflictReason ?? null,
    attempts: deliveryJob?.attemptCount ?? input.deliveryAttempts,
    lastActivityISO: (jobActivity ?? lastActivity(input)).toISOString(),
  };
}

/** Map a batch, newest activity first. */
export function mapDemandSyncActivity(
  inputs: readonly DemandMirrorInput[],
  linkDisplayNameById: ReadonlyMap<string, string>,
  deliveryJobByMirrorId: ReadonlyMap<string, DemandDeliveryJobInput> = new Map(),
): DemandSyncActivityRow[] {
  return inputs
    .map((i) => toDemandSyncActivityRow(i, linkDisplayNameById, deliveryJobByMirrorId.get(i.mirrorId)))
    .sort((a, b) => b.lastActivityISO.localeCompare(a.lastActivityISO));
}

/** DB read: the most recent demand items that have crossed federation links,
 *  with provenance resolved against the links' display names. */
export async function listRecentDemandSyncActivity(
  prisma: PrismaClient,
  opts: { take?: number } = {},
): Promise<DemandSyncActivityRow[]> {
  const take = Math.min(Math.max(opts.take ?? 50, 1), 200);
  const mirrors = await prisma.federatedRecordMirror.findMany({
    where: { recordType: { in: ["demand", "demand-envelope", "demand-response", "demand-disposition"] } },
    orderBy: { updatedAt: "desc" },
    take,
    select: {
      mirrorId: true,
      federationLinkId: true,
      recordType: true,
      canonicalSide: true,
      syncStatus: true,
      conflictReason: true,
      deliveryAttempts: true,
      lastDeliveryError: true,
      deadLetteredAt: true,
      lastDeliveryAt: true,
      lastSyncedAt: true,
      updatedAt: true,
      payload: true,
    },
  });

  const linkIds = Array.from(new Set(mirrors.map((m) => m.federationLinkId)));
  const mirrorIds = mirrors.map((mirror) => mirror.mirrorId);
  const [links, deliveryJobs] = await Promise.all([
    linkIds.length ? prisma.federationLink.findMany({
        where: { linkId: { in: linkIds } },
        select: { linkId: true, principal: { select: { displayName: true } } },
      }) : [],
    mirrorIds.length ? prisma.workItem.findMany({
      where: { sourceType: "federation-demand-delivery", sourceId: { in: mirrorIds } },
      select: {
        sourceId: true, status: true, attemptCount: true, nextAttemptAt: true,
        lastAttemptAt: true, lastError: true, completedAt: true,
      },
    }) : [],
  ]);
  const nameById = new Map<string, string>(
    links.map((l) => [l.linkId, l.principal?.displayName ?? l.linkId]),
  );

  const jobByMirrorId = new Map(
    deliveryJobs.flatMap((job) => job.sourceId ? [[job.sourceId, job] as const] : []),
  );
  return mapDemandSyncActivity(mirrors, nameById, jobByMirrorId);
}
