import { prisma } from "@dpf/db";
import { DEMAND_PROJECTION_TEMPLATES } from "@dpf/db/federated-demand-contract";
import { hasFederatedWorkOriginMarker } from "@dpf/db/federated-work-contract";
import type { FederationRelationshipPreset } from "@dpf/db/federation-link-types";

import { FEDERATION_SYNCABLE_BACKLOG_STATUSES } from "@/lib/explore/backlog";

import {
  dispatchDueDemand,
  queueDemandProjection,
  queueDemandWithdrawal,
  type DemandDeliveryDb,
} from "./demand-delivery";
import { resolveFederationIdentity, type FederationIdentityDb } from "./demand-identity";
import { reconcileDemandDigests } from "./demand-digest";
import { SAME_ORG_LOCAL_ONLY_SENSITIVITIES } from "./cross-org-sharing";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { syncFederationIntroductions, type IntroductionExchangeDb } from "./introduction-exchange";
import type { FederationDeliveryQueueDb } from "./delivery-queue";

interface ReconciliationLink {
  linkId: string;
  role: string;
  peerAuthorityUrl: string;
  peerTokenEnc: string | null;
  metadata: unknown;
}

interface ReconciliationBacklogItem {
  itemId: string;
  title: string;
  body: string | null;
  workType: string | null;
  occurrenceCount: number;
  createdAt: Date;
  updatedAt: Date;
  digitalProduct: { productId: string } | null;
}

export interface DemandReconciliationDb extends FederationIdentityDb, FederationDeliveryQueueDb {
  federationLink: {
    findMany(args: unknown): Promise<ReconciliationLink[]>;
  };
  federatedRecordMirror: DemandDeliveryDb["federatedRecordMirror"];
  backlogItem: {
    findMany(args: unknown): Promise<ReconciliationBacklogItem[]>;
  };
}

export function relationshipPresetForRole(role: string): FederationRelationshipPreset | null {
  if (role === "same-org-peer") return "same-organization";
  if (role === "manages" || role === "managed-by") return "service-provider";
  if (role === "channel-upstream" || role === "channel-downstream") return "channel";
  if (role === "community-peer") return "community-peer";
  return null;
}

const FEDERATED_DEMAND_ORIGIN_LINE = /^\[origin:federatedDemand:[^\]\r\n]+\]$/;

function isFederatedDemandOriginMarkerLine(line: string): boolean {
  return FEDERATED_DEMAND_ORIGIN_LINE.test(line.trim());
}

export function hasFederatedDemandOriginMarker(body: string | null): boolean {
  return (body ?? "").split(/\r?\n/).some(isFederatedDemandOriginMarkerLine);
}

function shareSafeSummary(body: string | null, title: string): string {
  const withoutMarkers = (body ?? "")
    .split(/\r?\n/)
    .filter((line) => !isFederatedDemandOriginMarkerLine(line))
    .join("\n")
    .trim();
  return withoutMarkers || title;
}

/**
 * Five-minute safety-net: project policy-eligible local demand, withdraw records
 * that left scope, then drain the protocol-specific durable outbox. Only the
 * same-organization preset has an automatic item-selection policy in Slice 2;
 * partner/channel/community links remain explicit until their governed sharing
 * controls land in Slice 3.
 */
export async function runDemandReconciliation(
  db: DemandReconciliationDb = prisma as unknown as DemandReconciliationDb,
  deps: {
    resolveIdentity?: typeof resolveFederationIdentity;
    queueProjection?: typeof queueDemandProjection;
    queueWithdrawal?: typeof queueDemandWithdrawal;
    reconcileDigests?: typeof reconcileDemandDigests;
    dispatch?: typeof dispatchDueDemand;
    syncIntroductions?: typeof syncFederationIntroductions;
    now?: Date;
  } = {},
) {
  const now = deps.now ?? new Date();
  const links = await db.federationLink.findMany({
    where: { linkState: "trusted", revokedAt: null, quarantinedAt: null },
    select: { linkId: true, role: true, peerAuthorityUrl: true, peerTokenEnc: true, metadata: true },
  });
  const automaticLinks = links.filter((link) => relationshipPresetForRole(link.role) === "same-organization");
  let projected = 0;
  let unchanged = 0;
  let withdrawn = 0;
  let failed = 0;
  const identity = links.length > 0
    ? await (deps.resolveIdentity ?? resolveFederationIdentity)(db)
    : null;

  if (automaticLinks.length > 0) {
    const items = await db.backlogItem.findMany({
      where: {
        // Same-org is trust-by-default ("for the same org, all is OK"): share ALL
        // non-sensitive backlog, not just the `dpf-portal`-tagged subset (which
        // most platform BIs never carry, so the old filter shared almost nothing).
        // The genuinely-sensitive tier (HR/confidential) stays local. Cross-org
        // links keep the deny-by-default gate elsewhere. See mayShareSameOrgDemand.
        sensitivity: { notIn: [...SAME_ORG_LOCAL_ONLY_SENSITIVITIES] },
        // Open work only. A closed item is excluded here, drops out of
        // eligibleIds below, and is withdrawn from the peer. See BI-8A8C1D3A.
        status: { in: [...FEDERATION_SYNCABLE_BACKLOG_STATUSES] },
      },
      select: {
        itemId: true, title: true, body: true, workType: true, occurrenceCount: true,
        createdAt: true, updatedAt: true, digitalProduct: { select: { productId: true } },
      },
    });
    // Parse the governed marker as a complete standalone line. A broad SQL
    // substring predicate both drops NULL bodies and mistakes explanatory prose
    // for an adopted peer envelope.
    // A work-sync mirror (BI-FF8A57EF) is a peer's record held read-only here;
    // projecting it as demand would hand the owner a copy of its own item.
    const eligibleItems = items.filter(
      (item) => !hasFederatedDemandOriginMarker(item.body) && !hasFederatedWorkOriginMarker(item.body),
    );
    const eligibleIds = new Set(eligibleItems.map((item) => item.itemId));
    for (const link of automaticLinks) {
      for (const item of eligibleItems) {
        // Fault-isolate each item: a single item that throws (envelope violation,
        // transient DB error) must NOT abort the whole cycle and strand every item
        // after it — the same "one bad record can't strand the batch" lesson as the
        // dead-letter fix (BI-8A7E3E56). Skip + log the offender by id and reason so
        // the exact cause is visible; keep projecting the rest.
        try {
          const result = await (deps.queueProjection ?? queueDemandProjection)(db, {
            link,
            source: {
              localRecordRef: item.itemId,
              title: item.title,
              summary: shareSafeSummary(item.body, item.title),
              workType: item.workType,
              occurrenceCount: item.occurrenceCount,
              product: item.digitalProduct?.productId ?? null,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
            },
            identity: identity!,
            contract: DEMAND_PROJECTION_TEMPLATES["same-organization"],
            audience: "internal",
            attribution: "organization",
            now,
          });
          if (result.action === "queued") projected++;
          else unchanged++;
        } catch (err) {
          failed++;
          console.warn(
            `[demand-reconciliation] projection skipped ${item.itemId} on ${link.linkId}: ${getErrorMessage(err)}`,
          );
        }
      }
      const existing = await db.federatedRecordMirror.findMany({
        where: {
          federationLinkId: link.linkId,
          recordType: "demand-envelope",
          canonicalSide: "local",
          syncStatus: { notIn: ["withdrawn", "revoked"] },
        },
        select: { localRecordRef: true },
      }) as unknown as Array<{ localRecordRef: string | null }>;
      for (const row of existing) {
        if (row.localRecordRef && !eligibleIds.has(row.localRecordRef)) {
          const result = await (deps.queueWithdrawal ?? queueDemandWithdrawal)(db, link.linkId, row.localRecordRef, now);
          if (result.action === "queued") withdrawn++;
        }
      }
    }
  }

  const digest = identity
    ? await (deps.reconcileDigests ?? reconcileDemandDigests)(db, identity, { now })
    : { linksChecked: 0, requeued: 0, confirmed: 0, failedLinks: 0 };
  const delivery = await (deps.dispatch ?? dispatchDueDemand)(db, { now });
  const introductions = deps.syncIntroductions
    ? await deps.syncIntroductions(db as unknown as IntroductionExchangeDb, { now })
    : "federationIntroductionCandidate" in (db as object)
      ? await syncFederationIntroductions(db as unknown as IntroductionExchangeDb, { now })
      : { linksChecked: 0, candidates: 0, rejected: 0, failed: 0 };
  return { links: links.length, projected, unchanged, withdrawn, failed, digest, delivery, introductions };
}
