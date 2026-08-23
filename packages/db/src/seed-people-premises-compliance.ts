import type { PrismaClient } from "../generated/client/client";
import { type RegulationApplicability } from "./regulation-applicability";
import { seedVerticalCompliancePack, type VerticalRegulationSeed } from "./vertical-compliance-pack";

// ARCHETYPE recurring-obligation packs, second wave: verticals whose recurring
// duties attach to PEOPLE in their care, or to PREMISES the public uses.
//
// Same authority discipline as seed-vertical-recurring-compliance.ts, and the
// same conformance tests apply. Researched against public sources (cited per
// regulation), never written from recall. Each row states the duty and a
// cadence, and NOT the fee, form number, hour count, or fixed date — those move
// and a stale one beside a due date reads as authoritative.
//
// The pattern this wave makes obvious: for people-facing verticals the expiring
// thing is usually a PERSON'S credential, not the business's. Those expire on
// per-person anniversaries, so the business-level obligation is a recurring
// SWEEP that catches what is lapsing — not a single renewal date. Every such row
// says so, because an operator reading "annual" would otherwise expect one date.

const EDUCATION_TRAINING: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["education-training"],
};
const FITNESS_RECREATION: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["fitness-recreation"],
};
const RETAIL_GOODS: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["retail-goods"],
};
const HOA_PROPERTY: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["hoa-property-management"],
};
const PET_SERVICES: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["pet-services"],
};
const SECURITY_SERVICES: RegulationApplicability = {
  basis: ["operating"], jurisdictions: ["us"], archetypes: ["security-services"],
};

export const PEOPLE_PREMISES_REGULATIONS: VerticalRegulationSeed[] = [
  {
    regulationId: "REG-US-CHILD-CARE-LICENSING",
    domain: "sector",
    name: "Child care and youth program licensing",
    shortName: "Child Care Licensing",
    jurisdiction: "US-state",
    industry: "education-training",
    sourceType: "external",
    sourceUrl: "https://www.acf.hhs.gov/occ",
    applicability: EDUCATION_TRAINING,
    notes:
      "Programs caring for children carry a licence over the PREMISES and a rolling set of "
      + "per-person clearances and certifications underneath it. Federal law sets a floor for "
      + "background checks on everyone with unsupervised access; states set the cycle, the training "
      + "hours, and the ratios. A single lapsed clearance can make a member of staff ineligible to "
      + "work that day, which is why the sweep matters more than the licence date.",
    obligations: [
      {
        title: "Renew the facility licence and pass its inspections",
        reference: "childcare/facility-licence",
        description:
          "Renew the child care or youth programme licence with the state licensing authority, and "
          + "keep the premises ready for the recurring health, fire, and licensing inspections that "
          + "accompany it.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Licensed child care and youth programmes. Licence terms and inspection frequency vary by "
          + "state — confirm your own and set the review date to match.",
        penaltySummary: "Licence suspension or revocation, and orders to stop enrolling or to close.",
      },
      {
        title: "Re-run staff and household background clearances before they expire",
        reference: "childcare/background-clearances",
        description:
          "Track every clearance for staff, volunteers, and adults resident on the premises, and "
          + "submit renewals before expiry so nobody's eligibility to work lapses.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Everyone with unsupervised access to children. Clearances commonly run around three "
          + "years per person and expire on per-person anniversaries — this annual review is the "
          + "sweep that catches what is expiring, not a single renewal date.",
        penaltySummary:
          "Staff ineligible to work, licence violations, and — where an ineligible person had "
          + "access — findings that reach the licence itself.",
      },
      {
        title: "Keep staff training and paediatric first aid current",
        reference: "childcare/staff-training",
        description:
          "Keep required health-and-safety training, paediatric first aid, and CPR current for all "
          + "staff, and hold the records that evidence it.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Programme staff. Required subjects and hours vary by state, and certifications sit with "
          + "the person on their own cycle — treat this as a recurring sweep.",
        penaltySummary: "Licensing violations, and ratio breaches when only trained staff may be counted.",
      },
    ],
  },

  {
    regulationId: "REG-US-FITNESS-FACILITY-SAFETY",
    domain: "sector",
    name: "Fitness and recreation facility safety",
    shortName: "Fitness Facility Safety",
    jurisdiction: "US-state",
    industry: "fitness-recreation",
    sourceType: "external",
    sourceUrl: "https://www.cdc.gov/model-aquatic-health-code/php/index.html",
    applicability: FITNESS_RECREATION,
    notes:
      "Two recurring duties dominate: keeping resuscitation certification current across the staff "
      + "who must hold it, and — where there is a pool or spa — an operating permit, a certified "
      + "operator, and a water-testing record the health authority will ask for.",
    obligations: [
      {
        title: "Keep staff CPR and AED certification current",
        reference: "fitness/cpr-aed-certification",
        description:
          "Track CPR and AED certification for trainers, instructors, and floor staff, renewing "
          + "through an accredited provider before expiry, and keep the AED itself serviced and "
          + "within date.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Facility staff required to hold certification. Certificates commonly run two years per "
          + "person and several states set their own staffing rules — so this annual review is the "
          + "sweep that catches what is expiring.",
        penaltySummary:
          "Liability exposure on a cardiac incident, breach of state facility rules, and insurers "
          + "declining a claim where certification had lapsed.",
      },
      {
        title: "Renew the pool or spa operating permit and operator certification",
        reference: "fitness/aquatic-permit",
        description:
          "Renew the public pool or spa operating permit with the local health authority, keep a "
          + "certified operator credential current, and retain the water chemistry testing records "
          + "the permit requires.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Facilities with a public pool or spa. Permits renew annually in most jurisdictions, "
          + "while operator certification commonly runs several years — confirm both. Testing "
          + "frequency and record retention are set locally.",
        penaltySummary: "Closure of the water feature, permit refusal, and liability for a waterborne illness or injury.",
      },
    ],
  },

  {
    regulationId: "REG-US-RETAIL-TRADE-MEASUREMENT",
    domain: "sector",
    name: "Retail trade measurement and pricing accuracy",
    shortName: "Trade Measurement",
    jurisdiction: "US-state",
    industry: "retail-goods",
    sourceType: "external",
    sourceUrl: "https://www.nist.gov/pml/owm",
    applicability: RETAIL_GOODS,
    notes:
      "Any device that determines what a customer pays — a scale, a meter, a scanner — is "
      + "legal-for-trade equipment inspected by a state or county weights-and-measures official. "
      + "The failure mode is quiet: a scale out of calibration looks completely normal, lights up, "
      + "and prices every transaction wrongly until someone checks.",
    obligations: [
      {
        title: "Have legal-for-trade devices inspected and certified",
        reference: "retail/device-certification",
        description:
          "Have every commercial weighing and measuring device inspected and certified by the "
          + "state or county weights-and-measures authority, and keep the certification records "
          + "and any calibration seals intact.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Retailers using scales, meters, or other legal-for-trade devices. Inspection frequency "
          + "is set by state rather than federally; annual is the common standard, and heavier use "
          + "warrants more often.",
        penaltySummary:
          "Devices condemned or sealed out of service, per-device penalties, and refunds or claims "
          + "where customers were overcharged.",
      },
    ],
  },

  {
    regulationId: "REG-US-COMMUNITY-ASSOCIATION-GOVERNANCE",
    domain: "sector",
    name: "Community association governance and reserves",
    shortName: "Association Governance",
    jurisdiction: "US-state",
    industry: "hoa-property-management",
    sourceType: "external",
    sourceUrl: "https://foundation.caionline.org/",
    applicability: HOA_PROPERTY,
    notes:
      "A community association's recurring duties run to its MEMBERS as much as to the state: an "
      + "adopted budget, distributed financials, and a reserve study that says whether the money "
      + "set aside will actually cover the roof. Roughly a dozen states mandate reserve studies "
      + "outright and about ten more require them conditionally, so whether these bind — and how "
      + "hard — turns on the state and the association's revenue.",
    obligations: [
      {
        title: "Adopt the annual budget and distribute it to members",
        reference: "association/annual-budget",
        description:
          "Adopt the operating and reserve budget for the coming year and distribute it to members "
          + "within the period the state and the governing documents require.",
        category: "governance",
        frequency: "annual",
        applicability:
          "Community associations. Distribution deadlines vary by state, commonly falling within a "
          + "set number of days of the fiscal year end — confirm yours.",
        penaltySummary:
          "Assessments open to challenge, and statutory remedies for members where the budget was "
          + "never properly adopted or distributed.",
      },
      {
        title: "Prepare and distribute the annual financial statement",
        reference: "association/annual-financials",
        description:
          "Prepare the association's annual financial statement at the level the state requires — "
          + "compilation, review, or audit — and make it available to members.",
        category: "financial",
        frequency: "annual",
        applicability:
          "Community associations. The REQUIRED level varies by state and commonly steps up with "
          + "annual revenue, so confirm which level applies before commissioning the work.",
        penaltySummary: "Statutory non-compliance, member petitions, and board exposure over unaccounted funds.",
      },
      {
        title: "Review and update the reserve study",
        reference: "association/reserve-study",
        description:
          "Review the reserve study against current component condition and costs, and commission "
          + "a full update or professional re-inspection on the cycle the state requires.",
        category: "financial",
        frequency: "annual",
        applicability:
          "Community associations. Around a dozen states mandate reserve studies and roughly ten "
          + "more require them conditionally; full updates commonly run on a multi-year cycle with "
          + "an annual review between — confirm your own state's rule.",
        penaltySummary:
          "Underfunded reserves leading to special assessments, statutory breach in mandating "
          + "states, and board liability for a foreseeable shortfall.",
      },
      {
        title: "Hold the annual members' meeting and board election",
        reference: "association/annual-meeting",
        description:
          "Hold the annual meeting of members with the notice the governing documents and state "
          + "law require, conduct any board election, and record the minutes.",
        category: "governance",
        frequency: "annual",
        applicability:
          "Community associations. Notice periods and quorum rules vary by state and by the "
          + "governing documents — confirm both.",
        penaltySummary: "Invalid elections and board actions open to challenge for want of a properly noticed meeting.",
      },
    ],
  },

  {
    regulationId: "REG-US-ANIMAL-CARE-FACILITY",
    domain: "sector",
    name: "Animal care facility licensing and vaccination records",
    shortName: "Animal Care Facility",
    jurisdiction: "US-state",
    industry: "pet-services",
    sourceType: "external",
    sourceUrl: "https://www.aphis.usda.gov/aphis/ourfocus/animalwelfare",
    applicability: PET_SERVICES,
    notes:
      "Every state requires some form of kennel or animal-care licence, and most localities add a "
      + "permit on top. The recurring record duty is vaccination proof for every animal in care — "
      + "rabies is required by law in every state, and the certificate itself runs one or three "
      + "years depending on the vaccine given, so the expiry sits with the ANIMAL, not the facility.",
    obligations: [
      {
        title: "Renew the animal care facility licence",
        reference: "animal-care/facility-licence",
        description:
          "Renew the kennel, boarding, grooming, or daycare licence with the state and with any "
          + "local authority that issues its own permit, and keep the premises to the enclosure, "
          + "sanitation, and ventilation standards it sets.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Facilities boarding, grooming, training, or day-caring animals. Licences commonly renew "
          + "annually, and local permit layers vary — confirm both state and local requirements.",
        penaltySummary: "Operating unlicensed, fines, and orders to cease taking animals.",
      },
      {
        title: "Verify and retain animal vaccination records",
        reference: "animal-care/vaccination-records",
        description:
          "Verify vaccination status for every animal accepted into care, and retain the "
          + "documentation for the period the state or locality requires, along with the record of "
          + "the stay and any treatment given.",
        category: "operational",
        frequency: "continuous",
        applicability:
          "Facilities accepting animals into care. Rabies vaccination is required by law in every "
          + "state; retention periods and the other required vaccinations are set locally.",
        penaltySummary:
          "Licence violations, quarantine orders after an exposure incident, and liability where an "
          + "unvaccinated animal was accepted.",
      },
    ],
  },

  {
    regulationId: "REG-US-PRIVATE-SECURITY-LICENSING",
    domain: "sector",
    name: "Private security licensing and officer registration",
    shortName: "Private Security Licensing",
    jurisdiction: "US-state",
    industry: "security-services",
    sourceType: "external",
    sourceUrl: "https://www.asisonline.org/",
    applicability: SECURITY_SERVICES,
    notes:
      "There is no federal regulator for contract security: each state sets its own standards, and "
      + "they differ enormously — some require board-approved training and testing, a few require "
      + "little beyond a background check. Two licences run in parallel: the COMPANY licence and "
      + "each officer's individual registration, with armed work almost always adding a separate "
      + "credential and recurring qualification.",
    obligations: [
      {
        title: "Renew the security company licence",
        reference: "security/company-licence",
        description:
          "Renew the contract security company's state licence, including any qualifying-manager "
          + "designation, insurance, and bond the licensing authority requires.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Contract security companies. The licensing authority and the renewal cycle vary by "
          + "state — confirm yours, and separately for every state you operate in.",
        penaltySummary: "Operating unlicensed, contract cancellation, and penalties against the qualifying manager personally.",
      },
      {
        title: "Renew officer registrations and refresher training",
        reference: "security/officer-registration",
        description:
          "Track each officer's state registration or guard card and renew before expiry, "
          + "including the refresher training the state requires for the cycle.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Registered security officers. Credentials commonly run one to three years per person and "
          + "expire on individual anniversaries — this annual review is the sweep that catches what "
          + "is expiring.",
        penaltySummary: "Officers ineligible to work posts, penalties against the employing company, and post coverage failures.",
      },
      {
        title: "Maintain armed officer permits and firearms qualification",
        reference: "security/armed-qualification",
        description:
          "Keep the separate armed credential and recurring firearms qualification current for "
          + "every officer working armed, and hold the records evidencing it.",
        category: "operational",
        frequency: "annual",
        applicability:
          "Companies deploying armed officers. Armed work nearly always requires a separate permit "
          + "and recurring qualification; requirements and frequency vary by state.",
        penaltySummary:
          "Officers unlawfully armed on post, criminal exposure, and company licence action after "
          + "an incident.",
      },
    ],
  },
];

export async function seedPeoplePremisesCompliance(prisma: PrismaClient): Promise<void> {
  await seedVerticalCompliancePack(
    prisma,
    "People and premises compliance packs",
    PEOPLE_PREMISES_REGULATIONS,
  );
}
