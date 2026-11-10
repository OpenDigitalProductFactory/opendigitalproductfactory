// Cross-install operational control plane · Slice 2 Increment 2 (BI-648F01A0).
//
// Five-minute cadence (with demand reconciliation): capture this install's
// operational posture once, queue the minimized record to every trusted
// same-organization link as a local-canonical outbox row, then drain the shared
// federation outbox. Sibling of runDemandReconciliation — same link selection,
// same fault isolation per link, same durable delivery.

import { prisma } from "@dpf/db";

import { getErrorMessage } from "@/lib/shared/get-error-message";

import { dispatchDueDemand, type DemandDeliveryDb } from "./demand-delivery";
import { resolveFederationIdentity, type FederationIdentityDb } from "./demand-identity";
import { relationshipPresetForRole } from "./demand-reconciliation";
import {
  captureLocalOperationalPosture,
  type OperationalPostureCaptureDb,
} from "./operational-posture-capture";
import { queueOperationalPostureProjection } from "./operational-posture-delivery";

interface ReconciliationLink {
  linkId: string;
  role: string;
  peerAuthorityUrl: string;
  peerTokenEnc: string | null;
}

export interface OperationalPostureReconciliationDb
  extends FederationIdentityDb, DemandDeliveryDb, OperationalPostureCaptureDb {
  federationLink: {
    findMany(args: unknown): Promise<ReconciliationLink[]>;
  };
}

export interface OperationalPostureReconciliationResult {
  links: number;
  projected: number;
  unchanged: number;
  failed: number;
  delivery: { attempted: number; delivered: number; deferred: number; deadLettered: number };
}

export async function runOperationalPostureReconciliation(
  db: OperationalPostureReconciliationDb = prisma as unknown as OperationalPostureReconciliationDb,
  deps: {
    resolveIdentity?: typeof resolveFederationIdentity;
    capture?: typeof captureLocalOperationalPosture;
    queueProjection?: typeof queueOperationalPostureProjection;
    dispatch?: typeof dispatchDueDemand;
    now?: Date;
  } = {},
): Promise<OperationalPostureReconciliationResult> {
  const now = deps.now ?? new Date();
  const links = await db.federationLink.findMany({
    where: { linkState: "trusted", revokedAt: null, quarantinedAt: null },
    select: { linkId: true, role: true, peerAuthorityUrl: true, peerTokenEnc: true },
  });
  // Posture is same-organization only: a service-provider, channel or community
  // peer never receives it automatically (AC-OCP-001).
  const sameOrgLinks = links.filter((link) => relationshipPresetForRole(link.role) === "same-organization");
  let projected = 0;
  let unchanged = 0;
  let failed = 0;

  if (sameOrgLinks.length > 0) {
    const identity = await (deps.resolveIdentity ?? resolveFederationIdentity)(db);
    // One capture per cycle; every link gets the same record.
    const source = await (deps.capture ?? captureLocalOperationalPosture)(db, { now });
    for (const link of sameOrgLinks) {
      // Fault-isolate each link: one refused projection (or transient DB error)
      // must not strand the other peers.
      try {
        const result = await (deps.queueProjection ?? queueOperationalPostureProjection)(db, {
          link, source, identity, now,
        });
        if (result.action === "queued") projected++;
        else unchanged++;
      } catch (err) {
        failed++;
        console.warn(
          `[operational-posture-reconciliation] projection skipped on ${link.linkId}: ${getErrorMessage(err)}`,
        );
      }
    }
  }

  const delivery = sameOrgLinks.length > 0
    ? await (deps.dispatch ?? dispatchDueDemand)(db, { now })
    : { attempted: 0, delivered: 0, deferred: 0, deadLettered: 0 };
  return { links: sameOrgLinks.length, projected, unchanged, failed, delivery };
}
