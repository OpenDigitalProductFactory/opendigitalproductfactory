export const INTEGRATION_BENCHMARK_DOMAINS = [
  "hr_payroll",
  "identity_directory",
  "ticketing_service_desk",
  "rmm_endpoint_device_management",
  "documentation_knowledge_cmdb_assets",
  "crm_sales",
  "accounting_billing_payments",
  "communications_email_chat",
  "project_work_management",
  "cloud_m365_google_security",
] as const;

export type IntegrationBenchmarkDomain = (typeof INTEGRATION_BENCHMARK_DOMAINS)[number];

export const INTEGRATION_TREATMENTS = [
  "native_first_class",
  "generic_connector",
  "bundle_default",
] as const;

export type IntegrationTreatment = (typeof INTEGRATION_TREATMENTS)[number];

export const INTEGRATION_DEPLOYMENT_MODES = ["cloud", "hybrid", "on_prem"] as const;

export type IntegrationDeploymentMode = (typeof INTEGRATION_DEPLOYMENT_MODES)[number];

export const INTEGRATION_PROFILE_TAGS = ["msp"] as const;

export type IntegrationProfileTag = (typeof INTEGRATION_PROFILE_TAGS)[number];

export const INTEGRATION_PRIORITY_TIERS = ["p0_anchor", "p1_expansion", "p2_bundle"] as const;

export type IntegrationPriorityTier = (typeof INTEGRATION_PRIORITY_TIERS)[number];

export const INTEGRATION_BENCHMARK_DOMAIN_LABELS: Record<IntegrationBenchmarkDomain, string> = {
  hr_payroll: "HR / Payroll",
  identity_directory: "Identity / Directory",
  ticketing_service_desk: "Ticketing / Service Desk",
  rmm_endpoint_device_management: "RMM / Endpoint",
  documentation_knowledge_cmdb_assets: "Documentation / CMDB",
  crm_sales: "CRM / Sales",
  accounting_billing_payments: "Accounting / Billing / Payments",
  communications_email_chat: "Communications / Email / Chat",
  project_work_management: "Project / Work Management",
  cloud_m365_google_security: "Cloud / M365 / Google / Security",
};

export const INTEGRATION_TREATMENT_LABELS: Record<IntegrationTreatment, string> = {
  native_first_class: "Native first-class",
  generic_connector: "Generic connector",
  bundle_default: "Bundle default",
};

export const INTEGRATION_DEPLOYMENT_LABELS: Record<IntegrationDeploymentMode, string> = {
  cloud: "Cloud",
  hybrid: "Hybrid",
  on_prem: "On-prem",
};

export interface IntegrationBenchmarkMetadata {
  benchmarkDomains: IntegrationBenchmarkDomain[];
  recommendedTreatment: IntegrationTreatment;
  deploymentModes: IntegrationDeploymentMode[];
  profileTags: IntegrationProfileTag[];
  mspRelevant: boolean;
  crossBusiness: boolean;
  priorityTier: IntegrationPriorityTier;
  metadataSource: "explicit" | "inferred";
}

export interface IntegrationBenchmarkInput {
  name: string;
  slug?: string | null;
  category?: string | null;
  tags?: string[] | null;
  vendor?: string | null;
  rawMetadata?: unknown;
}

export interface IntegrationBenchmarkFilters {
  benchmarkDomain?: IntegrationBenchmarkDomain;
  recommendedTreatment?: IntegrationTreatment;
  deploymentMode?: IntegrationDeploymentMode;
  businessProfile?: IntegrationProfileTag;
  mspRelevant?: boolean;
}

const DOMAIN_TOKEN_MAP: ReadonlyArray<{
  domain: IntegrationBenchmarkDomain;
  tokens: readonly string[];
}> = [
  {
    domain: "hr_payroll",
    tokens: ["hr", "payroll", "hris", "adp", "bamboohr", "gusto", "rippling", "workday"],
  },
  {
    domain: "identity_directory",
    tokens: ["identity", "directory", "sso", "scim", "ldap", "entra", "active-directory", "google-admin"],
  },
  {
    domain: "ticketing_service_desk",
    tokens: ["ticketing", "service-desk", "helpdesk", "itsm", "jira", "freshservice", "zendesk"],
  },
  {
    domain: "rmm_endpoint_device_management",
    tokens: ["rmm", "endpoint", "device-management", "device", "mdm", "ninjaone", "datto"],
  },
  {
    domain: "documentation_knowledge_cmdb_assets",
    tokens: [
      "documentation",
      "knowledge",
      "wiki",
      "cmdb",
      "asset",
      "assets",
      "itglue",
      "hudu",
      "confluence",
      "sharepoint",
    ],
  },
  {
    domain: "crm_sales",
    tokens: ["crm", "sales", "hubspot", "salesforce", "pipeline"],
  },
  {
    domain: "accounting_billing_payments",
    tokens: [
      "finance",
      "financial",
      "accounting",
      "billing",
      "invoice",
      "invoicing",
      "payment",
      "payments",
      "stripe",
      "quickbooks",
      "xero",
    ],
  },
  {
    domain: "communications_email_chat",
    tokens: [
      "email",
      "mail",
      "chat",
      "messaging",
      "communication",
      "communications",
      "teams",
      "slack",
      "outlook",
      "gmail",
    ],
  },
  {
    domain: "project_work_management",
    tokens: ["project", "projects", "task", "tasks", "work", "asana", "clickup", "trello", "monday"],
  },
  {
    domain: "cloud_m365_google_security",
    tokens: [
      "cloud",
      "security",
      "microsoft-365",
      "m365",
      "google-workspace",
      "workspace",
      "defender",
      "azure",
      "google-cloud",
      "storage",
    ],
  },
];

const MSP_RELEVANT_TOKENS = [
  "msp",
  "psa",
  "rmm",
  "helpdesk",
  "ticketing",
  "service-desk",
  "cmdb",
  "asset",
  "documentation",
  "endpoint",
  "security",
  "ninjaone",
  "connectwise",
  "autotask",
  "halopsa",
  "datto",
  "itglue",
  "hudu",
] as const;

const NATIVE_FIRST_CLASS_TOKENS = [
  "hubspot",
  "quickbooks",
  "stripe",
  "slack",
  "teams",
  "outlook",
  "gmail",
  "jira",
  "freshservice",
  "entra",
  "active-directory",
  "google-admin",
] as const;

const ON_PREM_TOKENS = [
  "on-prem",
  "onprem",
  "self-hosted",
  "selfhosted",
  "private-network",
  "lan",
  "ldap",
  "active-directory",
  "windows-server",
] as const;

const HYBRID_TOKENS = ["hybrid", "entra", "google-admin", "microsoft-365", "m365"] as const;

const CROSS_BUSINESS_DOMAINS = new Set<IntegrationBenchmarkDomain>([
  "hr_payroll",
  "identity_directory",
  "ticketing_service_desk",
  "crm_sales",
  "accounting_billing_payments",
  "communications_email_chat",
  "project_work_management",
  "cloud_m365_google_security",
]);

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function unique<T>(values: Iterable<T>): T[] {
  return Array.from(new Set(values));
}

function isDomain(value: unknown): value is IntegrationBenchmarkDomain {
  return typeof value === "string" && (INTEGRATION_BENCHMARK_DOMAINS as readonly string[]).includes(value);
}

function isTreatment(value: unknown): value is IntegrationTreatment {
  return typeof value === "string" && (INTEGRATION_TREATMENTS as readonly string[]).includes(value);
}

function isDeploymentMode(value: unknown): value is IntegrationDeploymentMode {
  return typeof value === "string" && (INTEGRATION_DEPLOYMENT_MODES as readonly string[]).includes(value);
}

function isProfileTag(value: unknown): value is IntegrationProfileTag {
  return typeof value === "string" && (INTEGRATION_PROFILE_TAGS as readonly string[]).includes(value);
}

function isPriorityTier(value: unknown): value is IntegrationPriorityTier {
  return typeof value === "string" && (INTEGRATION_PRIORITY_TIERS as readonly string[]).includes(value);
}

function coerceStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function collectTokens(input: IntegrationBenchmarkInput): string[] {
  const rawPieces = [
    input.name,
    input.slug ?? "",
    input.category ?? "",
    input.vendor ?? "",
    ...(input.tags ?? []),
  ];

  return unique(
    rawPieces
      .flatMap((piece) => piece.toLowerCase().split(/[^a-z0-9]+/g))
      .map((piece) => piece.trim())
      .filter(Boolean)
  );
}

function hasAnyToken(tokens: string[], candidates: readonly string[]): boolean {
  return candidates.some((candidate) => {
    const normalized = candidate.toLowerCase();
    return tokens.includes(normalized) || tokens.join(" ").includes(normalized);
  });
}

function inferDomains(tokens: string[], category?: string | null): IntegrationBenchmarkDomain[] {
  const inferred = new Set<IntegrationBenchmarkDomain>();
  const categoryToken = (category ?? "").toLowerCase();

  for (const entry of DOMAIN_TOKEN_MAP) {
    if (entry.tokens.some((token) => tokens.includes(token) || categoryToken.includes(token))) {
      inferred.add(entry.domain);
    }
  }

  if (categoryToken === "finance") inferred.add("accounting_billing_payments");
  if (categoryToken === "crm") inferred.add("crm_sales");
  if (categoryToken === "communication") inferred.add("communications_email_chat");
  if (categoryToken === "cloud") inferred.add("cloud_m365_google_security");

  return Array.from(inferred);
}

function inferDeploymentModes(tokens: string[]): IntegrationDeploymentMode[] {
  const modes = new Set<IntegrationDeploymentMode>();

  if (hasAnyToken(tokens, ON_PREM_TOKENS)) modes.add("on_prem");
  if (hasAnyToken(tokens, HYBRID_TOKENS)) modes.add("hybrid");
  if (modes.size === 0) modes.add("cloud");

  return Array.from(modes);
}

function inferMspRelevant(tokens: string[], domains: IntegrationBenchmarkDomain[]): boolean {
  if (hasAnyToken(tokens, MSP_RELEVANT_TOKENS)) return true;

  return domains.some((domain) =>
    [
      "identity_directory",
      "ticketing_service_desk",
      "rmm_endpoint_device_management",
      "documentation_knowledge_cmdb_assets",
      "cloud_m365_google_security",
      "communications_email_chat",
      "accounting_billing_payments",
    ].includes(domain)
  );
}

function inferRecommendedTreatment(
  tokens: string[],
  domains: IntegrationBenchmarkDomain[],
  mspRelevant: boolean,
  crossBusiness: boolean
): IntegrationTreatment {
  if (hasAnyToken(tokens, NATIVE_FIRST_CLASS_TOKENS)) return "native_first_class";
  if (
    mspRelevant ||
    domains.some((domain) =>
      [
        "hr_payroll",
        "identity_directory",
        "ticketing_service_desk",
        "rmm_endpoint_device_management",
        "documentation_knowledge_cmdb_assets",
        "project_work_management",
        "cloud_m365_google_security",
      ].includes(domain)
    )
  ) {
    return "generic_connector";
  }
  if (crossBusiness) return "bundle_default";
  return "generic_connector";
}

function inferPriorityTier(
  treatment: IntegrationTreatment,
  crossBusiness: boolean,
  mspRelevant: boolean
): IntegrationPriorityTier {
  if (treatment === "native_first_class") return "p0_anchor";
  if (crossBusiness || mspRelevant) return "p1_expansion";
  return "p2_bundle";
}

function getExplicitBenchmark(rawMetadata: unknown): Partial<IntegrationBenchmarkMetadata> | null {
  const metadata = toRecord(rawMetadata);
  if (!metadata) return null;

  const explicit = toRecord(metadata.dpfBenchmark) ?? toRecord(metadata.integrationBenchmark);
  if (!explicit) return null;

  const benchmarkDomains = coerceStringArray(explicit.benchmarkDomains).filter(isDomain);
  const deploymentModes = coerceStringArray(explicit.deploymentModes).filter(isDeploymentMode);
  const profileTags = coerceStringArray(explicit.profileTags).filter(isProfileTag);

  const result: Partial<IntegrationBenchmarkMetadata> = {};

  if (benchmarkDomains.length > 0) result.benchmarkDomains = benchmarkDomains;
  if (typeof explicit.mspRelevant === "boolean") result.mspRelevant = explicit.mspRelevant;
  if (typeof explicit.crossBusiness === "boolean") result.crossBusiness = explicit.crossBusiness;
  if (deploymentModes.length > 0) result.deploymentModes = deploymentModes;
  if (profileTags.length > 0) result.profileTags = profileTags;
  if (isTreatment(explicit.recommendedTreatment)) {
    result.recommendedTreatment = explicit.recommendedTreatment;
  }
  if (isPriorityTier(explicit.priorityTier)) {
    result.priorityTier = explicit.priorityTier;
  }

  return Object.keys(result).length > 0 ? result : null;
}

export function getIntegrationBenchmarkMetadata(
  input: IntegrationBenchmarkInput
): IntegrationBenchmarkMetadata {
  const tokens = collectTokens(input);
  const inferredDomains = inferDomains(tokens, input.category);
  const inferredCrossBusiness = inferredDomains.some((domain) => CROSS_BUSINESS_DOMAINS.has(domain));
  const inferredMspRelevant = inferMspRelevant(tokens, inferredDomains);
  const inferredTreatment = inferRecommendedTreatment(
    tokens,
    inferredDomains,
    inferredMspRelevant,
    inferredCrossBusiness
  );
  const inferredDeploymentModes = inferDeploymentModes(tokens);
  const explicit = getExplicitBenchmark(input.rawMetadata);

  const benchmarkDomains = explicit?.benchmarkDomains?.length
    ? explicit.benchmarkDomains
    : inferredDomains;
  const mspRelevant = explicit?.mspRelevant ?? inferredMspRelevant;
  const crossBusiness = explicit?.crossBusiness ?? inferredCrossBusiness;
  const deploymentModes = explicit?.deploymentModes?.length
    ? explicit.deploymentModes
    : inferredDeploymentModes;
  const profileTags = unique([
    ...(explicit?.profileTags ?? []),
    ...(mspRelevant ? (["msp"] as const) : []),
  ]);
  const recommendedTreatment = explicit?.recommendedTreatment ?? inferredTreatment;
  const priorityTier =
    explicit?.priorityTier ?? inferPriorityTier(recommendedTreatment, crossBusiness, mspRelevant);

  return {
    benchmarkDomains,
    recommendedTreatment,
    deploymentModes,
    profileTags,
    mspRelevant,
    crossBusiness,
    priorityTier,
    metadataSource: explicit ? "explicit" : "inferred",
  };
}

export function matchesIntegrationBenchmarkFilters(
  metadata: IntegrationBenchmarkMetadata,
  filters?: IntegrationBenchmarkFilters
): boolean {
  if (!filters) return true;
  if (filters.benchmarkDomain && !metadata.benchmarkDomains.includes(filters.benchmarkDomain)) {
    return false;
  }
  if (
    filters.recommendedTreatment &&
    metadata.recommendedTreatment !== filters.recommendedTreatment
  ) {
    return false;
  }
  if (filters.deploymentMode && !metadata.deploymentModes.includes(filters.deploymentMode)) {
    return false;
  }
  if (filters.businessProfile && !metadata.profileTags.includes(filters.businessProfile)) {
    return false;
  }
  if (typeof filters.mspRelevant === "boolean" && metadata.mspRelevant !== filters.mspRelevant) {
    return false;
  }
  return true;
}

export function labelIntegrationBenchmarkDomain(domain: IntegrationBenchmarkDomain): string {
  return INTEGRATION_BENCHMARK_DOMAIN_LABELS[domain];
}

export function labelIntegrationTreatment(treatment: IntegrationTreatment): string {
  return INTEGRATION_TREATMENT_LABELS[treatment];
}

export function labelIntegrationDeploymentMode(mode: IntegrationDeploymentMode): string {
  return INTEGRATION_DEPLOYMENT_LABELS[mode];
}
