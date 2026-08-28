// EP-MSP-FEDERATION — the production reads behind `resolveOrganizationTrustAnchor`.
//
// That resolver has only ever had test doubles behind it. With no production
// store, no caller could resolve a real anchor, so `evaluateOrganizationEnrollment`
// always answered `organization-trust-not-configured` and every pairing fell back
// to a human. This supplies the two reads it declares.
//
// WHY `findLocalOrganizationRef` RETURNS THE ESTATE, NOT `Organization.orgId`:
//
// `docs/superpowers/specs/2026-08-25-installation-estate-identity-design.md` §3
// settles this. The estate identifier "is therefore the name of the federation
// trust root, which is what `OrganizationTrustAnchor.organizationRef` already is",
// and it is deliberately NOT `Organization` — that is the business the
// installation runs, which is a different fact. They diverge exactly where
// federation cares: an MSP running fifty customer installs is one estate and
// fifty organizations, and a dev/prod pair is one estate where the dev install
// carries a demo organization the production install does not.
//
// Reading `Organization.orgId` here would be wrong in both directions, and one of
// them is unsafe. Two installs of one estate carrying different tenants would
// look like strangers and never auto-enrol — merely annoying. But two installs of
// DIFFERENT estates that happen to have seeded the same demo organization would
// compare equal, and a same-organization auto-enrolment would be the result. The
// estate identifier has no such collision: it names who operates the install.
//
// An installation with no estate name therefore has no organization ref, and
// `resolveOrganizationTrustAnchor` returns `no-local-organization`. That is the
// correct failure: an unnamed install cannot prove which trust root it belongs to,
// so it pairs through a human.

import { prisma } from "@dpf/db";

import { loadEstateNameResolution } from "@/lib/install/estate-identity";
import { normalizeOrganizationRef } from "@/lib/install/estate-identity-contract";

import type { JoinImportRecord, OrganizationTrustAnchorStore } from "./organization-trust-anchor";

/** The action type an operator's join-package import is recorded under. */
export const JOIN_IMPORT_ACTION_TYPE = "organization.join.import";

/** Only a completed import establishes trust. Queued and failed rows must not. */
export const JOIN_IMPORT_COMPLETED_STATUS = "completed";

/** The reads this module needs, kept narrow so a test can supply them directly. */
export interface TrustAnchorStoreDb {
  remoteAction: {
    findFirst(args: {
      where: { actionType: string; status: string };
      orderBy: { createdAt: "desc" };
      select: { parameters: true; completedAt: true; createdAt: true };
    }): Promise<JoinImportRecord | null>;
  };
  platformConfig: {
    findUnique(args: { where: { key: string }; select: { value: true } }): Promise<
      { value: unknown } | null
    >;
  };
}

/**
 * Build the store `resolveOrganizationTrustAnchor` consumes.
 *
 * Neither read throws: the resolver treats a throw as an absent anchor, but
 * making that explicit here keeps the failure attributable to the read that
 * failed rather than to the resolver's catch-all.
 */
export function createOrganizationTrustAnchorStore(
  db: TrustAnchorStoreDb = prisma as unknown as TrustAnchorStoreDb,
  options: {
    env?: Record<string, string | undefined>;
    readText?: (path: string) => Promise<string>;
  } = {},
): OrganizationTrustAnchorStore {
  return {
    async findLatestCompletedJoinImport(): Promise<JoinImportRecord | null> {
      return db.remoteAction.findFirst({
        where: {
          actionType: JOIN_IMPORT_ACTION_TYPE,
          status: JOIN_IMPORT_COMPLETED_STATUS,
        },
        orderBy: { createdAt: "desc" },
        select: { parameters: true, completedAt: true, createdAt: true },
      });
    },

    async findLocalOrganizationRef(): Promise<string | null> {
      const resolution = await loadEstateNameResolution(
        {
          readConfig: async (key: string) =>
            (await db.platformConfig.findUnique({ where: { key }, select: { value: true } }))?.value ??
            null,
        },
        options,
      );
      // The SAME normal form the peer-advertised ref goes through in
      // `nearby-candidates`, because `evaluateOrganizationEnrollment` compares
      // the two with `!==`. See `normalizeOrganizationRef` for why this is not
      // `slugifyEstateName`.
      return normalizeOrganizationRef(resolution.estateName);
    },
  };
}
