import type { PrismaClient, Prisma } from "../generated/client/client";
import * as crypto from "crypto";
import { type RegulationApplicability, type RegulationDomain } from "./regulation-applicability";

// BI-8D477188 Phase 2 — town/public-body compliance pack (civic spec §10).
// Seeds the universal state-law FAMILIES as global Regulation rows (industry
// "public-sector", same pattern as the DORA pack's industry "financial"):
// statutory deadlines and retention periods vary by state, so obligations carry
// org-configurable cadence notes rather than 50 per-state seed variants —
// BusinessContext.stateCode selects the defaults at onboarding.
// Data-driven applicability (BI-9DED0CE8): open-meetings/public-records bind
// every public body (the public-sector category); municipal finance and the
// EPA water regimes bind only the archetypes that run a municipality or a
// water/wastewater system.

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

/** Every public body: the whole public-sector category (municipality, utility, LE agency). */
const PUBLIC_BODY_APPLICABILITY: RegulationApplicability = {
  basis: ["operating"],
  jurisdictions: ["us"],
  archetypes: ["public-sector"],
};

/** Archetypes that run a municipality or a public water/wastewater system. */
const MUNICIPAL_APPLICABILITY: RegulationApplicability = {
  basis: ["operating"],
  jurisdictions: ["us"],
  archetypes: ["small-town-municipality", "municipal-utility"],
};

export const PUBLIC_SECTOR_REGULATIONS: RegulationSeed[] = [
  {
    regulationId: "REG-US-STATE-OPEN-MEETINGS",
    domain: "sector",
    name: "State Open Meetings Law (Sunshine Law)",
    shortName: "Open Meetings",
    jurisdiction: "US-state",
    industry: "public-sector",
    applicability: PUBLIC_BODY_APPLICABILITY,
    sourceType: "external",
    sourceUrl: null,
    notes:
      "All 50 US states require open meetings of public bodies: advance public notice, " +
      "published agendas, public attendance, recorded minutes, and limited executive sessions. " +
      "Notice periods and posting rules vary by state — configure deadlines from the " +
      "organization's state (BusinessContext.stateCode).",
    obligations: [
      {
        title: "Public notice of meetings within the statutory notice period",
        reference: "open-meetings/notice",
        description:
          "Post public notice of every regular and special meeting of the governing body within the " +
          "state-mandated notice period (commonly 24–72 hours; longer for regular sessions in some states). " +
          "Notice must state time, place, and accessibility information.",
        category: "governance",
        frequency: "event-driven",
        applicability: "All public bodies (council, boards, commissions, committees with authority)",
        penaltySummary: "Actions taken at an improperly noticed meeting may be voidable; statutory fines vary by state.",
      },
      {
        title: "Agenda published before the meeting",
        reference: "open-meetings/agenda",
        description:
          "Publish the meeting agenda in advance per state law. Items not on the published agenda are " +
          "restricted in many states. The agenda packet should be retained with the meeting record.",
        category: "governance",
        frequency: "event-driven",
        applicability: "All public bodies",
        penaltySummary: null,
      },
      {
        title: "Minutes recorded, approved, and made public",
        reference: "open-meetings/minutes",
        description:
          "Record minutes of every open meeting (attendees, motions, votes, decisions), approve them at a " +
          "subsequent meeting, and make them available to the public within the state-mandated window.",
        category: "governance",
        frequency: "event-driven",
        applicability: "All public bodies",
        penaltySummary: null,
      },
      {
        title: "Executive (closed) sessions limited to statutory grounds",
        reference: "open-meetings/executive-session",
        description:
          "Enter executive session only for grounds enumerated in state law (personnel, litigation, " +
          "real-estate negotiation, security), with the ground cited in open session and recorded in minutes. " +
          "No final action may be taken in closed session in most states.",
        category: "governance",
        frequency: "event-driven",
        applicability: "All public bodies",
        penaltySummary: "Improper closed sessions are a common basis for litigation and voided actions.",
      },
    ],
  },
  {
    regulationId: "REG-US-STATE-PUBLIC-RECORDS",
    domain: "sector",
    name: "State Public Records Law (FOIA equivalent)",
    shortName: "Public Records",
    jurisdiction: "US-state",
    industry: "public-sector",
    applicability: PUBLIC_BODY_APPLICABILITY,
    sourceType: "external",
    sourceUrl: null,
    notes:
      "All 50 states + DC grant public access to government records, with response deadlines " +
      "(commonly 3–10 business days), enumerated exemptions, and fee rules. Retention schedules " +
      "are set by the state archives/records authority. Configure the response-deadline default " +
      "from the organization's state.",
    obligations: [
      {
        title: "Respond to public records requests within the statutory deadline",
        reference: "public-records/response-deadline",
        description:
          "Acknowledge and respond to each records request within the state deadline — produce the records, " +
          "deny with the specific statutory exemption cited, or provide a lawful extension notice. Track " +
          "every request from receipt to disposition with its due date.",
        category: "records",
        frequency: "event-driven",
        applicability: "All public bodies",
        penaltySummary: "Statutory penalties, attorney-fee awards, and court-ordered production for missed deadlines.",
      },
      {
        title: "Exemption review and denial justification",
        reference: "public-records/exemptions",
        description:
          "Review responsive records against the state's enumerated exemptions (personnel privacy, active " +
          "investigations, juvenile records, security plans) before release. Denials must cite the exemption; " +
          "redact rather than withhold where severability applies.",
        category: "records",
        frequency: "event-driven",
        applicability: "All public bodies",
        penaltySummary: null,
      },
      {
        title: "Records retention schedule adherence",
        reference: "public-records/retention",
        description:
          "Retain and dispose of records per the state archives' retention schedule for local governments " +
          "(minutes and ordinances commonly permanent; correspondence and working files per schedule). " +
          "Destruction outside the schedule — or during a pending request or litigation hold — is prohibited.",
        category: "records",
        frequency: "continuous",
        applicability: "All public bodies",
        penaltySummary: "Unlawful destruction can carry criminal liability in many states.",
      },
    ],
  },
  {
    regulationId: "REG-US-STATE-MUNI-FINANCE",
    domain: "sector",
    name: "State Municipal Finance, Audit & Procurement Requirements",
    shortName: "Municipal Finance",
    jurisdiction: "US-state",
    industry: "public-sector",
    applicability: MUNICIPAL_APPLICABILITY,
    sourceType: "external",
    sourceUrl: null,
    notes:
      "State statutes govern municipal budgeting (annual appropriation), audit/filing with the state " +
      "auditor (annual or biennial by size), and procurement (competitive quotes and sealed-bid " +
      "thresholds). Thresholds and filing cadence vary by state and population.",
    obligations: [
      {
        title: "Annual budget adopted by appropriation before the fiscal year",
        reference: "muni-finance/budget-adoption",
        description:
          "Adopt the annual budget by ordinance/resolution before the fiscal year begins, after the " +
          "state-required public hearing. The appropriation is the legal spending constraint; amendments " +
          "follow the same public process.",
        category: "finance",
        frequency: "annual",
        applicability: "All general-purpose local governments",
        penaltySummary: "Spending without appropriation is ultra vires; state oversight escalation.",
      },
      {
        title: "Budget-to-actual monitoring against appropriations",
        reference: "muni-finance/budget-to-actual",
        description:
          "Monitor expenditures against appropriations by fund throughout the year (GASB budgetary " +
          "comparison). Surface overspend risk to the governing body before, not after, the overrun.",
        category: "finance",
        frequency: "monthly",
        applicability: "All general-purpose local governments",
        penaltySummary: null,
      },
      {
        title: "State audit preparation and filing",
        reference: "muni-finance/state-audit",
        description:
          "Prepare for and file the state-required annual or biennial audit / annual financial report with " +
          "the state auditor's office by the statutory deadline. Track findings to remediation.",
        category: "finance",
        frequency: "annual",
        applicability: "All local governments (cadence varies by size and state)",
        penaltySummary: "Late filings are publicly reported; persistent failure triggers state intervention.",
      },
      {
        title: "Procurement thresholds — quotes and sealed bids",
        reference: "muni-finance/procurement",
        description:
          "Follow state competitive-procurement thresholds: informal quotes above the lower threshold, " +
          "advertised sealed bids above the upper threshold, with documented exceptions (sole source, " +
          "emergency) and a complete audit trail.",
        category: "procurement",
        frequency: "event-driven",
        applicability: "All local governments",
        penaltySummary: "Bid-splitting and threshold evasion are common audit findings with personal liability in some states.",
      },
      {
        title: "Rate-covenant debt-service coverage monitoring",
        reference: "muni-finance/rate-covenant",
        description:
          "Monitor enterprise-fund net revenues against the debt-service coverage ratio promised in " +
          "bond rate covenants (commonly 1.10x–1.25x). Surface coverage shortfall to the governing " +
          "body early — the remedy is a rate adjustment set in public session, which takes months.",
        category: "finance",
        frequency: "monthly",
        applicability: "Local governments and districts with revenue-bond-financed utilities",
        penaltySummary: "Covenant breach can trigger default provisions, rate-increase mandates, and rating downgrades.",
      },
    ],
  },
  {
    regulationId: "REG-US-EPA-SDWA",
    domain: "sector",
    name: "Safe Drinking Water Act (via state primacy agency)",
    shortName: "SDWA",
    jurisdiction: "US-federal",
    industry: "public-sector",
    applicability: MUNICIPAL_APPLICABILITY,
    sourceType: "external",
    sourceUrl: "https://www.epa.gov/sdwa",
    notes:
      "EPA's Safe Drinking Water Act applies to community water systems through state primacy " +
      "agencies: sampling schedules against maximum contaminant levels, annual Consumer Confidence " +
      "Reports, certified operators, and service-line inventories (Lead and Copper Rule " +
      "Improvements). Sampling frequencies depend on system size and source water — configure the " +
      "calendar from the primacy agency's monitoring schedule.",
    obligations: [
      {
        title: "Sampling schedule adherence (state monitoring schedule)",
        reference: "sdwa/sampling-schedule",
        description:
          "Collect and submit compliance samples (bacteriological, disinfection byproducts, lead/copper, " +
          "chemical) on the monitoring schedule issued by the state primacy agency. A missed sample is a " +
          "monitoring violation with public-notice consequences even when water quality is fine.",
        category: "environmental",
        frequency: "monthly",
        applicability: "Community water systems (frequency varies by system size and source)",
        penaltySummary: "Monitoring/reporting violations require public notice; persistent violations escalate to enforcement.",
      },
      {
        title: "Consumer Confidence Report — annual delivery",
        reference: "sdwa/ccr",
        description:
          "Prepare and deliver the annual Consumer Confidence Report (water quality report) to all " +
          "customers by July 1, covering the prior calendar year's detections, violations, and source " +
          "information; certify delivery to the primacy agency.",
        category: "environmental",
        frequency: "annual",
        applicability: "Community water systems",
        penaltySummary: null,
      },
      {
        title: "Certified operator of record",
        reference: "sdwa/operator-certification",
        description:
          "Maintain a state-certified operator of record at the grade required for the system's " +
          "classification, with continuing-education renewal tracked before expiry.",
        category: "operational",
        frequency: "continuous",
        applicability: "All public water systems",
        penaltySummary: "Operating without a certified operator is an enforceable violation in every state.",
      },
      {
        title: "Lead service line inventory maintenance",
        reference: "sdwa/service-line-inventory",
        description:
          "Maintain and update the service-line material inventory required by the Lead and Copper " +
          "Rule Improvements, including customer notification for known or unknown lead lines and " +
          "replacement-plan progress reporting.",
        category: "environmental",
        frequency: "annual",
        applicability: "Community water systems",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-EPA-NPDES",
    domain: "sector",
    name: "Clean Water Act — NPDES Discharge Permits",
    shortName: "NPDES",
    jurisdiction: "US-federal",
    industry: "public-sector",
    applicability: MUNICIPAL_APPLICABILITY,
    sourceType: "external",
    sourceUrl: "https://www.epa.gov/npdes/npdes-permit-basics",
    notes:
      "Wastewater systems discharge under National Pollutant Discharge Elimination System permits " +
      "(EPA or authorized state). The operating loop is the discharge monitoring report cadence and " +
      "permit renewal lead time.",
    obligations: [
      {
        title: "Discharge monitoring reports (DMRs)",
        reference: "npdes/dmr",
        description:
          "Sample effluent and submit discharge monitoring reports on the permit's schedule " +
          "(typically monthly via NetDMR). Report exceedances with the corrective narrative.",
        category: "environmental",
        frequency: "monthly",
        applicability: "Systems holding an NPDES permit",
        penaltySummary: "Late or missing DMRs and effluent exceedances carry per-day civil penalties.",
      },
      {
        title: "NPDES permit renewal tracking",
        reference: "npdes/permit-renewal",
        description:
          "Track the five-year permit term and file the renewal application at least 180 days before " +
          "expiry to preserve administrative continuance.",
        category: "environmental",
        frequency: "event-driven",
        applicability: "Systems holding an NPDES permit",
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

export const PUBLIC_SECTOR_CONTROLS: ControlSeed[] = [
  {
    title: "Meeting Notice & Agenda Publication Procedure",
    description:
      "Documented workflow: meeting scheduled → notice posted within the state notice period → agenda " +
      "published → minutes recorded and approved. Backed by the GovernanceMeeting workflow surfaces.",
    controlType: "preventive",
    obligationRefs: ["open-meetings/notice", "open-meetings/agenda", "open-meetings/minutes"],
  },
  {
    title: "Records Request Log with Deadline Tracking",
    description:
      "Every records request logged on receipt with computed statutory due date, status transitions, " +
      "exemption citations on denial, and disposition record. Backed by the RecordsRequest queue.",
    controlType: "detective",
    obligationRefs: ["public-records/response-deadline", "public-records/exemptions"],
  },
  {
    title: "Records Retention Schedule Register",
    description:
      "Register of record series mapped to the state retention schedule with disposition holds for " +
      "pending requests and litigation.",
    controlType: "preventive",
    obligationRefs: ["public-records/retention"],
  },
  {
    title: "Procurement Threshold Checklist",
    description:
      "Pre-purchase checklist enforcing quote/sealed-bid thresholds with documented exception grounds " +
      "and approval trail.",
    controlType: "preventive",
    obligationRefs: ["muni-finance/procurement"],
  },
  {
    title: "Budget-to-Actual Review Cadence",
    description:
      "Monthly budget-to-actual review by fund against appropriations, surfaced to the governing body. " +
      "Backed by the FundBudgetLine fund view.",
    controlType: "detective",
    obligationRefs: ["muni-finance/budget-to-actual", "muni-finance/budget-adoption"],
  },
  {
    title: "Compliance Sampling Calendar",
    description:
      "Sampling and reporting deadlines from the state monitoring schedule maintained on the compliance " +
      "calendar with owner assignment — a missed sample is a violation regardless of water quality.",
    controlType: "preventive",
    obligationRefs: ["sdwa/sampling-schedule", "sdwa/ccr"],
  },
  {
    title: "DMR Filing Procedure",
    description:
      "Monthly effluent sampling → lab results → NetDMR submission workflow with exceedance-narrative " +
      "capture and deadline tracking.",
    controlType: "preventive",
    obligationRefs: ["npdes/dmr", "npdes/permit-renewal"],
  },
  {
    title: "Rate-Covenant Coverage Check",
    description:
      "Monthly enterprise-fund net-revenue vs debt-service coverage computation against bond covenants, " +
      "backed by the Funds budget-to-actual view.",
    controlType: "detective",
    obligationRefs: ["muni-finance/rate-covenant"],
  },
];

export async function seedPublicSectorCompliance(prisma: PrismaClient): Promise<void> {
  let regUpserts = 0;
  let oblCreated = 0;
  let ctlCreated = 0;
  let linksCreated = 0;

  const oblIdByRef = new Map<string, string>();

  for (const reg of PUBLIC_SECTOR_REGULATIONS) {
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

  for (const ctl of PUBLIC_SECTOR_CONTROLS) {
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
        // Silent-skip guard: a typo'd reference must fail loudly, not seed 0 links.
        throw new Error(`[seed-public-sector-compliance] control "${ctl.title}" references unknown obligation "${ref}"`);
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

  const expectedObligations = PUBLIC_SECTOR_REGULATIONS.reduce((n, r) => n + r.obligations.length, 0);
  console.log(
    `[seed] public-sector compliance pack: ${regUpserts}/${PUBLIC_SECTOR_REGULATIONS.length} regulations upserted, ` +
      `${oblCreated} obligations created (${expectedObligations} expected total), ` +
      `${ctlCreated} controls created, ${linksCreated} links created`,
  );
}
