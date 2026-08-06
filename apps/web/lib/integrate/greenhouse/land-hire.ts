// BI-02F1F944 — idempotent Greenhouse hire → EmployeeProfile landing (Seam B).
//
// A Greenhouse "hired" candidate becomes an onboarding EmployeeProfile with no
// re-keying and no duplicate. Idempotency is enforced by a MasterDataSourceRef
// soft-crosswalk keyed on (domain="worker", sourceSystem="greenhouse",
// sourceEntityId=<candidate id>) — its @@unique makes a re-delivered hire a
// no-op. This reuses existing substrate only (EmployeeProfile + the MDM ref);
// the typed PrincipalAlias link is a later hardening (design §2.1, §9).

import { slugify } from "@/lib/shared/slugify";

export const WORKER_MDM_DOMAIN = "worker";
export const GREENHOUSE_SOURCE_SYSTEM = "greenhouse";

export interface GreenhouseHire {
  /** Greenhouse candidate id — the idempotency key. */
  candidateId: string;
  /** Greenhouse application id (recorded for lineage). */
  applicationId: string | null;
  firstName: string;
  lastName: string;
  displayName: string;
  workEmail: string | null;
  phoneWork: string | null;
  /** ISO date the offer starts (Offer Packet `starts_at`). */
  startDate: string | null;
}

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type HireLandingClient = {
  masterDataSourceRef: {
    findUnique: (args: unknown) => Promise<{ canonicalId: string } | null>;
    create: (args: unknown) => Promise<unknown>;
  };
  employeeProfile: {
    create: (args: unknown) => Promise<{ id: string }>;
  };
};

export type HireLandingResult =
  | { landed: true; employeeProfileId: string }
  | { landed: false; reason: "already-landed"; employeeProfileId: string };

function makeGreenhouseEmployeeId(displayName: string, candidateId: string): string {
  const slug = slugify(displayName).slice(0, 24) || "employee";
  // Deterministic + unique per Greenhouse candidate (no clock needed).
  return `emp-${slug}-gh${candidateId}`;
}

/**
 * Land a Greenhouse hire idempotently. If a worker crosswalk already exists for
 * this candidate, returns the existing profile without creating a duplicate.
 */
export async function landGreenhouseHire(
  db: HireLandingClient,
  hire: GreenhouseHire,
): Promise<HireLandingResult> {
  const existing = await db.masterDataSourceRef.findUnique({
    where: {
      domain_sourceSystem_sourceEntityId: {
        domain: WORKER_MDM_DOMAIN,
        sourceSystem: GREENHOUSE_SOURCE_SYSTEM,
        sourceEntityId: hire.candidateId,
      },
    },
  });
  if (existing) {
    return { landed: false, reason: "already-landed", employeeProfileId: existing.canonicalId };
  }

  const created = await db.employeeProfile.create({
    data: {
      employeeId: makeGreenhouseEmployeeId(hire.displayName, hire.candidateId),
      firstName: hire.firstName || hire.displayName,
      lastName: hire.lastName,
      displayName: hire.displayName,
      status: "onboarding",
      ...(hire.workEmail ? { workEmail: hire.workEmail } : {}),
      ...(hire.phoneWork ? { phoneWork: hire.phoneWork } : {}),
      ...(hire.startDate ? { startDate: new Date(hire.startDate) } : {}),
    },
    select: { id: true },
  });

  const now = new Date();
  try {
    await db.masterDataSourceRef.create({
      data: {
        domain: WORKER_MDM_DOMAIN,
        canonicalId: created.id,
        sourceSystem: GREENHOUSE_SOURCE_SYSTEM,
        sourceEntityType: "candidate",
        sourceEntityId: hire.candidateId,
        observedAt: now,
        lastSeenAt: now,
        trustTier: "connector",
      },
    });
  } catch {
    // A concurrent delivery won the race and created the crosswalk first; the
    // @@unique(domain, sourceSystem, sourceEntityId) rejected this one. The
    // hire is already represented — treat as landed, not an error.
    return { landed: false, reason: "already-landed", employeeProfileId: created.id };
  }

  return { landed: true, employeeProfileId: created.id };
}
