// BI-E64D11AE (Absorb) — promote a Greenhouse hire into native recruiting rows.
// A hired candidate becomes a native Candidate + a hired Application, crosswalked
// to their Greenhouse source ids so the native pipeline shows the hire as one
// funnel item (deduped against the staged row by the pipeline read-model).
// Idempotent via the recruiting crosswalk. Complements the batch-1 hire->worker
// landing (which creates the EmployeeProfile); this creates the recruiting record.

import type { GreenhouseHire } from "@/lib/integrate/greenhouse/land-hire";
import {
  RECRUITING_DOMAINS,
  registerRecruitingCrosswalk,
  resolveNativeRecruitingId,
  type RecruitingCrosswalkClient,
} from "./recruiting-crosswalk";

const SOURCE = "greenhouse";

/** Structural client — the real PrismaClient and test fakes satisfy it. */
export type PromoteHireClient = RecruitingCrosswalkClient & {
  candidate: { create: (args: unknown) => Promise<{ id: string }> };
  application: { create: (args: unknown) => Promise<{ id: string }> };
};

export interface PromoteHireResult {
  candidateId: string;
  applicationId: string;
  promoted: boolean;
}

/** Greenhouse application id, or the candidate id when the hire carries none. */
function applicationKey(hire: GreenhouseHire): string {
  return hire.applicationId ?? hire.candidateId;
}

export async function promoteGreenhouseHireToNative(
  db: PromoteHireClient,
  hire: GreenhouseHire,
): Promise<PromoteHireResult> {
  const appKey = applicationKey(hire);

  // Idempotent: an existing application crosswalk means this hire is already
  // represented natively.
  const existingApp = await resolveNativeRecruitingId(db, {
    domain: RECRUITING_DOMAINS.application,
    sourceSystem: SOURCE,
    sourceEntityId: appKey,
  });
  if (existingApp) {
    const existingCandidate = await resolveNativeRecruitingId(db, {
      domain: RECRUITING_DOMAINS.candidate,
      sourceSystem: SOURCE,
      sourceEntityId: hire.candidateId,
    });
    return {
      candidateId: existingCandidate ?? "",
      applicationId: existingApp,
      promoted: false,
    };
  }

  // Resolve or create the native Candidate.
  let candidateId = await resolveNativeRecruitingId(db, {
    domain: RECRUITING_DOMAINS.candidate,
    sourceSystem: SOURCE,
    sourceEntityId: hire.candidateId,
  });
  if (!candidateId) {
    const created = await db.candidate.create({
      data: {
        candidateId: `gh-${hire.candidateId}`,
        kind: "candidate",
        displayName: hire.displayName || `candidate-${hire.candidateId}`,
        ...(hire.firstName ? { firstName: hire.firstName } : {}),
        ...(hire.lastName ? { lastName: hire.lastName } : {}),
        ...(hire.workEmail ? { email: hire.workEmail } : {}),
        ...(hire.phoneWork ? { phone: hire.phoneWork } : {}),
      },
    });
    candidateId = created.id;
    await registerRecruitingCrosswalk(db, {
      domain: RECRUITING_DOMAINS.candidate,
      sourceSystem: SOURCE,
      sourceEntityId: hire.candidateId,
      canonicalId: candidateId,
    });
  }

  // Create the hired native Application and crosswalk it.
  const application = await db.application.create({
    data: {
      applicationId: `gh-${appKey}`,
      candidateId,
      status: "hired",
    },
  });
  await registerRecruitingCrosswalk(db, {
    domain: RECRUITING_DOMAINS.application,
    sourceSystem: SOURCE,
    sourceEntityId: appKey,
    canonicalId: application.id,
  });

  return { candidateId, applicationId: application.id, promoted: true };
}
