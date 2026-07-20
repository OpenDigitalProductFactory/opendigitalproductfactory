import { prisma } from "@dpf/db";
import { DEMAND_PROJECTION_TEMPLATES } from "@dpf/db/federated-demand-contract";
import type { FederationRelationshipPreset } from "@dpf/db/federation-link-types";

import {
  dispatchDueDemand,
  queueDemandProjection,
  queueDemandWithdrawal,
  type DemandDeliveryDb,
} from "./demand-delivery";
import { resolveFederationIdentity, type FederationIdentityDb } from "./demand-identity";
import { reconcileDemandDigests } from "./demand-digest";

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

export interface DemandReconciliationDb extends FederationIdentityDb {
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

function shareSafeSummary(body: string | null, title: string): string {
  const withoutMarkers = (body ?? "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("[origin:"))
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
  const identity = links.length > 0
    ? await (deps.resolveIdentity ?? resolveFederationIdentity)(db)
    : null;

  if (automaticLinks.length > 0) {
    const items = await db.backlogItem.findMany({
      where: {
        digitalProduct: { productId: "dpf-portal" },
        NOT: { body: { contains: "[origin:federatedDemand:" } },
      },
      select: {
        itemId: true, title: true, body: true, workType: true, occurrenceCount: true,
        createdAt: true, updatedAt: true, digitalProduct: { select: { productId: true } },
      },
    });
    const eligibleIds = new Set(items.map((item) => item.itemId));
    for (const link of automaticLinks) {
      for (const item of items) {
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
  return { links: links.length, projected, unchanged, withdrawn, digest, delivery };
}
