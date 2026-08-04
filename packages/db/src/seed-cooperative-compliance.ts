import type { PrismaClient, Prisma } from "../generated/client/client";
import * as crypto from "crypto";
import { type RegulationApplicability, type RegulationDomain } from "./regulation-applicability";

// BI-AFC178F3 — cooperative compliance pack (civic spec §10).
// Same global-Regulation pattern as the public-sector pack, industry
// "cooperative": Subchapter T patronage mechanics + member-governance duties.
// Data-driven applicability (BI-9DED0CE8): gates on the cooperative archetype
// ids — credit unions are NOT in scope (exempt from Subchapter T; they answer
// to the banking pack's NCUA regime instead).

function makeId(prefix: string): string {
  const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${prefix}-${hex}`;
}

type ObligationSeed = {
  title: string;
  reference: string;
  description: string;
  category: string;
  frequency: string;
  applicability: string;
  penaltySummary: string | null;
};

type RegulationSeed = {
  regulationId: string;
  name: string;
  shortName: string;
  jurisdiction: string;
  industry: string;
  /** Data-driven applicability spec — scopes the regime to matching archetypes. */
  applicability: RegulationApplicability;
  /** Functional domain (attribution/reporting only). */
  domain: RegulationDomain;
  sourceType: "external";
  sourceUrl: string | null;
  notes: string;
  obligations: ObligationSeed[];
};

const COOPERATIVE_APPLICABILITY: RegulationApplicability = {
  basis: ["operating"],
  jurisdictions: ["us"],
  archetypes: ["cooperative", "agricultural-cooperative"],
};

export const COOPERATIVE_REGULATIONS: RegulationSeed[] = [
  {
    regulationId: "REG-US-IRS-SUBCHAPTER-T",
    domain: "finance",
    name: "IRC Subchapter T — Cooperative Patronage Taxation",
    shortName: "Subchapter T",
    jurisdiction: "US-federal",
    industry: "cooperative",
    applicability: COOPERATIVE_APPLICABILITY,
    sourceType: "external",
    sourceUrl: "https://uscode.house.gov/view.xhtml?edition=prelim&path=%2Fprelim%40title26%2FsubtitleA%2Fchapter1%2FsubchapterT",
    notes:
      "Internal Revenue Code §§1381–1388 govern how cooperatives deduct patronage dividends: " +
      "allocations must be made on the basis of business done with members, qualified written " +
      "notices of allocation require at least 20% paid in cash and member consent, and notices " +
      "must issue within 8.5 months of fiscal year end.",
    obligations: [
      {
        title: "Patronage allocated on the basis of business done with members",
        reference: "subchapter-t/patronage-basis",
        description:
          "Allocate patronage dividends to members in proportion to the business each member did " +
          "with the cooperative during the fiscal year, under a pre-existing obligation (bylaws or " +
          "member agreement). Maintain the per-member patronage-basis records that support the allocation.",
        category: "finance",
        frequency: "annual",
        applicability: "All cooperatives operating on a cooperative basis under Subchapter T",
        penaltySummary: "Allocations without basis records or a pre-existing obligation lose the patronage deduction.",
      },
      {
        title: "Qualified allocations: at least 20% cash and valid member consent",
        reference: "subchapter-t/qualified-cash-floor",
        description:
          "For a written notice of allocation to be qualified (deductible in the year of allocation), " +
          "pay at least 20% of the patronage dividend in cash or check and hold valid member consent " +
          "(bylaw consent, written consent, or qualified-check consent).",
        category: "finance",
        frequency: "annual",
        applicability: "Cooperatives issuing qualified written notices of allocation",
        penaltySummary: "Below the 20% floor the notice is nonqualified — deduction deferred until redemption.",
      },
      {
        title: "Written notices of allocation issued within the payment period",
        reference: "subchapter-t/notice-timing",
        description:
          "Issue written notices of allocation (and any cash portion) within the payment period — " +
          "8.5 months after the close of the fiscal year — for the allocation to count toward that year.",
        category: "finance",
        frequency: "annual",
        applicability: "All cooperatives allocating patronage",
        penaltySummary: null,
      },
      {
        title: "Form 1099-PATR filed for patronage distributions",
        reference: "subchapter-t/1099-patr",
        description:
          "File Form 1099-PATR for each member paid $10 or more in patronage dividends (or subject to " +
          "backup withholding) and furnish member copies by the statutory deadline.",
        category: "finance",
        frequency: "annual",
        applicability: "All cooperatives distributing patronage",
        penaltySummary: "Standard information-return penalties per missed or late form.",
      },
    ],
  },
  {
    regulationId: "REG-US-COOP-GOVERNANCE",
    domain: "corporate-governance",
    name: "Cooperative Governance Requirements (state co-op statutes & bylaws)",
    shortName: "Co-op Governance",
    jurisdiction: "US-state",
    industry: "cooperative",
    applicability: COOPERATIVE_APPLICABILITY,
    sourceType: "external",
    sourceUrl: null,
    notes:
      "State cooperative statutes and the co-op's own bylaws require democratic member control: " +
      "an annual member meeting, director elections, one-member-one-vote (with limited exceptions), " +
      "and maintained membership and equity records. Specifics vary by state and co-op type.",
    obligations: [
      {
        title: "Annual member meeting held with required notice",
        reference: "coop-governance/annual-meeting",
        description:
          "Hold the annual meeting of members with the notice period required by statute and bylaws; " +
          "present financial reports and conduct the business reserved to members (director elections, " +
          "bylaw amendments). Record minutes.",
        category: "governance",
        frequency: "annual",
        applicability: "All cooperatives",
        penaltySummary: "Failure can void elections and expose directors to member action.",
      },
      {
        title: "Director elections by the membership",
        reference: "coop-governance/director-elections",
        description:
          "Elect directors by member vote per bylaws (terms, districts/seats, nomination process). " +
          "Document election results in the meeting minutes and maintain the board roster.",
        category: "governance",
        frequency: "annual",
        applicability: "All cooperatives",
        penaltySummary: null,
      },
      {
        title: "Membership and equity records maintained",
        reference: "coop-governance/member-records",
        description:
          "Maintain the membership register (admissions, terminations) and each member's equity " +
          "ledger (allocations, retains, retirements) — the records that support both governance " +
          "rights and Subchapter T allocations.",
        category: "governance",
        frequency: "continuous",
        applicability: "All cooperatives",
        penaltySummary: null,
      },
      {
        title: "Bylaws current and available to members",
        reference: "coop-governance/bylaws",
        description:
          "Keep bylaws current with statute and practice (patronage obligation, consent provisions, " +
          "board structure) and available to members; amendments follow the member-vote process.",
        category: "governance",
        frequency: "continuous",
        applicability: "All cooperatives",
        penaltySummary: null,
      },
    ],
  },
];

type ControlSeed = {
  title: string;
  description: string;
  controlType: "preventive" | "detective" | "corrective";
  obligationRefs: string[];
};

export const COOPERATIVE_CONTROLS: ControlSeed[] = [
  {
    title: "Year-End Patronage Allocation Procedure",
    description:
      "Documented year-end run: determine the patronage pool, allocate on member patronage basis, " +
      "enforce the 20% cash floor for qualified notices, and issue notices within 8.5 months. " +
      "Backed by the Member Equity allocation runner.",
    controlType: "preventive",
    obligationRefs: [
      "subchapter-t/patronage-basis",
      "subchapter-t/qualified-cash-floor",
      "subchapter-t/notice-timing",
    ],
  },
  {
    title: "Member Equity Ledger",
    description:
      "Per-member equity ledger recording allocations, per-unit retains, and retirements — the " +
      "system of record behind notices, 1099-PATR amounts, and member equity statements.",
    controlType: "detective",
    obligationRefs: ["coop-governance/member-records", "subchapter-t/1099-patr"],
  },
  {
    title: "Annual Meeting & Election Workflow",
    description:
      "Meeting notice → agenda → annual meeting → minutes → recorded election results, on the " +
      "governance meeting workflow (bodyType annual-meeting / board).",
    controlType: "preventive",
    obligationRefs: ["coop-governance/annual-meeting", "coop-governance/director-elections"],
  },
];

export async function seedCooperativeCompliance(prisma: PrismaClient): Promise<void> {
  let regUpserts = 0;
  let oblCreated = 0;
  let ctlCreated = 0;
  let linksCreated = 0;

  const oblIdByRef = new Map<string, string>();

  for (const reg of COOPERATIVE_REGULATIONS) {
    const { obligations, ...regData } = reg;
    const applicability = regData.applicability as unknown as Prisma.InputJsonValue;
    const regulation = await prisma.regulation.upsert({
      where: { regulationId: regData.regulationId },
      update: {
        name: regData.name,
        shortName: regData.shortName,
        jurisdiction: regData.jurisdiction,
        industry: regData.industry,
        sourceType: regData.sourceType,
        sourceUrl: regData.sourceUrl,
        notes: regData.notes,
        applicability,
        domain: regData.domain,
      },
      create: { ...regData, applicability },
    });
    regUpserts++;

    for (const obl of obligations) {
      const existing = await prisma.obligation.findFirst({
        where: { regulationId: regulation.id, reference: obl.reference, status: "active" },
        select: { id: true },
      });
      if (existing) {
        oblIdByRef.set(obl.reference, existing.id);
        continue;
      }
      const created = await prisma.obligation.create({
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
      oblIdByRef.set(obl.reference, created.id);
      oblCreated++;
    }
  }

  for (const ctl of COOPERATIVE_CONTROLS) {
    const existing = await prisma.control.findFirst({
      where: { title: ctl.title, status: "active" },
      select: { id: true },
    });
    const controlId =
      existing?.id ??
      (
        await prisma.control.create({
          data: {
            controlId: makeId("CTL"),
            title: ctl.title,
            description: ctl.description,
            controlType: ctl.controlType,
            implementationStatus: "planned",
          },
        })
      ).id;
    if (!existing) ctlCreated++;

    for (const ref of ctl.obligationRefs) {
      const oblId = oblIdByRef.get(ref);
      if (!oblId) {
        throw new Error(
          `[seed-cooperative-compliance] control "${ctl.title}" references unknown obligation "${ref}"`,
        );
      }
      const link = await prisma.controlObligationLink.findUnique({
        where: { controlId_obligationId: { controlId, obligationId: oblId } },
      });
      if (!link) {
        await prisma.controlObligationLink.create({ data: { controlId, obligationId: oblId } });
        linksCreated++;
      }
    }
  }

  const expectedObligations = COOPERATIVE_REGULATIONS.reduce((n, r) => n + r.obligations.length, 0);
  console.log(
    `[seed] cooperative compliance pack: ${regUpserts}/${COOPERATIVE_REGULATIONS.length} regulations upserted, ` +
      `${oblCreated} obligations created (${expectedObligations} expected total), ` +
      `${ctlCreated} controls created, ${linksCreated} links created`,
  );
}
