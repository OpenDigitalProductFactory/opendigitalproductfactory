import type { PrismaClient, Prisma } from "../generated/client/client";
import * as crypto from "crypto";
import { type RegulationApplicability, type RegulationDomain } from "./regulation-applicability";

// BI-D9ACE184 + BI-E677F250 — banking deltas compliance pack (civic spec §10).
// industry "financial". The recurring-obligation regimes the BIAN leaf work
// (BI-5D9DCDE6) deliberately left out — licensing/credentials live on the
// licensing substrate; recurring obligations live here. BSA/AML is a SINGLE
// shared regulation both bank and credit union answer to (not double-seeded);
// NCUA is credit-union-specific; FDIC/CRA is community-bank-specific.
// Each regulation carries a data-driven applicability spec (BI-9DED0CE8) so an
// install is only in scope when its setup-chosen archetype matches — NCUA gates
// on the `credit-union` archetype id, FDIC/CRA on `community-bank`, BSA/AML on
// the whole banking-financial-services category.

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

export const BANKING_REGULATIONS: RegulationSeed[] = [
  {
    regulationId: "REG-US-BSA-AML",
    domain: "finance",
    name: "Bank Secrecy Act / Anti-Money Laundering",
    shortName: "BSA/AML",
    jurisdiction: "US-federal",
    industry: "financial",
    applicability: { basis: ["operating"], jurisdictions: ["us"], archetypes: ["banking-financial-services"] },
    sourceType: "external",
    sourceUrl: "https://www.fincen.gov/resources/statutes-and-regulations/bank-secrecy-act",
    notes:
      "The Bank Secrecy Act and its AML program requirements apply to all insured " +
      "depositories — community banks AND credit unions alike. A single shared regime: " +
      "customer identification, suspicious-activity and currency-transaction reporting, " +
      "sanctions screening, and an independently-tested program under a designated BSA officer.",
    obligations: [
      {
        title: "Customer Identification Program (CIP) / KYC",
        reference: "bsa/cip-kyc",
        description:
          "Maintain a written Customer Identification Program: verify identity at account " +
          "opening, perform customer due diligence and beneficial-ownership identification for " +
          "legal-entity members/customers, and apply risk-based enhanced due diligence.",
        category: "operational",
        frequency: "continuous",
        applicability: "All insured depositories (banks and credit unions)",
        penaltySummary: "Civil money penalties and consent orders for program deficiencies.",
      },
      {
        title: "Suspicious Activity Report (SAR) filing",
        reference: "bsa/sar",
        description:
          "File a SAR with FinCEN within 30 days of detecting suspicious activity meeting the " +
          "reporting threshold (60 days where no suspect is identified). Maintain SAR confidentiality.",
        category: "operational",
        frequency: "event-driven",
        applicability: "All insured depositories",
        penaltySummary: "Failure to file is a frequent BSA enforcement basis; criminal exposure for willful violations.",
      },
      {
        title: "Currency Transaction Report (CTR) filing",
        reference: "bsa/ctr",
        description:
          "File a CTR for cash transactions exceeding $10,000 (single or aggregated) within 15 days, " +
          "and maintain the exemption list for eligible customers.",
        category: "operational",
        frequency: "event-driven",
        applicability: "All insured depositories",
        penaltySummary: null,
      },
      {
        title: "OFAC / sanctions screening",
        reference: "bsa/ofac",
        description:
          "Screen customers and transactions against OFAC sanctions lists, block or reject " +
          "prohibited transactions, and report blocked property within the required window.",
        category: "operational",
        frequency: "continuous",
        applicability: "All insured depositories",
        penaltySummary: "Strict-liability OFAC penalties per violation.",
      },
      {
        title: "BSA officer designation & independent testing",
        reference: "bsa/officer-testing",
        description:
          "Designate a qualified BSA/AML compliance officer and conduct independent testing of the " +
          "program on a risk-based cadence (commonly annual), with board reporting of findings.",
        category: "governance",
        frequency: "annual",
        applicability: "All insured depositories",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-NCUA",
    domain: "finance",
    name: "NCUA Regulatory Requirements (federally insured credit unions)",
    shortName: "NCUA",
    jurisdiction: "US-federal",
    industry: "financial",
    applicability: { basis: ["operating"], jurisdictions: ["us"], archetypes: ["credit-union"] },
    sourceType: "external",
    sourceUrl: "https://ncua.gov/regulation-supervision/manuals-guides",
    notes:
      "The National Credit Union Administration regulates and insures federal and most " +
      "state-chartered credit unions: quarterly Call Report (Form 5300), field-of-membership " +
      "compliance, supervisory-committee audit, and remediation of examiner findings (DORs).",
    obligations: [
      {
        title: "NCUA 5300 Call Report — quarterly",
        reference: "ncua/5300-call-report",
        description:
          "File the NCUA Form 5300 Call Report each quarter by the filing deadline with accurate " +
          "financial and statistical data. Late or inaccurate filings draw examiner scrutiny.",
        category: "finance",
        frequency: "monthly",
        applicability: "All federally insured credit unions",
        penaltySummary: "Civil money penalties for late Call Report filing.",
      },
      {
        title: "Field-of-membership compliance",
        reference: "ncua/field-of-membership",
        description:
          "Admit members only within the approved field of membership (common bond, community, or " +
          "associational), and maintain records evidencing each member's eligibility.",
        category: "governance",
        frequency: "continuous",
        applicability: "All credit unions",
        penaltySummary: "Out-of-FOM membership can trigger charter action.",
      },
      {
        title: "Supervisory-committee annual audit",
        reference: "ncua/supervisory-audit",
        description:
          "The supervisory committee ensures an annual audit (or NCUA-acceptable alternative) and a " +
          "periodic verification of member accounts, reporting results to the board.",
        category: "governance",
        frequency: "annual",
        applicability: "All credit unions",
        penaltySummary: null,
      },
      {
        title: "Document of Resolution (DOR) tracking & remediation",
        reference: "ncua/dor-tracking",
        description:
          "Track examiner-issued Documents of Resolution and other findings to remediation with owners " +
          "and due dates; report status to the board until each is resolved.",
        category: "governance",
        frequency: "event-driven",
        applicability: "Credit unions with open examination findings",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-FDIC-CRA",
    domain: "finance",
    name: "FDIC/OCC Bank Supervision — Call Report, CRA & Fair Lending",
    shortName: "Bank Supervision",
    jurisdiction: "US-federal",
    industry: "financial",
    applicability: { basis: ["operating"], jurisdictions: ["us"], archetypes: ["community-bank"] },
    sourceType: "external",
    sourceUrl: "https://www.ffiec.gov/resources/reporting-forms",
    notes:
      "Community banks file the quarterly FFIEC Call Report and are examined for Community " +
      "Reinvestment Act performance, fair-lending compliance (ECOA/HMDA), insider-lending limits " +
      "(Reg O), with examiner findings tracked to remediation.",
    obligations: [
      {
        title: "FFIEC Call Report — quarterly",
        reference: "bank/ffiec-call-report",
        description:
          "File the quarterly FFIEC Consolidated Reports of Condition and Income (Call Report) by the " +
          "filing deadline with accurate data subject to validation edits.",
        category: "finance",
        frequency: "monthly",
        applicability: "All insured banks",
        penaltySummary: "Civil money penalties for late or materially inaccurate Call Reports.",
      },
      {
        title: "Community Reinvestment Act (CRA) performance",
        reference: "bank/cra",
        description:
          "Help meet the credit needs of the entire community including low- and moderate-income " +
          "neighborhoods; maintain the CRA public file and prepare for periodic CRA examination.",
        category: "governance",
        frequency: "continuous",
        applicability: "Insured banks subject to CRA",
        penaltySummary: "A poor CRA rating can block mergers, branches, and acquisitions.",
      },
      {
        title: "Fair lending — ECOA & HMDA",
        reference: "bank/fair-lending",
        description:
          "Comply with the Equal Credit Opportunity Act (non-discrimination) and, where applicable, " +
          "collect and report HMDA loan data accurately; monitor for disparate treatment and impact.",
        category: "governance",
        frequency: "annual",
        applicability: "Insured banks engaged in lending",
        penaltySummary: "Fair-lending violations carry referrals to DOJ and significant penalties.",
      },
      {
        title: "Regulation O — insider lending limits",
        reference: "bank/reg-o",
        description:
          "Comply with Regulation O limits and approval/reporting requirements for extensions of " +
          "credit to insiders (directors, executive officers, principal shareholders, and their interests).",
        category: "governance",
        frequency: "continuous",
        applicability: "All insured banks",
        penaltySummary: null,
      },
      {
        title: "Examination-finding remediation (MRAs / MRIAs)",
        reference: "bank/exam-remediation",
        description:
          "Track Matters Requiring Attention and Matters Requiring Immediate Attention from examinations " +
          "to remediation with owners and due dates; report status to the board until resolved.",
        category: "governance",
        frequency: "event-driven",
        applicability: "Banks with open examination findings",
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

export const BANKING_CONTROLS: ControlSeed[] = [
  {
    title: "BSA/AML Program",
    description:
      "Documented BSA/AML program: CIP/KYC, SAR/CTR filing procedures, OFAC screening, designated " +
      "BSA officer, and independent testing — shared by banks and credit unions.",
    controlType: "preventive",
    obligationRefs: [
      "bsa/cip-kyc",
      "bsa/sar",
      "bsa/ctr",
      "bsa/ofac",
      "bsa/officer-testing",
    ],
  },
  {
    title: "NCUA Call-Report & Supervisory Audit",
    description:
      "Quarterly 5300 Call Report filing, field-of-membership eligibility records, supervisory-" +
      "committee annual audit, and DOR remediation tracking.",
    controlType: "detective",
    obligationRefs: [
      "ncua/5300-call-report",
      "ncua/field-of-membership",
      "ncua/supervisory-audit",
      "ncua/dor-tracking",
    ],
  },
  {
    title: "FFIEC Call-Report & Exam Remediation",
    description:
      "Quarterly FFIEC Call Report, CRA public file and performance, fair-lending (ECOA/HMDA) " +
      "monitoring, Reg O insider-lending controls, and MRA/MRIA remediation tracking.",
    controlType: "detective",
    obligationRefs: [
      "bank/ffiec-call-report",
      "bank/cra",
      "bank/fair-lending",
      "bank/reg-o",
      "bank/exam-remediation",
    ],
  },
];

export async function seedBankingCompliance(prisma: PrismaClient): Promise<void> {
  let regUpserts = 0;
  let oblCreated = 0;
  let ctlCreated = 0;
  let linksCreated = 0;

  const oblIdByRef = new Map<string, string>();

  for (const reg of BANKING_REGULATIONS) {
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

  for (const ctl of BANKING_CONTROLS) {
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
          `[seed-banking-compliance] control "${ctl.title}" references unknown obligation "${ref}"`,
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

  const expectedObligations = BANKING_REGULATIONS.reduce((n, r) => n + r.obligations.length, 0);
  console.log(
    `[seed] banking compliance pack: ${regUpserts}/${BANKING_REGULATIONS.length} regulations upserted, ` +
      `${oblCreated} obligations created (${expectedObligations} expected total), ` +
      `${ctlCreated} controls created, ${linksCreated} links created`,
  );
}
