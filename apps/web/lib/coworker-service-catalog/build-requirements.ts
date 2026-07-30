type MaybeBuildBrief = {
  title?: string;
  description?: string;
  dataNeeds?: string;
  acceptanceCriteria?: string[];
  inputs?: string[];
};

type MaybeDesignDoc = {
  problemStatement?: string;
  dataModel?: string;
  proposedApproach?: string;
  acceptanceCriteria?: string[];
};

type MaybeBuildPlan = {
  tasks?: Array<{
    title?: string;
    testFirst?: string;
    implement?: string;
    verify?: string;
  }>;
};

export type BuildRequirementTriggerFamily =
  | "payment-cardholder-data"
  | "payroll-workforce-compensation"
  | "company-identity-data-authority"
  | "paid-provider"
  | "regulated-sensitive-domain";

export type BuildRequirementOfferRef = {
  offerKey: string;
  title: string;
  coworkerFamilies: string[];
  reason: string;
};

export type BuildRequirementsPacket = {
  triggeredFamilies: BuildRequirementTriggerFamily[];
  matchedSignals: string[];
  requiredCoworkerOffers: BuildRequirementOfferRef[];
  obligations: string[];
  controls: string[];
  prohibitedPatterns: string[];
  providerRequirements: string[];
  costTracking: string[];
  approvals: string[];
  dataBoundaries: string[];
  citations: string[];
  contextPolicy: string;
};

export type BuildRequirementsInput = {
  title?: string;
  brief?: MaybeBuildBrief | null;
  designDoc?: MaybeDesignDoc | null;
  buildPlan?: MaybeBuildPlan | null;
  businessContext?: string | null;
  scoutFindings?: string | null;
  runningSpec?: Record<string, unknown> | null;
};

type TriggerDefinition = {
  family: BuildRequirementTriggerFamily;
  patterns: RegExp[];
  offer: BuildRequirementOfferRef;
  obligations: string[];
  controls: string[];
  prohibitedPatterns: string[];
  providerRequirements: string[];
  costTracking: string[];
  approvals: string[];
  dataBoundaries: string[];
  citations: string[];
};

const TRIGGERS: TriggerDefinition[] = [
  {
    family: "payment-cardholder-data",
    patterns: [
      /\bcredit\s*card\b/i,
      /\bcardholder\b/i,
      /\bpayment\s*(processor|intent|method|token|card|checkout)\b/i,
      /\bPCI(?:\s+DSS)?\b/i,
      /\bPAN\b/i,
    ],
    offer: {
      offerKey: "aggregate-payment-compliance-requirements",
      title: "Payment compliance requirements packet",
      coworkerFamilies: ["compliance", "security", "legal", "finance", "provider-management"],
      reason: "Payment and cardholder-data work can affect PCI DSS scope and payment provider obligations.",
    },
    obligations: [
      "Classify whether the build stores, processes, transmits, or can affect cardholder-data environments.",
      "Identify payment-provider responsibilities before implementation starts.",
    ],
    controls: [
      "Do not store raw PAN, CVV, magnetic stripe, or equivalent sensitive authentication data in DPF logs, database rows, traces, or test fixtures.",
      "Use provider tokenization or hosted payment surfaces where feasible and document PCI DSS scope impact.",
      "Add acceptance criteria for masking, audit evidence, error handling, and least-privilege provider credentials.",
    ],
    prohibitedPatterns: [
      "Capturing raw card details in first-party forms unless the payment architecture has explicit approval.",
      "Writing raw card, CVV, or payment-secret values to logs, analytics, screenshots, model prompts, or support transcripts.",
    ],
    providerRequirements: [
      "Payment provider must have approved contract terms, data boundary, tokenization posture, and revocation path.",
    ],
    costTracking: [
      "Track payment provider fees, transaction charges, credential owner, budget owner, and reconciliation evidence.",
    ],
    approvals: ["Security, compliance, finance, and legal review are required before implementation is treated as ready."],
    dataBoundaries: ["Cardholder data and payment secrets must remain outside general-purpose AI and broad application logs."],
    citations: ["PCI DSS overview"],
  },
  {
    family: "payroll-workforce-compensation",
    patterns: [/\bADP\b/i, /\bpayroll\b/i, /\bsalary\b/i, /\bcompensation\b/i, /\bworkforce\s+pay/i],
    offer: {
      offerKey: "aggregate-payroll-provider-requirements",
      title: "Payroll/workforce provider requirements packet",
      coworkerFamilies: ["hr-payroll", "finance", "legal", "procurement", "security", "data-governance"],
      reason: "Payroll and compensation integrations affect employment authority, privacy, payment timing, and provider contracts.",
    },
    obligations: [
      "Confirm payroll authority, change-control owner, cycle timing, reversal/error handling, and employee-data privacy obligations.",
    ],
    controls: [
      "Require audit trails for salary, payroll status, employee identifiers, and provider synchronization decisions.",
      "Separate read-only workforce data sync from write/payment authority unless approvals explicitly allow writes.",
    ],
    prohibitedPatterns: [
      "Letting a coding agent infer payroll authority or salary-payment behavior without HR/payroll approval evidence.",
    ],
    providerRequirements: [
      "ADP or payroll provider access requires contract, credential owner, data-sharing scope, and environment separation.",
    ],
    costTracking: [
      "Track provider subscription, per-employee or usage fees, renewal cadence, budget owner, and cost center.",
    ],
    approvals: ["HR/payroll, finance, legal, security, and data governance approval are required for provider-backed payroll changes."],
    dataBoundaries: ["Employee payroll data must be classified as sensitive workforce data with retention and access constraints."],
    citations: ["ADP developer portal"],
  },
  {
    family: "company-identity-data-authority",
    patterns: [/\bD&B\b/i, /\bDun\s*&\s*Bradstreet\b/i, /\bDUNS\b/i, /\bcompany\s+name\s+authority\b/i, /\bfirmographic\b/i],
    offer: {
      offerKey: "aggregate-company-data-authority-requirements",
      title: "Company identity/data authority requirements packet",
      coworkerFamilies: ["procurement", "finance", "data-governance", "master-data", "legal"],
      reason: "Commercial company-data authority feeds introduce paid-data terms, lineage, matching, and refresh obligations.",
    },
    obligations: [
      "Define authoritative company identifier, match confidence, refresh cadence, lineage, and stale-data behavior.",
    ],
    controls: [
      "Record source, provider record id, match confidence, update timestamp, and override path for every authoritative company match.",
    ],
    prohibitedPatterns: [
      "Treating a provider-enriched company name as authoritative without lineage, confidence, and correction workflow.",
    ],
    providerRequirements: [
      "D&B-style data feed requires contract terms, permitted-use review, redistribution limits, and data-retention rules.",
    ],
    costTracking: [
      "Track subscription tier, API usage, refresh cadence, cost center, renewal date, and budget owner.",
    ],
    approvals: ["Procurement, finance, data-governance, master-data owner, and legal review are required before provider data is canonical."],
    dataBoundaries: ["Provider-enriched company data must retain source attribution and permitted-use metadata."],
    citations: ["D&B Direct+ documentation"],
  },
  {
    family: "paid-provider",
    patterns: [
      /\bpaid\s+(provider|service|api|dependency|data\s+feed)\b/i,
      /\bapi\s+token\b/i,
      /\bacquire\b.{0,40}\b(tokens?|credentials?|license)\b/i,
      /\bsubscription\b/i,
      /\brenewal\b/i,
      /\bcontract\b/i,
      /\bprovider\s+tokens?\b/i,
    ],
    offer: {
      offerKey: "aggregate-paid-provider-approval-requirements",
      title: "Paid provider approval requirements packet",
      coworkerFamilies: ["procurement", "finance", "legal", "security", "data-governance"],
      reason: "Paid dependencies require cost, contract, security, data-boundary, and renewal evidence before build execution.",
    },
    obligations: [
      "Identify provider, business owner, procurement route, contract status, budget owner, and implementation fallback.",
    ],
    controls: [
      "Do not mark a provider dependency as available until credentials, contract context, budget owner, and data boundary are recorded.",
      "Add review criteria for provider outage, termination, revocation, and migration path.",
    ],
    prohibitedPatterns: [
      "Hardcoding provider credentials or proceeding with implementation that assumes unapproved paid access exists.",
    ],
    providerRequirements: [
      "Provider onboarding must capture contract status, terms reference, credential owner, security review, data boundary, and revocation path.",
    ],
    costTracking: [
      "Track budget owner, cost center, pricing model, renewal cadence, usage limits, overage exposure, and approval evidence.",
    ],
    approvals: ["Procurement and finance approval are required; legal/security/data-governance approval is required when terms or data boundaries apply."],
    dataBoundaries: ["Provider credentials and paid data must not be exposed to general prompts or test fixtures."],
    citations: ["DPF paid-provider governance"],
  },
  {
    family: "regulated-sensitive-domain",
    patterns: [
      /\btax\b/i,
      /\bhealthcare\b/i,
      /\bHIPAA\b/i,
      /\bfinancial\s+reporting\b/i,
      /\bauthentication\b/i,
      /\bidentity\b/i,
      /\bsecurity\s+monitoring\b/i,
      /\bsupplier\s+onboarding\b/i,
      /\bcustomer\s+communication\b/i,
    ],
    offer: {
      offerKey: "aggregate-sensitive-domain-requirements",
      title: "Sensitive-domain requirements packet",
      coworkerFamilies: ["legal", "security", "compliance", "data-governance", "operations"],
      reason: "Regulated or sensitive operational domains need specialist requirements before implementation.",
    },
    obligations: ["Classify the sensitive domain, affected parties, authority boundary, and required evidence before build execution."],
    controls: ["Add acceptance criteria for authorization, audit, retention, notification, rollback, and employee checkpoint behavior."],
    prohibitedPatterns: ["Allowing autonomous implementation to set policy, legal, identity, or regulated operational behavior without review."],
    providerRequirements: [],
    costTracking: [],
    approvals: ["Relevant specialist approval is required based on domain and exposure."],
    dataBoundaries: ["Sensitive data movement must be explicit, minimized, and retained according to policy."],
    citations: ["DPF sensitive-domain governance"],
  },
];

export function buildRequirementsPacket(input: BuildRequirementsInput): BuildRequirementsPacket {
  const corpus = buildCorpus(input);
  const matched = TRIGGERS.filter((trigger) => trigger.patterns.some((pattern) => pattern.test(corpus)));

  return {
    triggeredFamilies: matched.map((trigger) => trigger.family),
    matchedSignals: matched.map((trigger) => trigger.family),
    requiredCoworkerOffers: matched.map((trigger) => trigger.offer),
    obligations: unique(matched.flatMap((trigger) => trigger.obligations)),
    controls: unique(matched.flatMap((trigger) => trigger.controls)),
    prohibitedPatterns: unique(matched.flatMap((trigger) => trigger.prohibitedPatterns)),
    providerRequirements: unique(matched.flatMap((trigger) => trigger.providerRequirements)),
    costTracking: unique(matched.flatMap((trigger) => trigger.costTracking)),
    approvals: unique(matched.flatMap((trigger) => trigger.approvals)),
    dataBoundaries: unique(matched.flatMap((trigger) => trigger.dataBoundaries)),
    citations: unique(matched.flatMap((trigger) => trigger.citations)),
    contextPolicy:
      "Build Studio must pass this bounded requirements packet to coding and review agents; do not inject the full coworker catalog.",
  };
}

export function formatBuildRequirementsPacketForPrompt(packet: BuildRequirementsPacket): string {
  if (packet.triggeredFamilies.length === 0) return "";

  const lines = [
    "",
    "--- Coworker Requirements Packet ---",
    `Context policy: ${packet.contextPolicy}`,
    `Triggered families: ${packet.triggeredFamilies.join(", ")}`,
    "",
    "Required coworker offers:",
    ...packet.requiredCoworkerOffers.map(
      (offer) => `- ${offer.offerKey}: ${offer.title} (${offer.coworkerFamilies.join(", ")}) - ${offer.reason}`,
    ),
    ...formatSection("Obligations", packet.obligations),
    ...formatSection("Controls and acceptance criteria", packet.controls),
    ...formatSection("Prohibited patterns", packet.prohibitedPatterns),
    ...formatSection("Provider requirements", packet.providerRequirements),
    ...formatSection("Cost and renewal tracking", packet.costTracking),
    ...formatSection("Required approvals", packet.approvals),
    ...formatSection("Data boundary and retention", packet.dataBoundaries),
    ...formatSection("Citations / policy sources", packet.citations),
    "Plan/review instruction: include these packet items in the build plan, implementation guardrails, verification evidence, and acceptance review. If a required approval or provider context is missing, mark the build as needs-human instead of assuming the dependency is available.",
  ];

  return lines.join("\n");
}

function buildCorpus(input: BuildRequirementsInput): string {
  const values: string[] = [];
  values.push(input.title ?? "");
  values.push(input.businessContext ?? "");
  values.push(input.scoutFindings ?? "");
  if (input.brief) {
    values.push(input.brief.title ?? "");
    values.push(input.brief.description ?? "");
    values.push(input.brief.dataNeeds ?? "");
    values.push(...(input.brief.inputs ?? []));
    values.push(...(input.brief.acceptanceCriteria ?? []));
  }
  if (input.designDoc) {
    values.push(input.designDoc.problemStatement ?? "");
    values.push(input.designDoc.dataModel ?? "");
    values.push(input.designDoc.proposedApproach ?? "");
    values.push(...(input.designDoc.acceptanceCriteria ?? []));
  }
  if (input.buildPlan) {
    for (const task of input.buildPlan.tasks ?? []) {
      values.push(task.title ?? "");
      values.push(task.testFirst ?? "");
      values.push(task.implement ?? "");
      values.push(task.verify ?? "");
    }
  }
  if (input.runningSpec) {
    values.push(JSON.stringify(input.runningSpec));
  }
  return values.join("\n");
}

function formatSection(title: string, values: string[]): string[] {
  if (values.length === 0) return [];
  return ["", `${title}:`, ...values.map((value) => `- ${value}`)];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
