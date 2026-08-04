import type { PrismaClient, Prisma } from "../generated/client/client";
import * as crypto from "crypto";
import { UK_CORP_GOV_CODE_APPLICABILITY, type RegulationDomain } from "./regulation-applicability";

// UK Corporate Governance Code (FRC, 2024 edition) compliance pack, focused on
// Provision 29 — the board internal-controls accountability declaration. This is
// a cross-sector, listing-gated regime (any industry archetype can be a UK
// premium-listed company), so it is NOT industry-seeded like the banking /
// public-sector packs. Applicability is stored as DATA on the regulation
// (Regulation.applicability = UK_CORP_GOV_CODE_APPLICABILITY) and classified
// generically per-install by classifyRegulationForInstall — no per-regulation code.
//
// The Code is "comply or explain" under the premium-listing regime, not statute.
// Provision 29 first applies for accounting periods beginning on/after
// 1 January 2026 (first affected annual reports land in 2027).

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
  deliverableType?: string;
};

type RegulationSeed = {
  regulationId: string;
  name: string;
  shortName: string;
  jurisdiction: string;
  industry: string | null;
  sourceType: "external";
  sourceUrl: string | null;
  /** Functional domain (attribution/reporting only). */
  domain: RegulationDomain;
  notes: string;
  obligations: ObligationSeed[];
};

// Single regulation record; cross-sector (industry = null) and listing-gated.
export const UK_CORP_GOV_REGULATIONS: RegulationSeed[] = [
  {
    regulationId: "REG-UK-CORP-GOV-CODE",
    domain: "corporate-governance",
    name: "UK Corporate Governance Code (2024) — Provision 29 board internal-controls declaration",
    shortName: "UK Corp Gov Code / Provision 29",
    jurisdiction: "UK",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.frc.org.uk/library/standards-codes-policy/corporate-governance/uk-corporate-governance-code/",
    notes:
      "The Financial Reporting Council's UK Corporate Governance Code applies on a " +
      "'comply or explain' basis to companies with a UK premium listing (in practice the " +
      "FTSE 350 and other premium-listed companies). Provision 29 of the 2024 Code is the " +
      "headline change: the board must monitor its risk-management and internal-control " +
      "framework, review the effectiveness of its MATERIAL controls across financial, " +
      "operational, compliance and reporting risks, and declare in the annual report whether " +
      "those controls operated effectively at the balance-sheet date — disclosing any material " +
      "weaknesses and remediation. Provision 29 applies for accounting periods beginning on or " +
      "after 1 January 2026, so the first affected annual reports appear in 2027. Standard-listed, " +
      "AIM-listed and private companies are out of scope (though many adopt it as good practice). " +
      "Not statute: enforcement is via the listing regime and investor pressure, not criminal liability.",
    obligations: [
      {
        title: "Monitor the risk-management & internal-control framework",
        reference: "ukcgc/p29-monitor-framework",
        description:
          "The board monitors the company's risk-management and internal-control framework " +
          "throughout the reporting year — not only at year end — covering financial, " +
          "operational, compliance and reporting risks.",
        category: "governance",
        frequency: "continuous",
        applicability: "UK premium-listed companies (FTSE 350 and other premium listings)",
        penaltySummary: "Comply-or-explain: a deficient framework or an unexplained deviation draws investor and listing-regime scrutiny.",
      },
      {
        title: "Review effectiveness of material controls",
        reference: "ukcgc/p29-review-material-controls",
        description:
          "Identify the company's MATERIAL controls and review whether they operated effectively " +
          "across financial, operational, compliance and reporting risks, gathering the assurance " +
          "evidence needed to support the year-end declaration.",
        category: "governance",
        frequency: "annual",
        applicability: "UK premium-listed companies",
        penaltySummary: null,
      },
      {
        title: "Board declaration on material-controls effectiveness (annual report)",
        reference: "ukcgc/p29-board-declaration",
        description:
          "Include a declaration in the annual report stating whether the board considers the " +
          "company's material controls to have operated effectively as at the balance-sheet date. " +
          "This is the personal-accountability shift — the board stands behind the declaration, " +
          "not merely a description of the framework.",
        category: "reporting",
        frequency: "annual",
        applicability: "UK premium-listed companies, for accounting periods beginning on/after 1 Jan 2026",
        penaltySummary: "Comply-or-explain: a missing or unexplained declaration is a governance-reporting failure under the listing regime.",
        deliverableType: "board-declaration",
      },
      {
        title: "Disclose material weaknesses and remediation",
        reference: "ukcgc/p29-disclose-weaknesses",
        description:
          "Where material weaknesses in the material controls are identified, disclose them and " +
          "explain the action taken or planned to remediate them.",
        category: "reporting",
        frequency: "event-driven",
        applicability: "UK premium-listed companies with identified material weaknesses",
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

export const UK_CORP_GOV_CONTROLS: ControlSeed[] = [
  {
    title: "Provision 29 material-controls monitoring & board declaration",
    description:
      "Year-round monitoring of the risk-management and internal-control framework, an annual " +
      "effectiveness review of the identified material controls (financial, operational, " +
      "compliance, reporting), the board's annual-report effectiveness declaration, and " +
      "disclosure/remediation of any material weaknesses.",
    controlType: "detective",
    obligationRefs: [
      "ukcgc/p29-monitor-framework",
      "ukcgc/p29-review-material-controls",
      "ukcgc/p29-board-declaration",
      "ukcgc/p29-disclose-weaknesses",
    ],
  },
];

export async function seedUkCorpGovCompliance(prisma: PrismaClient): Promise<void> {
  let regUpserts = 0;
  let oblCreated = 0;
  let ctlCreated = 0;
  let linksCreated = 0;

  const oblIdByRef = new Map<string, string>();

  for (const reg of UK_CORP_GOV_REGULATIONS) {
    const { obligations, ...regData } = reg;
    const applicability = UK_CORP_GOV_CODE_APPLICABILITY as unknown as Prisma.InputJsonValue;
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
          deliverableType: obl.deliverableType ?? null,
        },
      });
      oblIdByRef.set(obl.reference, created.id);
      oblCreated++;
    }
  }

  for (const ctl of UK_CORP_GOV_CONTROLS) {
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
          `[seed-uk-corp-gov-compliance] control "${ctl.title}" references unknown obligation "${ref}"`,
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

  const expectedObligations = UK_CORP_GOV_REGULATIONS.reduce((n, r) => n + r.obligations.length, 0);
  console.log(
    `[seed] UK corporate-governance compliance pack: ${regUpserts}/${UK_CORP_GOV_REGULATIONS.length} regulations upserted, ` +
      `${oblCreated} obligations created (${expectedObligations} expected total), ` +
      `${ctlCreated} controls created, ${linksCreated} links created`,
  );
}
