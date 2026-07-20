export type ProviderComplianceSourceAuthority = "primary" | "first-party" | "secondary";

export type ProviderComplianceClaimApplicability = {
  providerIds: string[];
  services: string[];
  accountClasses: string[];
  jurisdictions: string[];
  regions: string[];
  workloads: string[];
};

export type ProviderComplianceSourceClaim = {
  claimId: string;
  summary: string;
  appliesTo: ProviderComplianceClaimApplicability;
  conflictKey?: string;
  position?: string;
};

export type ProviderComplianceSourceEntry = {
  sourceKey: string;
  sourceType: "law" | "regulator-guidance" | "provider-terms";
  authority: ProviderComplianceSourceAuthority;
  publisher: string;
  title: string;
  url: string;
  license: string;
  publishedAt?: string;
  retrievedAt: string;
  maxAgeDays: number;
  abstract: string;
  claims: ProviderComplianceSourceClaim[];
};

const ANY = ["*"];

export const PROVIDER_COMPLIANCE_SOURCE_REGISTRY = {
  "eu/gdpr-controller-processor-and-transfers": {
    sourceKey: "eu/gdpr-controller-processor-and-transfers",
    sourceType: "law",
    authority: "primary",
    publisher: "European Union",
    title: "EUR-Lex — General Data Protection Regulation",
    url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
    license: "EU-legal-text-cite-by-reference",
    publishedAt: "2016-05-04",
    retrievedAt: "2026-07-20",
    maxAgeDays: 365,
    abstract: "Official GDPR text, including processor-contract requirements in Article 28 and international-transfer safeguards in Chapter V.",
    claims: [{
      claimId: "eu-controller-processor-contract-required",
      summary: "GDPR Article 28 requires processing by a processor to be governed by a binding contract or other legal act with specified safeguards.",
      appliesTo: {
        providerIds: ANY,
        services: ANY,
        accountClasses: ANY,
        jurisdictions: ["eu", "eea"],
        regions: ANY,
        workloads: ["customer-records", "employee-records", "health-records", "financial-records", "student-records", "public-sector-records"],
      },
    }, {
      claimId: "eu-third-country-transfer-safeguards-required",
      summary: "GDPR Chapter V permits transfers of personal data to third countries only under the conditions and safeguards set out in that chapter.",
      appliesTo: {
        providerIds: ANY,
        services: ANY,
        accountClasses: ANY,
        jurisdictions: ["eu", "eea"],
        regions: ANY,
        workloads: ["customer-records", "employee-records", "health-records", "financial-records", "student-records", "public-sector-records"],
      },
    }],
  },
  "ico/controller-processor-contracts": {
    sourceKey: "ico/controller-processor-contracts",
    sourceType: "regulator-guidance",
    authority: "primary",
    publisher: "UK Information Commissioner's Office",
    title: "ICO — when a controller-processor contract is needed",
    url: "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/when-is-a-contract-needed-and-why-is-it-important/",
    license: "UK-OGL-compatible-citation",
    retrievedAt: "2026-07-20",
    maxAgeDays: 365,
    abstract: "UK regulator guidance that a controller using a processor for personal information needs a binding written contract or other legal act under Article 28.",
    claims: [{
      claimId: "uk-controller-processor-contract-required",
      summary: "A UK GDPR controller using a processor for personal information needs a binding written contract or other legal act for that processing.",
      appliesTo: {
        providerIds: ANY,
        services: ANY,
        accountClasses: ANY,
        jurisdictions: ["uk"],
        regions: ANY,
        workloads: ["customer-records", "employee-records", "health-records", "financial-records", "student-records"],
      },
    }],
  },
  "ico/international-transfers": {
    sourceKey: "ico/international-transfers",
    sourceType: "regulator-guidance",
    authority: "primary",
    publisher: "UK Information Commissioner's Office",
    title: "ICO — are we making a restricted transfer?",
    url: "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/a-guide-to-international-transfers/are-we-making-a-restricted-transfer/",
    license: "UK-OGL-compatible-citation",
    retrievedAt: "2026-07-20",
    maxAgeDays: 180,
    abstract: "UK regulator three-step guidance for identifying restricted transfers, including access from outside the UK and the need for a transfer mechanism.",
    claims: [{
      claimId: "uk-remote-access-can-be-restricted-transfer",
      summary: "Making UK personal information accessible to a separate organisation outside the UK can be a restricted transfer even when the information remains on UK servers.",
      appliesTo: {
        providerIds: ANY,
        services: ANY,
        accountClasses: ANY,
        jurisdictions: ["uk"],
        regions: ANY,
        workloads: ["customer-records", "employee-records", "health-records", "financial-records", "student-records"],
      },
    }],
  },
  "openai/business-data-privacy": {
    sourceKey: "openai/business-data-privacy",
    sourceType: "provider-terms",
    authority: "first-party",
    publisher: "OpenAI",
    title: "OpenAI — business data privacy, security, and compliance",
    url: "https://openai.com/business-data/",
    license: "provider-published-cite-by-reference",
    retrievedAt: "2026-07-20",
    maxAgeDays: 60,
    abstract: "Provider-published data-treatment statements for named OpenAI business products and the API platform; not evidence that a connected account has a specific entitlement or configuration.",
    claims: [{
      claimId: "openai-business-no-training-default",
      summary: "OpenAI states that inputs and outputs from its named business products and API platform are not used for training or improving models by default.",
      appliesTo: {
        providerIds: ["openai"],
        services: ["api-platform", "chatgpt-business", "chatgpt-enterprise", "chatgpt-edu", "chatgpt-healthcare"],
        accountClasses: ["regular", "business-team", "enterprise"],
        jurisdictions: ANY,
        regions: ANY,
        workloads: ANY,
      },
      conflictKey: "openai-training-default",
      position: "excluded-by-default",
    }],
  },
  "anthropic/commercial-training": {
    sourceKey: "anthropic/commercial-training",
    sourceType: "provider-terms",
    authority: "first-party",
    publisher: "Anthropic",
    title: "Anthropic — personal data in model training for commercial products",
    url: "https://privacy.claude.com/en/articles/7996885-how-do-you-use-personal-data-in-model-training",
    license: "provider-published-cite-by-reference",
    publishedAt: "2026-03-16",
    retrievedAt: "2026-07-20",
    maxAgeDays: 60,
    abstract: "Provider-published training information for Claude for Work and the Anthropic API, explicitly separated from consumer products and account plans.",
    claims: [{
      claimId: "anthropic-commercial-training-scope-distinct",
      summary: "Anthropic's commercial training article applies to Claude for Work and the Anthropic API and explicitly directs consumer-product questions to separate guidance.",
      appliesTo: {
        providerIds: ["anthropic"],
        services: ["anthropic-api", "claude-for-work"],
        accountClasses: ["regular", "business-team", "enterprise"],
        jurisdictions: ANY,
        regions: ANY,
        workloads: ANY,
      },
    }],
  },
  "anthropic/consumer-training": {
    sourceKey: "anthropic/consumer-training",
    sourceType: "provider-terms",
    authority: "first-party",
    publisher: "Anthropic",
    title: "Anthropic — consumer product model training controls",
    url: "https://privacy.anthropic.com/en/articles/10023580-is-my-data-used-for-model-training",
    license: "provider-published-cite-by-reference",
    retrievedAt: "2026-07-20",
    maxAgeDays: 60,
    abstract: "Provider-published consumer-product data-treatment guidance; separate from Claude for Work and the Anthropic API.",
    claims: [{
      claimId: "anthropic-consumer-scope-distinct",
      summary: "Anthropic treats consumer plans as a separate product scope from commercial Claude for Work and API services.",
      appliesTo: {
        providerIds: ["anthropic"],
        services: ["claude-consumer", "claude-code-consumer"],
        accountClasses: ["regular"],
        jurisdictions: ANY,
        regions: ANY,
        workloads: ANY,
      },
    }],
  },
} as const satisfies Record<string, ProviderComplianceSourceEntry>;

export function validateProviderComplianceSourceRegistry(
  registry: Record<string, ProviderComplianceSourceEntry>,
): string[] {
  const errors: string[] = [];
  const claimIds = new Set<string>();
  for (const [key, source] of Object.entries(registry)) {
    if (source.sourceKey !== key) errors.push(`${key}: sourceKey mismatch`);
    if (!source.url.startsWith("https://")) errors.push(`${key}: HTTPS URL required`);
    if (!source.publisher.trim()) errors.push(`${key}: publisher required`);
    if (!Number.isFinite(Date.parse(source.retrievedAt))) errors.push(`${key}: invalid retrievedAt`);
    if (source.maxAgeDays <= 0) errors.push(`${key}: maxAgeDays must be positive`);
    if (source.authority === "secondary") errors.push(`${key}: secondary authority is not admissible`);
    for (const claim of source.claims) {
      if (claimIds.has(claim.claimId)) errors.push(`${key}: duplicate claim id ${claim.claimId}`);
      claimIds.add(claim.claimId);
      for (const [axis, values] of Object.entries(claim.appliesTo)) {
        if (values.length === 0) errors.push(`${key}/${claim.claimId}: empty ${axis}`);
      }
      if ((claim.conflictKey && !claim.position) || (!claim.conflictKey && claim.position)) {
        errors.push(`${key}/${claim.claimId}: conflictKey and position must appear together`);
      }
    }
  }
  return errors;
}
