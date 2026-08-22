import type { PrismaClient } from "../generated/client/client";
import * as crypto from "crypto";
import { type RegulationApplicability, type RegulationDomain } from "./regulation-applicability";

// ARCHETYPE recurring-obligation packs.
//
// The gap this fills, measured by scripts/measure-obligation-cadence-coverage.mjs:
// 22 of the 25 archetype categories the platform can be installed as had NO
// obligations at all. That reads to an operator as "nothing is due", which on
// screen is indistinguishable from "nothing was ever entered" — and raises no
// finding, so nobody is ever told.
//
// AUTHORITY AND ITS LIMITS — read before adding a row.
//
// Every row below was researched against public sources (cited per regulation),
// not written from recall. What the research consistently shows is that for each
// of these trades the DUTY is structurally stable — a salon has an establishment
// licence, a restaurant has a health permit, a carrier has a biennial update —
// while the CADENCE varies by state, often widely (cosmetology licences renew on
// cycles from one to four years; salon inspections run from twice-yearly to
// biennial).
//
// So each row states the duty and a cadence, and NOT the fee, the form number,
// the hours, or a fixed calendar date. Those move, and a stale one printed next
// to a due date reads as authoritative.
//
// Where a cadence genuinely varies, the row declares the SHORTER period and its
// applicability text says so plainly. An early reminder is safe; a late one is
// not. Where a cadence is FEDERALLY FIXED (the FMCSA biennial update, CLIA's
// two-year certificate) the real period is declared instead, because inventing
// urgency there would be its own kind of noise.

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
  domain: RegulationDomain;
  notes: string;
  obligations: ObligationSeed[];
};

// Gate on the archetype CATEGORY, so every archetype inside it inherits the
// pack. Written as literal specs rather than built by a helper, deliberately:
// scripts/measure-obligation-cadence-coverage.mjs reads the archetype gate from
// SOURCE, and a gate assembled at runtime is invisible to it — the pack would
// then report as reaching every install when it does not.
const FOOD_HOSPITALITY: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["food-hospitality"],
};
const HEALTHCARE_WELLNESS: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["healthcare-wellness"],
};
const BUILT_ENVIRONMENT: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"],
  archetypes: ["trades-maintenance", "real-estate-construction"],
};
const AUTOMOTIVE_SERVICES: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["automotive-services"],
};
const BEAUTY_PERSONAL_CARE: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["beauty-personal-care"],
};
const PROFESSIONAL_SERVICES: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["professional-services"],
};
const MOVING_AND_LOGISTICS: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["moving-and-logistics"],
};

export const VERTICAL_RECURRING_REGULATIONS: RegulationSeed[] = [
  // ── Food and hospitality ───────────────────────────────────────────────────
  {
    regulationId: "REG-US-FOOD-SERVICE-OPS",
    domain: "sector",
    name: "Food service operating permits and hygiene",
    shortName: "Food Service Ops",
    jurisdiction: "US-state",
    industry: "food-hospitality",
    sourceType: "external",
    sourceUrl: "https://www.fda.gov/food/retail-food-protection/fda-food-code",
    applicability: FOOD_HOSPITALITY,
    notes:
      "Retail food operations are permitted and inspected locally, under a state code that in most "
      + "states adopts some edition of the FDA Food Code. The permit, the certified-manager "
      + "requirement, and grease-interceptor servicing exist essentially everywhere; the cycle and "
      + "the fee are set by the local health authority and the sewer authority respectively.",
    obligations: [
      {
        title: "Renew the food service establishment health permit",
        reference: "food/health-permit-renewal",
        description:
          "Renew the health or food-service permit with the local health authority. Renewal "
          + "commonly re-triggers a routine inspection, so the premises and records should be "
          + "ready before the date rather than on it.",
        category: "operational",
        frequency: "annual",
        applicability:
          "All retail food establishments. Annual in most jurisdictions; some use two- or "
          + "three-year cycles — confirm yours and set the review date to match.",
        penaltySummary: "Permit lapse, closure order, and re-inspection fees; operating unpermitted is separately actionable.",
      },
      {
        title: "Keep food handler and manager certifications current",
        reference: "food/handler-certification",
        description:
          "Track every food handler and certified food protection manager certification and renew "
          + "before expiry. Certifications sit with the PERSON, so a team produces a rolling stream "
          + "of expiry dates rather than one shared date.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Food establishments in states requiring certification. Individual certificates commonly "
          + "run two to five years; this annual review is the sweep that catches the ones expiring, "
          + "not the renewal cycle itself.",
        penaltySummary: "Inspection violations, and operating without a certified manager on duty where one is required.",
      },
      {
        title: "Service the grease interceptor and retain the manifests",
        reference: "food/grease-interceptor",
        description:
          "Have the grease interceptor pumped on the schedule the sewer authority sets, and retain "
          + "each manifest showing the date, the volume, the hauler, and the disposal site.",
        category: "operational",
        frequency: "quarterly",
        applicability:
          "Food establishments with a grease interceptor. Pumping frequency is set by local "
          + "ordinance and by interceptor size — commonly around 90 days, but ranging from monthly "
          + "to annually. Confirm yours.",
        penaltySummary: "Sewer-discharge violations, surcharges, and liability for a blockage traced to the premises.",
      },
    ],
  },

  // ── Healthcare and wellness ────────────────────────────────────────────────
  {
    regulationId: "REG-US-CLINICAL-PRACTICE-OPS",
    domain: "sector",
    name: "Clinical practice recurring compliance",
    shortName: "Clinical Practice Ops",
    jurisdiction: "US-federal",
    industry: "healthcare-wellness",
    sourceType: "external",
    sourceUrl: "https://www.hhs.gov/hipaa/for-professionals/security/index.html",
    applicability: HEALTHCARE_WELLNESS,
    notes:
      "The recurring spine of a clinical practice: the HIPAA Security Rule's risk analysis, annual "
      + "workforce training, practitioner licensure, and — where the practice runs any laboratory "
      + "testing, including waived tests — a CLIA certificate. The risk analysis is the single most "
      + "commonly cited failure in enforcement actions, and it is an ongoing obligation rather than "
      + "a one-time project.",
    obligations: [
      {
        title: "Conduct and document the HIPAA security risk analysis",
        reference: "clinical/hipaa-risk-analysis",
        description:
          "Carry out an accurate and thorough assessment of risks and vulnerabilities to electronic "
          + "protected health information, document it, and act on what it finds. Review the "
          + "privacy, security, and breach-notification policies at the same time.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Covered entities and business associates. The Security Rule sets no fixed period — it "
          + "requires the analysis to be ongoing and updated as the practice changes. An annual "
          + "cycle is the commonly applied interpretation and the one enforcement actions measure "
          + "against.",
        penaltySummary:
          "Civil monetary penalties and corrective action plans. A missing or stale risk analysis is "
          + "the most frequently cited deficiency in HIPAA enforcement.",
      },
      {
        title: "Deliver annual HIPAA and workplace safety training",
        reference: "clinical/annual-training",
        description:
          "Train the workforce on HIPAA privacy and security, and on bloodborne pathogens and "
          + "hazard communication where there is exposure risk. Record who was trained and when.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Practices with a workforce touching protected health information, and any employer with "
          + "occupational exposure to blood or other potentially infectious material. The annual "
          + "cadence for exposure training is fixed federally; HIPAA training is commonly run on the "
          + "same cycle. New starters must be trained on joining, not at the next annual cycle.",
        penaltySummary: "Enforcement findings, and inability to evidence training during an audit or after an incident.",
      },
      {
        title: "Renew practitioner licences and registrations",
        reference: "clinical/practitioner-licensure",
        description:
          "Renew each clinician's state licence and any controlled-substance registration, "
          + "including the continuing education each renewal requires.",
        category: "operational",
        frequency: "annual",
        applicability:
          "All licensed clinicians. Renewal cycles vary by state and by profession, commonly running "
          + "one to three years — this annual review is the sweep that catches what is expiring, "
          + "not the renewal cycle itself.",
        penaltySummary: "Practising on a lapsed licence, which is separately actionable and usually excluded by insurers.",
      },
      {
        title: "Renew the CLIA certificate",
        reference: "clinical/clia-renewal",
        description:
          "Renew the practice's CLIA certificate for laboratory testing, including waived testing "
          + "performed in the office. Submit well ahead of expiry rather than on it.",
        category: "operational",
        // Federally fixed at a two-year certificate — the real period is declared
        // rather than a shorter one, because false urgency is its own noise.
        frequency: "biennial",
        applicability:
          "Any facility performing laboratory testing on human specimens, including waived tests. "
          + "The two-year certificate period is fixed federally, so this is the real cadence rather "
          + "than a shortened one; renewal is normally submitted well before expiry.",
        penaltySummary: "Testing without a current certificate, and sanctions including suspension of the certificate.",
      },
    ],
  },

  // ── Trades and maintenance, real estate and construction ───────────────────
  {
    regulationId: "REG-US-TRADE-CONTRACTOR-OPS",
    domain: "sector",
    name: "Trade contractor licensing, bonding and safety recordkeeping",
    shortName: "Contractor Ops",
    jurisdiction: "US-state",
    industry: "trades-maintenance",
    sourceType: "external",
    sourceUrl: "https://www.osha.gov/recordkeeping",
    applicability: BUILT_ENVIRONMENT,
    notes:
      "A trade contractor's standing to work is a stack of expiring instruments — licence, bond, "
      + "and insurance certificate — any one of which lapsing stops work or voids a contract. The "
      + "OSHA injury summary posting is separate, federal, and fixed to a calendar window.",
    obligations: [
      {
        title: "Renew the contractor licence and its continuing education",
        reference: "contractor/licence-renewal",
        description:
          "Renew the trade or general contractor licence in every state the business works in, "
          + "including any continuing education the board requires from approved providers.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Licensed trade and general contractors. Cycles are commonly one or two years and vary by "
          + "state and trade; continuing education is the most common point of failure at renewal.",
        penaltySummary:
          "Unlicensed-contracting penalties, unenforceable contracts and lien rights in many states, "
          + "and permit applications refused.",
      },
      {
        title: "Renew the licence bond and insurance certificates",
        reference: "contractor/bond-and-insurance",
        description:
          "Keep the contractor licence bond and the liability and workers' compensation "
          + "certificates in force, and confirm the board and any client holding a certificate "
          + "receive the renewed one.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Contractors in bonding states. Bond terms vary by state: most licence bonds renew "
          + "annually, while some states use a continuous bond that stays in force until cancelled, "
          + "with the premium still reviewed each year.",
        penaltySummary: "Licence suspension on bond cancellation, and breach of client contracts requiring evidence of cover.",
      },
      {
        title: "Post the OSHA annual injury and illness summary",
        reference: "contractor/osha-annual-summary",
        description:
          "Certify and post the annual summary of recordable work-related injuries and illnesses in "
          + "a visible workplace location for the required window — even in a year with no "
          + "recordable incidents — and submit it electronically where required.",
        category: "reporting",
        frequency: "annual",
        applicability:
          "Employers required to keep OSHA injury records. Smaller employers and some low-hazard "
          + "industries are partially exempt; construction is not. The posting window and the "
          + "electronic submission deadline are fixed federally — confirm the current year's dates.",
        penaltySummary: "Per-violation recordkeeping penalties, which escalate for a repeated or wilful failure.",
      },
    ],
  },

  // ── Automotive services ────────────────────────────────────────────────────
  {
    regulationId: "REG-US-AUTOMOTIVE-ENV-OPS",
    domain: "sector",
    name: "Automotive service environmental compliance",
    shortName: "Automotive Env",
    jurisdiction: "US-federal",
    industry: "automotive-services",
    sourceType: "external",
    sourceUrl: "https://www.epa.gov/hw/categories-hazardous-waste-generators",
    applicability: AUTOMOTIVE_SERVICES,
    notes:
      "A repair or body shop generates hazardous waste — solvents, waste antifreeze, brake fluids, "
      + "paint and filters — plus used oil, its highest-volume stream. Generator category is set by "
      + "how much is generated per CALENDAR MONTH, so it can change as the shop's work changes and "
      + "the duties change with it. Thresholds are deliberately not stated here; confirm them with "
      + "EPA and your state, which may be stricter.",
    obligations: [
      {
        title: "Review the hazardous waste generator category",
        reference: "automotive/generator-category-review",
        description:
          "Re-assess how much hazardous waste the shop generates per calendar month and confirm "
          + "the generator category is still correct, along with the storage, labelling, training "
          + "and manifesting duties that follow from it.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Shops generating hazardous waste. Category depends on monthly generated quantity and can "
          + "change with the shop's workload, so the annual review is a re-check rather than a "
          + "renewal. Thresholds and duties vary by state — several apply stricter rules than the "
          + "federal baseline.",
        penaltySummary: "Per-day RCRA penalties, and liability for improper disposal that follows the waste to its destination.",
      },
      {
        title: "Manage used oil storage, records, and collection",
        reference: "automotive/used-oil-management",
        description:
          "Store used oil in labelled, sound, closed containers away from drains, keep it free of "
          + "contamination from solvents or other wastes, and retain collection records.",
        category: "operational",
        frequency: "continuous",
        applicability:
          "Any shop generating used oil. Mixing used oil with other waste can reclassify the whole "
          + "volume as hazardous waste, which changes every duty that attaches to it.",
        penaltySummary: "Reclassification of the full volume as hazardous waste, cleanup liability, and per-day penalties.",
      },
    ],
  },

  // ── Beauty and personal care ───────────────────────────────────────────────
  {
    regulationId: "REG-US-PERSONAL-CARE-LICENSING",
    domain: "sector",
    name: "Personal care licensing and premises inspection",
    shortName: "Personal Care Licensing",
    jurisdiction: "US-state",
    industry: "beauty-personal-care",
    sourceType: "external",
    sourceUrl: "https://www.tdlr.texas.gov/barbering-and-cosmetology/",
    applicability: BEAUTY_PERSONAL_CARE,
    notes:
      "Two licences, not one: each practitioner holds an individual licence, and the PREMISES holds "
      + "a separate establishment licence subject to inspection. Losing track of the establishment "
      + "licence is the common failure, because it renews on its own cycle and nobody's personal "
      + "renewal notice mentions it.",
    obligations: [
      {
        title: "Renew the establishment licence",
        reference: "personal-care/establishment-licence",
        description:
          "Renew the salon, barbershop, or spa establishment licence for the premises and keep it "
          + "displayed. Renewal is separate from every practitioner's individual licence.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Licensed premises. Cycles are commonly one or two years and vary by state — confirm "
          + "yours and set the review date to match.",
        penaltySummary: "Operating an unlicensed establishment, fines, and closure until the licence is restored.",
      },
      {
        title: "Renew practitioner licences and continuing education",
        reference: "personal-care/practitioner-licence",
        description:
          "Track every practitioner's licence and renew before expiry, including the continuing "
          + "education hours the board requires for the cycle.",
        category: "operational",
        frequency: "annual",
        applicability:
          "All licensed practitioners working on the premises, whether employed or renting a chair. "
          + "Cycles run from one to four years by state; this annual review is the sweep that "
          + "catches what is expiring.",
        penaltySummary: "Fines against both the practitioner and the establishment permitting unlicensed practice.",
      },
      {
        title: "Prepare for the sanitation and safety inspection",
        reference: "personal-care/sanitation-inspection",
        description:
          "Keep implement disinfection, storage, and the sanitation log to the state board's "
          + "standard, ready for an inspection that normally arrives unannounced.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Licensed premises. Inspection frequency ranges from twice yearly to biennial by state, "
          + "and inspections are usually unannounced — so readiness is the standing duty, not the "
          + "inspection date.",
        penaltySummary: "Violation notices, fines, and re-inspection; serious sanitation findings can close the premises.",
      },
    ],
  },

  // ── Professional services ──────────────────────────────────────────────────
  {
    regulationId: "REG-US-PROFESSIONAL-PRACTICE",
    domain: "sector",
    name: "Licensed professional practice maintenance",
    shortName: "Professional Practice",
    jurisdiction: "US-state",
    industry: "professional-services",
    sourceType: "external",
    sourceUrl: "https://nasba.org/",
    applicability: PROFESSIONAL_SERVICES,
    notes:
      "For a licensed professional firm the licence is the product. Both the INDIVIDUAL licences "
      + "and, in many states, a separate FIRM licence must stay current, each with its own cycle "
      + "and its own continuing-education arithmetic — which commonly carries an annual minimum "
      + "inside a multi-year cycle, so a practitioner can satisfy the total and still fail.",
    obligations: [
      {
        title: "Renew individual professional licences and log continuing education",
        reference: "professional/individual-licence",
        description:
          "Renew each practitioner's licence and record the continuing education behind it, "
          + "including any per-year minimum and any mandatory subject such as ethics.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Licensed practitioners. Renewal is commonly biennial, but many boards impose a MINIMUM "
          + "number of hours in each year of the cycle — so an annual review is the one that "
          + "catches a shortfall while it can still be fixed.",
        penaltySummary: "Licence lapse or non-renewal, and practising unlicensed; shortfalls are usually made up with penalty hours.",
      },
      {
        title: "Renew the firm licence or registration",
        reference: "professional/firm-licence",
        description:
          "Renew the firm's own licence or registration where the state licenses the entity "
          + "separately from its practitioners.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Firms in states that license the entity. Renewal cycles vary by state and frequently do "
          + "NOT align with the individual licence cycle, which is how they get missed — confirm "
          + "yours separately.",
        penaltySummary: "Firm practising without registration, and engagements performed under it being challenged.",
      },
      {
        title: "Renew professional liability cover",
        reference: "professional/liability-cover",
        description:
          "Renew professional indemnity or errors-and-omissions cover without a gap, and check the "
          + "retroactive date still reaches back over the whole period of past work.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Practices carrying professional liability cover, and any practice whose licence, client "
          + "contracts, or lender require it. Policy terms are commonly annual — confirm your own "
          + "renewal date and retroactive date with the broker.",
        penaltySummary:
          "Uninsured claims. On a claims-made policy a lapse can void cover for PAST work as well "
          + "as future, which is the trap.",
      },
    ],
  },

  // ── Moving and logistics ───────────────────────────────────────────────────
  {
    regulationId: "REG-US-MOTOR-CARRIER-OPS",
    domain: "sector",
    name: "Motor carrier registration maintenance",
    shortName: "Motor Carrier Ops",
    jurisdiction: "US-federal",
    industry: "moving-and-logistics",
    sourceType: "external",
    sourceUrl: "https://www.fmcsa.dot.gov/registration/form-mcs-150-and-instructions-motor-carrier-identification-report",
    applicability: MOVING_AND_LOGISTICS,
    notes:
      "Federal, fixed, and unusually unforgiving: the biennial update is required even when nothing "
      + "has changed, and missing it deactivates the USDOT registration — the carrier is then simply "
      + "not authorised to operate. Both cadences here are set federally, so the real periods are "
      + "declared rather than shortened.",
    obligations: [
      {
        title: "File the biennial motor carrier identification update",
        reference: "carrier/biennial-update",
        description:
          "Update the USDOT number record with FMCSA on the biennial cycle, whether or not anything "
          + "has changed. The filing month is derived from the USDOT number itself.",
        category: "reporting",
        frequency: "biennial",
        applicability:
          "Every motor carrier holding a USDOT number. Required even with no changes; the deadline "
          + "is derived from the last digits of the USDOT number.",
        penaltySummary:
          "Deactivation of the USDOT registration — losing authority to operate — plus substantial "
          + "per-day civil penalties for failing to file.",
      },
      {
        title: "Renew Unified Carrier Registration",
        reference: "carrier/ucr-annual",
        description:
          "Complete the annual Unified Carrier Registration for the fleet, keeping the vehicle count "
          + "consistent with what the carrier record shows.",
        category: "reporting",
        frequency: "annual",
        applicability:
          "Motor carriers, brokers, and leasing companies operating interstate, or intrastate in a "
          + "participating state. The annual cycle is fixed federally; the fee tier is derived from "
          + "fleet size.",
        penaltySummary: "Roadside enforcement penalties and being placed out of service in enforcing states.",
      },
    ],
  },
];

export async function seedVerticalRecurringCompliance(prisma: PrismaClient): Promise<void> {
  let regUpserts = 0;
  let oblCreated = 0;

  for (const { obligations, applicability, ...regData } of VERTICAL_RECURRING_REGULATIONS) {
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

  const expected = VERTICAL_RECURRING_REGULATIONS.reduce((n, r) => n + r.obligations.length, 0);
  console.log(
    `[seed] Vertical recurring compliance packs: ${regUpserts}/${VERTICAL_RECURRING_REGULATIONS.length} regulations upserted, `
      + `${oblCreated} obligations created (${expected} expected total)`,
  );
}
