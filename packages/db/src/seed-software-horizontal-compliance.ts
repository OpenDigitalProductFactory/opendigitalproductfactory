import type { PrismaClient, Prisma } from "../generated/client/client";
import * as crypto from "crypto";
import { type RegulationApplicability } from "./regulation-applicability";

// BI-242F344C — HORIZONTAL compliance pack. Unlike the vertical packs (banking,
// public-sector, …) these regimes bind on WHAT an org does with data, not on its
// industry archetype: a software platform, a retailer, and a gym all face CCPA
// the moment they process Californians' personal data. Each regulation carries a
// data-driven applicability spec gating on DATA_HANDLING_PREDICATES, so it only
// surfaces for an install whose setup-declared data-handling profile matches —
// and shows as "review" (not "reference") while that profile is undeclared.
//
// STATUTORY vs FRAMEWORK is kept honest: SOC 2, ISO 27001, and the NIST AI RMF
// are NOT law — they are contractual/voluntary (sourceType "framework"). Every
// other row here is binding statute (sourceType "external").
//
// Determination + citations: BI-242F344C research (mid-2026). The set is a
// defensible baseline, deliberately one regulation per regime (state-law
// families modeled as a single row, as the public-sector pack does); extend by
// adding rows — no code change, the generic evaluator classifies them.

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
  /** Horizontal regimes are cross-industry — industry stays null. */
  industry: string | null;
  /** "external" = binding statute; "framework" = contractual/voluntary (SOC 2, ISO, NIST). */
  sourceType: "external" | "framework";
  sourceUrl: string | null;
  applicability: RegulationApplicability;
  notes: string;
  obligations: ObligationSeed[];
};

// ── Reusable applicability specs (US = operating nexus + a data-handling trigger) ──
const US_PERSONAL_DATA: RegulationApplicability = {
  basis: ["operating"],
  jurisdictions: ["us"],
  dataHandling: ["processes-personal-data"],
};
const US_AUTOMATED_DECISIONING: RegulationApplicability = {
  basis: ["operating"],
  jurisdictions: ["us"],
  dataHandling: ["deploys-automated-decisioning"],
};
const US_MARKETING: RegulationApplicability = {
  basis: ["operating"],
  jurisdictions: ["us"],
  dataHandling: ["sends-marketing"],
};

export const SOFTWARE_HORIZONTAL_REGULATIONS: RegulationSeed[] = [
  // ── Family 1 — US state comprehensive privacy ──
  {
    regulationId: "REG-US-CCPA",
    name: "California Consumer Privacy Act (as amended by CPRA)",
    shortName: "CCPA/CPRA",
    jurisdiction: "US-state",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://cppa.ca.gov/regulations/",
    applicability: US_PERSONAL_DATA,
    notes:
      "Binds a for-profit doing business in California that processes California residents' " +
      "personal data above thresholds (>$25M revenue, or ≥100k consumers/households, or ≥50% " +
      "revenue from selling/sharing). Covers employee and B2B-contact data. Enforced by the " +
      "California Privacy Protection Agency + AG. The CPPA ADMT / risk-assessment / cybersecurity-" +
      "audit regulations (effective Jan 2026, compliance from Jan 2027) attach here.",
    obligations: [
      {
        title: "Publish and annually update a compliant privacy policy",
        reference: "ccpa/privacy-policy",
        description:
          "Maintain a privacy policy disclosing categories of personal information collected, purposes, " +
          "retention, and consumer rights; review and update at least every 12 months.",
        category: "records",
        frequency: "annual",
        applicability: "Businesses meeting a CCPA threshold",
        penaltySummary: "Civil penalties up to $2,500 ($7,500 intentional / involving minors) per violation.",
      },
      {
        title: "Honor consumer rights requests within statutory windows",
        reference: "ccpa/consumer-rights",
        description:
          "Verify and fulfill access, deletion, correction, opt-out of sale/sharing, and limit-use-of-" +
          "sensitive-PI requests, generally within 45 days; maintain request records for 24 months.",
        category: "operational",
        frequency: "event-driven",
        applicability: "Businesses meeting a CCPA threshold",
        penaltySummary: null,
      },
      {
        title: "Recognize opt-out preference signals (Global Privacy Control)",
        reference: "ccpa/gpc",
        description:
          "Treat a browser/device Global Privacy Control signal as a valid opt-out of sale/sharing.",
        category: "operational",
        frequency: "continuous",
        applicability: "Businesses that sell/share personal information",
        penaltySummary: null,
      },
      {
        title: "Execute service-provider/contractor contracts with required terms",
        reference: "ccpa/service-provider-contracts",
        description:
          "Bind every vendor receiving personal information to the CCPA-required processing terms before disclosure.",
        category: "governance",
        frequency: "event-driven",
        applicability: "Businesses disclosing PI to vendors",
        penaltySummary: null,
      },
      {
        title: "Risk assessment + ADMT controls for significant automated decisions",
        reference: "ccpa/admt-risk-assessment",
        description:
          "Where automated decision-making technology drives a significant decision (finance, housing, " +
          "employment, health, education, essential services) about a consumer, conduct a documented risk " +
          "assessment, give pre-use notice + opt-out + access/appeal (CPPA regs; compliance from Jan 1, 2027).",
        category: "governance",
        frequency: "event-driven",
        applicability: "Businesses using ADMT for significant decisions",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-STATE-PRIVACY",
    name: "US State Comprehensive Privacy Laws (VCDPA family — 19+ states)",
    shortName: "State Privacy",
    jurisdiction: "US-state",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://iapp.org/resources/article/us-state-privacy-legislation-tracker/",
    applicability: US_PERSONAL_DATA,
    notes:
      "The Virginia-family of comprehensive privacy laws now in effect across ~20 states (VA, CO, CT, " +
      "UT, TX, OR, MT, IA, DE, NE, NH, NJ, MN, MD, IN, KY, RI, TN …). Thresholds vary — Texas has no " +
      "numeric threshold (any non-small-business processing residents' data). Most cover end-user/consumer " +
      "data (not employee/B2B). Configure per-state specifics from the states the org operates in / sells to.",
    obligations: [
      {
        title: "Honor consumer rights (access, delete, correct, portability, opt-out)",
        reference: "state-privacy/consumer-rights",
        description:
          "Provide access, deletion, correction, portability, and opt-out of targeted advertising, sale, and " +
          "profiling in furtherance of decisions with legal/significant effects; respond within ~45 days.",
        category: "operational",
        frequency: "event-driven",
        applicability: "Controllers meeting a state threshold",
        penaltySummary: "AG enforcement; ~$7,500 per violation typical.",
      },
      {
        title: "Obtain opt-in consent before processing sensitive data",
        reference: "state-privacy/sensitive-data-consent",
        description:
          "Get affirmative opt-in consent before processing sensitive categories (race, health, precise " +
          "geolocation, biometrics, children's data).",
        category: "operational",
        frequency: "event-driven",
        applicability: "Controllers processing sensitive data",
        penaltySummary: null,
      },
      {
        title: "Conduct data protection assessments (DPIAs) for high-risk processing",
        reference: "state-privacy/dpia",
        description:
          "Document a data protection assessment for targeted advertising, sale of personal data, sensitive-" +
          "data processing, and high-risk profiling.",
        category: "governance",
        frequency: "event-driven",
        applicability: "Controllers conducting high-risk processing",
        penaltySummary: null,
      },
      {
        title: "Recognize universal opt-out mechanisms",
        reference: "state-privacy/universal-opt-out",
        description:
          "Honor universal opt-out signals for targeted advertising / sale in states that require it (CO, CT, TX, OR, MT, DE, NJ, NH, MN, MD …).",
        category: "operational",
        frequency: "continuous",
        applicability: "Controllers in universal-opt-out states",
        penaltySummary: null,
      },
    ],
  },
  // ── Family 2 — breach notification ──
  {
    regulationId: "REG-US-STATE-BREACH-NOTIFICATION",
    name: "US State Data Breach Notification Laws (all 50 states + DC)",
    shortName: "Breach Notification",
    jurisdiction: "US-state",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.ncsl.org/technology-and-communication/security-breach-notification-laws",
    applicability: US_PERSONAL_DATA,
    notes:
      "Every US state + DC requires notification on unauthorized acquisition of computerized personal " +
      "information. Scope follows the RESIDENCY of affected individuals, so one incident can trigger many " +
      "state laws at once. A standing obligation to detect, notify, and safeguard — applies today to any " +
      "org holding employee/customer/end-user PII, not only after an incident.",
    obligations: [
      {
        title: "Notify affected individuals within the statutory window",
        reference: "breach/individual-notice",
        description:
          "On a reportable breach of personal information, notify affected individuals without unreasonable " +
          "delay / within the state deadline (commonly 30–60 days).",
        category: "operational",
        frequency: "event-driven",
        applicability: "Any holder of computerized personal information",
        penaltySummary: "AG enforcement and, in some states, private rights of action.",
      },
      {
        title: "Notify state AG and consumer reporting agencies over threshold",
        reference: "breach/regulator-notice",
        description:
          "Notify the state attorney general (and, over resident thresholds, consumer reporting agencies) as each state requires.",
        category: "operational",
        frequency: "event-driven",
        applicability: "Breaches exceeding state notice thresholds",
        penaltySummary: null,
      },
      {
        title: "Maintain reasonable security safeguards",
        reference: "breach/reasonable-safeguards",
        description:
          "Maintain reasonable administrative, technical, and physical safeguards for personal information " +
          "(standing duty under NY SHIELD, MA 201 CMR 17.00, and others).",
        category: "operational",
        frequency: "continuous",
        applicability: "Holders of personal information",
        penaltySummary: null,
      },
      {
        title: "Maintain incident-response capability and breach records",
        reference: "breach/incident-response",
        description:
          "Keep a documented incident-response plan and breach recordkeeping so detection, assessment, and " +
          "notification meet statutory deadlines.",
        category: "governance",
        frequency: "continuous",
        applicability: "Holders of personal information",
        penaltySummary: null,
      },
    ],
  },
  // ── Family 3 — security frameworks / attestation (NOT law) ──
  {
    regulationId: "REG-FRAMEWORK-SOC2",
    name: "SOC 2 — AICPA System and Organization Controls 2 (Trust Services Criteria)",
    shortName: "SOC 2",
    jurisdiction: "global",
    industry: null,
    sourceType: "framework",
    sourceUrl: "https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2",
    applicability: US_PERSONAL_DATA,
    notes:
      "NOT a law — a CPA-firm attestation regime. Effectively a market/contractual entry requirement for " +
      "B2B SaaS that holds customer data; surfaced here (gated on processing personal data, the typical " +
      "adopter) because it is expected, and its controls also EVIDENCE statutory compliance. Never treat as a legal obligation.",
    obligations: [
      {
        title: "Scope the system and select Trust Services Criteria",
        reference: "soc2/scope",
        description:
          "Define the system boundary and select criteria (Security required; Availability, Confidentiality, " +
          "Processing Integrity, Privacy optional) for the audit period.",
        category: "governance",
        frequency: "annual",
        applicability: "Orgs pursuing a SOC 2 report",
        penaltySummary: null,
      },
      {
        title: "Operate controls continuously over the audit period",
        reference: "soc2/operate-controls",
        description:
          "Run access reviews, change management, vendor risk reviews, and monitoring continuously; Type II covers a 6–12 month window.",
        category: "operational",
        frequency: "continuous",
        applicability: "Orgs pursuing a SOC 2 Type II report",
        penaltySummary: null,
      },
      {
        title: "Undergo and renew the independent CPA audit",
        reference: "soc2/audit",
        description: "Engage a CPA firm to examine and report on the controls; renew the report annually.",
        category: "governance",
        frequency: "annual",
        applicability: "Orgs maintaining a SOC 2 report",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-FRAMEWORK-ISO-27001",
    name: "ISO/IEC 27001:2022 — Information Security Management System",
    shortName: "ISO 27001",
    jurisdiction: "global",
    industry: null,
    sourceType: "framework",
    sourceUrl: "https://www.iso.org/standard/27001",
    applicability: US_PERSONAL_DATA,
    notes:
      "NOT a law — an accredited certification standard. Customer/market-driven. Surfaced (gated on " +
      "processing personal data) as an expected control framework whose ISMS also evidences statutory security duties.",
    obligations: [
      {
        title: "Maintain an ISMS with risk assessment and Statement of Applicability",
        reference: "iso27001/isms",
        description:
          "Operate an information security management system: risk assessment, risk treatment, and a Statement of Applicability across Annex A controls.",
        category: "governance",
        frequency: "continuous",
        applicability: "Orgs pursuing/holding ISO 27001 certification",
        penaltySummary: null,
      },
      {
        title: "Internal audits and management review",
        reference: "iso27001/internal-audit",
        description: "Conduct periodic internal audits and management reviews of the ISMS.",
        category: "governance",
        frequency: "annual",
        applicability: "Certified orgs",
        penaltySummary: null,
      },
      {
        title: "Surveillance audits and recertification",
        reference: "iso27001/surveillance",
        description: "Pass annual surveillance audits and recertify every three years with the certification body.",
        category: "governance",
        frequency: "annual",
        applicability: "Certified orgs",
        penaltySummary: null,
      },
    ],
  },
  // ── Family 4 — AI governance ──
  {
    regulationId: "REG-FRAMEWORK-NIST-AI-RMF",
    name: "NIST AI Risk Management Framework (AI RMF 1.0 + Generative AI Profile)",
    shortName: "NIST AI RMF",
    jurisdiction: "global",
    industry: null,
    sourceType: "framework",
    sourceUrl: "https://www.nist.gov/itl/ai-risk-management-framework",
    applicability: US_AUTOMATED_DECISIONING,
    notes:
      "NOT a law — voluntary US federal guidance. The recommended backbone that also satisfies multiple " +
      "statutory AI duties (e.g. Texas TRAIGA safe harbor rewards NIST-AI-RMF alignment). Gated on deploying automated decisioning.",
    obligations: [
      {
        title: "Govern — establish AI governance and an AI system inventory",
        reference: "nist-ai/govern",
        description: "Stand up AI governance roles/policies and maintain an inventory of AI systems and their intended uses.",
        category: "governance",
        frequency: "continuous",
        applicability: "Orgs deploying AI systems",
        penaltySummary: null,
      },
      {
        title: "Map and Measure — document uses and test for bias/robustness",
        reference: "nist-ai/map-measure",
        description: "Document intended and harmful uses; test AI systems for bias, robustness, and reliability with recorded results.",
        category: "operational",
        frequency: "annual",
        applicability: "Orgs deploying AI systems",
        penaltySummary: null,
      },
      {
        title: "Manage — maintain audit trails and periodic re-assessment",
        reference: "nist-ai/manage",
        description: "Maintain audit trails of AI decisions and re-assess risk periodically as systems and uses change.",
        category: "operational",
        frequency: "continuous",
        applicability: "Orgs deploying AI systems",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-TX-TRAIGA",
    name: "Texas Responsible AI Governance Act (TRAIGA)",
    shortName: "TX TRAIGA",
    jurisdiction: "US-state",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-ai-rights",
    applicability: US_AUTOMATED_DECISIONING,
    notes:
      "In effect Jan 1, 2026. Binds anyone who develops/deploys an AI system used by Texas residents. " +
      "Intent-based prohibited uses (behavioral manipulation to cause harm, unlawful discrimination, " +
      "unlawful deepfakes). AG-exclusive enforcement, no private right of action, up to $200k/violation, " +
      "60-day cure. NIST-AI-RMF-aligned documentation is a statutory safe harbor.",
    obligations: [
      {
        title: "Avoid prohibited AI uses",
        reference: "traiga/prohibited-uses",
        description:
          "Do not deploy AI for behavioral manipulation causing harm, unlawful discrimination, or unlawful deepfakes/CSAM.",
        category: "governance",
        frequency: "continuous",
        applicability: "Developers/deployers with Texas-resident users",
        penaltySummary: "AG enforcement; up to $200,000 per violation; 60-day cure.",
      },
      {
        title: "Maintain NIST-aligned documentation and adversarial testing (safe harbor)",
        reference: "traiga/safe-harbor-docs",
        description:
          "Maintain AI governance documentation, audit trails, and adversarial testing consistent with the NIST AI RMF to claim the statutory safe harbor.",
        category: "governance",
        frequency: "annual",
        applicability: "Developers/deployers seeking safe harbor",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-CO-AI-ACT",
    name: "Colorado Artificial Intelligence Act (SB 24-205, as amended)",
    shortName: "CO AI Act",
    jurisdiction: "US-state",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://coag.gov/ai/",
    applicability: US_AUTOMATED_DECISIONING,
    notes:
      "Effective Jan 1, 2027 (delayed from 2026; narrowed by 2026 amendment to ADMT transparency for " +
      "consequential decisions). Binds developers/deployers of ADMT used for consequential decisions about Colorado residents.",
    obligations: [
      {
        title: "Developer disclosures to deployers",
        reference: "co-ai/developer-disclosures",
        description:
          "Disclose intended and harmful uses, training-data categories, and oversight instructions to deployers of the AI system.",
        category: "governance",
        frequency: "event-driven",
        applicability: "Developers of consequential-decision ADMT (from Jan 1, 2027)",
        penaltySummary: "AG enforcement.",
      },
      {
        title: "Consumer access, correction, and human review of adverse automated decisions",
        reference: "co-ai/consumer-rights",
        description:
          "Give consumers notice of ADMT use, access/correct the data used, and obtain meaningful human review of an adverse consequential decision.",
        category: "operational",
        frequency: "event-driven",
        applicability: "Deployers of consequential-decision ADMT (from Jan 1, 2027)",
        penaltySummary: null,
      },
    ],
  },
  // ── Family 5 — consumer / marketing ──
  {
    regulationId: "REG-US-CAN-SPAM",
    name: "CAN-SPAM Act",
    shortName: "CAN-SPAM",
    jurisdiction: "US-federal",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business",
    applicability: US_MARKETING,
    notes:
      "FTC-enforced. Applies to any commercial email whose primary purpose is advertising/promotion, " +
      "including B2B marketing. Up to ~$53,088 per violating email.",
    obligations: [
      {
        title: "Truthful headers, subject lines, and advertising identification",
        reference: "can-spam/truthful-identification",
        description:
          "Use accurate From/routing headers and non-deceptive subject lines, and identify the message as an advertisement.",
        category: "operational",
        frequency: "continuous",
        applicability: "Senders of commercial email",
        penaltySummary: "Up to ~$53,088 per email.",
      },
      {
        title: "Valid physical address and working opt-out",
        reference: "can-spam/address-and-opt-out",
        description:
          "Include a valid physical postal address and a functioning unsubscribe mechanism in every commercial email.",
        category: "operational",
        frequency: "continuous",
        applicability: "Senders of commercial email",
        penaltySummary: null,
      },
      {
        title: "Honor opt-outs within 10 business days",
        reference: "can-spam/honor-opt-out",
        description:
          "Stop sending to an address within 10 business days of an opt-out; do not sell or transfer opt-out addresses; monitor third-party senders.",
        category: "operational",
        frequency: "event-driven",
        applicability: "Senders of commercial email",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-TCPA",
    name: "Telephone Consumer Protection Act",
    shortName: "TCPA",
    jurisdiction: "US-federal",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.fcc.gov/general/telemarketing-and-robocalls",
    applicability: US_MARKETING,
    notes:
      "FCC-enforced + state mini-TCPAs. Governs marketing calls/texts to mobile numbers via autodialer or " +
      "prerecorded/AI voice, and Do-Not-Call. AI-generated voice is 'artificial voice' (FCC 2024). Private " +
      "right of action: $500–$1,500 per call/text — high class-action exposure.",
    obligations: [
      {
        title: "Obtain prior express written consent for marketing calls/texts",
        reference: "tcpa/written-consent",
        description:
          "Get prior express written consent before autodialed/prerecorded/AI-voice marketing calls or SMS; retain consent records.",
        category: "operational",
        frequency: "event-driven",
        applicability: "Senders of marketing calls/texts",
        penaltySummary: "$500–$1,500 per call/text (private right of action).",
      },
      {
        title: "Scrub against Do-Not-Call and honor opt-outs immediately",
        reference: "tcpa/dnc-and-opt-out",
        description:
          "Scrub against the national DNC registry, maintain an internal DNC list, and honor STOP/opt-out immediately; identify the sender in each message.",
        category: "operational",
        frequency: "continuous",
        applicability: "Senders of marketing calls/texts",
        penaltySummary: null,
      },
    ],
  },
  // ── Family 6 — accessibility ──
  {
    regulationId: "REG-US-ADA-WCAG",
    name: "ADA Title III + WCAG (digital accessibility)",
    shortName: "ADA/WCAG",
    jurisdiction: "US-federal",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.ada.gov/resources/web-guidance/",
    applicability: {
      basis: ["operating"],
      jurisdictions: ["us"],
      dataHandling: ["publicly-accessible-service"],
    },
    notes:
      "ADA Title III (DOJ-enforced) + state analogues (e.g. CA Unruh Act). A public-facing storefront/app " +
      "surface carries web-accessibility exposure; conforming to WCAG 2.1/2.2 AA is the de-facto standard " +
      "courts reference. Section 508 (WCAG AA) additionally binds when selling ICT to the US government.",
    obligations: [
      {
        title: "Meet WCAG 2.1/2.2 AA on public web/app surfaces",
        reference: "ada/wcag-conformance",
        description: "Bring public-facing web and application surfaces into conformance with WCAG 2.1/2.2 Level AA.",
        category: "operational",
        frequency: "continuous",
        applicability: "Orgs with public-facing digital surfaces",
        penaltySummary: "ADA Title III litigation and state-law exposure.",
      },
      {
        title: "Periodic accessibility audits and remediation",
        reference: "ada/audits",
        description:
          "Run automated + manual accessibility testing periodically, publish an accessibility statement, and remediate reported barriers.",
        category: "governance",
        frequency: "annual",
        applicability: "Orgs with public-facing digital surfaces",
        penaltySummary: null,
      },
      {
        title: "Include accessibility in the SDLC for new features",
        reference: "ada/sdlc",
        description: "Build accessibility acceptance criteria into design and development for new public-facing features.",
        category: "operational",
        frequency: "continuous",
        applicability: "Orgs shipping public-facing features",
        penaltySummary: null,
      },
    ],
  },
  // ── Family 7 — sector overlays (dormant until the data type / customer is onboarded) ──
  {
    regulationId: "REG-US-HIPAA",
    name: "Health Insurance Portability and Accountability Act (HIPAA)",
    shortName: "HIPAA",
    jurisdiction: "US-federal",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.hhs.gov/hipaa/for-professionals/index.html",
    applicability: {
      basis: ["operating"],
      jurisdictions: ["us"],
      dataHandling: ["handles-health-data"],
    },
    notes:
      "Applies when the org is a covered entity or a business associate — i.e. it creates/receives/maintains/" +
      "transmits Protected Health Information on behalf of a covered entity. The Business Associate Agreement " +
      "is the trigger, not merely holding health-ish data.",
    obligations: [
      {
        title: "Execute Business Associate Agreements",
        reference: "hipaa/baa",
        description: "Sign a BAA with each covered entity / upstream business associate before handling PHI.",
        category: "governance",
        frequency: "event-driven",
        applicability: "Business associates handling PHI",
        penaltySummary: "OCR civil penalties; potential criminal exposure.",
      },
      {
        title: "Implement Security Rule safeguards and annual risk analysis",
        reference: "hipaa/security-rule",
        description: "Implement administrative, physical, and technical safeguards for ePHI and perform an annual security risk analysis.",
        category: "operational",
        frequency: "annual",
        applicability: "Handlers of ePHI",
        penaltySummary: null,
      },
      {
        title: "Breach notification within 60 days",
        reference: "hipaa/breach-notice",
        description: "Notify covered entities / individuals / HHS of a PHI breach without unreasonable delay and within 60 days.",
        category: "operational",
        frequency: "event-driven",
        applicability: "Handlers of PHI",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-GLBA",
    name: "Gramm-Leach-Bliley Act + FTC Safeguards Rule",
    shortName: "GLBA",
    jurisdiction: "US-federal",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.ftc.gov/business-guidance/privacy-security/gramm-leach-bliley-act",
    applicability: {
      basis: ["operating"],
      jurisdictions: ["us"],
      dataHandling: ["handles-financial-data"],
    },
    notes:
      "Applies to 'financial institutions' (broadly read by the FTC, incl. fintech-adjacent SaaS) and to " +
      "service providers that receive customer financial information from them. The Safeguards Rule sets the security program duties.",
    obligations: [
      {
        title: "Maintain a written information security program",
        reference: "glba/infosec-program",
        description: "Designate a qualified individual and maintain a written information security program with an annual risk assessment.",
        category: "governance",
        frequency: "annual",
        applicability: "Financial institutions and their service providers",
        penaltySummary: "FTC/banking-regulator enforcement.",
      },
      {
        title: "Encryption, MFA, and incident response",
        reference: "glba/technical-safeguards",
        description: "Implement encryption of customer financial data, multi-factor authentication, and an incident-response plan.",
        category: "operational",
        frequency: "continuous",
        applicability: "Financial institutions and their service providers",
        penaltySummary: null,
      },
      {
        title: "Notify the FTC of a reportable event within 30 days",
        reference: "glba/ftc-notice",
        description: "Notify the FTC of a security event affecting ≥500 consumers within 30 days.",
        category: "operational",
        frequency: "event-driven",
        applicability: "Financial institutions",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-FERPA",
    name: "Family Educational Rights and Privacy Act (FERPA)",
    shortName: "FERPA",
    jurisdiction: "US-federal",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://studentprivacy.ed.gov/",
    applicability: {
      basis: ["operating"],
      jurisdictions: ["us"],
      dataHandling: ["handles-education-data"],
    },
    notes:
      "Applies when processing student education records as a 'school official' on behalf of an educational " +
      "institution (via the school-official exception in a vendor contract). EdTech-customer contracts trigger it.",
    obligations: [
      {
        title: "Contractual FERPA terms and use limitation",
        reference: "ferpa/contract-terms",
        description: "Accept school-official-exception contract terms; use education records only for the contracted purpose.",
        category: "governance",
        frequency: "event-driven",
        applicability: "Vendors handling education records",
        penaltySummary: "Loss of federal funding eligibility flows to the institution; contractual liability to the vendor.",
      },
      {
        title: "No unauthorized redisclosure; support access/amendment",
        reference: "ferpa/redisclosure",
        description: "Do not redisclose education records without authorization; support institution access and amendment obligations.",
        category: "operational",
        frequency: "continuous",
        applicability: "Vendors handling education records",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-US-FEDRAMP",
    name: "FedRAMP (cloud authorization for US federal customers)",
    shortName: "FedRAMP",
    jurisdiction: "US-federal",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.fedramp.gov/",
    applicability: {
      basis: ["operating"],
      jurisdictions: ["us"],
      dataHandling: ["government-customers"],
    },
    notes:
      "Authorization requirement to offer a cloud service to US federal agencies (NIST SP 800-53 baseline, " +
      "3PAO assessment, ATO, continuous monitoring). CMMC additionally applies when handling DoD CUI.",
    obligations: [
      {
        title: "Implement the NIST SP 800-53 control baseline",
        reference: "fedramp/800-53-baseline",
        description: "Implement the FedRAMP control baseline at the appropriate impact level (Low/Moderate/High).",
        category: "governance",
        frequency: "continuous",
        applicability: "Cloud services pursuing FedRAMP",
        penaltySummary: null,
      },
      {
        title: "3PAO assessment, ATO, and continuous monitoring",
        reference: "fedramp/assess-authorize-monitor",
        description: "Complete a 3PAO assessment, obtain an Authorization to Operate, and run monthly continuous monitoring with POA&M management.",
        category: "governance",
        frequency: "monthly",
        applicability: "Authorized cloud services",
        penaltySummary: null,
      },
    ],
  },
  // ── Family 8 — EU / UK (dormant until an EU/UK nexus is captured) ──
  {
    regulationId: "REG-EU-GDPR",
    name: "EU General Data Protection Regulation (2016/679)",
    shortName: "GDPR",
    jurisdiction: "EU",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://edpb.europa.eu/",
    applicability: {
      basis: ["operating", "selling"],
      jurisdictions: ["eu"],
      dataHandling: ["processes-personal-data"],
    },
    notes:
      "Applies to an EU establishment, or to offering goods/services to (or monitoring) individuals in the " +
      "EU (Art. 3). Dormant until an EU nexus is captured (operating or selling into the EU) — then binds on " +
      "processing personal data. Fines up to €20M / 4% global turnover.",
    obligations: [
      {
        title: "Maintain lawful basis and records of processing (Art. 30)",
        reference: "gdpr/ropa",
        description: "Establish a lawful basis for each processing activity and maintain records of processing activities.",
        category: "records",
        frequency: "continuous",
        applicability: "Controllers/processors with an EU nexus",
        penaltySummary: "Up to €20M or 4% of global annual turnover.",
      },
      {
        title: "Handle data subject requests within one month",
        reference: "gdpr/dsar",
        description: "Fulfill access, erasure, rectification, portability, and objection requests within one month.",
        category: "operational",
        frequency: "event-driven",
        applicability: "Controllers with an EU nexus",
        penaltySummary: null,
      },
      {
        title: "72-hour breach notification and Art. 28 processor contracts",
        reference: "gdpr/breach-and-contracts",
        description: "Notify the supervisory authority within 72 hours of a personal-data breach; bind processors with Art. 28 contracts.",
        category: "operational",
        frequency: "event-driven",
        applicability: "Controllers/processors with an EU nexus",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-UK-GDPR",
    name: "UK GDPR + Data Protection Act 2018",
    shortName: "UK GDPR",
    jurisdiction: "UK",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://ico.org.uk/",
    applicability: {
      basis: ["operating", "selling"],
      jurisdictions: ["uk"],
      dataHandling: ["processes-personal-data"],
    },
    notes:
      "The UK's post-Brexit GDPR regime, ICO-enforced. Same structure as EU GDPR for UK individuals. Dormant until a UK nexus is captured.",
    obligations: [
      {
        title: "Records of processing and lawful basis",
        reference: "uk-gdpr/ropa",
        description: "Maintain records of processing and a lawful basis for processing UK individuals' personal data.",
        category: "records",
        frequency: "continuous",
        applicability: "Controllers/processors with a UK nexus",
        penaltySummary: "ICO enforcement; fines up to £17.5M / 4% turnover.",
      },
      {
        title: "DSARs and 72-hour ICO breach notification",
        reference: "uk-gdpr/dsar-breach",
        description: "Fulfill data subject requests within one month and notify the ICO of a breach within 72 hours.",
        category: "operational",
        frequency: "event-driven",
        applicability: "Controllers with a UK nexus",
        penaltySummary: null,
      },
    ],
  },
  {
    regulationId: "REG-EU-AI-ACT",
    name: "EU Artificial Intelligence Act (Regulation 2024/1689)",
    shortName: "EU AI Act",
    jurisdiction: "EU",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://artificialintelligenceact.eu/",
    applicability: {
      basis: ["operating", "selling"],
      jurisdictions: ["eu"],
      dataHandling: ["deploys-automated-decisioning"],
    },
    notes:
      "Applies to placing an AI system on the EU market or its output being used in the EU. Dormant until an " +
      "EU nexus is captured. Transparency duties (Art. 50 — chatbot disclosure, AI-content labeling) + GPAI " +
      "obligations apply Aug 2, 2026; high-risk (Annex III) duties deferred to Dec 2, 2027 (2026 Digital Omnibus).",
    obligations: [
      {
        title: "Transparency: disclose AI interaction and label AI content",
        reference: "eu-ai/transparency",
        description: "Disclose when a person interacts with an AI system and label AI-generated/deepfake content (Art. 50; from Aug 2, 2026).",
        category: "governance",
        frequency: "continuous",
        applicability: "Providers/deployers with an EU nexus",
        penaltySummary: "Fines up to €35M / 7% global turnover for prohibited practices.",
      },
      {
        title: "High-risk system obligations (from Dec 2, 2027)",
        reference: "eu-ai/high-risk",
        description:
          "For Annex III high-risk systems: risk management, data governance, technical documentation, logging, human oversight, and conformity assessment.",
        category: "governance",
        frequency: "event-driven",
        applicability: "Providers of high-risk AI with an EU nexus",
        penaltySummary: null,
      },
    ],
  },
];

export async function seedSoftwareHorizontalCompliance(prisma: PrismaClient): Promise<void> {
  let regUpserts = 0;
  let oblCreated = 0;

  for (const reg of SOFTWARE_HORIZONTAL_REGULATIONS) {
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

  const expected = SOFTWARE_HORIZONTAL_REGULATIONS.reduce((n, r) => n + r.obligations.length, 0);
  console.log(
    `[seed] software horizontal compliance pack: ${regUpserts}/${SOFTWARE_HORIZONTAL_REGULATIONS.length} regulations upserted, ` +
      `${oblCreated} obligations created (${expected} expected total)`,
  );
}
