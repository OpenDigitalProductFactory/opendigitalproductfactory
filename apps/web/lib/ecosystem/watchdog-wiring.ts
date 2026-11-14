/**
 * Default wiring for the weekly ecosystem digest (BI-784D20FD, BI-8FBF58AB).
 *
 * Separated from the runner so every real lookup that can fail does so with a
 * NAMED reason rather than silently yielding an empty week.
 *
 * WHERE IT POSTS. Into the installation's standing ecosystem-participation room,
 * derived on first use (participation-room.ts), as a platform event message —
 * senderType "system", the way the deliberation bridge and the mailroom post —
 * so no coworker identity is assumed or invented. This replaces a PlatformConfig
 * binding that nothing ever wrote, which meant the digest could never post.
 *
 * WHO IS TOLD. The organization's RECORDED accountable human, with no fallback:
 * when none is recorded the digest still lands in the room, and nobody is
 * notified rather than somebody plausible.
 *
 * WHAT IT CARRIES. What a PARTICIPANT actually holds: demand envelopes received
 * from peers, and this installation's own outbound demand. It previously read
 * backlog items tagged "ecosystem-inbound", which exist only on the upstream
 * controller — so on every other installation the ballot was always empty.
 */

import { prisma } from "@dpf/db";

import { decodeDemandOutboxPayload } from "@/lib/federation/demand-delivery";
import { decodeDemandDispositionMirrorPayload } from "@/lib/federation/demand-disposition";
import { decodeDemandMirrorPayload } from "@/lib/federation/demand-exchange";
import { resolveFederationIdentity } from "@/lib/federation/demand-identity";
import type { BallotCandidate } from "./ballot";
import { ensureEcosystemParticipationRoom, type ParticipationRoomRef } from "./participation-room";
import {
  renderWatchdogMessage,
  runEcosystemWatchdog,
  type WatchdogOutcome,
  type WatchdogViewer,
} from "./watchdog-runner";
import type { DispositionNews, WatchdogDigest } from "./watchdog";

/** The envelope fields the digest reads. Structural, so the mappers test without a full envelope. */
export interface DigestEnvelope {
  envelopeId: string;
  originInstallationId?: string;
  title: string;
  summary: string;
  audience?: string;
  forwarding?: { permitted: boolean; audiences: string[]; expiresAt?: string } | null;
  applicability?: { archetypeRefs?: string[] };
  signal?: { occurrenceCount?: number; affectedOrganizations?: number };
}

export interface DemandMirrorRow {
  canonicalSide: string;
  payload: unknown;
}

type EnvelopeDecoder = (payload: unknown) => { envelope: DigestEnvelope; activity?: string; disposition?: string } | null;

/**
 * Map what this installation holds into ballot candidates.
 *
 * Peer rows are envelopes received from other installations; local rows are
 * this installation's own outbound demand, so their submitter is itself and
 * the ballot files them under "what you raised". A withdrawn envelope is not
 * something anyone can vote on and is dropped.
 */
export function mapParticipantCandidates(
  rows: DemandMirrorRow[],
  decoders: { peer: EnvelopeDecoder; local: EnvelopeDecoder },
): BallotCandidate[] {
  const seen = new Set<string>();
  return rows.flatMap((row): BallotCandidate[] => {
    const decoded = row.canonicalSide === "local" ? decoders.local(row.payload) : decoders.peer(row.payload);
    const envelope = decoded?.envelope;
    if (!envelope?.envelopeId || !envelope.title) return [];
    if (decoded?.activity === "dpf.demand.withdrawn" || decoded?.disposition === "withdrawn") return [];
    if (seen.has(envelope.envelopeId)) return [];
    seen.add(envelope.envelopeId);
    return [{
      ref: envelope.envelopeId,
      title: envelope.title,
      summary: envelope.summary,
      submitter: envelope.originInstallationId ?? null,
      audience: envelope.audience ?? "community",
      // Source-owned consent travels with the envelope; absent means forbidden.
      forwarding: envelope.forwarding ?? null,
      archetypeRefs: envelope.applicability?.archetypeRefs ?? null,
      occurrenceCount: envelope.signal?.occurrenceCount ?? 0,
      affectedOrganizations: envelope.signal?.affectedOrganizations ?? null,
    }];
  });
}

/**
 * Map disposition notices onto the digest's vocabulary.
 *
 * The federated contract decides accepted | rejected | archived; the digest
 * speaks scheduled | declined. This used to decode notices with the ENVELOPE
 * decoder and look for scheduled|declined|deferred, so it matched nothing and
 * "what happened to what you backed" could never appear. A decline that carries
 * no message stays reasonless here, and the digest's closure rule withholds it
 * rather than showing an empty verdict.
 */
export function mapDispositionNotices(
  payloads: unknown[],
  titleByEnvelopeId: ReadonlyMap<string, string>,
): DispositionNews[] {
  return payloads.flatMap((payload): DispositionNews[] => {
    const notice = decodeDemandDispositionMirrorPayload(payload)?.notice;
    if (!notice) return [];
    const title = titleByEnvelopeId.get(notice.envelopeId) ?? "Something this installation raised";
    const message = notice.message?.trim() || null;
    if (notice.decision === "accepted") {
      return [{ ref: notice.envelopeId, title, outcome: "scheduled", reason: message }];
    }
    return [{ ref: notice.envelopeId, title, outcome: "declined", reason: message }];
  });
}

/** ISO-8601 week key, so the digest posts at most once per installation per week. */
export function isoWeekKey(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function loadEnvelopeRows(): Promise<DemandMirrorRow[]> {
  return prisma.federatedRecordMirror.findMany({
    where: { recordType: "demand-envelope", canonicalSide: { in: ["peer", "local"] } },
    orderBy: { lastSyncedAt: "desc" },
    take: 200,
    select: { canonicalSide: true, payload: true },
  });
}

/**
 * This install's archetype, read from the SAME place the regulation
 * applicability classifier reads it (`compliance-library`), because this is the
 * same question asked of a different artefact.
 */
async function loadViewer(): Promise<WatchdogViewer | null> {
  const identity = await resolveFederationIdentity(prisma as never).catch(() => null);
  if (!identity?.installationId) return null;

  const storefront = await prisma.storefrontConfig.findFirst({
    orderBy: { createdAt: "asc" },
    select: { archetype: { select: { archetypeId: true, category: true } } },
  }).catch(() => null);

  const archetype = storefront?.archetype;
  return {
    installationId: identity.installationId,
    audience: "community",
    profile: {
      // An undeclared archetype yields "might apply", never silence — the
      // classifier treats an undeclared RECEIVER as reviewable on purpose.
      archetypeCategories: archetype?.category ? [archetype.category] : [],
      archetypeIds: archetype?.archetypeId ? [archetype.archetypeId] : [],
    },
  };
}

async function loadDispositions(): Promise<DispositionNews[]> {
  const [notices, ownEnvelopes] = await Promise.all([
    prisma.federatedRecordMirror.findMany({
      where: { recordType: "demand-disposition", canonicalSide: "peer" },
      orderBy: { lastSyncedAt: "desc" },
      take: 50,
      select: { payload: true },
    }),
    prisma.federatedRecordMirror.findMany({
      where: { recordType: "demand-envelope", canonicalSide: "local" },
      select: { payload: true },
      take: 500,
    }),
  ]);
  const titles = new Map<string, string>();
  for (const row of ownEnvelopes) {
    // The outbox also carries responses and notices; only a demand envelope has a title.
    const envelope = decodeDemandOutboxPayload(row.payload)?.envelope;
    if (envelope && envelope.specVersion === "dpf.demand/1") titles.set(envelope.envelopeId, envelope.title);
  }
  return mapDispositionNotices(notices.map((row) => row.payload), titles);
}

/** The recorded accountable human's active user, or null — never a best guess. */
async function resolveOwnerUserId(): Promise<string | null> {
  const { readOrganizationTopAccountablePrincipalId } = await import("@/lib/work-management/organization-accountable.server");
  const principalId = await readOrganizationTopAccountablePrincipalId().catch(() => null);
  if (!principalId) return null;
  const { activeUserIdForHumanPrincipal } = await import("@/lib/queue/functions/workroom-drive-task-owner");
  return activeUserIdForHumanPrincipal(prisma as never, principalId).catch(() => null);
}

export async function postDigestToRoom(
  room: ParticipationRoomRef,
  digest: WatchdogDigest,
  deps: {
    db: { workItemMessage: { upsert(args: unknown): Promise<unknown> } };
    installationId: string;
    now: Date;
    notify?: (input: { recipientUserId: string; workItemId: string; title: string; body: string; urgency: string; deepLink?: string }) => Promise<void>;
    ownerUserId: string | null;
  },
): Promise<{ notified: boolean }> {
  const week = isoWeekKey(deps.now);
  await deps.db.workItemMessage.upsert({
    // At most one digest per installation per ISO week, however often the job re-runs.
    where: { messageId: `ecosystem-digest:${deps.installationId}:${week}` },
    update: {},
    create: {
      messageId: `ecosystem-digest:${deps.installationId}:${week}`,
      workItemId: room.id,
      senderType: "system",
      messageType: "ecosystem-digest",
      body: renderWatchdogMessage(digest),
      structuredPayload: {
        week,
        yours: digest.ballot.yours.length,
        applies: digest.ballot.applies.length,
        mightApply: digest.ballot.mightApply.length,
        withheld: digest.ballot.withheld,
        dispositions: digest.dispositions.length,
        releases: digest.releases.length,
      },
      channel: "in-app",
    },
  });
  const recipient = room.assignedToUserId ?? deps.ownerUserId;
  if (!recipient || !deps.notify) return { notified: false };
  await deps.notify({
    recipientUserId: recipient,
    workItemId: room.itemId,
    title: "This week in the ecosystem",
    body: `${digest.ballot.applies.length} open for your vote, ${digest.dispositions.length} answered.`,
    urgency: "routine",
    deepLink: `/workspace/cases/${room.caseKey}`,
  });
  return { notified: true };
}

export async function runWeeklyEcosystemWatchdog(now: Date = new Date()): Promise<WatchdogOutcome> {
  const ownerUserId = await resolveOwnerUserId();
  let room: ParticipationRoomRef | null = null;
  let installationId: string | null = null;

  return runEcosystemWatchdog({
    loadViewer: async () => {
      const viewer = await loadViewer();
      installationId = viewer?.installationId ?? null;
      return viewer;
    },
    loadCandidates: async () => mapParticipantCandidates(await loadEnvelopeRows(), {
      peer: decodeDemandMirrorPayload as unknown as EnvelopeDecoder,
      local: decodeDemandOutboxPayload as unknown as EnvelopeDecoder,
    }),
    loadDispositions,
    loadReleases: async () => [],
    resolveRoom: async () => {
      room = await ensureEcosystemParticipationRoom(prisma as never, { ownerUserId });
      return room.caseKey;
    },
    deliver: async (_roomRef, digest) => {
      if (!room || !installationId) throw new Error("the participation room was not resolved before delivery");
      const { sendQueueNotification } = await import("@/lib/queue/notification-adapter");
      await postDigestToRoom(room, digest, {
        db: prisma as never,
        installationId,
        now,
        notify: sendQueueNotification,
        ownerUserId,
      });
    },
    now,
  });
}
