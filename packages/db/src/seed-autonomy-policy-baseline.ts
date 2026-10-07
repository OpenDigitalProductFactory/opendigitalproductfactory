// Seed the WWMD autonomy baseline (BI-E30C0F4F). Runs on every install and every
// upgrade. Idempotent and non-clobbering: a lineage whose newest row an operator
// authored is left alone; a changed baseline retires the old row and creates the
// next version, so history is kept.

import { randomUUID } from "node:crypto";

import type { PrismaClient } from "../generated/client/client";
import { assertHumanControlHasBasis, buildWwmdBaselinePolicies, type AutonomyPolicySeedRow } from "./autonomy-policy-baseline.js";

export interface AutonomyPolicyBaselineSeedResult {
  created: number;
  superseded: number;
  unchanged: number;
  preserved: number;
}

type PolicyRow = Record<string, unknown> & { policyId: string; version: number; status: string; sourceKind: string };

const COMPARED: Array<keyof AutonomyPolicySeedRow> = [
  "industry", "jurisdiction", "jurisdictionBasis", "activityClass", "maxAutonomyLevel",
  "humanControlRequired", "requiredEvidence", "regulationId", "rationale",
];

function sameContent(existing: PolicyRow, row: AutonomyPolicySeedRow): boolean {
  return COMPARED.every((field) => JSON.stringify(existing[field] ?? null) === JSON.stringify(row[field] ?? null));
}

export async function seedAutonomyPolicyBaseline(
  prisma: Pick<PrismaClient, "regulatoryAutonomyPolicy">,
): Promise<AutonomyPolicyBaselineSeedResult> {
  const result: AutonomyPolicyBaselineSeedResult = { created: 0, superseded: 0, unchanged: 0, preserved: 0 };

  for (const row of buildWwmdBaselinePolicies()) {
    assertHumanControlHasBasis(row);
    const lineage = (await prisma.regulatoryAutonomyPolicy.findMany({
      where: { policyKey: row.policyKey },
      orderBy: { version: "desc" },
    })) as unknown as PolicyRow[];
    const newest = lineage[0];

    if (newest && newest.sourceKind !== row.sourceKind) {
      result.preserved += 1;
      continue;
    }
    if (newest && newest.status === "active" && sameContent(newest, row)) {
      result.unchanged += 1;
      continue;
    }
    if (newest && newest.status === "active") {
      await prisma.regulatoryAutonomyPolicy.update({
        where: { policyId: newest.policyId },
        data: { status: "retired", effectiveUntil: new Date() },
      });
      result.superseded += 1;
    }
    await prisma.regulatoryAutonomyPolicy.create({
      data: {
        policyId: `rap-${randomUUID()}`,
        version: (newest?.version ?? 0) + 1,
        ...row,
      },
    });
    result.created += 1;
  }

  return result;
}
