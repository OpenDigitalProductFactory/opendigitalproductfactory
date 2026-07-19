# AI Provider Suitability Routing, Onboarding Recommendations, And Vertical Granularity

| Field | Value |
| --- | --- |
| Status | Draft design |
| Date | 2026-07-19 |
| Owner surface | Platform AI, onboarding, archetype operations, compliance |
| Work capsule | WC-3851CAF8 |
| Prompt source | User rant at `C:/Users/Mark Bodman/OneDrive/Desktop/rant.txt` plus follow-up direction |
| Governing principle | [Ground New Work In Existing Platform](../../founder-kernel/wiki/principles/consult-specs-first.md) |
| Scope | Provider suitability policy, onboarding recommendation flow, compliance-aware AI routing, and next-layer archetype/value-stream/job granularity |
| Out of scope | Code implementation, provider legal review, definitive legal advice, replacing the existing router |

## 1. Executive Summary

DPF should add a governed **AI Provider Suitability** layer above the existing routing substrate.

The layer answers one practical question for every install and every AI task:

> Which capable AI providers may safely handle this task for this business, in this location, with this data, for this job and value-stream stage?

The answer must not be a hard provider pin. DPF already has a dynamic router, cost-per-success ranking, provider health, activity contracts, local provider discovery, compliance scope capture, operational value-stream derivation, and occupation profiles. The missing layer is a policy compiler that turns business context and vertical work context into bounded routing constraints.

The strategic position:

> DPF routes each AI task to the safest capable provider: local when privacy, residency, or contract posture demands it; hosted when quality, parallelism, or capability demands it; and always under the customer's business, location, industry, and compliance constraints.

This preserves DPF's local-sovereign posture without overstating local inference. Local models are a privacy and offline floor. Hosted frontier, hosted open-weight, and router-backed endpoints remain necessary for long-context, tool-heavy, multimodal, high-quality, and parallel work.

This design is an incremental layer over prior DPF routing, onboarding, archetype, occupation, compliance, and value-stream work. It supersedes only older assumptions that provider setup is mostly "connect provider plus route by quality/cost"; it does not supersede the existing router, archetype model, activity contract, compliance library, or occupation design.

## 2. Rant Distillation

The transcript's useful signal is not "open-weight models replace hosted AI." It is more nuanced:

- Open-weight models matter because they create model/provider competition and reduce lock-in.
- "Open-weight" does not mean "practical to run locally" for frontier-scale workloads.
- Local inference has hidden costs: hardware, electricity, heat, idle capacity, weak parallelism, model reload time, and operational upkeep.
- Token price alone is the wrong business metric. DPF should optimize **cost per successful work outcome**, including retries, latency, context failures, missing tool support, and human correction.
- Hosted open-weight providers and routers matter because they let DPF use diverse capacity without directly managing all hardware.
- Local inference is still essential for privacy, offline, restricted data, short summaries, low-risk local tasks, and customer confidence.
- Regulated industries need routing restrictions derived from law, contract posture, geography, and data sensitivity, not from generic provider popularity.

DPF implication: local-first is a policy preference, not a universal execution target. The platform should prefer self-hosted/local when viable, but "viable" includes quality, latency, capacity, parallelism, evidence, and compliance.

## 3. Current DPF Substrate

DPF already has the right primitive families.

### 3.1 Provider And Routing Substrate

- `apps/web/lib/routing/request-contract.ts` defines `RequestContract` with sensitivity, modalities, required capabilities, budget posture, allowed providers, and residency policy.
- `apps/web/lib/routing/pipeline-v2.ts` keeps endpoint selection centralized. It hard-filters by status, model class, sensitivity clearance, context, capability, local-only residency, and rate capacity, then ranks by cost per success.
- `apps/web/lib/routing/activity-contract.ts` and `apps/web/lib/routing/activity-compiler.ts` add activity-level routing hints for class, risk, token envelope, distribution shape, and success shape.
- `apps/web/lib/routing/adapter-openrouter.ts` parses OpenRouter model discovery metadata, pricing, modalities, supported parameters, and model cards.
- `packages/db/data/providers-registry.json` includes direct providers, local providers, OpenRouter, LiteLLM, and Z.ai/GLM provider entries.
- `docs/user-guide/ai-workforce/model-routing-lifecycle.md` documents model discovery, tier floors, cost-per-success ranking, and local/basic model behavior.

Design implication: this spec must not create a second router. It should add demand-side policy constraints and metadata that feed the existing router.

Implementation caveat: `RequestContract.allowedProviders` is currently inferred and tested at the contract boundary, but the inspected `pipeline-v2` hard filter only enforces `residencyPolicy === "local_only"` directly. The first implementation slice must either hard-filter `allowedProviders` in `getExclusionReasonV2()` or convert allow/deny provider constraints into `PolicyRuleEval` before the V2 pipeline runs. Until that is fixed, onboarding recommendations cannot be claimed as route-enforced provider fences.

### 3.2 Business, Compliance, And Onboarding Substrate

- `BusinessContext` already captures `operatesIn`, `sellsTo`, `employsIn`, `dataResidency`, `handlesCardPayments`, `listingStatus`, `stateCode`, company size, stage, geographic scope, and source system.
- `StorefrontConfig.archetypeId` is the primary business-shape source of truth. Multi-archetype composition exists for secondary service lines.
- `apps/web/lib/compliance-library.ts` classifies regulations against archetype and region profile as applies, review, or reference.
- `apps/web/lib/autonomy/regulatory-autonomy-runtime.ts` already resolves region profile plus archetype into autonomy ceilings.
- `apps/web/lib/actions/setup-constants.ts` makes first-run setup visit real platform routes, including `ai-providers` and `business-context`.

Design implication: onboarding should enrich `BusinessContext` and provider setup recommendations. It should not introduce a disconnected questionnaire table unless persistence needs exceed the existing context record.

### 3.3 Vertical Granularity Substrate

- `packages/storefront-templates/src/operational-value-stream.ts` derives the universal operational stages: attract, capture, qualify, deliver, settle, retain, trust-compliance, operate-improve, and return-inspect.
- `packages/storefront-templates/src/twin-value-stream.ts` binds twin queues/zones to operational value-stream stages.
- `OccupationProfile` in `packages/db/prisma/schema.prisma` and `packages/db/data/occupation_registry.json` introduces an archetype-scoped human job dimension.
- `docs/architecture/archetype-business-value-streams.md` describes 95 seeded archetypes across 21 categories and explains load-bearing stages.
- `docs/superpowers/specs/2026-07-16-employee-occupation-onboarding-and-role-tailored-workspace-design.md` defines occupation as a focus layer over RBAC.

Design implication: the next granularity layer should be a matrix of `archetype + value-stream stage + occupation/job + governed data profile + activity class`, compiled into AI route policy.

### 3.4 Canonical Ownership And Predecessor Ledger

This design composes the following shipped programs. Implementers must re-check their current state before each BI starts and must not create parallel registries, policy engines, setup flows, or routing passes.

| Concern | Canonical owner to extend | Predecessor PRs | This design's responsibility |
| --- | --- | --- | --- |
| Data identity, classification, purpose, residency, and policy decision | `apps/web/lib/govern/data/*`; `EP-DATA-GOVERNANCE`, especially `BI-DG-002`, `BI-DG-003`, `BI-DG-011`, `BI-DG-012` | [#3185](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3185), [#3251](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3251), [#3255](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3255) | Bind AI work to governed assets/fields/purpose and translate the existing PDP result into routing constraints. |
| Jurisdiction capture and regulatory applicability | `BusinessContext.operatesIn/sellsTo/employsIn/dataResidency`; `packages/db/src/regulation-applicability.ts`; `apps/web/lib/compliance-library.ts` | [#2030](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/2030), [#2095](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/2095), [#2562](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/2562) | Consume declared regional bases and applicable regulation results; do not add a competing location or regulation model. |
| Cost/quality/time posture | `apps/web/lib/golden-triangle/*`; `EP-GOLDEN-TRIANGLE` | [#2284](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/2284) | Apply hard suitability constraints before Golden Triangle preferences; preserve its precedence and fail-closed rules. |
| Endpoint routing and capacity | `RequestContract`, `routeEndpointV2`, provider capacity and health loaders | [#3034](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3034), [#3145](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3145) | Add load-bearing allow/deny and trust constraints to the existing hard-filter/composition path. |
| Task capability and specialist ownership | `ActivityContract`, planner capability broker, specialist router | [#3224](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3224), [#3227](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3227) | Consume task/activity facts as suitability inputs; do not confuse capability attachment or coworker delegation with provider selection. |
| Archetype, occupation, and value-stream context | `StorefrontConfig.archetypeId`, `OccupationProfile`, `deriveOperationalValueStream()`, `deriveTwinValueStreamBinding()` | [#3114](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3114), [#3135](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3135), [#3194](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3194), [#3063](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3063), [#3067](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3067) | Derive a work-context overlay; do not create another vertical, persona, job, or stage taxonomy. |
| Runtime capability and provider health | capability catalog, provider health projection, governed runtime resolver | [#3262](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3262), [#3266](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3266) | Reuse live availability/health as route facts; suitability never declares a provider operational by itself. |

The live planning owner for this program is `EP-AI-PROVIDER-SUITABILITY`. The implementation plan is `docs/superpowers/plans/2026-07-19-ai-provider-suitability-routing.md`; its BI map is normative for delivery order and cross-program dependencies.

## 4. Research And Benchmarking

### 4.1 Provider Routing And Router Controls

OpenRouter exposes request-level provider routing controls including explicit provider order, provider allow/deny lists, fallback behavior, sorting, quantization filters, and parameter requirements. It also exposes privacy controls such as Zero Data Retention and provider data-collection filters. Sources:

- [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [OpenRouter provider logging](https://openrouter.ai/docs/guides/privacy/provider-logging)
- [OpenRouter data residency article](https://openrouter.ai/blog/insights/ai-data-residency)
- [OpenRouter model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)
- [OpenRouter sovereign AI](https://openrouter.ai/docs/guides/features/sovereign-ai)
- [OpenRouter router metadata](https://openrouter.ai/docs/guides/features/router-metadata)

Adopt:

- Treat OpenRouter as a router provider whose underlying endpoint matters.
- Compile DPF trust requirements into OpenRouter `provider` settings when using OpenRouter.
- Use `zdr`, `data_collection: "deny"`, `only`, `ignore`, `order`, and fallback controls when the policy requires them.
- Treat EU in-region routing as a distinct enterprise-enabled endpoint and account entitlement. OpenRouter's EU routing uses `https://eu.openrouter.ai`; provider settings alone do not prove EU residency.
- Request router metadata for auditable OpenRouter calls so DPF can record selected provider/endpoint attempts when OpenRouter returns them.

Reject:

- Treating OpenRouter as one homogeneous provider for regulated workloads.
- Allowing unbounded fallbacks when a task requires a specific trust posture.

### 4.2 Compliance And AI Risk Standards

Official guidance establishes the shape of regulated provider decisions:

- HHS states that HIPAA-regulated cloud service providers that create, receive, maintain, or transmit ePHI for a covered entity or business associate are business associates and require HIPAA-aligned contracts and responsibilities. Source: [HHS HIPAA cloud computing guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html).
- The Department of Education's student privacy guidance says FERPA does not prohibit cloud computing, but schools must use reasonable methods to protect education records, and online education services can require consent or an applicable exception. Sources: [Student Privacy cloud FAQ](https://studentprivacy.ed.gov/sites/default/files/resource_document/file/FAQ_Cloud_Computing_0.pdf), [Protecting Student Privacy](https://studentprivacy.ed.gov/privacy-and-education-technology).
- The FTC Safeguards Rule requires covered financial institutions to protect customer information and oversee service providers. Sources: [FTC Safeguards Rule](https://www.ftc.gov/legal-library/browse/rules/safeguards-rule), [16 CFR Part 314](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-314).
- The EU AI Act creates risk-based duties, including special handling for high-risk AI systems. Sources: [European Commission AI Act overview](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai), [European Commission high-risk guidelines](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-high-risk-systems).
- NIST AI RMF organizes AI risk management around Govern, Map, Measure, and Manage, and profiles can tailor controls to specific settings. Source: [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework).

Adopt:

- Treat industry, geography, data type, autonomy class, and provider contract evidence as route inputs.
- Make provider eligibility auditable and explainable.
- Use NIST AI RMF as the control-plane vocabulary, not as a UX burden for small operators.

Reject:

- Generic "SOC 2 means safe for all data" claims.
- "No training" as a synonym for Zero Data Retention.
- One global compliance answer for every customer.

### 4.3 Commercial And Open-Source Analogues

Commercial patterns:

- Cloud AI platforms such as Azure AI Foundry, AWS Bedrock, and Google Vertex AI push customers toward region, IAM, logging, contract, model-catalog, and evaluation controls. DPF should match the control-plane pattern while staying provider-agnostic.
- Router platforms such as OpenRouter, LiteLLM proxy, Portkey, and Martian separate routing, observability, and policy from model execution.
- Enterprise SaaS onboarding patterns increasingly ask company type, location, current systems, and risk posture to configure defaults.

Open-source patterns:

- LiteLLM supports multi-provider routing, fallback, budgets, and proxy-level controls, making it a useful self-hosted fan-out point.
- vLLM and Ollama/Docker Model Runner are practical local/owned inference substrates, but capacity and model fit remain workload-specific.
- Frappe/ERPNext-style role profiles and DPF's own occupation design show that job-focused setup should configure the working surface, not only RBAC.

Adopt:

- Direct providers where contract posture matters.
- Router-backed providers where diversity, speed of testing, or small-business setup simplicity matters.
- Local providers where restricted data, offline use, or trust requirements dominate.

## 5. Design Goals

1. Compile business and work context into route constraints before model selection.
2. Recommend provider bundles during onboarding from archetype, jurisdictions, data sensitivity, company size, and risk posture.
3. Preserve dynamic routing and cost-per-success ranking inside policy bounds.
4. Support task-specific routing, including local if available and sufficient.
5. Treat OpenRouter coverage as a capability with trust constraints, not as a blanket approval.
6. Add vertical granularity across archetype, value-stream stage, occupation/job, activity class, and governed data/workload profile.
7. Produce user-facing explanations in business language.
8. Persist evidence for regulated provider enablement and review.

## 6. Non-Goals

- Do not give legal advice or certify compliance.
- Do not create hard-coded provider pins as the default strategy.
- Do not assume local inference is free, unlimited, or always adequate.
- Do not replace `routeEndpointV2`.
- Do not fork onboarding into a separate wizard unrelated to the current setup routes.
- Do not add per-industry one-off router branches. Rules must compile from data.

## 7. Core Concept: Provider Suitability Policy

Add a platform-owned policy object:

```ts
type ProviderSuitabilityPolicy = {
  policyId: string;
  organizationId: string;
  source: "onboarding" | "admin" | "regulatory-review" | "default";
  businessProfile: {
    archetypeId: string | null;
    archetypeCategory: string | null;
    compositionArchetypeIds: string[];
    operatesIn: string[];
    sellsTo: string[];
    employsIn: string[];
    dataResidency: string[];
    companySize: string | null;
    companyStage: string | null;
    handlesCardPayments: boolean;
    listingStatus: string | null;
    riskPosture: "conservative" | "balanced" | "progressive" | null;
  };
  workloadProfiles: AiWorkloadDataProfile[];
  providerTrustRequirements: ProviderTrustRequirement[];
  defaultRoutingPosture: RoutingPosture;
  evidenceRequirements: ProviderEvidenceRequirement[];
  generatedAt: string;
};
```

This object can start as a pure read model derived from `BusinessContext`, `StorefrontConfig`, compliance applicability, and provider metadata. Persist it only when operator confirmation, audit history, or admin override needs a durable snapshot.

### 7.1 Governed Data Profiles And AI Workload Classes

DPF already has the canonical data-control vocabulary in `apps/web/lib/govern/data/taxonomy.ts`: `DataAssetId`, `DataFieldId`, `DataSensitivity`, `DataCategory`, `ProcessingPurposeKey`, `ResidencyClassKey`, and related policy types. Provider suitability must consume those types and the existing data policy decision point. It must not introduce another data-class registry.

The business labels below remain useful as **AI workload classes**: compact derivation keys that map archetype/activity context to governed assets, fields, purpose, and regulatory posture. They are not authoritative classifications.

```ts
type AiWorkloadClassKey =
  | "public-marketing"
  | "internal-operations"
  | "customer-records"
  | "employee-records"
  | "payments-finance"
  | "health-phi"
  | "student-records"
  | "legal-privileged"
  | "security-logs"
  | "public-sector-records"
  | "regulated-decisioning"
  | "source-code"
  | "secrets-credentials";

type AiWorkloadDataProfile = {
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
```

Initial mapping examples:

| Archetype/category signal | Default sensitive classes |
| --- | --- |
| healthcare-wellness | `health-phi`, `customer-records`, `payments-finance` |
| education-training | `student-records`, `customer-records`, `employee-records` |
| banking-financial-services | `payments-finance`, `customer-records`, `regulated-decisioning` |
| public-sector | `public-sector-records`, `employee-records`, `regulated-decisioning` |
| security-services | `security-logs`, `customer-records` |
| professional-services legal/accounting variants | `legal-privileged`, `payments-finance`, `customer-records` |
| software-platform / Build Studio | `source-code`, `secrets-credentials`, `customer-records` when tenant data is present |

The workload class helps choose defaults and explanations. The governed profile and PDP decision are authoritative. `RequestContract.sensitivity` remains the coarse routing clearance, while PDP obligations and provider trust requirements compile into hard route constraints. Unknown classification or missing processing authority must retain the data-governance evaluator's deny/review posture; provider suitability cannot downgrade it.

### 7.2 Provider Trust Facts

Extend provider/model metadata with trust facts. These are facts or unknowns, not marketing copy:

```ts
type ProviderTrustFacts = {
  providerId: string;
  category: "direct" | "router" | "local" | "self-hosted";
  jurisdictions: string[];
  externalEgress: "none" | "provider-cloud" | "router-cloud" | "self-hosted-network" | "unknown";
  externalTrainingUse: "denied" | "allowed" | "configurable" | "not-applicable" | "unknown";
  platformRetention: "route-logs" | "chat-history" | "telemetry" | "operator-configured" | "unknown";
  supportsZdr: boolean | null;
  supportsNoTraining: boolean | null;
  supportsRegionalRouting: boolean | null;
  supportedRegions: string[];
  regionalEndpoints: Array<{
    region: string;
    baseUrl: string;
    requiresEnterpriseEnablement: boolean;
    enabledForAccount: boolean | null;
  }>;
  contractEvidence: {
    baaAvailable?: boolean | null;
    baaOnFile?: boolean | null;
    dpaAvailable?: boolean | null;
    dpaOnFile?: boolean | null;
    serviceProviderOversightReviewedAt?: string | null;
    studentDataTermsReviewedAt?: string | null;
    financialCustomerInfoReviewedAt?: string | null;
    fedrampEligible?: boolean | null;
    soc2?: boolean | null;
    iso27001?: boolean | null;
  };
  routerPassThrough?: {
    exposesUnderlyingProvider: boolean;
    supportsProviderAllowlist: boolean;
    supportsProviderBlocklist: boolean;
    supportsZdrFilter: boolean;
    supportsDataCollectionDeny: boolean;
    supportsBoundedFallbacks: boolean;
  };
  evidenceStatus: "unreviewed" | "operator-attested" | "contract-uploaded" | "expired" | "rejected";
  lastReviewedAt: string | null;
};
```

For local providers:

- external egress = none for model execution when the endpoint is truly local
- external training use = not applicable
- platform retention remains governed by DPF's own logs, chat history, telemetry, backups, and operator retention settings
- category = local
- supports ZDR is not applicable; local is stronger than ZDR for egress, but weaker than hosted for capacity and frontier quality

For OpenRouter:

- category = router
- default trust facts must describe the router and the unknown underlying provider
- route eligibility for regulated data requires endpoint/provider constraints, not just `providerId = openrouter`
- EU data residency requires both an EU regional endpoint (`https://eu.openrouter.ai`) and proof that the account has enterprise in-region routing enabled

## 8. Onboarding Recommendation Flow

The setup flow should use the current real-route onboarding model and add a provider suitability recommendation pass.

### 8.1 Questions To Ask

Use plain language and progressive disclosure:

1. Business type: existing archetype selection.
2. Location footprint: where the company operates, sells, employs, and where data must stay.
3. Sensitive work: which kinds of data AI coworkers may help with:
   - public website and marketing only
   - customer messages and records
   - employee records
   - payments, invoices, loans, or financial records
   - health or patient information
   - student or learner information
   - legal, privileged, security, or public-sector records
   - source code or secrets
4. AI posture:
   - private by default
   - best results
   - lowest cost
   - balanced
5. Available local capacity:
   - use this computer/local server for private work when possible
   - do not rely on local models
   - not sure
6. Contract posture:
   - we can use standard hosted providers
   - we need approved vendors/contracts
   - we need local or self-hosted only for some data

Do not ask operators to understand VRAM, quantization, or endpoint slugs during setup. Those belong in advanced provider detail screens.

### 8.2 Recommendation Bundles

The recommendation engine outputs bundles, not one provider:

| Bundle | Default fit | Routing posture |
| --- | --- | --- |
| Private/regulatory cautious | Healthcare, finance, education, public sector, legal, security | Local for restricted classes; direct contracted providers for approved cloud; OpenRouter only with ZDR/no-training/bounded-provider constraints |
| Balanced small business | Trades, beauty, retail, food, fitness, nonprofit with no special data | Hosted strong/frontier provider plus local for restricted/private snippets |
| EU/data residency | EU operations or data residency | Local, EU-region direct providers, self-hosted in-region routes, or router routes using a proven EU endpoint/account entitlement plus provider constraints |
| Build Studio/code | Software platform, MSP, internal platform work | Frontier/strong tool-capable providers; local code models only for low-risk edits or private summaries; secrets stay local |
| Cost-first commodity work | Public marketing drafts, simple summaries, low-risk extraction | Adequate/strong cheaper providers, hosted open-weight endpoints, local when quality is acceptable |

The bundle writes:

- recommended providers to configure
- blocked provider/data combinations
- evidence required before activation for restricted classes
- default `residencyPolicy`
- default `allowedProviders`
- OpenRouter routing controls if OpenRouter is enabled
- operator-readable explanation

### 8.3 User-Facing Copy Pattern

Use business copy:

- "Patient details stay on this machine unless you approve a provider with a healthcare contract."
- "Marketing drafts can use cloud models because they do not contain private customer records."
- "OpenRouter can be used for general work, but regulated records need Zero Data Retention and bounded provider fallback."
- "Local models protect privacy but may be slower or less accurate for complex reasoning."

Avoid:

- "Use model X for HIPAA"
- "Local is free"
- "This provider is compliant"
- "Router means safe"

## 9. Routing Policy Compiler

Create a pure compiler:

```ts
type CompileAiRoutePolicyInput = {
  businessContext: BusinessContextLike;
  storefrontArchetype: StorefrontArchetypeLike | null;
  archetypeComposition: StorefrontArchetypeLike[];
  occupationKey?: string | null;
  valueStreamStage?: OperationalValueStreamStageKey | null;
  activityContract?: ActivityContract | null;
  workloadProfiles: AiWorkloadDataProfile[];
  dataPolicyDecision: DataPolicyDecision;
  taskType: string;
  routeContext?: Partial<RouteContextHints>;
};

type CompiledAiRoutePolicy = {
  sensitivity: "public" | "internal" | "confidential" | "restricted";
  residencyPolicy: "local_only" | "approved_cloud" | "any_enabled";
  allowedProviders?: string[];
  deniedProviders?: string[];
  providerRequirements: ProviderTrustRequirement[];
  requiredBaseUrl?: string;
  openRouterProviderSettings?: OpenRouterProviderSettings;
  evidenceRequirements: ProviderEvidenceRequirement[];
  explanation: RoutePolicyExplanation;
};
```

The compiler feeds `inferContract()` through `routeContext`. It also passes provider-specific execution settings into adapters where supported.

### 9.1 Route Rules

Initial deterministic rules:

| Condition | Route policy |
| --- | --- |
| workload profile includes `secrets-credentials` and governed fields remain restricted | `local_only` unless a specifically approved vault-safe provider exists |
| healthcare + `health-phi` | local or approved cloud provider with contract evidence; OpenRouter only when bounded to eligible ZDR/no-training endpoints and contract posture permits |
| education + `student-records` | local or approved provider; require disclosure/evidence review for hosted providers |
| finance + `payments-finance` or GLBA-like customer info | approved provider only; require service-provider oversight evidence |
| EU data residency | local, self-hosted in-region, region-constrained approved direct provider, or enterprise-enabled OpenRouter EU base URL with bounded providers |
| public marketing | any enabled capable provider; cost-first allowed |
| activity risk high/critical | raise tier floor and require review/evaluator; do not relax privacy controls |
| value-stream stage `trust-compliance` | raise sensitivity at least to confidential unless the governed profile is explicitly public |
| occupation includes front-desk/field roles | do not widen authority; inherit governed data references and workload hints from the tool/action being performed |

### 9.2 OpenRouter Adapter Policy

When the selected provider is OpenRouter, DPF should compile trust posture into request settings:

```ts
type OpenRouterProviderSettings = {
  only?: string[];
  ignore?: string[];
  order?: string[];
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
  data_collection?: "allow" | "deny";
  zdr?: boolean;
  sort?: "price" | "throughput" | "latency";
};
```

Examples:

- Regulated/private: `{ zdr: true, data_collection: "deny", allow_fallbacks: false, only: approvedEndpointSlugs }`
- Cost-first public: `{ sort: "price", allow_fallbacks: true }`
- Latency-first general: `{ sort: "latency", allow_fallbacks: true }`
- Provider-specific eval: `{ only: [candidateProvider], require_parameters: true, allow_fallbacks: false }`

The adapter must record the underlying provider returned by OpenRouter when available. If unavailable, the route explanation should say the underlying provider was not proven.

OpenRouter calls that need auditability must opt into router metadata with `X-OpenRouter-Metadata: enabled` and parse the returned `openrouter_metadata` object permissively. The stored route evidence should include selected endpoint/provider attempts when present, and explicitly mark `underlyingProviderEvidence = "not-returned"` when metadata is absent. Restricted routes must not rely on unproven underlying-provider identity.

## 10. Vertical Granularity Matrix

The next layer of DPF granularity is:

```text
archetype/category
  -> operational value-stream stage
    -> occupation/job
      -> activity class
        -> governed data profile / workload class
          -> AI provider suitability policy
```

This does three things:

1. It lets DPF route a "summarize today's dental intake forms" task differently from "draft public copy for the dental website."
2. It lets DPF recommend setup differently for a dentist, field dispatcher, banker, school administrator, and MSP owner.
3. It lets DPF explain why a route happened in the language of work, not model plumbing.

### 10.1 Example Matrix Rows

| Archetype | Stage | Occupation/job | Activity | AI workload class (mapped to governed data profile) | Default provider posture |
| --- | --- | --- | --- | --- | --- |
| dental-practice | deliver | dental-hygienist | summarize visit notes | health-phi | local or approved cloud with contract evidence |
| dental-practice | attract | owner/marketing | draft website copy | public-marketing | any enabled capable provider, cost-balanced |
| trades-maintenance | qualify | field-dispatcher | assign urgent job | customer-records | approved cloud or local if capable; tool-capable strong tier |
| banking-financial-services | capture | loan officer | summarize application | payments-finance, regulated-decisioning | approved provider only; no unbounded router fallback |
| education-training | retain | instructor/admin | message families about progress | student-records | local or approved provider; audit logging |
| software-platform | operate-improve | platform engineer | code edit | source-code, secrets-credentials maybe | frontier tool-capable provider for code; local-only for secrets |
| public-sector | trust-compliance | clerk | records request response | public-sector-records | approved provider or local; jurisdiction policy review |

### 10.2 Where To Store The Matrix

Do not start with a giant hand-authored table for every archetype/job/task combination.

Use derivation first:

- archetype/category from `StorefrontArchetype`
- stage from `deriveOperationalValueStream()`
- occupation from `OccupationProfile`
- activity from `ActivityContract`
- governed assets/fields/purpose from `apps/web/lib/govern/data/*` and activity/tool metadata
- workload class from route, stage, archetype, and occupation defaults; it never overrides governed classification
- regulation posture from `compliance-library` and `regulatory-autonomy-runtime`
- provider facts from provider trust catalog

Only persist overrides when:

- an operator approves a different posture
- a vertical archetype needs a specific rule not derivable from category defaults
- a regulator/contract evidence requirement must be audited
- production outcomes show a route should be promoted or degraded

## 11. Platform Work Plan

This is the design sequence, not an implementation checklist.

### Phase 0: Reconciliation, Route Enforcement, And Policy Compiler (`BI-AIPS-001` to `BI-AIPS-003`)

Create the trust fact vocabulary and a pure policy compiler.

Key work:

- Re-audit all predecessor programs in §3.4 and publish the canonical ownership/delta map (`BI-AIPS-001`).
- Make `allowedProviders` and a typed `deniedProviders` load-bearing in the V2 routing hard filter (`BI-AIPS-002`).
- Add typed provider trust facts without duplicating the provider registry, data-governance spine, or provider-health projection (`BI-AIPS-003`).
- Compile provider suitability from business context, archetype, regulatory applicability, governed data profile/PDP result, and activity.
- Emit route context hints for existing `inferContract()`.
- Enforce provider allow/deny constraints in the V2 routing path. `allowedProviders` already exists on `RequestContract`; Phase 0 must make allowlists and denylists load-bearing through either `getExclusionReasonV2()` or policy-rule compilation.
- Produce explanation objects for UI and audit.

Acceptance:

- Unit tests prove healthcare/education/finance/public/general cases compile to distinct routing policies.
- No call site bypasses `routeEndpointV2`.
- A compiled `allowedProviders` fence excludes every non-allowed endpoint in `routeEndpointV2`.
- A compiled `deniedProviders` fence excludes a denied endpoint even when it is cheapest, fastest, or otherwise capable.
- Unknown provider trust facts produce review/blocked posture for restricted data, not silent approval.

### Phase 1: Onboarding Recommendations (`BI-AIPS-004`)

Extend setup around `ai-providers` and `business-context`.

Key work:

- Ask the sensitive-data and AI-posture questions.
- Store answers in `BusinessContext` where they are durable organization context, or in a minimal adjacent table if repeated confirmation history is required.
- Show provider recommendation cards with "recommended", "allowed for general work", "requires review", and "not for restricted data" states.
- Create finance/compliance follow-up work items when evidence is required.

Acceptance:

- A dental/healthcare install receives local-first or approved-cloud recommendations for patient data.
- A general retail install receives a balanced hosted/local recommendation without unnecessary compliance friction.
- An EU/data-residency install receives region-aware warning copy.
- The UI never says a provider is legally compliant; it says what evidence is needed.

### Phase 2: OpenRouter Policy Pass-Through (`BI-AIPS-005`)

Upgrade OpenRouter from "many models behind one key" to "bounded router under DPF policy."

Key work:

- Carry compiled OpenRouter provider settings in the execution plan.
- Pass request-level provider controls to OpenRouter through the actual chat/completions request body, not only through discovery metadata or stored recipe settings.
- Use the required regional base URL when policy requires it; EU data-residency routes must call `https://eu.openrouter.ai` only when enterprise enablement is attested for the account.
- Send `X-OpenRouter-Metadata: enabled` for auditable router routes and persist selected provider/attempt metadata when returned.
- Capture returned underlying provider identity where available.
- Treat unbounded fallback as disallowed for restricted classes.

Acceptance:

- Restricted route tests prove OpenRouter requests include ZDR/no-training/bounded fallback controls.
- EU-residency route tests prove the OpenRouter request uses the EU base URL and fails closed when enterprise enablement is unknown.
- Router-metadata tests prove DPF requests metadata and records selected provider/attempt evidence when returned.
- Public/cost-first tests prove OpenRouter can still use price/latency routing.
- Route decision logs explain both DPF's provider and the underlying router selection.
- If the adapter cannot prove provider-setting pass-through for a request, the route is not eligible for restricted data.

### Phase 3: Vertical Matrix Integration (`BI-AIPS-006`)

Connect provider policy to activity/value-stream/occupation granularity.

Key work:

- Bind high-risk tools/actions/routes to governed assets, fields, purpose, and an optional workload class.
- Let `ActivityContract` carry governed data references or route-policy hints without becoming a classification authority.
- Derive stage-aware defaults from operational value stream and archetype category.
- Teach occupation onboarding and coworker rosters which governed data profiles and workload classes their common tasks touch.

Acceptance:

- Same provider can be allowed for marketing copy but blocked for PHI/student/financial data in the same install.
- Workbench explanations include stage and job context when available.
- Occupation never widens RBAC or tool grants.

### Phase 4: Evidence And Continuous Suitability (`BI-AIPS-007` and `BI-AIPS-008`)

Make provider suitability an ongoing operational process.

Key work:

- Add provider evidence records: BAA/DPA, retention review, no-training/ZDR attestation, regional routing proof, review expiry.
- Use telemetry to update cost-per-success by activity/workload class, not only provider/model.
- Surface expiring evidence and provider drift in AI Workforce and Finance.
- Feed approved changes back into policy compiler.

Acceptance:

- Enabling a provider for restricted classes requires evidence or an explicit admin attestation.
- Expired evidence downgrades eligibility for restricted classes.
- Activity outcomes can promote/degrade provider recommendations without rewriting rules.

### 11.1 Delivery Dependency Graph

```text
BI-AIPS-001 substrate reconciliation
  -> BI-AIPS-002 route allow/deny enforcement
  -> BI-AIPS-003 trust facts + pure suitability compiler
       -> BI-AIPS-004 onboarding recommendations
       -> BI-AIPS-005 OpenRouter bounded pass-through
       -> BI-AIPS-006 vertical/activity data bindings
            -> BI-AIPS-007 evidence, expiry, and route receipts
                 -> BI-AIPS-008 continuous suitability and rollout completion
```

`BI-AIPS-002` may proceed after the reconciliation BI because it repairs an already-declared routing contract. `BI-AIPS-004`, `BI-AIPS-005`, and `BI-AIPS-006` can then proceed in parallel over the compiler contract, but restricted OpenRouter recommendations stay disabled until `BI-AIPS-005` proves pass-through and evidence capture. `BI-AIPS-007` owns durable trust evidence and receipt integration; earlier phases use derived facts and explicit unknown/review states rather than creating temporary evidence stores.

## 12. UX Shape

### 12.1 Setup

The setup UX should feel like a business advisor, not a cloud security questionnaire.

Recommended layout:

- concise question step
- recommendation summary
- provider cards grouped by "use now", "use after review", "not recommended for this data"
- plain-English reasons
- advanced drawer for technical details

Provider card states:

- Ready for general work
- Ready for private local work
- Needs account setup
- Needs contract/evidence
- Not recommended for restricted data
- Degraded or needs billing/reauth action

### 12.2 AI Workforce Provider Detail

Add a "What this provider may handle" panel:

- allowed governed workload profiles
- blocked governed workload profiles
- evidence on file
- last reviewed date
- underlying router controls for router providers
- recent route outcomes by activity class

### 12.3 Routing Workbench / Operations Map

Extend the existing activity workbench:

- show business context applied
- show governed workload/data context
- show stage/job when available
- show selected provider/model
- show excluded providers and why
- show cost-per-success and confidence
- show fallback constraints

Operator text example:

> "This dental intake summary stayed local because it contains patient information and no approved healthcare cloud provider is on file."

Admin detail:

> `workloadClasses=["health-phi"]`, `governedSensitivity="restricted"`, `residencyPolicy="local_only"`, `excluded=openrouter: contract evidence missing; anthropic: BAA not attested`

## 13. Data And Architecture Decisions

### Decision 1: Compile Policy, Do Not Fork Routing

`routeEndpointV2` remains the endpoint selector. Provider suitability narrows and annotates the request; routing still ranks eligible endpoints.

### Decision 2: Start Derived, Persist Evidence

The policy itself starts as a derived read model. Evidence, operator overrides, and expiry require persistence.

### Decision 3: Router Providers Need Underlying Endpoint Policy

OpenRouter and LiteLLM are not single trust domains for regulated routing. DPF must account for the underlying provider or constrain the router to acceptable endpoints.

### Decision 4: AI Workload Class Is An Overlay, Not Data Classification

`restricted` is not enough, but PHI, student records, financial customer information, source code, and public-sector records must resolve through the canonical data-governance assets, fields, categories, purposes, residency classes, and PDP. `AiWorkloadClassKey` supplies business semantics and defaults only.

### Decision 5: Vertical Granularity Uses Existing Lenses

Archetype, value-stream stage, and occupation already exist or are in-flight. AI policy should compose onto them instead of inventing another vertical model.

## 14. Security And Privacy Risks

| Risk | Mitigation |
| --- | --- |
| Provider metadata goes stale | add last-reviewed date, evidence expiry, and periodic review tasks |
| Operator misunderstands recommendation as legal certification | use "recommended / requires review / evidence needed" language, not "compliant" |
| Router fallback leaks regulated data to an unapproved underlying provider | bounded fallback, allowlists, ZDR/no-training filters, route logs |
| Local model selected for work it cannot do well | preserve quality tier and cost-per-success ranking inside local-only constraints; escalate to human when no capable local route exists |
| Workload overlay conflicts with governed classification | governed asset/field classification and PDP always win; unknown or conflicting context fails to review/deny |
| Occupation policy widens access | occupation focuses UI only; RBAC and tool grants remain security boundary |

## 15. Testing Strategy

Unit tests:

- policy compiler for healthcare, education, finance, public-sector, EU, and general small-business cases
- workload-class to governed-profile derivation, including unknown/conflict cases
- data PDP obligations to route-constraint compilation
- OpenRouter provider settings compilation
- OpenRouter regional endpoint/base URL selection
- OpenRouter router metadata request and permissive parsing
- explanation text snapshots for risky cases
- unknown trust facts produce review/blocked outcomes

Integration tests:

- trust-fact seed shape validation
- onboarding recommendation read model from `BusinessContext` and `StorefrontConfig`
- `inferContract()` receives compiled route hints
- `routeEndpointV2` excludes providers outside compiled allow policy
- `routeEndpointV2` excludes providers inside compiled deny policy
- provider evidence expiry changes eligibility
- provider slug validation for OpenRouter `only`, `ignore`, and `order` settings
- migration safety if provider evidence moves from JSON/registry metadata into a table

UX tests:

- setup flow shows recommendation cards in plain language
- provider detail shows allowed/blocked governed workload profiles
- routing workbench shows route reason without raw jargon by default

Docs:

- update `docs/user-guide/ai-workforce/connecting-providers.md`
- update `docs/user-guide/ai-workforce/model-routing-lifecycle.md`
- update `docs/user-guide/market-archetypes.md` if onboarding language changes
- add operator-facing provider suitability docs

## 16. Rollout

1. Ship derived policy compiler with tests and no UI behavior change.
2. Add admin-only preview of provider suitability for current install.
3. Add onboarding recommendation cards.
4. Add OpenRouter bounded routing support.
5. Attach governed data references and workload-class hints to selected high-risk activities/tools.
6. Add evidence workflow and expiry.
7. Expand vertical matrix from priority industries: healthcare, finance, education, public sector, software/MSP, then general SMB categories.

## 17. Open Questions

1. Should provider evidence live on `ModelProvider` metadata first, or in a new `ProviderTrustEvidence` table from day one?
2. Which existing `DataProcessingActivity` and provider evidence records can carry onboarding confirmation history without adding another policy store?
3. What is the minimum provider trust catalog seed for launch: local, OpenAI, Anthropic, Google, Azure, Bedrock, OpenRouter, LiteLLM, Z.ai?
4. Should the first UI be in `/platform/ai/providers`, `/setup`, or the AI Operations Map?
5. Which verticals get the first governed data bindings and workload hints: healthcare, finance, education, source-code/Build Studio, or all four?

## 18. Recommended First Implementation Slice

Build the smallest safe loop:

1. Complete `BI-AIPS-001` and verify current ownership against §3.4.
2. Complete `BI-AIPS-002`: add typed `deniedProviders`, enforce allow/deny in `getExclusionReasonV2()`, and reuse the same filter in readiness previews.
3. Add `AiWorkloadClassKey`, governed profile bindings, and `ProviderTrustFacts` only where existing canonical types do not already own the fact.
4. Add `compileAiProviderSuitabilityPolicy()` as a pure adapter over `BusinessContext`, regulatory applicability, data PDP output, provider facts, and activity context.
5. Add tests for five onboarding profiles: dental practice, retail store, credit union, training company, software platform.
6. Add admin-only provider suitability preview to AI Workforce.
7. Add OpenRouter settings compilation, but keep restricted use disabled until tests prove pass-through behavior, regional endpoint selection, router metadata capture, and evidence persistence.

This gives DPF the strategic control plane without waiting for every vertical/job/workload binding to be perfect.

## 19. Sources

- OpenRouter provider routing: https://openrouter.ai/docs/guides/routing/provider-selection
- OpenRouter provider logging: https://openrouter.ai/docs/guides/privacy/provider-logging
- OpenRouter data residency: https://openrouter.ai/blog/insights/ai-data-residency
- OpenRouter model fallbacks: https://openrouter.ai/docs/guides/routing/model-fallbacks
- OpenRouter sovereign AI: https://openrouter.ai/docs/guides/features/sovereign-ai
- OpenRouter router metadata: https://openrouter.ai/docs/guides/features/router-metadata
- HHS HIPAA cloud guidance: https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html
- Department of Education student privacy cloud FAQ: https://studentprivacy.ed.gov/sites/default/files/resource_document/file/FAQ_Cloud_Computing_0.pdf
- Department of Education privacy and education technology: https://studentprivacy.ed.gov/privacy-and-education-technology
- FTC Safeguards Rule: https://www.ftc.gov/legal-library/browse/rules/safeguards-rule
- 16 CFR Part 314: https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-314
- European Commission AI Act overview: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai
- European Commission high-risk AI guidelines: https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-high-risk-systems
- NIST AI Risk Management Framework: https://www.nist.gov/itl/ai-risk-management-framework
