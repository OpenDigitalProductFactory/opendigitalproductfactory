// BI-02F1F944 — idempotent Greenhouse hire → EmployeeProfile landing (Seam B).
//
// A Greenhouse "hired" candidate becomes an onboarding EmployeeProfile with no
// re-keying and no duplicate. Idempotency is enforced by a MasterDataSourceRef
// soft-crosswalk keyed on (domain="worker", sourceSystem="greenhouse",
// sourceEntityId=<candidate id>) — its @@unique makes a re-delivered hire a
// no-op. This reuses existing substrate only (EmployeeProfile + the MDM ref);
// the typed PrincipalAlias link is a later hardening (design §2.1, §9).

import { slugify } from "@/lib/shared/slugify";
import {
  offerCompensationColumns,
  type EmployeeCompensationColumns,
} from "@/lib/recruiting/offer-compensation";

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
  /**
   * The accepted offer's compensation (Offer.compensation JSON). Mapped onto the
   * EmployeeProfile comp columns payroll reads, so the hire lands PAYABLE — the
   * recruiting→hiring→paying seam. Absent/malformed comp lands the hire unpaid
   * (comp can be entered later); it never blocks the hire.
   */
  compensation?: unknown;
}

/** Structural transaction client — satisfied by Prisma's interactive tx client and test fakes. */
type HireLandingTransactionClient = {
  masterDataSourceRef: {
    findUnique: (args: unknown) => Promise<{ canonicalId: string } | null>;
    create: (args: unknown) => Promise<unknown>;
  };
  employeeProfile: {
    create: (args: unknown) => Promise<{ id: string }>;
  };
};

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type HireLandingClient = HireLandingTransactionClient & {
  $transaction: <T>(fn: (tx: HireLandingTransactionClient) => Promise<T>) => Promise<T>;
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

  // Carry the accepted offer's pay terms onto the comp columns payroll reads, so
  // the new hire is immediately payable (the recruiting→hiring→paying seam).
  const compColumns: EmployeeCompensationColumns | null = offerCompensationColumns(
    hire.compensation,
  );

  try {
    const employeeProfileId = await db.$transaction(async (tx) => {
      const created = await tx.employeeProfile.create({
        data: {
          employeeId: makeGreenhouseEmployeeId(hire.displayName, hire.candidateId),
          firstName: hire.firstName || hire.displayName,
          lastName: hire.lastName,
          displayName: hire.displayName,
          status: "onboarding",
          ...(hire.workEmail ? { workEmail: hire.workEmail } : {}),
          ...(hire.phoneWork ? { phoneWork: hire.phoneWork } : {}),
          ...(hire.startDate ? { startDate: new Date(hire.startDate) } : {}),
          ...(compColumns ?? {}),
        },
        select: { id: true },
      });

      const now = new Date();
      await tx.masterDataSourceRef.create({
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
      return created.id;
    });

    return { landed: true, employeeProfileId };
  } catch (error) {
    // A concurrent delivery may win the unique crosswalk race. The interactive
    // transaction rolls back this attempt's EmployeeProfile; return only the
    // winner's canonical id. If no winner exists, this was a real write failure.
    const winner = await db.masterDataSourceRef.findUnique({
      where: {
        domain_sourceSystem_sourceEntityId: {
          domain: WORKER_MDM_DOMAIN,
          sourceSystem: GREENHOUSE_SOURCE_SYSTEM,
          sourceEntityId: hire.candidateId,
        },
      },
    });
    if (winner) {
      return { landed: false, reason: "already-landed", employeeProfileId: winner.canonicalId };
    }
    throw error;
  }
}
