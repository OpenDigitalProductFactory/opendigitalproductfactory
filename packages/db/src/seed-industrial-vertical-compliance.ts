import type { PrismaClient } from "../generated/client/client";
import { type RegulationApplicability } from "./regulation-applicability";
import { seedVerticalCompliancePack, type VerticalRegulationSeed } from "./vertical-compliance-pack";

// ARCHETYPE recurring-obligation packs, third wave: the remaining categories —
// industrial and site operations, land, venues, equipment, media, and software.
//
// Same authority discipline and the same conformance tests as the other two
// waves. Researched against public sources (cited per regulation), never written
// from recall; duty and cadence only, no fee, form number, hour count, or fixed
// date.
//
// One row here differs in KIND and says so in its own applicability text: a
// software platform's recurring assurance work (audit, penetration test, access
// review) is CONTRACTUAL rather than statutory — it is owed to customers under
// their agreements, not to a regulator. It belongs on the calendar for exactly
// the same reason, and calling it a legal duty when it is not would be its own
// kind of fabrication.

const AGRICULTURE_RANCHING: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["agriculture-ranching"],
};
const INDUSTRIAL_SITES: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"],
  archetypes: ["manufacturing", "warehousing-fulfilment"],
};
const FABRIC_CARE: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["fabric-care-services"],
};
const LIVE_EVENTS_VENUES: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["live-events-venues"],
};
const ASSET_RENTAL: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["asset-rental"],
};
const MEDIA_PRODUCTION: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["media-production"],
};
const SOFTWARE_PLATFORM: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["software-platform"],
};

export const INDUSTRIAL_VERTICAL_REGULATIONS: VerticalRegulationSeed[] = [
  {
    regulationId: "REG-US-AGRICULTURAL-OPERATIONS",
    domain: "sector",
    name: "Agricultural operations certification and worker protection",
    shortName: "Agricultural Operations",
    jurisdiction: "US-federal",
    industry: "agriculture-ranching",
    sourceType: "external",
    sourceUrl: "https://www.epa.gov/pesticide-worker-safety",
    applicability: AGRICULTURE_RANCHING,
    notes:
      "Two recurring duties dominate a farm or ranch that uses pesticides: the applicator's own "
      + "certification, and the Worker Protection Standard training owed to every worker and "
      + "handler. Both are federal floors that states administer, so the cycle and the approved "
      + "providers are set locally.",
    obligations: [
      {
        title: "Renew pesticide applicator certification",
        reference: "agriculture/applicator-certification",
        description:
          "Renew each certified applicator's licence with the state lead agency, including the "
          + "continuing education or re-examination the state requires for the category held.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Operations applying restricted-use pesticides. Certification cycles and continuing "
          + "education vary by state and by applicator category — this annual review is the sweep "
          + "that catches what is expiring.",
        penaltySummary: "Applying restricted-use product without certification, which carries federal and state penalties.",
      },
      {
        title: "Deliver worker protection training and keep the records",
        reference: "agriculture/worker-protection-training",
        description:
          "Provide pesticide safety training to workers and handlers before they enter treated "
          + "areas, keep the training records, and maintain the application information display "
          + "and decontamination supplies the standard requires.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Agricultural establishments with workers or handlers covered by the Worker Protection "
          + "Standard. Training must be repeated on a recurring cycle; retention periods are set "
          + "federally and states commonly add to them.",
        penaltySummary: "Federal penalties per violation, and liability for exposure incidents where training was not delivered.",
      },
    ],
  },

  {
    regulationId: "REG-US-INDUSTRIAL-SITE-SAFETY",
    domain: "sector",
    name: "Industrial site safety, equipment and chemical reporting",
    shortName: "Industrial Site Safety",
    jurisdiction: "US-federal",
    industry: "manufacturing",
    sourceType: "external",
    sourceUrl: "https://www.osha.gov/powered-industrial-trucks",
    applicability: INDUSTRIAL_SITES,
    notes:
      "A plant or distribution centre carries three recurring duties that are easy to let slip "
      + "because none of them arrives as a bill: operator evaluations for powered industrial "
      + "trucks, life-safety system inspection, and the annual chemical inventory report owed to "
      + "emergency responders. The last one exists so a fire crew knows what is inside before they "
      + "go in.",
    obligations: [
      {
        title: "Re-evaluate powered industrial truck operators",
        reference: "industrial/pit-operator-evaluation",
        description:
          "Evaluate each forklift and powered industrial truck operator's performance and record "
          + "it. Re-evaluate sooner after an unsafe incident, a near miss, or a change of equipment "
          + "or conditions.",
        category: "operational",
        // Federally fixed at "at least every three years" — the real period is
        // declared rather than a shortened one.
        frequency: "triennial",
        applicability:
          "Sites operating powered industrial trucks. The three-year maximum interval is fixed "
          + "federally; an unsafe incident, a near miss, or new equipment resets it immediately.",
        penaltySummary: "Per-violation OSHA penalties, and evaluation records being the first thing requested after an incident.",
      },
      {
        title: "Inspect and certify fire protection systems",
        reference: "industrial/fire-protection-inspection",
        description:
          "Have sprinkler, alarm, suppression, and extinguisher systems inspected and tested by a "
          + "qualified contractor on their required cycles, and retain the certificates.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Sites with fixed fire protection systems. Component cycles vary — some tests run "
          + "monthly or quarterly and others multi-year — so confirm the schedule your system and "
          + "local fire code require.",
        penaltySummary: "Fire code violations, occupancy restrictions, and insurers declining a claim after a loss.",
      },
      {
        title: "File the annual hazardous chemical inventory report",
        reference: "industrial/chemical-inventory-report",
        description:
          "Report hazardous chemicals stored on site to the state commission, the local emergency "
          + "planning committee, and the fire department, so responders know what is present.",
        category: "reporting",
        frequency: "annual",
        applicability:
          "Sites storing hazardous chemicals above the reporting thresholds. Thresholds vary by "
          + "substance and several states set lower ones than the federal baseline — confirm both "
          + "before concluding you are out of scope.",
        penaltySummary: "Substantial per-day civil penalties, and responders entering a site blind to what is stored there.",
      },
    ],
  },

  {
    regulationId: "REG-US-FABRIC-CARE-ENVIRONMENTAL",
    domain: "sector",
    name: "Fabric care solvent and waste compliance",
    shortName: "Fabric Care Environmental",
    jurisdiction: "US-federal",
    industry: "fabric-care-services",
    sourceType: "external",
    sourceUrl: "https://www.epa.gov/stationary-sources-air-pollution/dry-cleaning-facilities-national-perchloroethylene-air-emission",
    applicability: FABRIC_CARE,
    notes:
      "Solvent-based cleaning is regulated on two fronts at once — air emissions and hazardous "
      + "waste — with recurring inspection, record, and reporting duties under each. This sector is "
      + "also in transition: EPA finalised a rule in December 2024 phasing perchloroethylene out of "
      + "dry cleaning over ten years, so an operation still using it has a migration to plan as "
      + "well as a compliance record to keep. Confirm the current position with EPA and your state "
      + "before relying on any summary, including this one.",
    obligations: [
      {
        title: "Inspect solvent equipment for leaks and log the results",
        reference: "fabric-care/leak-inspection",
        description:
          "Inspect solvent machines and connections for leaks on the required schedule, repair "
          + "what is found within the permitted window, and keep the inspection and repair log.",
        category: "operational",
        frequency: "monthly",
        applicability:
          "Facilities operating solvent cleaning machines. Inspection frequency varies with machine "
          + "type and facility size, and states commonly apply stricter rules — confirm yours.",
        penaltySummary: "Air standard violations, per-day penalties, and enforcement focused on the missing log rather than the leak.",
      },
      {
        title: "Track solvent purchases and file required reports",
        reference: "fabric-care/solvent-reporting",
        description:
          "Record solvent purchase and consumption volumes, keep the rolling totals the standard "
          + "requires, and submit the reports and notifications owed to the air authority.",
        category: "reporting",
        frequency: "annual",
        applicability:
          "Solvent-using facilities. Consumption totals determine which tier of the standard "
          + "applies, so the records also decide the duties — confirm the current requirements, "
          + "which are changing under the perchloroethylene phase-out.",
        penaltySummary: "Enforcement for unreported consumption, and being held to a stricter tier than the records support.",
      },
      {
        title: "Manifest and dispose of solvent waste",
        reference: "fabric-care/waste-disposal",
        description:
          "Dispose of separator water, still bottoms, spent filters, and contaminated materials "
          + "through a permitted hauler, and retain the manifests.",
        category: "operational",
        frequency: "continuous",
        applicability:
          "Facilities generating solvent waste. Generator category depends on monthly quantity and "
          + "determines storage, labelling, and manifesting duties.",
        penaltySummary: "RCRA penalties and cleanup liability that follows the waste to its destination.",
      },
    ],
  },

  {
    regulationId: "REG-US-PUBLIC-VENUE-OPERATIONS",
    domain: "sector",
    name: "Public venue occupancy, safety and licensing",
    shortName: "Public Venue Ops",
    jurisdiction: "US-state",
    industry: "live-events-venues",
    sourceType: "external",
    sourceUrl: "https://www.nfpa.org/codes-and-standards/nfpa-101-standard-development/101",
    applicability: LIVE_EVENTS_VENUES,
    notes:
      "A venue's right to admit the public rests on instruments that expire: an occupancy "
      + "certificate, fire and life-safety inspections, and — where drink is served — a liquor "
      + "licence whose lapse stops trading on the night it matters most.",
    obligations: [
      {
        title: "Renew the occupancy permit and pass fire and life-safety inspection",
        reference: "venue/occupancy-and-fire",
        description:
          "Keep the certificate of occupancy current for the posted capacity, and pass the "
          + "recurring fire and life-safety inspection covering egress, emergency lighting, "
          + "alarms, and suppression.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Venues admitting the public. Inspection frequency and permit terms vary by jurisdiction "
          + "and with occupancy classification — confirm both with the local fire authority.",
        penaltySummary: "Capacity reductions, orders to close, and personal liability for admitting over a posted capacity.",
      },
      {
        title: "Renew the alcohol licence and server certifications",
        reference: "venue/alcohol-licence",
        description:
          "Renew the venue's alcohol licence and keep responsible-service certification current "
          + "for the staff required to hold it.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Venues serving alcohol. Licence terms vary by state and locality; server certification "
          + "sits with the person and commonly runs several years, so treat it as a recurring "
          + "sweep alongside the licence renewal.",
        penaltySummary:
          "Serving unlicensed, licence suspension, and dram-shop exposure that insurers commonly "
          + "exclude where certification had lapsed.",
      },
    ],
  },

  {
    regulationId: "REG-US-RENTAL-EQUIPMENT-SAFETY",
    domain: "sector",
    name: "Rental equipment inspection and cover",
    shortName: "Rental Equipment",
    jurisdiction: "US-state",
    industry: "asset-rental",
    sourceType: "external",
    sourceUrl: "https://www.osha.gov/laws-regs/regulations/standardnumber/1910",
    applicability: ASSET_RENTAL,
    notes:
      "A rental business's exposure is that its equipment fails in someone else's hands. The "
      + "recurring duties are therefore evidential: inspection and maintenance records per asset, "
      + "and cover that answers for a third-party injury.",
    obligations: [
      {
        title: "Inspect and service rental assets on their maintenance schedule",
        reference: "rental/asset-inspection",
        description:
          "Inspect and service each rental asset to the manufacturer's schedule and any statutory "
          + "requirement for that class of equipment, and keep the per-asset record.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Rental fleets. Intervals vary by equipment class and by hours of use — lifting and "
          + "pressure equipment commonly carry statutory intervals of their own. Confirm per class "
          + "rather than applying one schedule.",
        penaltySummary:
          "Liability for injury caused by an unserviced asset, with the maintenance record the "
          + "first evidence sought and its absence effectively conceding the point.",
      },
      {
        title: "Renew liability cover for equipment in customer hands",
        reference: "rental/liability-cover",
        description:
          "Renew general and products liability cover, confirming it answers for equipment "
          + "operated by customers off the premises, and refresh certificates held by commercial "
          + "hirers.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Rental operators. Policy terms are commonly annual; confirm the renewal date and that "
          + "the cover extends to off-site customer operation.",
        penaltySummary: "Uninsured third-party injury claims, and breach of commercial hire agreements requiring evidence of cover.",
      },
    ],
  },

  {
    regulationId: "REG-US-PRODUCTION-OPERATIONS",
    domain: "sector",
    name: "Production permits, clearances and cover",
    shortName: "Production Operations",
    jurisdiction: "US-state",
    industry: "media-production",
    sourceType: "external",
    sourceUrl: "https://www.osha.gov/laws-regs/regulations/standardnumber/1910",
    applicability: MEDIA_PRODUCTION,
    notes:
      "Production compliance is mostly per-project — permits, clearances, and certificates issued "
      + "for a shoot — but two things recur at the BUSINESS level and are the ones that lapse "
      + "quietly between projects: the production insurance programme, and rights and release "
      + "records that must survive long after delivery.",
    obligations: [
      {
        title: "Renew the production insurance programme",
        reference: "production/insurance-programme",
        description:
          "Renew general liability, equipment, and errors-and-omissions cover, and confirm the "
          + "limits still satisfy what broadcasters, distributors, and location owners require.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Production companies. Policy terms are commonly annual; errors-and-omissions cover in "
          + "particular is a delivery requirement for most distributors — confirm limits against "
          + "current agreements.",
        penaltySummary:
          "Delivery refused for want of the required certificate, locations withdrawn, and "
          + "uninsured claims over rights or injury.",
      },
      {
        title: "Review rights, clearance and release records",
        reference: "production/rights-and-releases",
        description:
          "Review that music, footage, location, and talent releases are held and retrievable for "
          + "every title still in distribution, and that any term-limited licence is tracked to "
          + "its expiry.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Production companies with titles in distribution. Licence terms vary per work and "
          + "commonly expire long after delivery — the annual review is what catches an expiring "
          + "term before a title has to be pulled.",
        penaltySummary: "Infringement claims, distribution takedowns, and indemnity claims from distributors.",
      },
    ],
  },

  {
    regulationId: "REG-US-SOFTWARE-ASSURANCE-CYCLE",
    domain: "sector",
    name: "Software platform assurance cycle",
    shortName: "Software Assurance",
    jurisdiction: "US-federal",
    industry: "software-platform",
    sourceType: "external",
    sourceUrl: "https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2",
    applicability: SOFTWARE_PLATFORM,
    notes:
      "Different in KIND from every other pack here, and deliberately so. These duties are "
      + "CONTRACTUAL rather than statutory: they are owed to customers under their agreements and "
      + "to the security questionnaires that gate renewals, not to a regulator. They belong on the "
      + "calendar for the same reason as a licence renewal — missing one costs a customer — but "
      + "calling them a legal requirement would be wrong, so this pack does not.",
    obligations: [
      {
        title: "Complete the annual security audit or attestation",
        reference: "software/annual-attestation",
        description:
          "Run the recurring third-party audit the customer base expects, covering the observation "
          + "period without a gap so the report periods join up.",
        category: "operational",
        // Not statutory. Recurring because customers require it.
        frequency: "annual",
        applicability:
          "Platforms whose customers require an attestation. This is a CONTRACTUAL obligation, not "
          + "a statutory one — scope, framework, and observation period are set by customer "
          + "commitments rather than by regulation. A gap between observation periods is commonly "
          + "treated as a lapse.",
        penaltySummary:
          "Renewals blocked and procurement stalled; a gap between report periods is usually "
          + "treated as a control failure by the customer's own auditors.",
      },
      {
        title: "Commission the recurring penetration test",
        reference: "software/penetration-test",
        description:
          "Commission an independent penetration test against the production surface, and track "
          + "the findings through to remediation rather than only to the report.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Platforms committed to recurring testing under customer agreements or an attestation "
          + "scope. Contractual rather than statutory; frequency is commonly annual and set by "
          + "those commitments.",
        penaltySummary: "Attestation exceptions, customer escalation, and unremediated findings surfacing in a later incident.",
      },
      {
        title: "Review production access and privilege",
        reference: "software/access-review",
        description:
          "Review who holds production and administrative access, remove what is no longer needed, "
          + "and record the review and its outcome.",
        category: "operational",
        frequency: "quarterly",
        applicability:
          "Platforms with production systems holding customer data. Contractual rather than "
          + "statutory; quarterly is the commonly committed cadence, and leaver-driven removal is "
          + "immediate rather than waiting for the next review.",
        penaltySummary: "Audit exceptions, and standing access by former staff being among the most damaging findings after a breach.",
      },
    ],
  },
];

export async function seedIndustrialVerticalCompliance(prisma: PrismaClient): Promise<void> {
  await seedVerticalCompliancePack(
    prisma,
    "Industrial and site vertical compliance packs",
    INDUSTRIAL_VERTICAL_REGULATIONS,
  );
}
