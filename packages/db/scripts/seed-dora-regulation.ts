/**
 * EP-REG-DORA-001: DORA Regulation Onboarding Seed Script
 *
 * Seeds the EU Digital Operational Resilience Act (Regulation 2022/2554)
 * with obligations across all 5 pillars, suggested controls, control-obligation
 * links, an ICT Risk Management Policy, and policy requirements.
 *
 * Run: cd packages/db && npx tsx scripts/seed-dora-regulation.ts
 */
import { PrismaClient } from "../generated/client/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as crypto from "crypto";
import { loadDbEnv } from "../src/load-env";

loadDbEnv();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function makeId(prefix: string): string {
  const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${prefix}-${hex}`;
}

// ─── Data ──────────────────────────────────────────────────────────────────────

const DORA_REG = {
  regulationId: "REG-DORA-2022",
  name: "Digital Operational Resilience Act",
  shortName: "DORA",
  jurisdiction: "EU",
  industry: "financial",
  sourceType: "external" as const,
  effectiveDate: new Date("2025-01-17"), // DORA applies from 17 Jan 2025
  reviewDate: new Date("2027-01-17"), // 2-year review cycle
  sourceUrl: "https://eur-lex.europa.eu/eli/reg/2022/2554",
  notes:
    "EU Regulation 2022/2554 on digital operational resilience for the financial sector. " +
    "Applies to 21 categories of financial entities. Proportionality principle (Art. 4(2)) " +
    "scales requirements by entity size, risk profile, and complexity. " +
    "Simplified regime (Art. 16) for small/non-interconnected entities.",
};

// Obligations organised by DORA chapter/article
const OBLIGATIONS: Array<{
  title: string;
  reference: string;
  description: string;
  category: string;
  frequency: string;
  applicability: string;
  penaltySummary: string | null;
}> = [
  // ── Chapter II: ICT Risk Management (Articles 5-16) ──────────────────────
  {
    title: "ICT risk management governance — management body ultimate responsibility",
    reference: "Article 5(1)-(2)",
    description:
      "The management body must define, approve, oversee, and be accountable for the ICT risk " +
      "management framework. Must set clear roles and responsibilities, define risk appetite for ICT risk, " +
      "approve ICT internal audit plans and reviews, allocate and review ICT budget, and approve/review " +
      "the entity's digital operational resilience strategy.",
    category: "cybersecurity",
    frequency: "continuous",
    applicability: "All financial entities (proportionality applies)",
    penaltySummary: "Administrative penalties and remedial measures per national law (Art. 50-52)",
  },
  {
    title: "Management body ICT training obligation",
    reference: "Article 5(4)",
    description:
      "Members of the management body must maintain sufficient knowledge and skills to understand " +
      "and assess ICT risk. Must undertake specific training on a regular basis, commensurate with " +
      "the ICT risk being managed.",
    category: "cybersecurity",
    frequency: "annual",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "ICT risk management framework — establish and maintain",
    reference: "Article 6(1)-(5)",
    description:
      "Establish, maintain, and update a sound, comprehensive, and well-documented ICT risk management " +
      "framework as part of the overall risk management system. Must include strategies, policies, " +
      "procedures, ICT protocols and tools necessary to protect all information assets and ICT assets. " +
      "Framework must be documented, reviewed at least annually, and improved based on lessons from testing " +
      "and incidents.",
    category: "cybersecurity",
    frequency: "annual",
    applicability: "All financial entities (proportionality applies)",
    penaltySummary: "Administrative penalties per national law (Art. 50-52)",
  },
  {
    title: "ICT systems, protocols, and tools — maintain up-to-date and reliable",
    reference: "Article 7",
    description:
      "Identify, classify, and document all ICT assets, information, and their dependencies. " +
      "Maintain ICT systems, protocols, and tools that are reliable, have sufficient capacity, " +
      "and are resilient. Perform regular identification and assessment of all sources of ICT risk.",
    category: "cybersecurity",
    frequency: "continuous",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Identification of ICT risk — asset inventory and risk assessment",
    reference: "Article 8",
    description:
      "Identify, classify, and adequately document all ICT-supported business functions, " +
      "roles, responsibilities, information assets, and ICT assets. Identify all sources of " +
      "ICT risk, including ICT third-party dependencies. Perform risk assessments upon major " +
      "changes and at least annually. Map ICT assets to business functions and identify " +
      "critical ICT third-party service providers.",
    category: "cybersecurity",
    frequency: "annual",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Protection and prevention measures",
    reference: "Article 9",
    description:
      "Implement ICT security policies, procedures, protocols, and tools to ensure the security " +
      "and resilience of ICT systems. This includes access controls, network security, encryption " +
      "of data in transit and at rest, patch management, and physical security measures. " +
      "Ensure identity management, authentication, and access-control policies.",
    category: "cybersecurity",
    frequency: "continuous",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Detection of anomalous activities",
    reference: "Article 10",
    description:
      "Establish mechanisms to promptly detect anomalous activities including ICT network " +
      "performance issues, ICT-related incidents, and potential material single points of failure. " +
      "Implement continuous monitoring, logging, and threat detection capabilities. " +
      "All detection mechanisms must be regularly tested.",
    category: "cybersecurity",
    frequency: "continuous",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Response and recovery plans",
    reference: "Article 11",
    description:
      "Establish a comprehensive ICT business continuity policy and associated response and " +
      "recovery plans. These must cover all critical or important functions carried out through ICT " +
      "third-party service providers. Plans must be tested at least annually, including testing of " +
      "ICT third-party dependencies.",
    category: "cybersecurity",
    frequency: "annual",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Backup policies and restoration procedures",
    reference: "Article 12",
    description:
      "Establish and implement backup policies specifying scope, frequency, and retention periods. " +
      "When restoring backup data, use ICT systems that are physically and logically separated from " +
      "the source. Restore backups periodically to verify integrity. Test backup and restoration " +
      "procedures regularly.",
    category: "cybersecurity",
    frequency: "continuous",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Learning and evolving — post-incident reviews",
    reference: "Article 13",
    description:
      "Establish capabilities and staff to gather information on vulnerabilities and cyber threats. " +
      "Conduct post-incident reviews after significant ICT disruptions. Use lessons learned to improve " +
      "ICT risk management framework, strategy, and business continuity policy. Maintain awareness of " +
      "cyber threats and vulnerabilities relevant to the entity's ICT environment.",
    category: "cybersecurity",
    frequency: "event-driven",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Communication policies for ICT-related incidents",
    reference: "Article 14",
    description:
      "Establish communication plans for responsible disclosure of ICT-related incidents or " +
      "vulnerabilities to clients, counterparts, and the public. Designate at least one person " +
      "responsible for communication strategy. Assign roles for public and media communication.",
    category: "cybersecurity",
    frequency: "continuous",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Simplified ICT risk management framework (small entities)",
    reference: "Article 16",
    description:
      "Entities qualifying under the simplified regime must still apply a sound and documented " +
      "ICT risk management framework, document ICT-supported business functions, identify sources of ICT risk, " +
      "implement protection measures, detect and respond to anomalous activities, and maintain backup " +
      "and restoration procedures. Requirements are scaled to the entity's size and risk profile.",
    category: "cybersecurity",
    frequency: "annual",
    applicability:
      "Small and non-interconnected investment firms, exempt payment/e-money institutions, small IORPs",
    penaltySummary: null,
  },

  // ── Chapter III: ICT-related Incident Management (Articles 17-23) ────────
  {
    title: "ICT-related incident management process",
    reference: "Article 17",
    description:
      "Establish and implement an ICT-related incident management process to detect, manage, and " +
      "notify ICT-related incidents. Must include early warning indicators, procedures for identifying, " +
      "tracking, logging, categorising, and classifying incidents, and assign roles and responsibilities. " +
      "Establish procedures for communicating with staff, stakeholders, and media.",
    category: "operational",
    frequency: "continuous",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Classification of ICT-related incidents",
    reference: "Article 18",
    description:
      "Classify ICT-related incidents based on: (a) number of clients/counterparts affected, " +
      "(b) duration, (c) geographical spread, (d) data losses (availability, authenticity, integrity, " +
      "confidentiality), (e) criticality of services affected, (f) economic impact. " +
      "Also classify significant cyber threats using criteria from regulatory technical standards.",
    category: "operational",
    frequency: "event-driven",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Major ICT-related incident reporting to competent authority",
    reference: "Article 19",
    description:
      "Report major ICT-related incidents to the relevant competent authority. Reporting must include: " +
      "(a) initial notification — without undue delay but within 4 hours of classification or next business " +
      "day if after working hours; (b) intermediate report — within 72 hours of the initial notification; " +
      "(c) final report — within 1 month. If not classified as major within 24 hours, the 4-hour clock " +
      "starts when classified.",
    category: "operational",
    frequency: "event-driven",
    applicability: "All financial entities",
    penaltySummary:
      "Administrative penalties. Failure to report is a significant aggravating factor in enforcement.",
  },
  {
    title: "Voluntary notification of significant cyber threats",
    reference: "Article 19(2)",
    description:
      "Financial entities may voluntarily notify competent authorities of significant cyber threats " +
      "they consider to be of relevance to the financial system, service users, or clients, even when " +
      "no incident has yet materialised.",
    category: "operational",
    frequency: "event-driven",
    applicability: "All financial entities (voluntary)",
    penaltySummary: null,
  },
  {
    title: "Harmonised incident reporting content and templates",
    reference: "Article 20",
    description:
      "Use the templates and content specified in the regulatory technical standards (RTS) " +
      "developed by the ESAs for initial, intermediate, and final reports. Comply with any " +
      "additional reporting requirements set by competent authorities.",
    category: "operational",
    frequency: "event-driven",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Inform clients of major ICT incidents affecting their financial interests",
    reference: "Article 19(3a)",
    description:
      "Where a major ICT-related incident has or may have an impact on the financial interests of " +
      "clients, inform clients without undue delay about the incident and the measures taken to " +
      "mitigate its effects. In case of a significant cyber threat, inform clients who may be affected " +
      "of any appropriate protection measures they may take.",
    category: "operational",
    frequency: "event-driven",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Centralisation of incident reporting (single EU Hub)",
    reference: "Article 21",
    description:
      "Incident reports will flow through a single EU reporting hub operated by the ESAs. " +
      "Financial entities must comply with any hub-specific formatting, content, or submission " +
      "channel requirements when established.",
    category: "operational",
    frequency: "event-driven",
    applicability: "All financial entities (once hub is operational)",
    penaltySummary: null,
  },

  // ── Chapter IV: Digital Operational Resilience Testing (Articles 24-27) ──
  {
    title: "General requirements for digital operational resilience testing",
    reference: "Article 24",
    description:
      "Establish, maintain, and review a sound and comprehensive digital operational resilience " +
      "testing programme as an integral part of the ICT risk management framework. Must include a " +
      "range of assessments, tests, methodologies, practices, and tools. Proportionality principle applies — " +
      "scope and frequency depend on entity size, business profile, and ICT risk profile.",
    category: "cybersecurity",
    frequency: "annual",
    applicability: "All financial entities (proportionality applies)",
    penaltySummary: null,
  },
  {
    title: "Vulnerability assessments, network security testing, open-source analysis",
    reference: "Article 25",
    description:
      "Testing programme must include at minimum: vulnerability assessments and scans, " +
      "open-source software analysis, network security assessments, gap analyses, physical security " +
      "reviews, scenario-based tests, compatibility testing, performance testing, and end-to-end testing. " +
      "All ICT systems and applications supporting critical or important functions must be tested at least annually.",
    category: "cybersecurity",
    frequency: "annual",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Threat-Led Penetration Testing (TLPT)",
    reference: "Article 26",
    description:
      "Entities identified by competent authorities as significant must carry out advanced testing " +
      "by means of threat-led penetration testing (TLPT) at least every 3 years. TLPT must cover " +
      "several or all critical or important functions. Testing must be performed by qualified " +
      "independent testers, follow the TIBER-EU framework or equivalent, and include live production " +
      "systems. Results must be validated by the competent authority.",
    category: "cybersecurity",
    frequency: "event-driven",
    applicability:
      "Entities identified by competent authorities as significant (mandatory); " +
      "others may carry out TLPT voluntarily",
    penaltySummary:
      "Competent authorities may require more frequent TLPT or additional scope if resilience gaps found",
  },
  {
    title: "Requirements for TLPT testers",
    reference: "Article 27",
    description:
      "TLPT testers must be: (a) of the highest suitability and reputability; (b) possess technical " +
      "and organisational capabilities, including expertise in threat intelligence, penetration testing, " +
      "and red team testing; (c) be accredited/certified by a relevant body or adhere to formal codes of " +
      "conduct; (d) provide independent assurance or audit report on sound risk management; " +
      "(e) be covered by professional indemnity insurance.",
    category: "cybersecurity",
    frequency: "event-driven",
    applicability: "Entities performing TLPT",
    penaltySummary: null,
  },

  // ── Chapter V: Managing ICT Third-Party Risk (Articles 28-44) ────────────
  {
    title: "General principles on ICT third-party risk management",
    reference: "Article 28",
    description:
      "Financial entities must manage ICT third-party risk as an integral part of the ICT risk " +
      "management framework. Remain fully responsible at all times for compliance with all obligations " +
      "under DORA, even when using ICT services from third parties. Must assess and manage concentration " +
      "risk arising from ICT third-party dependencies. Maintain a register of information on all " +
      "contractual arrangements with ICT third-party service providers.",
    category: "operational",
    frequency: "continuous",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Register of information on ICT third-party arrangements",
    reference: "Article 28(3)",
    description:
      "Maintain and update a register of information on all contractual arrangements for the use " +
      "of ICT services provided by third-party service providers. Distinguish between those supporting " +
      "critical or important functions and those that do not. Report the register to competent authorities " +
      "at least annually, on request, and following any material changes.",
    category: "operational",
    frequency: "annual",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Pre-contractual assessment of ICT third-party service providers",
    reference: "Article 28(4)-(5)",
    description:
      "Before entering into contractual arrangements, perform appropriate due diligence on prospective " +
      "ICT third-party service providers. Assess whether the arrangement will create concentration risk. " +
      "Identify and assess all relevant risks, including ensuring the provider has appropriate information " +
      "security standards. Only enter into arrangements with providers that comply with appropriate " +
      "information security standards.",
    category: "operational",
    frequency: "event-driven",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Key contractual provisions for ICT services",
    reference: "Article 30",
    description:
      "Contractual arrangements with ICT third-party service providers must include at minimum: " +
      "clear description of all functions and services; provisions on quality, locations of data processing, " +
      "security measures, service levels with quantitative targets, notice periods, " +
      "notification obligations for incidents, rights of access/inspection/audit (including third-party testing), " +
      "exit strategies with adequate transition periods, and cooperation during regulatory inspections.",
    category: "operational",
    frequency: "event-driven",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Additional contractual provisions for critical/important functions",
    reference: "Article 30(3)",
    description:
      "For ICT services supporting critical or important functions, contracts must also include: " +
      "full service level descriptions with quantitative/qualitative performance targets, " +
      "appropriate penalties for missed targets, termination rights and minimum notice periods, " +
      "obligations of the provider to cooperate fully in regulatory inspections and audits, " +
      "and exit strategies ensuring minimal disruption to business continuity.",
    category: "operational",
    frequency: "event-driven",
    applicability: "All financial entities for critical/important function contracts",
    penaltySummary: null,
  },
  {
    title: "ICT third-party concentration risk assessment",
    reference: "Article 29",
    description:
      "Assess and monitor ICT concentration risk. Consider: the number of critical or important functions " +
      "relying on the same provider, substitutability of the ICT services, proportion of entity's critical " +
      "infrastructure supported by a single provider, systemic implications if the provider fails. " +
      "Weigh benefits and costs of alternative solutions when assessing sub-outsourcing chains.",
    category: "operational",
    frequency: "annual",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Sub-outsourcing of critical/important functions — prior notification and objection right",
    reference: "Article 30(2a)",
    description:
      "When third-party providers sub-outsource ICT services supporting critical or important functions, " +
      "the financial entity must be informed in advance and have the right to object. Contractual " +
      "arrangements must include provisions ensuring the financial entity can monitor and audit " +
      "the sub-outsourcer's compliance.",
    category: "operational",
    frequency: "event-driven",
    applicability: "All financial entities for critical/important function contracts",
    penaltySummary: null,
  },
  {
    title: "Exit strategies from ICT third-party service providers",
    reference: "Article 28(8)",
    description:
      "Develop and maintain exit strategies for ICT services supporting critical or important functions. " +
      "Exit strategies must allow transition to alternative providers or in-house solutions without " +
      "undue disruption to business activities. Must include mandatory transition periods, " +
      "identification of alternative providers, and testing of transition processes.",
    category: "operational",
    frequency: "annual",
    applicability: "All financial entities",
    penaltySummary: null,
  },
  {
    title: "Oversight Framework for critical ICT third-party service providers",
    reference: "Articles 31-44",
    description:
      "Critical ICT third-party service providers designated by the ESAs are subject to an EU Oversight " +
      "Framework. The Lead Overseer (one of EBA, ESMA, or EIOPA) can conduct inspections, issue " +
      "recommendations, and impose penalty payments. Financial entities using designated critical providers " +
      "must cooperate with the oversight framework and assess risks arising from provider deficiencies.",
    category: "operational",
    frequency: "continuous",
    applicability:
      "Critical ICT third-party service providers + financial entities using them",
    penaltySummary:
      "Lead Overseer can impose periodic penalty payments on critical providers (Art. 35(8)). " +
      "Financial entities face enforcement if they fail to manage risks from provider deficiencies.",
  },

  // ── Chapter VI: Information-sharing (Article 45) ─────────────────────────
  {
    title: "ICT-related information sharing arrangements",
    reference: "Article 45",
    description:
      "Financial entities may exchange amongst themselves cyber threat information and intelligence, " +
      "including indicators of compromise, tactics, techniques and procedures, cybersecurity alerts, " +
      "and configuration tools. Such sharing must take place within trusted communities, protect the " +
      "confidentiality of shared information, and comply with competition law and GDPR. " +
      "Must notify competent authorities of participation in sharing arrangements.",
    category: "cybersecurity",
    frequency: "continuous",
    applicability: "All financial entities (voluntary)",
    penaltySummary: null,
  },
];

// Controls: suggested typical controls a financial entity would implement
const CONTROLS: Array<{
  title: string;
  description: string;
  controlType: "preventive" | "detective" | "corrective";
  implementationStatus: "planned" | "in-progress" | "implemented";
  // Which obligation references this control addresses (for linking)
  obligationRefs: string[];
}> = [
  {
    title: "ICT Risk Management Framework Document",
    description:
      "Documented ICT risk management framework covering strategy, policies, procedures, protocols, " +
      "and tools. Reviewed and updated at least annually.",
    controlType: "preventive",
    implementationStatus: "planned",
    obligationRefs: ["Article 5(1)-(2)", "Article 6(1)-(5)"],
  },
  {
    title: "ICT Asset Inventory and Classification",
    description:
      "Maintained register of all ICT assets, information assets, business functions, roles, " +
      "and dependencies. Updated upon major changes and reviewed annually.",
    controlType: "preventive",
    implementationStatus: "planned",
    obligationRefs: ["Article 7", "Article 8"],
  },
  {
    title: "Identity and Access Management (IAM) Controls",
    description:
      "Authentication, authorization, and access control policies and systems. Includes MFA, " +
      "least-privilege, role-based access, privileged access management, and periodic access reviews.",
    controlType: "preventive",
    implementationStatus: "planned",
    obligationRefs: ["Article 9"],
  },
  {
    title: "Encryption and Data Protection",
    description:
      "Encryption of data in transit and at rest. Key management procedures. " +
      "Data loss prevention (DLP) controls.",
    controlType: "preventive",
    implementationStatus: "planned",
    obligationRefs: ["Article 9"],
  },
  {
    title: "Security Information and Event Management (SIEM)",
    description:
      "Continuous monitoring, logging, and threat detection system. Correlation of security " +
      "events across all ICT systems. Automated alerting for anomalous activities.",
    controlType: "detective",
    implementationStatus: "planned",
    obligationRefs: ["Article 10"],
  },
  {
    title: "ICT Business Continuity Plan",
    description:
      "Documented business continuity and disaster recovery plans covering all critical/important " +
      "functions including those relying on ICT third-party providers. Tested at least annually.",
    controlType: "corrective",
    implementationStatus: "planned",
    obligationRefs: ["Article 11"],
  },
  {
    title: "Backup and Restoration Procedures",
    description:
      "Documented backup policy with defined scope, frequency, retention periods, and media. " +
      "Physically and logically separated backup systems. Regular restoration tests.",
    controlType: "corrective",
    implementationStatus: "planned",
    obligationRefs: ["Article 12"],
  },
  {
    title: "ICT Incident Management Process",
    description:
      "Documented incident management process with classification criteria, escalation procedures, " +
      "roles/responsibilities, communication plans, and post-incident review methodology.",
    controlType: "detective",
    implementationStatus: "planned",
    obligationRefs: ["Article 17", "Article 18"],
  },
  {
    title: "Regulatory Incident Reporting Procedure",
    description:
      "Procedure ensuring major ICT incidents are reported to competent authority within 4 hours " +
      "(initial notification), 72 hours (intermediate), and 1 month (final). Templates maintained " +
      "per RTS requirements. Client notification process for incidents affecting financial interests.",
    controlType: "corrective",
    implementationStatus: "planned",
    obligationRefs: ["Article 19", "Article 19(2)", "Article 19(3a)", "Article 20"],
  },
  {
    title: "Digital Operational Resilience Testing Programme",
    description:
      "Annual testing programme including vulnerability assessments, network security testing, " +
      "open-source analysis, scenario testing, performance testing, and gap analyses. " +
      "All critical/important function ICT systems tested at least annually.",
    controlType: "detective",
    implementationStatus: "planned",
    obligationRefs: ["Article 24", "Article 25"],
  },
  {
    title: "Threat-Led Penetration Testing (TLPT) Programme",
    description:
      "TLPT programme following TIBER-EU framework. Performed at least every 3 years covering " +
      "critical/important functions on live production systems. Conducted by qualified independent testers.",
    controlType: "detective",
    implementationStatus: "planned",
    obligationRefs: ["Article 26", "Article 27"],
  },
  {
    title: "ICT Third-Party Risk Management Framework",
    description:
      "Framework for managing ICT third-party risk including due diligence procedures, " +
      "contract requirements, ongoing monitoring, concentration risk assessment, and exit strategies.",
    controlType: "preventive",
    implementationStatus: "planned",
    obligationRefs: [
      "Article 28",
      "Article 28(3)",
      "Article 28(4)-(5)",
      "Article 30",
      "Article 30(3)",
    ],
  },
  {
    title: "ICT Third-Party Register of Information",
    description:
      "Maintained register of all contractual arrangements with ICT third-party service providers. " +
      "Distinguishes critical/important function providers. Reported to competent authority annually.",
    controlType: "preventive",
    implementationStatus: "planned",
    obligationRefs: ["Article 28(3)"],
  },
  {
    title: "ICT Concentration Risk Assessment",
    description:
      "Annual assessment of ICT concentration risk including dependency mapping, single-provider " +
      "exposure analysis, substitutability assessment, and systemic risk considerations.",
    controlType: "detective",
    implementationStatus: "planned",
    obligationRefs: ["Article 29"],
  },
  {
    title: "ICT Third-Party Exit Strategy Procedures",
    description:
      "Documented exit strategies for ICT services supporting critical/important functions. " +
      "Includes alternative provider identification, transition timelines, and testing of exit procedures.",
    controlType: "corrective",
    implementationStatus: "planned",
    obligationRefs: ["Article 28(8)"],
  },
  {
    title: "Management Body ICT Training Programme",
    description:
      "Regular training programme for management body members on ICT risk, digital operational " +
      "resilience, and cyber threats. Documented attendance and content coverage.",
    controlType: "preventive",
    implementationStatus: "planned",
    obligationRefs: ["Article 5(4)"],
  },
  {
    title: "Post-Incident Review and Lessons Learned Process",
    description:
      "Formal process for conducting post-incident reviews after significant ICT disruptions. " +
      "Findings fed back into ICT risk management framework improvements. Awareness of new " +
      "vulnerabilities and threats maintained.",
    controlType: "corrective",
    implementationStatus: "planned",
    obligationRefs: ["Article 13"],
  },
  {
    title: "ICT-Related Communication and Disclosure Policy",
    description:
      "Communication plans for responsible disclosure of ICT incidents/vulnerabilities to clients, " +
      "counterparts, and public. Designated spokesperson. Media communication procedures.",
    controlType: "preventive",
    implementationStatus: "planned",
    obligationRefs: ["Article 14"],
  },
  {
    title: "Cyber Threat Information Sharing Participation",
    description:
      "Participation in trusted information-sharing communities for exchange of cyber threat " +
      "intelligence, IoCs, TTPs, and cybersecurity alerts. Compliance with competition law and GDPR.",
    controlType: "detective",
    implementationStatus: "planned",
    obligationRefs: ["Article 45"],
  },
];

// Policy and requirements
const POLICY = {
  title: "ICT Risk Management Policy",
  description:
    "Overarching policy governing the management of ICT risk across the organisation in compliance " +
    "with the EU Digital Operational Resilience Act (DORA). Covers ICT risk governance, asset management, " +
    "protection measures, detection capabilities, response and recovery, testing programme, " +
    "third-party risk management, and incident management.",
  category: "security",
};

const POLICY_REQUIREMENTS: Array<{
  title: string;
  requirementType: "acknowledgment" | "training" | "attestation" | "action";
  description: string;
  frequency: string | null;
  applicability: string;
}> = [
  {
    title: "Annual ICT risk assessment completion",
    requirementType: "action",
    description: "Complete and document annual ICT risk assessment per Article 6 & 8 of DORA.",
    frequency: "annual",
    applicability: "all-employees",
  },
  {
    title: "ICT risk management framework awareness training",
    requirementType: "training",
    description:
      "Complete training on the organisation's ICT risk management framework, policies, and procedures.",
    frequency: "annual",
    applicability: "all-employees",
  },
  {
    title: "ICT incident reporting procedure training",
    requirementType: "training",
    description:
      "Complete training on ICT incident detection, classification, escalation, and regulatory " +
      "reporting procedures per DORA Chapter III requirements.",
    frequency: "annual",
    applicability: "all-employees",
  },
  {
    title: "Management body ICT risk training",
    requirementType: "training",
    description:
      "Board/management body members must complete specific ICT risk and cyber resilience training " +
      "per Article 5(4) of DORA.",
    frequency: "annual",
    applicability: "role:HR-000",
  },
  {
    title: "ICT Risk Management Policy acknowledgment",
    requirementType: "acknowledgment",
    description: "Read and acknowledge the ICT Risk Management Policy.",
    frequency: "on-change",
    applicability: "all-employees",
  },
  {
    title: "Digital operational resilience testing participation",
    requirementType: "attestation",
    description:
      "Attest participation in annual digital operational resilience testing programme " +
      "including vulnerability assessments and scenario-based testing.",
    frequency: "annual",
    applicability: "department:engineering",
  },
];

// ─── Seed ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("EP-REG-DORA-001: Seeding DORA regulation data...\n");

  // 1. Create Regulation
  const existingReg = await prisma.regulation.findUnique({
    where: { regulationId: DORA_REG.regulationId },
  });

  let regulation: { id: string; regulationId: string };
  if (existingReg) {
    console.log(`Regulation ${DORA_REG.regulationId} already exists — updating.`);
    regulation = await prisma.regulation.update({
      where: { regulationId: DORA_REG.regulationId },
      data: {
        name: DORA_REG.name,
        shortName: DORA_REG.shortName,
        jurisdiction: DORA_REG.jurisdiction,
        industry: DORA_REG.industry,
        sourceType: DORA_REG.sourceType,
        effectiveDate: DORA_REG.effectiveDate,
        reviewDate: DORA_REG.reviewDate,
        sourceUrl: DORA_REG.sourceUrl,
        notes: DORA_REG.notes,
      },
    });
  } else {
    regulation = await prisma.regulation.create({
      data: {
        regulationId: DORA_REG.regulationId,
        ...DORA_REG,
      },
    });
    console.log(`Created regulation: ${DORA_REG.shortName} (${regulation.id})`);
  }

  // Log to ComplianceAuditLog
  await prisma.complianceAuditLog.create({
    data: {
      entityType: "regulation",
      entityId: regulation.id,
      action: "created",
      notes: "DORA regulation onboarded via seed script (EP-REG-DORA-001)",
    },
  });

  // 2. Create Obligations
  console.log(`\nCreating ${OBLIGATIONS.length} DORA obligations...`);
  const oblMap = new Map<string, string>(); // reference → id
  let oblCreated = 0;
  let oblSkipped = 0;

  for (const obl of OBLIGATIONS) {
    // Check if obligation with same reference already exists for this regulation
    const existing = await prisma.obligation.findFirst({
      where: {
        regulationId: regulation.id,
        reference: obl.reference,
        status: "active",
      },
    });

    if (existing) {
      oblMap.set(obl.reference, existing.id);
      oblSkipped++;
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
    oblMap.set(obl.reference, created.id);
    oblCreated++;

    await prisma.complianceAuditLog.create({
      data: {
        entityType: "obligation",
        entityId: created.id,
        action: "created",
        notes: `DORA ${obl.reference}: ${obl.title}`,
      },
    });
  }
  console.log(`  Created: ${oblCreated}, Skipped (existing): ${oblSkipped}`);

  // 3. Create Controls and link to obligations
  console.log(`\nCreating ${CONTROLS.length} controls and linking to obligations...`);
  let ctlCreated = 0;
  let ctlSkipped = 0;
  let linksCreated = 0;

  for (const ctl of CONTROLS) {
    // Check if control with same title already exists
    const existing = await prisma.control.findFirst({
      where: { title: ctl.title, status: "active" },
    });

    let controlId: string;
    if (existing) {
      controlId = existing.id;
      ctlSkipped++;
    } else {
      const created = await prisma.control.create({
        data: {
          controlId: makeId("CTL"),
          title: ctl.title,
          description: ctl.description,
          controlType: ctl.controlType,
          implementationStatus: ctl.implementationStatus,
        },
      });
      controlId = created.id;
      ctlCreated++;

      await prisma.complianceAuditLog.create({
        data: {
          entityType: "control",
          entityId: controlId,
          action: "created",
          notes: `DORA control: ${ctl.title}`,
        },
      });
    }

    // Link control to obligations
    for (const ref of ctl.obligationRefs) {
      const oblId = oblMap.get(ref);
      if (!oblId) {
        console.warn(`  WARNING: No obligation found for reference ${ref}`);
        continue;
      }

      const existingLink = await prisma.controlObligationLink.findUnique({
        where: {
          controlId_obligationId: { controlId, obligationId: oblId },
        },
      });

      if (!existingLink) {
        await prisma.controlObligationLink.create({
          data: { controlId, obligationId: oblId },
        });
        linksCreated++;

        await prisma.complianceAuditLog.create({
          data: {
            entityType: "control",
            entityId: controlId,
            action: "linked",
            notes: `Linked to obligation ${ref}`,
          },
        });
      }
    }
  }
  console.log(`  Controls created: ${ctlCreated}, Skipped: ${ctlSkipped}`);
  console.log(`  Control-obligation links created: ${linksCreated}`);

  // 4. Create Policy linked to the first obligation (governance)
  console.log(`\nCreating ICT Risk Management Policy...`);
  const existingPolicy = await prisma.policy.findFirst({
    where: { title: POLICY.title, status: "active" },
  });

  let policyId: string;
  if (existingPolicy) {
    console.log(`  Policy "${POLICY.title}" already exists — skipping.`);
    policyId = existingPolicy.id;
  } else {
    // Link to the governance obligation (Article 5)
    const govOblId = oblMap.get("Article 5(1)-(2)");

    const created = await prisma.policy.create({
      data: {
        policyId: makeId("POL"),
        title: POLICY.title,
        description: POLICY.description,
        category: POLICY.category,
        lifecycleStatus: "draft",
        obligationId: govOblId ?? null,
      },
    });
    policyId = created.id;
    console.log(`  Created policy: ${POLICY.title} (${policyId})`);

    await prisma.complianceAuditLog.create({
      data: {
        entityType: "policy",
        entityId: policyId,
        action: "created",
        notes: `DORA ICT Risk Management Policy created via seed script`,
      },
    });
  }

  // 5. Create Policy Requirements
  console.log(`\nCreating ${POLICY_REQUIREMENTS.length} policy requirements...`);
  let reqCreated = 0;
  let reqSkipped = 0;

  for (const req of POLICY_REQUIREMENTS) {
    const existing = await prisma.policyRequirement.findFirst({
      where: { policyId, title: req.title, status: "active" },
    });

    if (existing) {
      reqSkipped++;
      continue;
    }

    const created = await prisma.policyRequirement.create({
      data: {
        requirementId: makeId("PREQ"),
        policyId,
        title: req.title,
        requirementType: req.requirementType,
        description: req.description,
        frequency: req.frequency,
        applicability: req.applicability,
      },
    });
    reqCreated++;

    // If training type, create TrainingRequirement
    if (req.requirementType === "training") {
      await prisma.trainingRequirement.create({
        data: {
          requirementId: created.id,
          trainingTitle: req.title,
          provider: "internal",
          deliveryMethod: "online",
          durationMinutes: 60,
        },
      });
    }

    await prisma.complianceAuditLog.create({
      data: {
        entityType: "requirement",
        entityId: created.id,
        action: "created",
        notes: `Policy requirement: ${req.title}`,
      },
    });
  }
  console.log(`  Created: ${reqCreated}, Skipped: ${reqSkipped}`);

  // 6. Summary
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("EP-REG-DORA-001: DORA Onboarding Complete");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Regulation:        ${DORA_REG.shortName} (${DORA_REG.regulationId})`);
  console.log(`Obligations:       ${oblCreated} created, ${oblSkipped} existing`);
  console.log(`Controls:          ${ctlCreated} created, ${ctlSkipped} existing`);
  console.log(`Control-Obl Links: ${linksCreated} created`);
  console.log(`Policy:            ${POLICY.title}`);
  console.log(`Requirements:      ${reqCreated} created, ${reqSkipped} existing`);
  console.log("═══════════════════════════════════════════════════════════\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
