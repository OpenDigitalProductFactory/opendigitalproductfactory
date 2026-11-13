// Organization guidance on a development companion (BI-1B165D02; companion
// design §4.2, DI-5B370FD391FD).
//
// On a companion, organization-business decisions resolve the production
// authority's guidance snapshot as the organization profile. Local material may
// only narrow it: deny-overrides, so only local material that opposes is kept.
// A companion holding no valid snapshot reports "no organization guidance"
// instead of borrowing the platform profile, and an expired snapshot is never
// used. Every other installation resolves exactly as before.

import type { GuidanceMaterialV1, GuidanceSnapshotV1 } from "@dpf/db/guidance-snapshot-contract";

import {
  isMaterialApplicable,
  resolveOrgProfileId,
  resolveProfileMaterial,
  resolveProfileMaterialForOrg,
  toDecisionPerspectiveProfile,
  type OrgProfileClient,
  type OrganizationGuidanceState,
  type PerspectiveMaterialClient,
  type ResolvedProfileMaterial,
} from "./material";
import { DECISION_DOMAIN_CLASSES, type DecisionDomainClass, type PerspectiveMaterial } from "./types";

/** What this installation knows about its authority's guidance, read by the server loader. */
export type OrganizationGuidance =
  | { role: "local" }
  /** A companion; `snapshot` is the held snapshot already verified on receipt, or null. */
  | { role: "companion"; snapshot: GuidanceSnapshotV1 | null; now: Date };

export const NO_ORGANIZATION_GUIDANCE_PROFILE_ID = "no-organization-guidance";

export const NO_ORGANIZATION_GUIDANCE_NOTICE =
  "No organization guidance: this development companion holds no valid guidance snapshot from its production authority, so this decision is recorded as a guidance gap instead of being decided on platform defaults.";

export function expiredGuidanceNotice(expiresAt: string): string {
  return `Organization guidance expired at ${expiresAt}: this development companion records organization-business decisions as guidance gaps until its production authority issues a new snapshot.`;
}

/** A profile that recommends and arbitrates nothing, so every decision under it is a recorded gap. */
const NO_GUIDANCE_PROFILE = toDecisionPerspectiveProfile({
  profileId: NO_ORGANIZATION_GUIDANCE_PROFILE_ID,
  name: "No organization guidance",
  kind: "organization",
  scope: null,
  fallbackProfileId: null,
  defaultResolver: null,
  autonomyPolicy: { allowRecommendation: false, allowArbitration: false },
});

type Resolved = ResolvedProfileMaterial & { orgProfileSelected: boolean; organizationGuidance: OrganizationGuidanceState };

type ResolveInput = {
  db: PerspectiveMaterialClient & OrgProfileClient;
  organizationId: string | null | undefined;
  domainClass: DecisionDomainClass;
  fallbackProfileId?: string;
  maxDepth?: number;
};

function noGuidance(state: Extract<OrganizationGuidanceState, { state: "none" | "expired" }>): Resolved {
  return {
    selectedProfileId: NO_ORGANIZATION_GUIDANCE_PROFILE_ID,
    selectedProfile: NO_GUIDANCE_PROFILE,
    resolvedProfileChain: [NO_ORGANIZATION_GUIDANCE_PROFILE_ID],
    coverageGap: true,
    materials: [],
    orgProfileSelected: false,
    organizationGuidance: state,
  };
}

function fromSnapshot(row: GuidanceMaterialV1, profileId: string): PerspectiveMaterial {
  return {
    materialId: row.materialId,
    profileId,
    sourceType: row.sourceType,
    sourceRef: row.sourceRef,
    summary: row.summary,
    domainClass: (DECISION_DOMAIN_CLASSES as readonly string[]).includes(row.domainClass)
      ? row.domainClass as DecisionDomainClass
      : "plan-readiness",
    direction: row.direction,
    domains: row.domains,
    freshness: row.freshness,
    evidenceGrade: row.evidenceGrade,
    confidenceWeight: row.confidenceWeight,
    // The authority sent only rows its resolver uses: approved and promoted.
    reviewStatus: "approved",
    promotionState: "promoted",
    lastValidatedAt: row.lastValidatedAt ? new Date(row.lastValidatedAt) : null,
  };
}

/** Local material that narrows: rows of this installation's own organization profile that oppose. */
async function localNarrowing(input: ResolveInput): Promise<PerspectiveMaterial[]> {
  const localProfileId = await resolveOrgProfileId({ db: input.db, organizationId: input.organizationId });
  if (!localProfileId) return [];
  const local = await resolveProfileMaterial({
    db: input.db, profileId: localProfileId, domainClass: input.domainClass, maxDepth: 1,
  });
  if (local.selectedProfileId !== localProfileId) return [];
  return local.materials.filter((material) => material.direction === "oppose");
}

async function resolveUnderSnapshot(input: ResolveInput, snapshot: GuidanceSnapshotV1): Promise<Resolved> {
  const profile = snapshot.wwwd.profile;
  const selected = toDecisionPerspectiveProfile({
    profileId: profile.profileId,
    name: profile.name,
    kind: "organization",
    scope: null,
    fallbackProfileId: profile.fallbackProfileId,
    defaultResolver: profile.defaultResolver,
    autonomyPolicy: profile.autonomyPolicy,
  });
  const authority = snapshot.wwwd.materials
    .map((row) => fromSnapshot(row, profile.profileId))
    .filter((material) => isMaterialApplicable(material, input.domainClass));
  const narrowing = await localNarrowing(input);
  const guidance: OrganizationGuidanceState = {
    state: "current",
    version: snapshot.meta.version,
    expiresAt: snapshot.meta.expiresAt,
    authorityInstallationDid: snapshot.meta.authorityInstallationDid,
  };

  if (authority.length > 0) {
    return {
      selectedProfileId: profile.profileId,
      selectedProfile: selected,
      resolvedProfileChain: [profile.profileId],
      coverageGap: false,
      materials: [...authority, ...narrowing],
      orgProfileSelected: true,
      organizationGuidance: guidance,
    };
  }

  // The authority's own resolver would continue down its profile's fallback
  // chain; those profiles ship in every image, so the companion walks the same one.
  const chain = profile.fallbackProfileId
    ? await resolveProfileMaterial({
      db: input.db, profileId: profile.fallbackProfileId, domainClass: input.domainClass, maxDepth: input.maxDepth,
    })
    : null;
  const materials = [...(chain?.materials ?? []), ...narrowing];
  return {
    selectedProfileId: chain?.selectedProfileId ?? profile.profileId,
    selectedProfile: chain?.selectedProfile ?? selected,
    resolvedProfileChain: [profile.profileId, ...(chain?.resolvedProfileChain ?? [])],
    coverageGap: materials.length === 0,
    materials,
    orgProfileSelected: true,
    organizationGuidance: guidance,
  };
}

/**
 * The organization-business resolver: a companion resolves its authority's
 * guidance; every other installation resolves its own organization profile.
 */
export async function resolveOrganizationDecisionMaterial(input: ResolveInput & {
  loadGuidance?: () => Promise<OrganizationGuidance>;
}): Promise<Resolved> {
  const guidance = input.loadGuidance
    ? await input.loadGuidance()
    : await (await import("./organization-guidance.server")).loadOrganizationGuidance();

  if (guidance.role === "local") {
    return { ...(await resolveProfileMaterialForOrg(input)), organizationGuidance: { state: "local" } };
  }
  const snapshot = guidance.snapshot;
  if (!snapshot) return noGuidance({ state: "none", notice: NO_ORGANIZATION_GUIDANCE_NOTICE });
  if (Date.parse(snapshot.meta.expiresAt) <= guidance.now.getTime()) {
    return noGuidance({
      state: "expired",
      version: snapshot.meta.version,
      expiresAt: snapshot.meta.expiresAt,
      notice: expiredGuidanceNotice(snapshot.meta.expiresAt),
    });
  }
  return resolveUnderSnapshot(input, snapshot);
}
