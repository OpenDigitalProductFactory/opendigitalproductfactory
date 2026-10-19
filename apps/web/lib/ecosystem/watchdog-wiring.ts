/**
 * Default wiring for the weekly watchdog (BI-784D20FD).
 *
 * Separated from the runner so every real lookup that can fail does so with a
 * NAMED reason rather than silently yielding an empty week.
 *
 * DELIVERY BINDING IS DELIBERATELY EXPLICIT, NOT GUESSED. Posting into a room
 * requires two things this module must not invent: the derived room's case key,
 * and the coworker principal that speaks. Both room paths in the codebase
 * (`room-messaging-pack`, `federated-room.server`) resolve an agent principal
 * before they will write, and fabricating one here would post the ecosystem
 * digest under an identity nobody authorised. Until the binding is configured
 * the run reports `no-room` with an actionable message — visible in the job's
 * run data — rather than doing nothing quietly.
 */

import { prisma } from "@dpf/db";

import { decodeDemandMirrorPayload } from "@/lib/federation/demand-exchange";
import { resolveFederationIdentity } from "@/lib/federation/demand-identity";
import type { BallotCandidate } from "./ballot";
import {
  runEcosystemWatchdog,
  type WatchdogOutcome,
  type WatchdogViewer,
} from "./watchdog-runner";
import type { DispositionNews } from "./watchdog";

/** PlatformConfig key holding the derived room's case key and speaking principal. */
export const WATCHDOG_BINDING_KEY = "ecosystem.watchdog-binding.v1";

/** Backlog items the inbound triage filed — what this install votes on. */
async function loadCandidates(): Promise<BallotCandidate[]> {
  const rows = await prisma.backlogItem.findMany({
    where: { lifecycleTags: { has: "ecosystem-inbound" }, status: { notIn: ["done", "retired"] } },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      itemId: true, title: true, body: true, scopeKind: true,
      archetypeCategories: true, archetypeIds: true, occurrenceCount: true,
    },
  });

  return rows.map((row) => ({
    ref: row.itemId,
    title: row.title,
    summary: row.body ?? row.title,
    // These items already reached this install through the governed inbound
    // path, so the consent decision that allowed them here has been made.
    // Re-deriving it from an envelope we no longer hold would fabricate a verdict.
    submitter: null,
    audience: "community",
    forwarding: { permitted: true, audiences: ["community"] },
    archetypeRefs: [
      ...(row.scopeKind ? [`scope:${row.scopeKind}`] : []),
      ...row.archetypeCategories.map((category) => `category:${category}`),
      ...row.archetypeIds.map((id) => `archetype:${id}`),
    ],
    occurrenceCount: row.occurrenceCount,
  }));
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

/** Disposition notices a peer sent back about what this install submitted. */
async function loadDispositions(): Promise<DispositionNews[]> {
  const rows = await prisma.federatedRecordMirror.findMany({
    where: { recordType: "demand-disposition", canonicalSide: "peer" },
    orderBy: { lastSyncedAt: "desc" },
    take: 50,
    select: { localRecordRef: true, payload: true },
  }).catch(() => [] as Array<{ localRecordRef: string | null; payload: unknown }>);

  return rows.flatMap((row): DispositionNews[] => {
    const decoded = decodeDemandMirrorPayload(row.payload) as
      | { envelope?: { title?: string; outcome?: string; reason?: string } }
      | null;
    const envelope = decoded?.envelope;
    const outcome = envelope?.outcome;
    if (outcome !== "scheduled" && outcome !== "declined" && outcome !== "deferred") return [];
    return [{
      ref: row.localRecordRef ?? "unknown",
      title: envelope?.title ?? "A submission you backed",
      outcome,
      reason: envelope?.reason ?? null,
    }];
  });
}

interface WatchdogBinding {
  caseKey: string;
  senderPrincipalId: string;
  senderLabel: string;
}

async function loadBinding(): Promise<WatchdogBinding | null> {
  const row = await prisma.platformConfig.findUnique({
    where: { key: WATCHDOG_BINDING_KEY },
    select: { value: true },
  }).catch(() => null);
  const value = row?.value as Partial<WatchdogBinding> | null | undefined;
  if (!value?.caseKey || !value.senderPrincipalId) return null;
  return {
    caseKey: value.caseKey,
    senderPrincipalId: value.senderPrincipalId,
    senderLabel: value.senderLabel ?? "Ecosystem watchdog",
  };
}

export async function runWeeklyEcosystemWatchdog(): Promise<WatchdogOutcome> {
  const binding = await loadBinding();

  return runEcosystemWatchdog({
    loadViewer,
    loadCandidates,
    loadDispositions,
    loadReleases: async () => [],
    resolveRoom: async () => binding?.caseKey ?? null,
    deliver: async (_roomRef, _digest) => {
      // Reached only when a binding exists; the runner short-circuits otherwise.
      if (!binding) throw new Error("no watchdog binding configured");
      const { postWorkItemComment } = await import("@/lib/work-management/post-work-item-comment");
      const { renderWatchdogMessage } = await import("./watchdog-runner");
      const { decodeWorkCaseKey } = await import("@/lib/work-management/case-key");
      const decoded = decodeWorkCaseKey(binding.caseKey);
      if (!decoded) throw new Error(`watchdog binding case key is not addressable: ${binding.caseKey}`);
      const item = await prisma.workItem.findFirst({
        where: {
          OR: [
            { sourceType: decoded.sourceType, sourceId: decoded.sourceId },
            { sourceType: decoded.sourceType, itemId: decoded.sourceId },
          ],
        },
        select: { id: true, title: true },
      });
      if (!item) throw new Error(`watchdog binding room not found: ${binding.caseKey}`);

      await postWorkItemComment({
        db: {
          workItemMessage: { create: (args: unknown) => prisma.workItemMessage.create(args as never) },
          notification: { create: (args: unknown) => prisma.notification.create(args as never) },
        } as never,
        workItemId: item.id,
        workItemTitle: item.title,
        body: renderWatchdogMessage(_digest),
        sender: { type: "agent", id: binding.senderPrincipalId, label: binding.senderLabel },
        roster: [] as never,
      });
    },
  });
}
