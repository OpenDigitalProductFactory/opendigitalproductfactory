import type { PrismaClient, Prisma } from "../generated/client/client";
import * as crypto from "crypto";
import { type RegulationApplicability, type RegulationDomain } from "./regulation-applicability";

// BI-0B867B67 (phase 3) — HR / EMPLOYMENT-LAW pack: the proof "functional variant"
// of centralized-compliance-with-contextual-domains. These regimes bind on the
// EMPLOYING basis — where an org's staff work — regardless of industry archetype,
// so they gate on BusinessContext.employsIn (a signal captured at setup but, until
// now, unused by any seeded regulation). domain "hr-employment" attributes them to
// the HR context for the by-function rollup while they still live in the one
// central registry. This promotes the employment-law knowledge that previously
// lived only in the WSID profession corpus (seed-profession-corpus.ts) to tracked,
// coverable obligations. US federal statutes; state leave/wage is one configurable
// row (per the public-sector pack pattern). Citations per row.

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
  industry: string | null;
  sourceType: "external";
  sourceUrl: string | null;
  applicability: RegulationApplicability;
  /** Functional domain (attribution/reporting only) — always hr-employment here. */
  domain: RegulationDomain;
  notes: string;
  obligations: ObligationSeed[];
};

// Employment law binds where staff WORK (the employing basis), not on industry.
const US_EMPLOYING: RegulationApplicability = {
  basis: ["employing"],
  jurisdictions: ["us"],
};

export const HR_EMPLOYMENT_REGULATIONS: RegulationSeed[] = [
  {
    regulationId: "REG-US-FLSA",
    domain: "hr-employment",
    name: "Fair Labor Standards Act",
    shortName: "FLSA",
    jurisdiction: "US-federal",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.dol.gov/agencies/whd/flsa",
    applicability: US_EMPLOYING,
    notes:
      "Federal minimum wage, overtime (1.5x over 40 hours/week for non-exempt employees), exempt " +
      "classification, and recordkeeping. Enforced by the DOL Wage and Hour Division. State wage/hour " +
      "laws (daily overtime, higher minimums) layer on top — see the state row.",
    obligations: [
      {
        title: "Pay minimum wage and overtime to non-exempt employees",
        reference: "flsa/minimum-wage-overtime",
        description:
          "Pay at least the federal (or higher state) minimum wage and 1.5x the regular rate for hours over " +
          "40 in a workweek to non-exempt employees.",
        category: "operational",
        frequency: "continuous",
        applicability: "All employers with non-exempt employees",
        penaltySummary: "Back wages, liquidated (double) damages, and civil penalties for willful violations.",
      },
      {
        title: "Classify employees exempt vs non-exempt correctly",
        reference: "flsa/exempt-classification",
        description:
          "Apply the duties + salary-basis tests before treating a role as overtime-exempt; misclassification is a frequent enforcement basis.",
        category: "governance",
        frequency: "event-driven",
        applicability: "All employers",
        penaltySummary: null,
      },
      {
        title: "Keep accurate time and pay records",
        reference: "flsa/recordkeeping",
        description:
          "Maintain hours-worked and wage records for non-exempt employees for at least three years.",
        category: "records",
        frequency: "continuous",
        applicability: "All employers with non-exempt employees",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-FMLA",
    domain: "hr-employment",
    name: "Family and Medical Leave Act",
    shortName: "FMLA",
    jurisdiction: "US-federal",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.dol.gov/agencies/whd/fmla",
    applicability: US_EMPLOYING,
    notes:
      "Job-protected unpaid leave (up to 12 weeks) for eligible employees of covered employers (50+ " +
      "employees within 75 miles). State family-leave laws often extend this. Applies once headcount " +
      "thresholds are met — configure from actual headcount.",
    obligations: [
      {
        title: "Provide eligible employees job-protected FMLA leave",
        reference: "fmla/leave-entitlement",
        description:
          "Grant up to 12 weeks (26 for military caregiver) of job-protected leave to eligible employees and restore them to their role.",
        category: "operational",
        frequency: "event-driven",
        applicability: "Employers with 50+ employees within 75 miles",
        penaltySummary: "Reinstatement, back pay, liquidated damages.",
      },
      {
        title: "Provide FMLA eligibility and rights notices",
        reference: "fmla/notices",
        description:
          "Post the general FMLA notice and give eligibility/rights-and-responsibilities/designation notices on a qualifying leave request.",
        category: "records",
        frequency: "event-driven",
        applicability: "Covered employers",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-TITLE-VII-EEO",
    domain: "hr-employment",
    name: "Title VII / Equal Employment Opportunity (EEOC-enforced)",
    shortName: "Title VII / EEO",
    jurisdiction: "US-federal",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.eeoc.gov/employers",
    applicability: US_EMPLOYING,
    notes:
      "Prohibits employment discrimination on race, color, religion, sex (incl. pregnancy, sexual " +
      "orientation, gender identity), and national origin. Applies to employers with 15+ employees. " +
      "Bundles the core EEO duties (also EPA equal pay); ADEA and ADA are separate rows.",
    obligations: [
      {
        title: "Non-discrimination in all employment actions",
        reference: "eeo/non-discrimination",
        description:
          "Do not discriminate in hiring, pay, promotion, discipline, or termination on a protected basis; apply consistent, documented criteria.",
        category: "governance",
        frequency: "continuous",
        applicability: "Employers with 15+ employees",
        penaltySummary: "EEOC charges, DOJ referral, damages and injunctive relief.",
      },
      {
        title: "Maintain an anti-harassment policy and complaint process",
        reference: "eeo/anti-harassment",
        description:
          "Maintain and communicate an anti-harassment policy with a complaint/investigation procedure and anti-retaliation protection.",
        category: "governance",
        frequency: "continuous",
        applicability: "Covered employers",
        penaltySummary: null,
      },
      {
        title: "Post required EEO notices and retain personnel records",
        reference: "eeo/notices-records",
        description:
          "Post the 'EEO is the Law' notice and retain personnel/employment records per EEOC rules (generally one year, longer if a charge is filed).",
        category: "records",
        frequency: "continuous",
        applicability: "Covered employers",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-ADA-TITLE-I",
    domain: "hr-employment",
    name: "Americans with Disabilities Act — Title I (employment)",
    shortName: "ADA (employment)",
    jurisdiction: "US-federal",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.eeoc.gov/disability-discrimination",
    applicability: US_EMPLOYING,
    notes:
      "Prohibits disability discrimination in employment and requires reasonable accommodation absent " +
      "undue hardship. Employers with 15+ employees. Distinct from ADA Title III (digital/physical " +
      "accessibility), which lives in the accessibility domain.",
    obligations: [
      {
        title: "Provide reasonable accommodation through an interactive process",
        reference: "ada1/reasonable-accommodation",
        description:
          "Engage in a documented interactive process and provide reasonable accommodation for qualified individuals with a disability, absent undue hardship.",
        category: "operational",
        frequency: "event-driven",
        applicability: "Employers with 15+ employees",
        penaltySummary: "EEOC charges; compensatory and punitive damages.",
      },
      {
        title: "Non-discrimination and confidential medical information",
        reference: "ada1/non-discrimination-confidentiality",
        description:
          "Do not discriminate based on disability; keep medical information in separate, confidential files.",
        category: "governance",
        frequency: "continuous",
        applicability: "Covered employers",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-ADEA",
    domain: "hr-employment",
    name: "Age Discrimination in Employment Act",
    shortName: "ADEA",
    jurisdiction: "US-federal",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.eeoc.gov/age-discrimination",
    applicability: US_EMPLOYING,
    notes:
      "Protects workers aged 40+ from age-based employment discrimination. Employers with 20+ employees. " +
      "Includes OWBPA rules for valid age-related waivers in separation agreements.",
    obligations: [
      {
        title: "No age-based discrimination for workers 40+",
        reference: "adea/non-discrimination",
        description:
          "Do not use age as a factor in employment decisions for workers 40 and older; scrutinize reductions-in-force for disparate impact.",
        category: "governance",
        frequency: "continuous",
        applicability: "Employers with 20+ employees",
        penaltySummary: "Back pay, liquidated damages for willful violations.",
      },
      {
        title: "OWBPA-compliant waivers in separation agreements",
        reference: "adea/owbpa-waivers",
        description:
          "Ensure any age-related waiver in a separation agreement meets OWBPA requirements (consideration period, revocation window, disclosures).",
        category: "governance",
        frequency: "event-driven",
        applicability: "Employers offering separation agreements",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-I9-IRCA",
    domain: "hr-employment",
    name: "Form I-9 / Immigration Reform and Control Act",
    shortName: "I-9 / IRCA",
    jurisdiction: "US-federal",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.uscis.gov/i-9",
    applicability: US_EMPLOYING,
    notes:
      "Every US employer must verify each new hire's identity and work authorization on Form I-9 and " +
      "retain it. Applies to all employers regardless of size.",
    obligations: [
      {
        title: "Complete and retain Form I-9 for every new hire",
        reference: "i9/verification",
        description:
          "Complete Form I-9 within three business days of hire; retain for the later of three years from hire or one year from termination.",
        category: "records",
        frequency: "event-driven",
        applicability: "All US employers",
        penaltySummary: "Civil penalties per violation; criminal exposure for a pattern of knowing violations.",
      },
      {
        title: "Non-discrimination in the verification process",
        reference: "i9/anti-discrimination",
        description:
          "Do not over-document, reject valid documents, or treat workers differently based on citizenship/national origin during verification.",
        category: "governance",
        frequency: "continuous",
        applicability: "All US employers",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-OSHA",
    domain: "hr-employment",
    name: "Occupational Safety and Health Act",
    shortName: "OSHA",
    jurisdiction: "US-federal",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.osha.gov/",
    applicability: US_EMPLOYING,
    notes:
      "The General Duty Clause requires a workplace free of recognized serious hazards; specific standards " +
      "and injury recording/reporting apply by size and industry. Applies to most private employers.",
    obligations: [
      {
        title: "Provide a workplace free of recognized serious hazards",
        reference: "osha/general-duty",
        description:
          "Meet the General Duty Clause and applicable OSHA standards; provide required training and hazard communication.",
        category: "operational",
        frequency: "continuous",
        applicability: "Most private employers",
        penaltySummary: "Citations and civil penalties per violation; higher for willful/repeat.",
      },
      {
        title: "Record and report injuries and illnesses",
        reference: "osha/recordkeeping-reporting",
        description:
          "Maintain OSHA 300 logs where required, post the annual summary, and report severe incidents (fatalities within 8 hours; hospitalizations within 24).",
        category: "records",
        frequency: "continuous",
        applicability: "Employers above OSHA size/industry thresholds",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-STATE-EMPLOYMENT",
    domain: "hr-employment",
    name: "State Employment Laws (wage, leave, and pay transparency)",
    shortName: "State Employment",
    jurisdiction: "US-state",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.dol.gov/agencies/whd/state",
    applicability: US_EMPLOYING,
    notes:
      "State-specific employment obligations that layer on federal law: higher minimum wage and daily " +
      "overtime, paid sick/family leave, final-paycheck timing, pay-transparency/salary-range posting, and " +
      "required workplace postings. Specifics vary by the states where staff work — configure from employsIn.",
    obligations: [
      {
        title: "Meet state wage, overtime, and final-pay rules",
        reference: "state-emp/wage-hour",
        description:
          "Apply the higher of state vs federal minimum wage, any state daily-overtime rules, and state final-paycheck timing.",
        category: "operational",
        frequency: "continuous",
        applicability: "Employers with staff in the state",
        penaltySummary: "State labor-agency penalties and employee claims.",
      },
      {
        title: "Provide state-mandated paid sick / family leave",
        reference: "state-emp/paid-leave",
        description:
          "Accrue and allow use of state/local paid sick leave and paid family leave where required.",
        category: "operational",
        frequency: "continuous",
        applicability: "Employers in paid-leave states/localities",
        penaltySummary: null,
      },
      {
        title: "Pay-transparency and required workplace postings",
        reference: "state-emp/pay-transparency-postings",
        description:
          "Post salary ranges in job listings where required and display state-mandated workplace notices.",
        category: "records",
        frequency: "continuous",
        applicability: "Employers in pay-transparency/posting states",
        penaltySummary: null,
      },
    ],
  },
];

export async function seedHrEmploymentCompliance(prisma: PrismaClient): Promise<void> {
  let regUpserts = 0;
  let oblCreated = 0;

  for (const reg of HR_EMPLOYMENT_REGULATIONS) {
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

  const expected = HR_EMPLOYMENT_REGULATIONS.reduce((n, r) => n + r.obligations.length, 0);
  console.log(
    `[seed] HR employment compliance pack: ${regUpserts}/${HR_EMPLOYMENT_REGULATIONS.length} regulations upserted, ` +
      `${oblCreated} obligations created (${expected} expected total)`,
  );
}
