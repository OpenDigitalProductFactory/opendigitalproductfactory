import type { ApplicabilityResult } from "@dpf/db/regulation-applicability";
import type { DataPolicyDecision } from "@/lib/govern/data/policy-decision";
import type {
  DataAssetId,
  DataCategory,
  DataFieldId,
  DataSensitivity,
  ProcessingPurposeKey,
  ResidencyClassKey,
} from "@/lib/govern/data/taxonomy";
import type { PostureOverride } from "@/lib/golden-triangle/types";
import type { RequestContract } from "../request-contract";

export type AiWorkloadClassKey =
  | "public-marketing"
  | "internal-operations"
  | "customer-records"
  | "employee-records"
  | "payments-finance"
  | "health-phi"
  | "student-records"
  | "legal-privileged"
  | "security-logs"
  | "criminal-justice"
  | "safety-sensitive"
  | "youth-sensitive"
  | "public-sector-records"
  | "regulated-decisioning"
  | "source-code"
  | "secrets-credentials";

export type AiWorkloadDataProfile = {
  workloadClass: AiWorkloadClassKey;
  assetIds: DataAssetId[];
  fieldIds?: DataFieldId[];
  sensitivity: DataSensitivity;
  categories: DataCategory[];
  purpose: ProcessingPurposeKey;
  residencyClass: ResidencyClassKey;
  classificationKnown: boolean;
  processingActivityId?: string;
  applicableRegulationIds: string[];
};

export type ProviderCategory = "direct" | "router" | "local" | "self-hosted";
export type ProviderExecutionChannel =
  | "direct-api"
  | "subscription-cli"
  | "hosted-router"
  | "cloud-tenant"
  | "local-runtime";
export type ProviderAccountClass = "regular" | "business-team" | "enterprise" | "unknown";
export type ProviderCommercialBasis =
  | "usage-metered"
  | "subscription-included"
  | "enterprise-contract"
  | "local-compute"
  | "unknown";
export type ProviderConnectionAuthMethod =
  | "api-key"
  | "oauth"
  | "workload-identity"
  | "local"
  | "unknown";

export type ProviderCatalogTrustFacts = {
  /** Runtime provider key. Catalog aliases may share catalogProviderId. */
  providerId: string;
  catalogProviderId: string;
  category: ProviderCategory;
  jurisdictions: string[];
  externalEgress: "none" | "provider-cloud" | "router-cloud" | "self-hosted-network" | "unknown";
  supportsZdr: boolean | null;
  supportsNoTraining: boolean | null;
  supportsRegionalRouting: boolean | null;
  supportedRegions: string[];
  regionalEndpoints: Array<{
    region: string;
    baseUrl: string;
    requiresEnterpriseEnablement: boolean;
  }>;
  routerPassThrough?: {
    exposesUnderlyingProvider: boolean;
    supportsProviderAllowlist: boolean;
    supportsProviderBlocklist: boolean;
    supportsZdrFilter: boolean;
    supportsDataCollectionDeny: boolean;
    supportsBoundedFallbacks: boolean;
  };
};

export type ProviderContractEvidence = {
  supplierContractId?: string | null;
  contractPlanName?: string | null;
  dpaOnFile?: boolean | null;
  baaAvailable?: boolean | null;
  baaOnFile?: boolean | null;
  dpaAvailable?: boolean | null;
  serviceProviderOversightReviewedAt?: string | null;
  studentDataTermsReviewedAt?: string | null;
  financialCustomerInfoReviewedAt?: string | null;
  fedrampEligible?: boolean | null;
  soc2?: boolean | null;
  iso27001?: boolean | null;
};

export type ProviderEntitlements = {
  zeroRetention?: boolean | null;
  noTraining?: boolean | null;
  regionalProcessing?: boolean | null;
  adminAuditControls?: boolean | null;
  enterpriseSupportOrSla?: boolean | null;
  enabledRegions?: string[];
  /** Account-approved OpenRouter endpoint slugs; never inferred from provider marketing. */
  approvedUnderlyingProviderSlugs?: string[];
};

export type ProviderConnectionPosture = {
  providerConnectionId: string;
  providerId: string;
  executionChannel: ProviderExecutionChannel;
  accountClass: ProviderAccountClass;
  commercialBasis: ProviderCommercialBasis;
  authMethod: ProviderConnectionAuthMethod;
  contractEvidence: ProviderContractEvidence;
  entitlements: ProviderEntitlements;
  evidenceStatus: "unreviewed" | "operator-attested" | "contract-uploaded" | "expired" | "rejected";
  lastReviewedAt: string | null;
};

/** Read projection of facts owned by provider/auth/finance/contract setup. */
export type ProviderConnectionSourceFacts = {
  providerConnectionId: string;
  providerId: string;
  providerCategory: ProviderCategory;
  externalEgress: ProviderCatalogTrustFacts["externalEgress"];
  modelProviderAuthMethod: string | null;
  credentialStatus?: string | null;
  cliEngine?: string | null;
  costModel?: string | null;
  cloudTenant?: boolean;
  accountClassAttestation?: ProviderAccountClass;
  commercialBasisAttestation?: ProviderCommercialBasis;
  contractEvidence?: ProviderContractEvidence;
  entitlements?: ProviderEntitlements;
  evidenceStatus?: ProviderConnectionPosture["evidenceStatus"];
  lastReviewedAt?: string | null;
};

export type ProviderTrustFacts = ProviderCatalogTrustFacts & ProviderConnectionPosture;

export type BusinessSuitabilityProfile = {
  organizationId: string;
  archetypeId: string | null;
  archetypeCategory: string | null;
  operatesIn: string[];
  sellsTo: string[];
  employsIn: string[];
  dataResidency: string[];
  riskPosture: "conservative" | "balanced" | "progressive" | null;
};

export type RegulationSuitabilityResult = {
  regulationId: string;
  applicability: ApplicabilityResult;
};

export type ProviderSuitabilityExplanation = {
  code: string;
  message: string;
  providerId?: string;
  providerConnectionId?: string;
};

export type OpenRouterPolicyObligations = {
  requireProviderAllowlist: boolean;
  requireProviderBlocklist: boolean;
  requireZdr: boolean;
  denyDataCollection: boolean;
  requireBoundedFallbacks: boolean;
  requiredRegion: string | null;
  approvedEndpointSlugs: string[];
  providerConnectionId: string | null;
  accountClass: ProviderAccountClass;
  evidenceStatus: ProviderConnectionPosture["evidenceStatus"];
  regionalProcessingEntitled: boolean;
  enabledRegions: string[];
  requiredBaseUrl: string | null;
};

export type ProviderSuitabilityPolicy = {
  policyId: string;
  organizationId: string;
  source: "onboarding" | "admin" | "regulatory-review" | "default";
  effect: "allow" | "review" | "deny";
  allowedProviders: string[];
  deniedProviders: string[];
  allowedProviderConnectionIds: string[];
  deniedProviderConnectionIds: string[];
  residencyPolicy: NonNullable<RequestContract["residencyPolicy"]>;
  openRouterObligations: OpenRouterPolicyObligations | null;
  explanations: ProviderSuitabilityExplanation[];
  compilerVersion: string;
};

export type CompileProviderSuitabilityInput = {
  businessProfile: BusinessSuitabilityProfile;
  workloadProfiles: AiWorkloadDataProfile[];
  dataPolicyDecisions: DataPolicyDecision[];
  regulationResults: RegulationSuitabilityResult[];
  providerFacts: ProviderTrustFacts[];
  source: ProviderSuitabilityPolicy["source"];
  activityClass?: string;
  goldenTrianglePosture?: PostureOverride;
};
