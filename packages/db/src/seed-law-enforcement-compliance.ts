import type { PrismaClient, Prisma } from "../generated/client/client";
import * as crypto from "crypto";
import { type RegulationApplicability, type RegulationDomain } from "./regulation-applicability";

// BI-C1578821 — law-enforcement compliance pack (civic spec §10).
// industry "public-safety". Phase 1 is NO-CJI by design: this pack covers POST
// training, policy attestation, and a CJIS READINESS GATE that is an explicit
// Phase-2 prerequisite, NOT a satisfied control.
// Data-driven applicability (BI-9DED0CE8): gates on the specific
// `law-enforcement-agency` archetype id — its category is public-sector, so the
// category-wide public-body pack also applies to an agency, but POST/CJIS bind
// no other public body.

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

const LAW_ENFORCEMENT_APPLICABILITY: RegulationApplicability = {
  basis: ["operating"],
  jurisdictions: ["us"],
  archetypes: ["law-enforcement-agency"],
};

export const LAW_ENFORCEMENT_REGULATIONS: RegulationSeed[] = [
  {
    regulationId: "REG-US-STATE-POST",
    domain: "sector",
    name: "Peace Officer Standards & Training (state POST)",
    shortName: "POST",
    jurisdiction: "US-state",
    industry: "public-safety",
    applicability: LAW_ENFORCEMENT_APPLICABILITY,
    sourceType: "external",
    sourceUrl: null,
    notes:
      "State Peace Officer Standards and Training (POST) commissions set officer " +
      "certification, mandated annual in-service training hours, firearms and use-of-force " +
      "qualification, and decertification reporting. Hour requirements and cadence vary by " +
      "state; configure from the agency's state.",
    obligations: [
      {
        title: "Annual in-service training hours per officer",
        reference: "post/in-service-hours",
        description:
          "Each sworn officer completes the state-mandated annual in-service training hours " +
          "(commonly 20–40), with documented topics. Track completion per officer against the " +
          "state requirement and flag shortfalls before the reporting deadline.",
        category: "operational",
        frequency: "annual",
        applicability: "All sworn officers",
        penaltySummary: "Officers below required hours may lose certification eligibility.",
      },
      {
        title: "Officer certification currency",
        reference: "post/certification-currency",
        description:
          "Maintain current POST certification for every sworn officer (initial academy, " +
          "field training completion, and continuing requirements). Track certification status " +
          "and expirations.",
        category: "operational",
        frequency: "continuous",
        applicability: "All sworn officers",
        penaltySummary: "Employing an uncertified officer exposes the agency to liability.",
      },
      {
        title: "Firearms & use-of-force qualification cadence",
        reference: "post/use-of-force-qualification",
        description:
          "Conduct and document firearms qualification and use-of-force/defensive-tactics " +
          "training on the state-required cadence (commonly annual or semi-annual).",
        category: "operational",
        frequency: "annual",
        applicability: "All sworn officers carrying firearms",
        penaltySummary: null,
      },
      {
        title: "Decertification & separation reporting",
        reference: "post/decertification-reporting",
        description:
          "Report officer separations for misconduct and decertification events to the state " +
          "POST commission (and the national decertification index where applicable) within the " +
          "statutory window.",
        category: "operational",
        frequency: "event-driven",
        applicability: "Agency professional-standards function",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-LE-POLICY-ATTESTATION",
    domain: "sector",
    name: "Law Enforcement Policy Issuance & Attestation",
    shortName: "LE Policy",
    jurisdiction: "US-state",
    industry: "public-safety",
    applicability: LAW_ENFORCEMENT_APPLICABILITY,
    sourceType: "external",
    sourceUrl: null,
    notes:
      "Agencies must issue, update, and obtain officer attestation to core policies, and " +
      "retain body-worn-camera footage per state schedules. Specifics vary by state and " +
      "agency accreditation (e.g. CALEA).",
    obligations: [
      {
        title: "Use-of-force policy issued and attested",
        reference: "le-policy/use-of-force",
        description:
          "Maintain a current use-of-force policy (including de-escalation and duty-to-intervene " +
          "where required) and obtain documented officer attestation on issuance and material update.",
        category: "governance",
        frequency: "event-driven",
        applicability: "All sworn officers",
        penaltySummary: "Outdated or un-attested policy is a frequent civil-liability finding.",
      },
      {
        title: "Body-worn camera policy and retention schedule",
        reference: "le-policy/bwc-retention",
        description:
          "Maintain a body-worn-camera policy and retain footage per the state schedule " +
          "(non-evidentiary commonly 60–90 days; use-of-force/complaint footage longer). " +
          "Configure the retention window from the agency's state. NOTE: Phase 1 tracks the " +
          "POLICY and schedule only — it stores no footage (CJI/evidence is Phase 2).",
        category: "governance",
        frequency: "continuous",
        applicability: "Agencies deploying body-worn cameras",
        penaltySummary: null,
      },
      {
        title: "Complaint intake & internal-affairs process",
        reference: "le-policy/complaint-intake",
        description:
          "Maintain an accessible citizen complaint-intake process and a documented internal-" +
          "affairs/professional-standards review workflow with defined timelines and disposition records.",
        category: "governance",
        frequency: "continuous",
        applicability: "All agencies",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-CJIS-READINESS",
    domain: "sector",
    name: "FBI CJIS Security Policy — Readiness Gate (Phase 2 prerequisite)",
    shortName: "CJIS Gate",
    jurisdiction: "US-federal",
    industry: "public-safety",
    applicability: LAW_ENFORCEMENT_APPLICABILITY,
    sourceType: "external",
    sourceUrl: "https://le.fbi.gov/cjis-division/cjis-security-policy-resource-center",
    notes:
      "The FBI CJIS Security Policy governs any system that stores, processes, or transmits " +
      "criminal justice information (CJI). DPF Phase 1 for law enforcement stores NO CJI. This " +
      "single readiness obligation is a GATE that must be satisfied BEFORE any case/incident/" +
      "evidence feature is enabled — it is not a Phase-1 compliance claim.",
    obligations: [
      {
        title: "CJIS Security Policy readiness — REQUIRED before any CJI feature (Phase 2 gate)",
        reference: "cjis/readiness-gate",
        description:
          "Before DPF may store, process, or transmit any criminal justice information, the agency " +
          "and the deployment must satisfy the CJIS Security Policy: advanced authentication (MFA), " +
          "encryption of CJI in transit and at rest, comprehensive audit logging, personnel security " +
          "screening, and physical/media protection. This is a Phase-2 gate; Phase 1 stores no CJI and " +
          "makes no CJIS compliance claim. Do NOT mark satisfied until a security review confirms it.",
        category: "operational",
        frequency: "event-driven",
        applicability: "Required before enabling any criminal-justice-information feature (Phase 2)",
        penaltySummary: "CJI handling without CJIS compliance can terminate the agency's CJIS access.",
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

export const LAW_ENFORCEMENT_CONTROLS: ControlSeed[] = [
  {
    title: "POST Training & Certification Tracker",
    description:
      "Per-officer record of in-service hours, certification status/expiry, and firearms/use-of-force " +
      "qualification against the state POST requirement, backed by the training-requirement substrate.",
    controlType: "detective",
    obligationRefs: [
      "post/in-service-hours",
      "post/certification-currency",
      "post/use-of-force-qualification",
    ],
  },
  {
    title: "Policy Issuance & Attestation Register",
    description:
      "Register of core policies (use-of-force, BWC, complaint intake) with officer attestation on " +
      "issuance and update, backed by the policy/acknowledgment substrate.",
    controlType: "preventive",
    obligationRefs: [
      "le-policy/use-of-force",
      "le-policy/bwc-retention",
      "le-policy/complaint-intake",
    ],
  },
  {
    title: "CJIS Readiness Checklist (Phase-2 gate)",
    description:
      "Checklist tracking CJIS Security Policy prerequisites — MFA, encryption, audit logging, personnel " +
      "screening — that MUST be satisfied before any CJI feature. Tracked as a future gate, not a " +
      "Phase-1 control.",
    controlType: "preventive",
    obligationRefs: ["cjis/readiness-gate"],
  },
];

export async function seedLawEnforcementCompliance(prisma: PrismaClient): Promise<void> {
  let regUpserts = 0;
  let oblCreated = 0;
  let ctlCreated = 0;
  let linksCreated = 0;

  const oblIdByRef = new Map<string, string>();

  for (const reg of LAW_ENFORCEMENT_REGULATIONS) {
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

  for (const ctl of LAW_ENFORCEMENT_CONTROLS) {
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
          `[seed-law-enforcement-compliance] control "${ctl.title}" references unknown obligation "${ref}"`,
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

  const expectedObligations = LAW_ENFORCEMENT_REGULATIONS.reduce((n, r) => n + r.obligations.length, 0);
  console.log(
    `[seed] law-enforcement compliance pack: ${regUpserts}/${LAW_ENFORCEMENT_REGULATIONS.length} regulations upserted, ` +
      `${oblCreated} obligations created (${expectedObligations} expected total), ` +
      `${ctlCreated} controls created, ${linksCreated} links created`,
  );
}
