// Guidance snapshot publication on the authority (BI-1B165D02, companion design §4.1).
//
// Runs on the five-minute federation cadence. Only an installation whose stance
// is "authority" (P1, BI-B50BE189) publishes, and only to the companion on the
// link that backs that relationship. The snapshot carries the organization's
// active WWWD profile and exactly the material its resolver uses: approved and
// promoted rows of that profile.

import { prisma } from "@dpf/db";
import {
  GUIDANCE_SNAPSHOT_MAX_MATERIALS,
  type GuidanceMaterialV1,
  type GuidanceWwwdV1,
} from "@dpf/db/guidance-snapshot-contract";

import { resolveOrgProfileId } from "@/lib/decision-perspective/material";
import { loadInstanceStanceWithPairing, prismaInstanceStanceStore } from "@/lib/install/instance-stance";

import type { DemandDeliveryDb } from "./demand-delivery";
import { resolveFederationSigningIdentity, type FederationIdentityDb } from "./demand-identity";
import { queueGuidanceSnapshot } from "./guidance-snapshot-exchange";

type MaterialRow = {
  materialId: string;
  sourceType: string;
  sourceRef: unknown;
  summary: string | null;
  domainClass: string;
  direction: string | null;
  domains: string[];
  freshness: string;
  evidenceGrade: string;
  confidenceWeight: number;
  lastValidatedAt: Date | null;
};

export interface AuthorityGuidanceDb {
  decisionPerspectiveProfile: {
    findFirst(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<unknown>;
  };
  perspectiveMaterial: { findMany(args: unknown): Promise<unknown> };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? value as T : fallback;
}

/**
 * The organization's WWWD guidance as its own resolver sees it, or null when it
 * has no active organization profile (then there is nothing to publish, and the
 * companion reports no organization guidance).
 */
export async function buildAuthorityWwwd(
  db: AuthorityGuidanceDb,
  organizationId: string | null,
): Promise<GuidanceWwwdV1 | null> {
  const profileId = await resolveOrgProfileId({ db: db as never, organizationId });
  if (!profileId) return null;
  const profile = await db.decisionPerspectiveProfile.findUnique({
    where: { profileId },
    select: { profileId: true, name: true, fallbackProfileId: true, autonomyPolicy: true, defaultResolver: true },
  }) as { profileId: string; name: string | null; fallbackProfileId: string | null; autonomyPolicy: unknown; defaultResolver: unknown } | null;
  if (!profile) return null;

  const rows = await db.perspectiveMaterial.findMany({
    where: { profileId, reviewStatus: "approved", promotionState: "promoted" },
    orderBy: [{ sourceType: "asc" }, { materialId: "asc" }],
    take: GUIDANCE_SNAPSHOT_MAX_MATERIALS + 1,
  }) as MaterialRow[];
  if (rows.length > GUIDANCE_SNAPSHOT_MAX_MATERIALS) {
    // Truncating would silently drop doctrine; refuse instead, so the companion
    // reports the gap rather than deciding on a partial stance.
    throw new Error(`The organization profile ${profileId} has more than ${GUIDANCE_SNAPSHOT_MAX_MATERIALS} promoted rows; a guidance snapshot cannot carry them all.`);
  }

  const materials: GuidanceMaterialV1[] = rows.map((row) => {
    const sourceRef = record(row.sourceRef);
    return {
      materialId: row.materialId,
      sourceType: row.sourceType,
      sourceRef,
      summary: row.summary ?? "",
      domainClass: row.domainClass,
      direction: oneOf(row.direction ?? sourceRef.principleDirection, ["support", "oppose", "neutral"] as const, "neutral"),
      domains: row.domains ?? [],
      freshness: oneOf(row.freshness, ["current", "stale", "superseded", "contradicted"] as const, "stale"),
      evidenceGrade: oneOf(row.evidenceGrade, ["A", "B", "C", "D"] as const, "D"),
      confidenceWeight: Math.min(1, Math.max(0, Number.isFinite(row.confidenceWeight) ? row.confidenceWeight : 0)),
      lastValidatedAt: row.lastValidatedAt ? row.lastValidatedAt.toISOString() : null,
    };
  });

  const autonomyPolicy = record(profile.autonomyPolicy);
  const defaultResolver = record(profile.defaultResolver);
  return {
    profile: {
      profileId: profile.profileId,
      name: profile.name ?? profile.profileId,
      fallbackProfileId: profile.fallbackProfileId,
      autonomyPolicy: Object.keys(autonomyPolicy).length > 0 ? autonomyPolicy : null,
      defaultResolver: Object.keys(defaultResolver).length > 0 ? defaultResolver : null,
    },
    materials,
  };
}

export type GuidancePublicationResult =
  | { published: false; reason: "not-authority" | "companion-did-unknown" | "no-organization-guidance" }
  | { published: true; action: "queued" | "noop"; version: number };

export async function runGuidanceSnapshotPublication(now: Date = new Date()): Promise<GuidancePublicationResult> {
  const { stance, pairedLinkId } = await loadInstanceStanceWithPairing(prismaInstanceStanceStore(prisma), { now });
  if (stance.relationship !== "authority" || !pairedLinkId) return { published: false, reason: "not-authority" };

  const link = await prisma.federationLink.findUnique({
    where: { linkId: pairedLinkId },
    select: { linkId: true, peerAuthorityUrl: true, peerTokenEnc: true, peerDeviceId: true },
  });
  if (!link?.peerDeviceId) return { published: false, reason: "companion-did-unknown" };

  const organization = await prisma.organization.findFirst({ select: { id: true } });
  const wwwd = await buildAuthorityWwwd(prisma as unknown as AuthorityGuidanceDb, organization?.id ?? null);
  if (!wwwd) return { published: false, reason: "no-organization-guidance" };

  const authority = await resolveFederationSigningIdentity(prisma as unknown as FederationIdentityDb);
  const result = await queueGuidanceSnapshot(prisma as unknown as DemandDeliveryDb, {
    link,
    authority,
    companionInstallationDid: link.peerDeviceId,
    wwwd,
    now,
  });
  return { published: true, action: result.action, version: result.version };
}
