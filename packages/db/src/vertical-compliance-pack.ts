import type { PrismaClient } from "../generated/client/client";
import * as crypto from "crypto";
import { type RegulationApplicability, type RegulationDomain } from "./regulation-applicability";

// Shared shape and seeder for archetype-gated compliance packs.
//
// Extracted once there were two pack files rather than copied a third time: the
// upsert-regulation / create-missing-obligations loop is identical across every
// pack, and a divergence in it would silently change how ONE vertical seeds.

export type ObligationSeed = {
  title: string;
  reference: string;
  description: string;
  category: string;
  frequency: string;
  applicability: string;
  penaltySummary: string | null;
};

export type VerticalRegulationSeed = {
  regulationId: string;
  name: string;
  shortName: string;
  jurisdiction: string;
  industry: string | null;
  sourceType: "external";
  sourceUrl: string | null;
  applicability: RegulationApplicability;
  domain: RegulationDomain;
  notes: string;
  obligations: ObligationSeed[];
};

function makeId(prefix: string): string {
  const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${prefix}-${hex}`;
}

/**
 * Idempotent: regulations upsert, and an obligation is created only when no
 * ACTIVE row with the same reference already exists under it. A re-seed must
 * never duplicate an obligation an operator has since given a review date to.
 */
export async function seedVerticalCompliancePack(
  prisma: PrismaClient,
  label: string,
  regulations: VerticalRegulationSeed[],
): Promise<void> {
  let regUpserts = 0;
  let oblCreated = 0;

  for (const { obligations, applicability, ...regData } of regulations) {
    const regulation = await prisma.regulation.upsert({
      where: { regulationId: regData.regulationId },
      update: {
        name: regData.name,
        shortName: regData.shortName,
        jurisdiction: regData.jurisdiction,
        sourceUrl: regData.sourceUrl,
        notes: regData.notes,
        applicability: applicability as never,
        domain: regData.domain,
      },
      create: { ...regData, applicability: applicability as never },
    });
    regUpserts++;

    for (const obl of obligations) {
      const existing = await prisma.obligation.findFirst({
        where: { regulationId: regulation.id, reference: obl.reference, status: "active" },
        select: { id: true },
      });
      if (existing) continue;
      await prisma.obligation.create({
        data: {
          obligationId: makeId("OBL"),
          regulationId: regulation.id,
          title: obl.title,
          description: obl.description,
          reference: obl.reference,
          category: obl.category,
          frequency: obl.frequency,
          applicability: obl.applicability,
          penaltySummary: obl.penaltySummary,
        },
      });
      oblCreated++;
    }
  }

  const expected = regulations.reduce((n, r) => n + r.obligations.length, 0);
  console.log(
    `[seed] ${label}: ${regUpserts}/${regulations.length} regulations upserted, `
      + `${oblCreated} obligations created (${expected} expected total)`,
  );
}
