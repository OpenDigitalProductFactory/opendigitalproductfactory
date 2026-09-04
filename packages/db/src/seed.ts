// packages/db/src/seed.ts
import "./load-env.js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { prisma } from "./client.js";
import { Prisma } from "../generated/client/client";
import { parseRoleId, parseAgentTier, parseAgentType, parseAgentPortfolioSlug } from "./seed-helpers.js";
import { resolveAgentIdentity } from "./agent-identity.js";
import { resolvePrincipalSensitivityClearance } from "./principal-sensitivity.js";
import { convergeAgentPrincipals, type AgentPrincipalDb } from "./agent-principal-convergence.js";
import { upsertCoworkerAgentTolerant } from "./coworker-agent-upsert.js";
import { loadFingerprintCatalogIntoDb, defaultCatalogPath } from "./discovery-fingerprint-catalog-loader.js";
import { loadOuiRegistryIntoDb, defaultOuiRegistryPath } from "./mac-oui-loader.js";
import { seedEaArchimate4 } from "./seed-ea-archimate4.js";
import { seedEaBpmn20 } from "./seed-ea-bpmn20.js";
import { seedEaCrossNotation } from "./seed-ea-cross-notation.js";
import { resolveSeedPrice } from "./model-pricing-brackets.js";
import { seedEaReferenceModels } from "./seed-ea-reference-models.js";
import { seedEaStructureRules } from "./seed-ea-structure-rules.js";
import { seedEaSysml2 } from "./seed-ea-sysml2.js";
import { seedEaSysmlAgentAuthority } from "./seed-ea-sysml-agent-authority.js";
import { seedEaSysmlCada } from "./seed-ea-sysml-cada.js";
import { seedEaSysmlDataAuthority } from "./seed-ea-sysml-data-authority.js";
import { projectPlatformCapabilities } from "./portfolio-sources/project-portfolio-source.js";
import { projectAiProviders, projectIntegrations } from "./portfolio-sources/project-external-supply.js";
import { projectSupplyChain } from "./portfolio-sources/project-sbom.js";
import { projectProductDependencyGraph } from "./portfolio-sources/product-dependency.js";
import { projectCoworkerWorkforce } from "./portfolio-sources/project-coworker-workforce.js";
import { projectBomWorkforceSurfaces } from "./portfolio-sources/project-bom-workforce-surfaces.js";
import { backfillBacklogPortfolios } from "./backlog-portfolio.js";
import {
  seedViewpointsForNotation,
  ARCHIMATE_VIEWPOINTS,
  BPMN_VIEWPOINTS,
  SYSML_VIEWPOINTS,
} from "./seed-ea-viewpoints.js";
import { seedGovernanceReferenceData } from "./governance-seed.js";
import {
  COWORKER_AGENT_SEEDS,
  HARDCODED_COWORKER_GRANTS,
  ONBOARDING_AGENT_GRANTS,
  resolveCoworkerLifecycleSeedPolicy,
  seedWorkforceReferenceData,
} from "./workforce-seed.js";
import { seedStorefrontArchetypes } from "./seed-storefront-archetypes.js";
import { seedOccupations } from "./seed-occupations.js";
import { seedPublicSectorCompliance } from "./seed-public-sector-compliance.js";
import { seedCooperativeCompliance } from "./seed-cooperative-compliance.js";
import { seedLawEnforcementCompliance } from "./seed-law-enforcement-compliance.js";
import { seedBankingCompliance } from "./seed-banking-compliance.js";
import { seedUkCorpGovCompliance } from "./seed-uk-corp-gov-compliance.js";
import { seedSoftwareHorizontalCompliance } from "./seed-software-horizontal-compliance.js";
import { seedHrEmploymentCompliance } from "./seed-hr-employment-compliance.js";
import { seedBusinessOperationsCompliance } from "./seed-business-operations-compliance.js";
import { seedVerticalRecurringCompliance } from "./seed-vertical-recurring-compliance.js";
import { seedPeoplePremisesCompliance } from "./seed-people-premises-compliance.js";
import { seedIndustrialVerticalCompliance } from "./seed-industrial-vertical-compliance.js";
import { seedBusinessCapabilityPerspective } from "./business-capability-perspectives.js";
import { seedGeographicData } from "./seed-geographic-data.js";
import { seedTaxJurisdictions } from "./seed-tax-jurisdictions.js";
import { seedLicenseRequirements } from "./seed-license-requirements.js";
import { seedPromptTemplates } from "./seed-prompt-templates.js";
import { seedSkills } from "./seed-skills.js";
import { seedWikiKernel } from "./seed-wiki-kernel.js";
import { seedDecisionPerspective, seedProfessionProfiles } from "./seed-decision-perspective.js";
import { seedProfessionCorpus } from "./seed-profession-corpus.js";
import { backfillProfessionCraftMaterials } from "./profession-material-promotion.js";
import { seedPlatformVoice } from "./seed-platform-voice.js";
import {
  SPEACHES_PROVIDER_ID,
  SPEACHES_MODEL_ID,
  SPEACHES_MODEL_PROFILE_CONFIG,
  SPEACHES_ENDPOINT_PERFORMANCE_BASELINE,
} from "./voice-stt-providers.js";
import { seedDeliberationPatterns } from "./seed-deliberation.js";
import { seedStallThresholds } from "./seed-stall-thresholds.js";
import { ensureDiscoveryTriageScheduledTask } from "./seed-discovery-triage.js";
import { ensureDataModelMirrorScheduledTask } from "./seed-data-model-mirror.js";
import { ensureBookkeepingCycleScheduledTask } from "./seed-bookkeeping-cycle.js";
import { ensureSysmlProjectionScheduledTask } from "./seed-sysml-projection.js";
import { ensureSelfOptimizationSweepScheduledTask } from "./seed-self-optimization-sweep.js";
import { ensureHiveScoutScheduledTask } from "./seed-hive-scout.js";
import { ensureAllBackupScheduledJobs } from "./seed-platform-backup.js";
import { ensureDataRetentionScheduledJob } from "./seed-platform-retention.js";
import { ensureInngestRetentionScheduledJob } from "./seed-platform-inngest-retention.js";
import { ensureContributorInventoryScheduledJob } from "./seed-contributor-inventory.js";
import { seedAgentControlPlaneMaturity } from "./seed-agent-control-plane-maturity.js";
import { seedCoworkerServiceCatalog } from "./coworker-service-catalog-seed.js";
import { syncCapabilities } from "./sync-capabilities.js";
import { defaultGovernanceFor } from "./taxonomy-governance-defaults.js";
import { buildTaxonomyNodeEntries, type TaxonomySeedRow } from "./taxonomy-seed-entries.js";
import {
  AGENT_MODEL_CONFIG_DEFAULTS,
  resolveAgentModelDefaultUpdate,
} from "./agent-model-defaults.js";
import { toModelProfileSeedCreateData } from "./model-profile-seed.js";
import {
  deriveLocalModelCapabilityPrior,
  localInputModalities,
  localOutputModalities,
} from "./local-model-capabilities.js";
import {
  activateProviderWithDefaultConnection,
  ensureDefaultProviderConnection,
} from "./provider-connection.js";
import { seedIntegrationCoverage } from "../scripts/seed-integration-coverage.js";
import { seedAbsorptionPosture } from "./seed-absorption-posture.js";
import {
  loadPlatformSbomFromRepository,
  persistPlatformSbom,
  type PlatformSbomClient,
} from "./platform-sbom-seed.js";
import * as crypto from "crypto";
import bcrypt from "bcryptjs";

const DATA_DIR = join(__dirname, "..", "data");

function readJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, filename), "utf-8")) as T;
}

async function seedRoles(): Promise<void> {
  const registry = readJson<{
    roles: Array<{
      role_id: string;
      role_name: string;
      authority_domain?: string;
      hitl_tier_min?: number;
      escalation_sla_hours?: number;
    }>;
  }>("role_registry.json");

  for (const r of registry.roles) {
    const slaDurationH =
      r.escalation_sla_hours !== undefined && r.escalation_sla_hours >= 0
        ? r.escalation_sla_hours
        : null;

    await prisma.platformRole.upsert({
      where: { roleId: parseRoleId(r.role_id) },
      update: {
        name: r.role_name,
        description: r.authority_domain ?? null,
        hitlTierMin: r.hitl_tier_min ?? 1,
        slaDurationH,
      },
      create: {
        roleId: parseRoleId(r.role_id),
        name: r.role_name,
        description: r.authority_domain ?? null,
        hitlTierMin: r.hitl_tier_min ?? 1,
        slaDurationH,
      },
    });
  }
  console.log(`Seeded ${registry.roles.length} platform roles`);
}

// Registry agent type for seedAgents
interface RegistryAgent {
  agent_id: string;
  agent_name: string;
  displayName?: string;
  kind?: string;
  tier?: string;
  value_stream?: string;
  /**
   * BI-REFACTOR-B6A61421: typed portal hive-mind role
   * (builder|reviewer|architect|tester|operator|specialist). Source of truth for
   * the role the portal-context hive-mind resolver prefers over keyword inference.
   */
  role?: string;
  capability_domain?: string;
  status?: string;
  human_supervisor_id?: string;
  hitl_tier_default?: number;
  delegates_to?: string[];
  escalates_to?: string;
  it4it_sections?: string[];
  /** Optional slug aliases from agent_registry.json (first becomes Agent.slugId). */
  aliases?: string[];
  config_profile?: {
    model_binding?: {
      model_id?: string;
      temperature?: number;
      max_tokens?: number;
    };
    execution_runtime?: {
      type?: string;
      timeout_seconds?: number;
    };
    token_budget?: {
      daily_limit?: number;
      per_task_limit?: number;
    };
    tool_grants?: string[];
    memory?: {
      type?: string;
      backend?: string | null;
    };
    concurrency_limit?: number;
  };
}

/**
 * BI-4FA040D5: load every durable revocation tombstone as a set of
 * `${agentCuid}:${grantKey}` composite keys. The grant-apply loops below consult
 * this so a seed grant an operator revoked is not resurrected on the next boot.
 */
async function loadRevokedGrantSet(): Promise<Set<string>> {
  const rows = await prisma.agentToolGrantRevocation.findMany({
    select: { agentId: true, grantKey: true },
  });
  return new Set(rows.map((r) => `${r.agentId}:${r.grantKey}`));
}

async function seedAgentPrincipals(): Promise<void> {
  const { converged, examined } = await convergeAgentPrincipals(
    prisma as unknown as AgentPrincipalDb,
    () => `PRN-${crypto.randomUUID()}`,
  );
  if (converged.length === 0) {
    console.log(`  Agent principals converged: ${examined} agent(s), none missing`);
    return;
  }
  console.log(`  + ${converged.length} agent Principal(s) of ${examined}: ${converged.slice(0, 8).join(", ")}${converged.length > 8 ? ", …" : ""}`);
}

async function seedAgents(): Promise<void> {
  const registry = readJson<{ agents: RegistryAgent[] }>("agent_registry.json");
  const revokedGrants = await loadRevokedGrantSet();

  // Build portfolio slug → cuid lookup (portfolios must already be seeded)
  const portfolios = await prisma.portfolio.findMany({ select: { id: true, slug: true } });
  const portfolioIdBySlug = new Map(portfolios.map((p) => [p.slug, p.id]));

  // Track seen agent_ids to skip duplicates (keep first occurrence)
  const seen = new Set<string>();

  for (const a of registry.agents) {
    if (seen.has(a.agent_id)) {
      console.warn(`  → Skipping duplicate agent ${a.agent_id}`);
      continue;
    }
    seen.add(a.agent_id);

    const portfolioSlug = parseAgentPortfolioSlug(a.human_supervisor_id ?? "");
    const portfolioId = portfolioSlug ? (portfolioIdBySlug.get(portfolioSlug) ?? null) : null;

    const identity = resolveAgentIdentity({
      agentId: a.agent_id,
      name: a.agent_name,
      tier: a.tier,
      displayName: a.displayName,
      kind: a.kind,
    });

    // BI-74FD6420: do NOT attach coworker slug handles onto AGT-* rows here.
    // COWORKER_AGENT_SEEDS still creates parallel slug agentId rows that many
    // FK consumers reference (coworkerServiceCatalog, hive-scout task,
    // agent-model-defaults). Collapsing those into AGT-* breaks seed. Roster
    // display collapses dual-seed pairs via dropDualSeedAliasAgents instead.
    const unifiedFields = {
      name: a.agent_name,
      displayName: identity.displayName,
      kind: identity.kind,
      tier: parseAgentTier(a.agent_id),
      type: parseAgentType(a.agent_id),
      description: a.capability_domain ?? null,
      status: "active",
      portfolioId,
      // EP-AI-WORKFORCE-001: Unified lifecycle fields
      valueStream: a.value_stream ?? null,
      // BI-REFACTOR-B6A61421: typed hive-mind role carried from agent_registry.json
      // so resolveHiveMindCandidates prefers it over keyword inference.
      role: a.role ?? null,
      it4itSections: a.it4it_sections ?? [],
      humanSupervisorId: a.human_supervisor_id ?? null,
      hitlTierDefault: a.hitl_tier_default ?? 3,
      escalatesTo: a.escalates_to ?? null,
      delegatesTo: a.delegates_to ?? [],
      sensitivity: "internal" as const,
    };

    const agent = await prisma.agent.upsert({
      where: { agentId: a.agent_id },
      update: unifiedFields,
      create: { agentId: a.agent_id, ...unifiedFields },
    });

    // Seed AgentExecutionConfig from config_profile
    const cp = a.config_profile;
    if (cp) {
      await prisma.agentExecutionConfig.upsert({
        where: { agentId: agent.id },
        update: {
          defaultModelId: cp.model_binding?.model_id ?? null,
          temperature: cp.model_binding?.temperature ?? 0.3,
          maxTokens: cp.model_binding?.max_tokens ?? 4096,
          executionType: cp.execution_runtime?.type ?? "in_process",
          timeoutSeconds: cp.execution_runtime?.timeout_seconds ?? 120,
          concurrencyLimit: cp.concurrency_limit ?? 4,
          dailyTokenLimit: cp.token_budget?.daily_limit ?? 200000,
          perTaskTokenLimit: cp.token_budget?.per_task_limit ?? 20000,
          memoryType: cp.memory?.type ?? "session",
          memoryBackend: cp.memory?.backend ?? null,
        },
        create: {
          agentId: agent.id,
          defaultModelId: cp.model_binding?.model_id ?? null,
          temperature: cp.model_binding?.temperature ?? 0.3,
          maxTokens: cp.model_binding?.max_tokens ?? 4096,
          executionType: cp.execution_runtime?.type ?? "in_process",
          timeoutSeconds: cp.execution_runtime?.timeout_seconds ?? 120,
          concurrencyLimit: cp.concurrency_limit ?? 4,
          dailyTokenLimit: cp.token_budget?.daily_limit ?? 200000,
          perTaskTokenLimit: cp.token_budget?.per_task_limit ?? 20000,
          memoryType: cp.memory?.type ?? "session",
          memoryBackend: cp.memory?.backend ?? null,
        },
      });

      // Seed AgentToolGrant rows from tool_grants array
      if (cp.tool_grants) {
        for (const grantKey of cp.tool_grants) {
          if (revokedGrants.has(`${agent.id}:${grantKey}`)) continue; // BI-4FA040D5: honor durable revocation
          await prisma.agentToolGrant.upsert({
            where: { agentId_grantKey: { agentId: agent.id, grantKey } },
            update: {},
            create: { agentId: agent.id, grantKey },
          });
        }
      }
    }
  }
  console.log(`Seeded ${seen.size} agents (skipped ${registry.agents.length - seen.size} duplicates)`);
}

async function seedBusinessModels(): Promise<void> {
  const registry = readJson<{
    business_models: Array<{
      model_id: string;
      name: string;
      description?: string;
      is_built_in: boolean;
      roles: Array<{
        role_id: string;
        name: string;
        authority_domain?: string;
        it4it_alignment?: string;
        hitl_tier_default?: number;
        escalates_to?: string;
      }>;
    }>;
  }>("business_model_registry.json");

  let roleCount = 0;
  for (const m of registry.business_models) {
    const model = await prisma.businessModel.upsert({
      where: { modelId: m.model_id },
      update: { name: m.name, description: m.description ?? null, isBuiltIn: m.is_built_in },
      create: { modelId: m.model_id, name: m.name, description: m.description ?? null, isBuiltIn: m.is_built_in, status: "active" },
    });
    for (const r of m.roles) {
      await prisma.businessModelRole.upsert({
        where: { roleId: r.role_id },
        update: {
          name: r.name,
          authorityDomain: r.authority_domain ?? null,
          it4itAlignment: r.it4it_alignment ?? null,
          hitlTierDefault: r.hitl_tier_default ?? 2,
          escalatesTo: r.escalates_to ?? null,
          isBuiltIn: m.is_built_in,
        },
        create: {
          roleId: r.role_id,
          name: r.name,
          authorityDomain: r.authority_domain ?? null,
          it4itAlignment: r.it4it_alignment ?? null,
          hitlTierDefault: r.hitl_tier_default ?? 2,
          escalatesTo: r.escalates_to ?? null,
          isBuiltIn: m.is_built_in,
          status: "active",
          businessModelId: model.id,
        },
      });
      roleCount++;
    }
  }
  console.log(`Seeded ${registry.business_models.length} business models with ${roleCount} roles`);
}

/**
 * Ensure the platform bootstrap Organization exists. DPF is
 * single-org-per-install (see memory: project_single_org_per_install); the
 * seed guarantees an Organization exists before any downstream content,
 * so the single-org invariant holds from the first container start. The
 * Setup wizard later upgrades this bootstrap row in place with the real
 * company name and details (see apps/web/lib/actions/setup-entities.ts).
 */
async function ensureBootstrapOrganization(): Promise<string> {
  const existing = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const org = await prisma.organization.upsert({
    where: { slug: "platform" },
    update: {},
    create: {
      orgId: "ORG-PLATFORM",
      name: "Open Digital Product Factory",
      slug: "platform",
    },
  });
  return org.id;
}

async function seedPortfolios(): Promise<void> {
  const registry = readJson<{
    portfolios: Array<{
      id: string;
      name: string;
      description?: string;
    }>;
  }>("portfolio_registry.json");

  for (const p of registry.portfolios) {
    await prisma.portfolio.upsert({
      where: { slug: p.id },
      update: { name: p.name, description: p.description ?? null },
      create: {
        slug: p.id,
        name: p.name,
        description: p.description ?? null,
      },
    });
  }
  console.log(`Seeded ${registry.portfolios.length} portfolios`);
}

async function seedTaxonomyNodes(): Promise<void> {
  const DATA_PATH = join(__dirname, "..", "data", "taxonomy_v3.json");
  const rows: TaxonomySeedRow[] = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  const registry = readJson<{ portfolios: Array<{ id: string; name: string }> }>("portfolio_registry.json");
  const entries = buildTaxonomyNodeEntries(rows, registry.portfolios);

  // Look up Portfolio.id values by portfolioId slug
  const portfolios = await prisma.portfolio.findMany({ select: { id: true, slug: true } });
  const portfolioIdMap = new Map<string, string>(); // portfolio slug → Portfolio.id
  for (const p of portfolios) {
    portfolioIdMap.set(p.slug, p.id);
  }

  // Insert in order so parent always exists before child
  const nodeIdToCuid = new Map<string, string>();
  for (const entry of entries) {
    const parentCuid = entry.parentNodeId ? (nodeIdToCuid.get(entry.parentNodeId) ?? null) : null;
    const portfolioCuid = portfolioIdMap.get(entry.portfolioId) ?? null;
    const governance = defaultGovernanceFor(entry.nodeId);
    const node = await prisma.taxonomyNode.upsert({
      where: { nodeId: entry.nodeId },
      create: {
        nodeId:      entry.nodeId,
        name:        entry.name,
        parentId:    parentCuid,
        portfolioId: portfolioCuid,
        status:      "active",
        description: entry.description,
        enrichment:  entry.enrichment ? JSON.parse(JSON.stringify(entry.enrichment)) : undefined,
        governance:  JSON.parse(JSON.stringify(governance)),
      },
      update: {
        name:        entry.name,
        parentId:    parentCuid,
        portfolioId: portfolioCuid,
        status:      "active",
        description: entry.description,
        enrichment:  entry.enrichment ? JSON.parse(JSON.stringify(entry.enrichment)) : undefined,
        governance:  JSON.parse(JSON.stringify(governance)),
      },
      select: { id: true },
    });
    nodeIdToCuid.set(entry.nodeId, node.id);
  }

  // Invariant guard: every TaxonomyNode must carry governance after seed.
  // This catches future regressions where a code path adds rows but skips
  // the governance payload (per the "fix the seed, not the runtime" principle).
  const missing = await prisma.taxonomyNode.count({
    where: { governance: { equals: Prisma.DbNull } },
  });
  if (missing > 0) {
    throw new Error(
      `Invariant violation: ${missing} TaxonomyNode rows have null governance after seed. ` +
        `Did seedTaxonomyNodes skip the upsert payload? See packages/db/src/taxonomy-governance-defaults.ts.`,
    );
  }

  console.log(`Seeded ${entries.length} taxonomy nodes`);
}

/**
 * Load the discovery-fingerprint catalog into DiscoveryFingerprintRule rows so
 * the discovery pipeline applies them at runtime (spec §8.3). Runs AFTER
 * seedTaxonomyNodes so each rule's semantic taxonomyNodeId resolves to a cuid.
 * Idempotent (upsert on ruleKey) — re-running seed reproduces the estate's
 * identifications with zero SQL.
 */
async function seedDiscoveryFingerprints(): Promise<void> {
  const result = await loadFingerprintCatalogIntoDb(prisma, defaultCatalogPath(__dirname));
  if (result.unresolvedTaxonomy.length > 0) {
    // Non-fatal: an identity-only rule (no placement) is valid, but flag so a
    // typo'd nodeId surfaces instead of silently degrading placement.
    console.warn(
      `[seed] ${result.unresolvedTaxonomy.length} fingerprint rule(s) had unresolved taxonomy nodeIds: ` +
        result.unresolvedTaxonomy.join(", "),
    );
  }
  console.log(
    `Seeded ${result.loaded} discovery fingerprint rules (catalog ${result.catalogKey}@${result.version}), ` +
      `${result.catalogIdentitiesLinked} linked to canonical CatalogIdentity rows`,
  );
}

async function seedMacVendorOui(): Promise<void> {
  const result = await loadOuiRegistryIntoDb(prisma, defaultOuiRegistryPath(__dirname));
  if (result.skippedMalformed > 0) {
    // Non-fatal: a refreshed IEEE dump may carry lines this parser does not
    // recognise. Surface the count so a format change is visible instead of
    // silently shrinking the registry.
    console.warn(`[seed] skipped ${result.skippedMalformed} malformed OUI line(s)`);
  }
  console.log(`Seeded ${result.loaded} MAC OUI vendor prefixes`);
}

async function seedDigitalProducts(): Promise<void> {
  const registry = readJson<{
    digital_products: Array<{
      product_id: string;
      name: string;
      description?: string;
      portfolio_id?: string;
      taxonomy_node_id?: string;
      lifecycle?: { stage_status?: string };
    }>;
  }>("digital_product_registry.json");

  const products = registry.digital_products;
  for (const p of products) {
    let portfolioDbId: string | undefined;
    if (p.portfolio_id) {
      const portfolio = await prisma.portfolio.findUnique({ where: { slug: p.portfolio_id } });
      portfolioDbId = portfolio?.id;
    }
    // Resolve taxonomy node for portfolio tree placement
    let taxonomyNodeDbId: string | undefined;
    if (p.taxonomy_node_id) {
      const node = await prisma.taxonomyNode.findUnique({ where: { nodeId: p.taxonomy_node_id } });
      taxonomyNodeDbId = node?.id;
    }
    // Treat registry stage_status as the operational lifecycleStatus.
    // All registry products are assumed to be in production.
    const lifecycleStatus = p.lifecycle?.stage_status ?? "active";

    await prisma.digitalProduct.upsert({
      where: { productId: p.product_id },
      update: {
        name: p.name,
        description: p.description ?? null,
        lifecycleStage: "production",
        lifecycleStatus,
        portfolioId: portfolioDbId ?? null,
        taxonomyNodeId: taxonomyNodeDbId ?? undefined,
      },
      create: {
        productId: p.product_id,
        name: p.name,
        description: p.description ?? null,
        lifecycleStage: "production",
        lifecycleStatus,
        portfolioId: portfolioDbId ?? null,
        taxonomyNodeId: taxonomyNodeDbId ?? null,
      },
    });
  }
  console.log(`Seeded ${products.length} digital products`);
}

async function seedDpfSelfRegistration(): Promise<void> {
  // The portal is a platform service under Foundational — it's the user-facing
  // web application that provides lifecycle views for all digital products.
  const portfolio = await prisma.portfolio.findUnique({
    where: { slug: "foundational" },
  });
  if (!portfolio) throw new Error("foundational portfolio not seeded");

  // Try the specific platform services node first, fall back to portfolio root
  let taxonomyNode = await prisma.taxonomyNode.findUnique({
    where: { nodeId: "foundational/platform_services" },
  });
  if (!taxonomyNode) {
    taxonomyNode = await prisma.taxonomyNode.findUnique({
      where: { nodeId: "foundational" },
    });
  }
  if (!taxonomyNode) throw new Error("foundational taxonomy node not seeded");

  // Register DPF Portal as a DigitalProduct
  await prisma.digitalProduct.upsert({
    where: { productId: "dpf-portal" },
    update: {
      name:            "Digital Product Factory Portal",
      description:     "The Digital Product Factory platform — portal application, AI workforce, monitoring, and administration.",
      lifecycleStage:  "production",
      lifecycleStatus: "active",
      portfolioId:     portfolio.id,
      taxonomyNodeId:  taxonomyNode.id,
    },
    create: {
      productId:       "dpf-portal",
      name:            "Digital Product Factory Portal",
      description:     "The Digital Product Factory platform — portal application, AI workforce, monitoring, and administration.",
      lifecycleStage:  "production",
      lifecycleStatus: "active",
      portfolioId:     portfolio.id,
      taxonomyNodeId:  taxonomyNode.id,
    },
    select: { id: true },
  });

  console.log("Seeded DPF Portal digital product (foundational/platform_services)");
}

async function seedPlatformSbom(): Promise<void> {
  const repositoryRoot = join(__dirname, "..", "..", "..");
  const input = await loadPlatformSbomFromRepository({
    repositoryRoot,
    generatedAt: new Date(),
    gitRef: process.env.GITHUB_SHA ?? process.env.GIT_COMMIT ?? "installed-runtime",
  });
  const result = await persistPlatformSbom(prisma as unknown as PlatformSbomClient, input);
  console.log(
    `Seeded platform SBOM ${result.documentId}: ` +
      `${result.componentCount} components, ${result.occurrenceCount} occurrences, ` +
      `${result.supersededDocumentCount} superseded document(s)`,
  );
}

// Epic/backlog seeding removed — managed separately via backup/restore process.
async function seedDefaultAdminUser(): Promise<void> {
  // Creates a default HR-000 user for initial access. Change password immediately.
  const adminRole = await prisma.platformRole.findUnique({ where: { roleId: "HR-000" } });
  if (!adminRole) throw new Error("HR-000 role not seeded");

  const existing = await prisma.user.findUnique({ where: { email: "admin@dpf.local" } });
  const user =
    existing ??
    (await (async () => {
      const password = process.env.ADMIN_PASSWORD ?? "changeme123";
      const hash = await bcrypt.hash(password, 12);
      return prisma.user.create({
        data: {
          email: "admin@dpf.local",
          passwordHash: hash,
          isSuperuser: true,
          groups: { create: { platformRoleId: adminRole.id } },
        },
      });
    })());

  // Principal convergence (AGENTS.md §11): every User must have a matching
  // Principal + PrincipalAlias so audit-attributed actions (issue edge-node
  // bootstrap token, approve principal, etc) can resolve session.user.id →
  // principalId without falling back to a synthetic string that would
  // violate BootstrapToken_issuedByPrincipalId_fkey and similar hard FKs.
  //
  // Inlined here rather than calling apps/web/lib/identity/principal-linking.ts
  // because the seed runs in packages/db and cannot depend on apps/web. Keep
  // the row shape exactly matching `syncUserPrincipal` so the runtime
  // self-heal path produces identical rows.
  const existingAlias = await prisma.principalAlias.findFirst({
    where: {
      aliasType: "user",
      aliasValue: user.id,
      issuer: "",
    },
    include: { principal: true },
  });
  const sensitivityClearance = resolvePrincipalSensitivityClearance({
    existing: existingAlias?.principal.sensitivityClearance,
    isSuperuser: user.isSuperuser,
  });
  const clearanceChanged = existingAlias
    ? existingAlias.principal.sensitivityClearance.length !== sensitivityClearance.length ||
      existingAlias.principal.sensitivityClearance.some(
        (value, index) => value !== sensitivityClearance[index],
      )
    : true;
  const principal = existingAlias
    ? clearanceChanged
      ? await prisma.principal.update({
          where: { id: existingAlias.principal.id },
          data: { sensitivityClearance },
        })
      : existingAlias.principal
    : await prisma.principal.create({
        data: {
          principalId: `PRN-${crypto.randomUUID()}`,
          kind: "human",
          status: "active",
          displayName: user.email,
          sensitivityClearance,
        },
      });
  if (!existingAlias) {
    await prisma.principalAlias.create({
      data: {
        principalId: principal.id,
        aliasType: "user",
        aliasValue: user.id,
        issuer: "",
      },
    });
  }

  if (existing) {
    console.log(`Converged default admin principal: ${principal.principalId}`);
  } else {
    console.log(`Created default admin: ${user.email} (default password set — CHANGE THIS IMMEDIATELY)`);
    console.log(`  + Principal ${principal.principalId} + PrincipalAlias (aliasType=user, aliasValue=${user.id})`);
  }
}

async function seedEaViewpoints(): Promise<void> {
  // Notation-aware viewpoint seeding lives in seed-ea-viewpoints.ts (2026-06-14
  // SysML substrate spec §10 Phase 1 + §11 refactoring budget: one reusable helper
  // instead of per-notation copy-paste). ArchiMate is required; BPMN and SysML are
  // optional and skipped if their notation has not been seeded yet.
  await seedViewpointsForNotation("archimate4", ARCHIMATE_VIEWPOINTS);
  await seedViewpointsForNotation("bpmn20", BPMN_VIEWPOINTS, { optional: true });
  await seedViewpointsForNotation("sysml2", SYSML_VIEWPOINTS, { optional: true });
}

async function seedEaViews(): Promise<void> {
  const notation = await prisma.eaNotation.findUniqueOrThrow({
    where: { slug: "archimate4" },
    select: { id: true },
  });
  const appVp = await prisma.viewpointDefinition.findUnique({
    where: { name: "Application Architecture" },
    select: { id: true },
  });
  const bizVp = await prisma.viewpointDefinition.findUnique({
    where: { name: "Business Architecture" },
    select: { id: true },
  });
  const dataModelVp = await prisma.viewpointDefinition.findUnique({
    where: { name: "Data Model" },
    select: { id: true },
  });
  const views = [
    {
      name: "DPF Platform — Application Architecture",
      description: "Application components and services that make up the Digital Product Factory platform.",
      layoutType: "graph",
      scopeType: "portfolio",
      scopeRef: "foundational",
      viewpointId: appVp?.id ?? null,
    },
    {
      name: "Business Capability Map",
      description: "Top-level business capabilities across the organisation.",
      layoutType: "graph",
      scopeType: "custom",
      scopeRef: null,
      viewpointId: bizVp?.id ?? null,
    },
    {
      // EP-DATA-ARCH: system-owned host view; populated by the data-model mirror
      // (reconcileDataModelMirror finds it by scopeType+scopeRef and reuses it).
      name: "Data Model",
      description: "Live ERD mirrored from the Prisma schema (system-owned).",
      layoutType: "graph",
      scopeType: "data-model",
      scopeRef: "prisma",
      viewpointId: dataModelVp?.id ?? null,
    },
  ];
  for (const v of views) {
    const existing = await prisma.eaView.findFirst({ where: { name: v.name }, select: { id: true } });
    if (!existing) {
      await prisma.eaView.create({
        data: {
          notationId: notation.id,
          name: v.name,
          description: v.description,
          layoutType: v.layoutType,
          scopeType: v.scopeType,
          ...(v.scopeRef != null && { scopeRef: v.scopeRef }),
          ...(v.viewpointId != null && { viewpointId: v.viewpointId }),
          status: "draft",
        },
      });
    }
  }
  console.log(`Seeded ${views.length} EA views`);
}

async function seedMcpServers(): Promise<void> {
  // Default MCP servers bundled with the platform.
  // All are free, open-source (MIT license) from the official MCP project.
  //
  // Status is seeded as "active": these are internal plumbing the platform
  // requires to function (Build Studio, review-phase verification, hive
  // contribution) — not optional third-party add-ons. Forcing the admin to
  // click Register for services the installer just installed is friction
  // without a governance benefit. A matching `modelProvider` row is upserted
  // alongside each so the "N new MCP services detected" banner (which fires
  // on missing modelProvider entries) doesn't show bundled plumbing.
  //
  // SECURITY: Filesystem and PostgreSQL servers are marked sandbox-only.
  // They MUST execute inside the sandbox container (via docker exec), never as
  // child processes of the portal container. The portal container has production
  // credentials and file access — spawning stdio MCP servers there would bypass
  // sandbox isolation entirely. The executionScope field enforces this.
  const defaultServers = [
    {
      serverId: "codex-agent",
      name: "OpenAI Codex Agent",
      transport: "stdio",
      category: "coding",
      tags: ["code-generation", "code-review"],
      config: {
        command: "npx",
        args: ["-y", "codex", "mcp-server"],
        transport: "stdio",
        executionScope: "sandbox",
        tools: ["codex", "codex-reply"],
        linkedProviderId: "codex",
        defaults: {
          "approval-policy": "on-request",
          sandbox: "workspace-write",
        },
      },
    },
    {
      serverId: "mcp-filesystem",
      name: "Filesystem (MCP Official)",
      transport: "stdio",
      category: "development",
      tags: ["file-read", "file-write", "file-search", "sandbox"],
      config: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
        transport: "stdio",
        executionScope: "sandbox",
        notes: "Free, open-source (MIT). SANDBOX ONLY — runs inside sandbox container scoped to /workspace. Never runs in the portal container.",
      },
    },
    {
      serverId: "mcp-postgres",
      name: "PostgreSQL (MCP Official)",
      transport: "stdio",
      category: "database",
      tags: ["sql", "database", "schema-introspection", "query"],
      config: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres"],
        transport: "stdio",
        executionScope: "sandbox",
        env: {
          // Points to the SANDBOX database, not production.
          // The sandbox has its own isolated PostgreSQL instance.
          POSTGRES_CONNECTION_STRING: "postgresql://dpf:dpf_sandbox@localhost:5432/dpf",
        },
        notes: "Free, open-source (MIT). SANDBOX ONLY — connects to the sandbox-isolated database, not production. Read-only by default.",
      },
    },
    {
      serverId: "mcp-github",
      name: "GitHub (MCP Official)",
      transport: "stdio",
      category: "development",
      tags: ["git", "pull-requests", "issues", "code-review", "repository"],
      config: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        transport: "stdio",
        executionScope: "external",
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PAT}",
        },
        notes: "Free, open-source (MIT). Requires a free GitHub Personal Access Token. Safe for portal execution — communicates with external GitHub API only, no local file or DB access.",
      },
    },
    {
      serverId: "mcp-browser-use",
      name: "Browser-Use (AI Browser Automation)",
      transport: "http",
      category: "development",
      tags: ["browser-automation", "web-interaction", "ui-testing", "qa", "data-extraction"],
      config: {
        url: "http://browser-use:8500/mcp",
        transport: "http",
        executionScope: "external",
        notes: "Free, open-source (MIT). AI-powered browser automation via browser-use. Replaces Playwright with LLM-driven navigation, self-healing selectors, and evidence capture. Requires --profile browser-use to start.",
      },
    },
  ];

  for (const server of defaultServers) {
    const existing = await prisma.mcpServer.findUnique({
      where: { serverId: server.serverId },
    });

    if (!existing) {
      await prisma.mcpServer.create({
        data: {
          serverId: server.serverId,
          name: server.name,
          transport: server.transport,
          category: server.category,
          tags: server.tags,
          config: server.config,
          status: "active",
        },
      });
      console.log(`Seeded MCP server: ${server.serverId}`);
    } else {
      console.log(`MCP server ${server.serverId} already exists — skipping (preserving admin config)`);
    }

    // Mirror the server into modelProvider so the "N new MCP services
    // detected" banner (driven by a missing modelProvider row) doesn't flag
    // bundled plumbing. Shape matches what registerMcpService() creates when
    // the admin clicks Register in the UI; keeping them in sync means an
    // existing install won't regress to the banner after a re-seed.
    await prisma.modelProvider.upsert({
      where: { providerId: server.serverId },
      update: {
        name: server.name,
        endpointType: "service",
        serviceKind: "mcp",
        category: "mcp-subscribed",
        status: "active",
      },
      create: {
        providerId: server.serverId,
        name: server.name,
        endpointType: "service",
        serviceKind: "mcp",
        category: "mcp-subscribed",
        sensitivityClearance: ["public", "internal"],
        capabilityTier: "basic",
        costBand: "free",
        taskTags: [],
        status: "active",
        families: [],
        enabledFamilies: [],
        costModel: "token",
        authMethod: "none",
        supportedAuthMethods: ["none"],
      },
    });
  }
}

async function seedSandboxPool(): Promise<void> {
  const POOL_SIZE = Number(process.env.DPF_SANDBOX_POOL_SIZE) || 3;
  const BASE_PORT = 3036;

  // Slot 0 is the legacy dpf-sandbox-1 on port 3035
  const slots = [
    { slotIndex: 0, containerId: "dpf-sandbox-1", port: 3035 },
    ...Array.from({ length: POOL_SIZE - 1 }, (_, i) => ({
      slotIndex: i + 1,
      containerId: `dpf-sandbox-${i + 2}`,
      port: BASE_PORT + i + 1,
    })),
  ];

  for (const slot of slots) {
    const existing = await prisma.sandboxSlot.findUnique({
      where: { slotIndex: slot.slotIndex },
    });
    if (!existing) {
      await prisma.sandboxSlot.create({
        data: {
          slotIndex: slot.slotIndex,
          containerId: slot.containerId,
          port: slot.port,
          status: "available",
        },
      });
      console.log(`Seeded sandbox slot ${slot.slotIndex}: ${slot.containerId}:${slot.port}`);
    } else {
      console.log(`Sandbox slot ${slot.slotIndex} already exists — skipping`);
    }
  }
}

async function seedRuntimeTargets(): Promise<void> {
  const rootPortalUrl = process.env.APP_URL ?? process.env.AUTH_URL ?? "http://localhost:3000";
  const now = new Date();

  await prisma.runtimeTarget.upsert({
    where: { targetId: "RT-ROOT-PORTAL" },
    create: {
      targetId: "RT-ROOT-PORTAL",
      kind: "root-portal",
      status: "running",
      serviceName: "portal",
      containerName: "dpf-portal-1",
      hostUrl: rootPortalUrl,
      port: 3000,
      serviceVersion: process.env.DPF_IMAGE_VERSION ?? process.env.DPF_VERSION ?? null,
      lastHeartbeatAt: now,
      metadata: {},
    },
    update: {
      kind: "root-portal",
      serviceName: "portal",
      containerName: "dpf-portal-1",
      hostUrl: rootPortalUrl,
      port: 3000,
      serviceVersion: process.env.DPF_IMAGE_VERSION ?? process.env.DPF_VERSION ?? null,
      lastHeartbeatAt: now,
    },
  });

  await prisma.runtimeTarget.upsert({
    where: { targetId: "RT-DEV-PORTAL" },
    create: {
      targetId: "RT-DEV-PORTAL",
      kind: "dev-portal",
      status: "planned",
      serviceName: "dev-portal",
      containerName: "dpf-dev-portal-1",
      hostUrl: "http://localhost:3001",
      port: 3001,
      metadata: {},
    },
    update: {
      kind: "dev-portal",
      serviceName: "dev-portal",
      containerName: "dpf-dev-portal-1",
      hostUrl: "http://localhost:3001",
      port: 3001,
    },
  });

  const featureBuilds = await prisma.featureBuild.findMany({
    select: { id: true, buildId: true },
  });
  const featureBuildIdByBuildId = new Map(featureBuilds.map((build) => [build.buildId, build.id]));

  const sandboxes = await prisma.sandbox.findMany({
    select: {
      id: true,
      buildId: true,
      providerId: true,
      state: true,
      previewUrl: true,
    },
  });
  const sandboxIds = new Set(sandboxes.map((sandbox) => sandbox.id));

  for (const sandbox of sandboxes) {
    const status = sandbox.state === "running" || sandbox.state === "ready"
      ? "running"
      : sandbox.state === "failed"
        ? "failed"
        : sandbox.state === "destroyed"
          ? "released"
          : "assigned";
    await prisma.runtimeTarget.upsert({
      where: { targetId: `RT-SANDBOX-${sandbox.id}` },
      create: {
        targetId: `RT-SANDBOX-${sandbox.id}`,
        kind: "build-sandbox",
        status,
        sandboxId: sandbox.id,
        featureBuildId: featureBuildIdByBuildId.get(sandbox.buildId) ?? null,
        hostUrl: sandbox.previewUrl,
        metadata: {
          buildId: sandbox.buildId,
          providerId: sandbox.providerId,
        },
      },
      update: {
        status,
        sandboxId: sandbox.id,
        featureBuildId: featureBuildIdByBuildId.get(sandbox.buildId) ?? null,
        hostUrl: sandbox.previewUrl,
        metadata: {
          buildId: sandbox.buildId,
          providerId: sandbox.providerId,
        },
      },
    });
  }

  const candidates = await prisma.gitPromotionCandidate.findMany({
    where: { status: { in: ["queued", "verifying", "in_progress"] } },
    select: {
      id: true,
      candidateId: true,
      status: true,
      sandboxId: true,
    },
  });

  for (const candidate of candidates) {
    const status = candidate.status === "verifying" || candidate.status === "in_progress"
      ? "verifying"
      : "planned";
    await prisma.runtimeTarget.upsert({
      where: { targetId: `RT-GIT-PROMOTION-${candidate.id}` },
      create: {
        targetId: `RT-GIT-PROMOTION-${candidate.id}`,
        kind: "git-promotion-sandbox",
        status,
        sandboxId: candidate.sandboxId && sandboxIds.has(candidate.sandboxId) ? candidate.sandboxId : null,
        metadata: {
          candidateId: candidate.candidateId,
          candidateSandboxId: candidate.sandboxId,
        },
      },
      update: {
        status,
        sandboxId: candidate.sandboxId && sandboxIds.has(candidate.sandboxId) ? candidate.sandboxId : null,
        metadata: {
          candidateId: candidate.candidateId,
          candidateSandboxId: candidate.sandboxId,
        },
      },
    });
  }

  console.log("Seeded runtime targets: root portal, dev portal, and active sandbox mirrors");
}

async function seedCoworkerAgents(): Promise<void> {
  // EP-AI-WORKFORCE-001: Coworker roster and grants live in workforce-seed.ts
  // so profession coverage invariants can test the seed data directly.

  const revokedGrants = await loadRevokedGrantSet(); // BI-4FA040D5
  let grantCount = 0;
  for (const cw of COWORKER_AGENT_SEEDS) {
    // Keep slug agentId rows as first-class seed identities. Many surfaces FK
    // Agent.agentId by slug (CoworkerService.providerAgentId, hive scout task,
    // agent-model-defaults). Dual-seed AGT-* twins from seedAgents() remain;
    // AI Workforce roster display collapses them via dropDualSeedAliasAgents
    // (BI-74FD6420) until a full FK migration lands.
    const { agentId, slugId, delegatesTo, initialLifecycleStage, ...rest } = cw;
    const lifecyclePolicy = resolveCoworkerLifecycleSeedPolicy(cw);
    const identity = resolveAgentIdentity({ agentId, name: rest.name, slugId, displayName: rest.name });
    // BI-3073F13B: this upsert keys on agentId but its create branch writes the
    // @unique slugId, so a new agentId re-using an existing slugId throws P2002
    // and (outside a transaction) aborts the whole coworker seed. Tolerate it:
    // on a slugId collision, re-resolve the canonical slug row and apply this
    // coworker's fields to it instead of crashing.
    const agent = await upsertCoworkerAgentTolerant(prisma, slugId, {
      where: { agentId },
      create: {
        agentId,
        slugId,
        displayName: identity.displayName,
        kind: identity.kind,
        ...rest,
        ...(delegatesTo ? { delegatesTo: [...delegatesTo] } : {}),
        ...lifecyclePolicy.create,
      },
      update: {
        slugId,
        name: rest.name,
        displayName: identity.displayName,
        kind: identity.kind,
        description: rest.description,
        valueStream: rest.valueStream,
        sensitivity: rest.sensitivity,
        // Only a coworker that declares seed-owned delegation authority updates
        // this field. Preserve operator-managed authority for every other slug.
        ...(delegatesTo ? { delegatesTo: [...delegatesTo] } : {}),
        // Un-retire if a prior broken seed pass archived the slug twin.
        archived: false,
        status: "active",
        // Preserve the live lifecycle stage. New coworkers may seed as draft
        // and only establish_coworker(action="promote") may move them to
        // production after behavioral certification. Reseeding must not
        // silently bypass that gate or demote an already promoted coworker.
        ...lifecyclePolicy.update,
      },
    });
    if (agent.outcome === "reresolved_slug_collision") {
      console.warn(
        `[seed-coworker] slugId "${slugId}" already held by another agent; applied ${agentId}'s fields to the canonical slug row instead of crashing (BI-3073F13B).`,
      );
    }

    const grants = HARDCODED_COWORKER_GRANTS[agentId];
    if (grants) {
      for (const grantKey of grants) {
        if (revokedGrants.has(`${agent.id}:${grantKey}`)) continue; // BI-4FA040D5: honor durable revocation
        await prisma.agentToolGrant.upsert({
          where: { agentId_grantKey: { agentId: agent.id, grantKey } },
          update: {},
          create: { agentId: agent.id, grantKey },
        });
        grantCount++;
      }
      // Reconcile, don't just add: remove grant rows no longer in the desired
      // set. The pure-upsert loop above left stale grants behind forever — e.g.
      // customer-advisor kept backlog_write/marketing_read after its grants were
      // corrected, and those stale tier-1 tools crowded the per-turn tool budget
      // and pushed the CRM tools (create_quote) past the cap. A coworker's live
      // grants must equal its declared set.
      //
      // BI-4FA040D5: scope the reconcile to seed grants (grantedBy = null). An
      // operator-added grant (grantedBy set) is a durable delta and must survive
      // the boot; only stale SEED rows no longer in the declared set are pruned.
      await prisma.agentToolGrant.deleteMany({
        where: { agentId: agent.id, grantKey: { notIn: [...grants] }, grantedBy: null },
      });
    }
  }

  // Backfill grants for onboarding agents already in the DB.
  for (const [agentId, grants] of Object.entries(ONBOARDING_AGENT_GRANTS)) {
    const agent = await prisma.agent.findUnique({ where: { agentId } });
    if (!agent) continue; // Not yet bootstrapped — first-run flow will seed it with grants
    for (const grantKey of grants) {
      if (revokedGrants.has(`${agent.id}:${grantKey}`)) continue; // BI-4FA040D5: honor durable revocation
      await prisma.agentToolGrant.upsert({
        where: { agentId_grantKey: { agentId: agent.id, grantKey } },
        update: {},
        create: { agentId: agent.id, grantKey },
      });
      grantCount++;
    }
  }

  console.log(`Seeded ${COWORKER_AGENT_SEEDS.length} coworker agents with ${grantCount} tool grants`);
}

/** EP-AI-WORKFORCE-001: Seed skills for coworker agents */
async function seedCoworkerSkills(): Promise<void> {
  // Skills per agent slug — matches the skills from agent-routing.ts ROUTE_AGENT_MAP
  const agentSkills: Record<string, Array<{ label: string; description: string; capability?: string; prompt: string; sortOrder: number }>> = {
    "portfolio-advisor": [
      { label: "Health summary", description: "Analyze health metrics and flag risks", prompt: "Give me a health summary of the portfolio, highlighting any risks or issues.", sortOrder: 0 },
      { label: "Budget analysis", description: "Review budget allocations and spending", prompt: "Analyze the budget allocations across the portfolio and flag any concerns.", sortOrder: 1 },
      { label: "Find a product", description: "Search for a digital product", prompt: "Help me find a product in the portfolio.", sortOrder: 2 },
      { label: "Report an issue", description: "Report a bug or give feedback", prompt: "I'd like to report an issue or give feedback.", sortOrder: 3 },
    ],
    "external-catalog-scout": [
      { label: "Run scout pass", description: "Scan the approved external catalog and file governed backlog suggestions", prompt: "Run the external catalog scout pass. Use the governed ingest tool once, then summarize what was created, duplicated, or deferred.", sortOrder: 0 },
      { label: "Review latest gaps", description: "Summarize the latest archetype gaps worth platform attention", prompt: "Review the latest Hive Scout suggestions and summarize the highest-value gaps for DPF to absorb into the platform.", sortOrder: 1 },
      { label: "Report an issue", description: "Report a bug or give feedback", prompt: "I'd like to report an issue or give feedback.", sortOrder: 2 },
    ],
    "build-specialist": [
      { label: "Start a build", description: "Begin a new feature build", capability: "build_studio", prompt: "Help me start a new feature build.", sortOrder: 0 },
      { label: "Review code", description: "Review pending code changes", prompt: "Review the current code changes and suggest improvements.", sortOrder: 1 },
      { label: "Report an issue", description: "Report a bug or give feedback", prompt: "I'd like to report an issue or give feedback.", sortOrder: 2 },
    ],
    "coo": [
      { label: "Platform health", description: "Overview of platform health and agent status", prompt: "Give me an overview of platform health, agent status, and any operational concerns.", sortOrder: 0 },
      { label: "Workforce status", description: "AI workforce operational summary", prompt: "Summarize the AI workforce status: which agents are active, degraded, or offline.", sortOrder: 1 },
      { label: "Report an issue", description: "Report a bug or give feedback", prompt: "I'd like to report an issue or give feedback.", sortOrder: 2 },
    ],
    "doc-specialist": [
      { label: "Generate diagram", description: "Create a Mermaid diagram for a concept", prompt: "Generate a Mermaid diagram for the concept I describe. Choose the appropriate diagram type (flowchart, sequence, class, state, ER, C4) based on the subject.", sortOrder: 0 },
      { label: "Review doc structure", description: "Check document structural issues", prompt: "Review the structure of this document. Check heading hierarchy, cross-references, section completeness, and IT4IT alignment.", sortOrder: 1 },
      { label: "Regenerate diagrams", description: "Update diagrams to match current state", prompt: "Find and regenerate all Mermaid diagrams in this document to reflect the current codebase and architecture state.", sortOrder: 2 },
      { label: "Renderer compatibility", description: "Check diagram renderer compatibility", prompt: "Check this Mermaid diagram for compatibility issues across renderers (GitHub, VS Code, GitBook). Flag unsupported syntax.", sortOrder: 3 },
      { label: "Report an issue", description: "Report a bug or give feedback", prompt: "I'd like to report an issue or give feedback.", sortOrder: 4 },
    ],
  };

  let count = 0;
  for (const [slugId, skills] of Object.entries(agentSkills)) {
    const agent = await prisma.agent.findFirst({ where: { OR: [{ agentId: slugId }, { slugId }] } });
    if (!agent) { console.warn(`  → Agent ${slugId} not found, skipping skills`); continue; }

    for (const skill of skills) {
      await prisma.agentSkillAssignment.upsert({
        where: { agentId_label: { agentId: agent.id, label: skill.label } },
        update: { description: skill.description, prompt: skill.prompt, sortOrder: skill.sortOrder, capability: skill.capability ?? null },
        create: { agentId: agent.id, label: skill.label, description: skill.description, prompt: skill.prompt, sortOrder: skill.sortOrder, capability: skill.capability ?? null },
      });
      count++;
    }
  }
  console.log(`Seeded ${count} agent skills`);
}

/** EP-AI-WORKFORCE-001: Seed prompt context for coworker agents */
async function seedAgentPromptContexts(): Promise<void> {
  const contexts: Record<string, { perspective: string; heuristics: string; interpretiveModel: string; domainTools: string[] }> = {
    "portfolio-advisor": {
      perspective: "You see the organization as a portfolio of investments. Every product is an asset with cost, value, risk, and return. You encode the world as financial health, investment ratios, and strategic alignment.",
      heuristics: "Start with portfolio-level health metrics, then drill into product-level concerns. Flag concentration risk, budget overruns, and misaligned investments.",
      interpretiveModel: "Optimize for risk-adjusted return on IT investment. A healthy portfolio balances innovation (new products) with stability (mature products).",
      domainTools: ["list_products", "get_product", "list_backlog_items", "search_products"],
    },
    "external-catalog-scout": {
      perspective: "You scan the external ecosystem — agent catalogs and the wider product/market space — for proven patterns and design challenges, then translate them into DPF-native backlog suggestions without importing code or multiplying tools.",
      heuristics: "Run the governed scout pass first, summarize concrete counts, name genuine novelty, and keep backlog noise low by calling out duplicates and deferred items clearly. For changed market-source material, ask what the product makes effortless that our model would not catch, and cite the source URL on every suggestion.",
      interpretiveModel: "Optimize for absorption over integration. External projects are evidence and inspiration, not product dependencies.",
      domainTools: ["run_hive_scout_ingest", "list_backlog_items", "search_products"],
    },
    "build-specialist": {
      perspective: "You see the platform as code to be written, tested, and shipped. Every request maps to files, functions, and tests. You encode the world as implementation tasks.",
      heuristics: "Read existing code before proposing changes. Search for patterns and reuse. Write tests alongside implementation. Make the smallest change that works.",
      interpretiveModel: "Optimize for working software delivered incrementally. Code is healthy when tests pass, types check, and the change is reviewable.",
      domainTools: ["search_project_files", "read_project_file", "write_sandbox_file", "generate_code", "run_sandbox_tests"],
    },
    "doc-specialist": {
      perspective: "You see the platform as a network of documents, diagrams, and cross-references. You encode the world as document completeness, structural consistency, diagram accuracy, and renderer compatibility.",
      heuristics: "Structure validation: does the document follow the platform spec template? Cross-reference integrity: do links resolve? Diagram accuracy: does Mermaid syntax render correctly? Renderer awareness: GitHub, VS Code, and GitBook each support different features. Completeness: are there TODOs or placeholder content?",
      interpretiveModel: "Optimize for documentation that is accurate, self-contained, and renderable. A document is healthy when a new developer can read it without questions, all diagrams render correctly, and all cross-references resolve.",
      domainTools: ["search_project_files", "read_project_file", "list_products"],
    },
    "coo": {
      perspective: "You see the organization as a system of systems. Every agent, product, and process is interconnected. You encode the world as operational health, strategic alignment, and workforce coordination.",
      heuristics: "Start with the big picture: what is the platform's overall health? Which agents are performing well? Where are bottlenecks? Delegate details to specialist agents.",
      interpretiveModel: "Optimize for organizational effectiveness. The platform is healthy when all value streams are flowing, agents are performing, and strategic priorities are advancing.",
      domainTools: ["list_products", "get_product", "list_backlog_items", "search_products"],
    },
  };

  let count = 0;
  for (const [slugId, ctx] of Object.entries(contexts)) {
    const agent = await prisma.agent.findFirst({ where: { OR: [{ agentId: slugId }, { slugId }] } });
    if (!agent) { console.warn(`  → Agent ${slugId} not found, skipping prompt context`); continue; }

    await prisma.agentPromptContext.upsert({
      where: { agentId: agent.id },
      update: ctx,
      create: { agentId: agent.id, ...ctx },
    });
    count++;
  }
  console.log(`Seeded ${count} agent prompt contexts`);
}

/** EP-AI-WORKFORCE-001: Seed feature degradation mappings */
async function seedFeatureDegradationMappings(): Promise<void> {
  const mappings: Array<{ agentSlug: string; featureRoute: string; featureName: string; requiredTier: string; degradationMode: string; userMessage: string }> = [
    { agentSlug: "build-specialist", featureRoute: "/build", featureName: "Build Studio code generation", requiredTier: "strong", degradationMode: "reduced", userMessage: "Code generation is running on a basic model. Complex implementations may need manual review." },
    { agentSlug: "doc-specialist", featureRoute: "/docs", featureName: "Documentation review", requiredTier: "adequate", degradationMode: "manual_only", userMessage: "Documentation review is temporarily unavailable. Manual review required." },
    { agentSlug: "doc-specialist", featureRoute: "/build", featureName: "Diagram generation in builds", requiredTier: "adequate", degradationMode: "reduced", userMessage: "Diagram generation is running on a basic model. Complex diagrams may have errors." },
    { agentSlug: "portfolio-advisor", featureRoute: "/portfolio", featureName: "Portfolio health analysis", requiredTier: "adequate", degradationMode: "reduced", userMessage: "Portfolio analysis is running on a basic model. Results may be less detailed." },
    { agentSlug: "ea-architect", featureRoute: "/ea", featureName: "Architecture governance", requiredTier: "adequate", degradationMode: "reduced", userMessage: "Architecture analysis is running on a basic model. Complex dependency analysis may be limited." },
  ];

  let count = 0;
  for (const m of mappings) {
    const agent = await prisma.agent.findFirst({ where: { OR: [{ agentId: m.agentSlug }, { slugId: m.agentSlug }] } });
    if (!agent) { console.warn(`  → Agent ${m.agentSlug} not found, skipping degradation mapping`); continue; }

    await prisma.featureDegradationMapping.upsert({
      where: { agentId_featureRoute: { agentId: agent.id, featureRoute: m.featureRoute } },
      update: { featureName: m.featureName, requiredTier: m.requiredTier, degradationMode: m.degradationMode, userMessage: m.userMessage },
      create: { agentId: agent.id, featureRoute: m.featureRoute, featureName: m.featureName, requiredTier: m.requiredTier, degradationMode: m.degradationMode, userMessage: m.userMessage },
    });
    count++;
  }
  console.log(`Seeded ${count} feature degradation mappings`);
}

async function seedPlatformConfig(): Promise<void> {
  await prisma.platformConfig.upsert({
    where: { key: "USE_UNIFIED_COWORKER" },
    update: {},
    create: { key: "USE_UNIFIED_COWORKER", value: { enabled: false } },
  });
  // EP-COWORKER-LIFECYCLE Phase 3: when enabled, the lifecycle gate also
  // blocks coworkers whose last behavioral certification FAILED (draft and
  // retirement stages are always blocked). Ships off so grandfathered agents
  // keep working until certification sweeps are established on the install.
  await prisma.platformConfig.upsert({
    where: { key: "COWORKER_LIFECYCLE_STRICT" },
    update: {},
    create: { key: "COWORKER_LIFECYCLE_STRICT", value: { enabled: false } },
  });
  await prisma.platformConfig.upsert({
    where: { key: "self_upgrade" },
    update: {},
    create: {
      key: "self_upgrade",
      value: {
        enabled: process.env.DPF_SELF_UPGRADE_ENABLED !== "false",
        hostInstallPath: process.env.DPF_HOST_INSTALL_PATH ?? "/workspace",
        hostSourceMountPath: process.env.DPF_SELF_UPGRADE_HOST_SOURCE_MOUNT ?? "/host-dpf",
        composeProject: process.env.COMPOSE_PROJECT_NAME ?? "dpf",
        portalContainerName: process.env.DPF_PRODUCTION_PORTAL_CONTAINER ?? "dpf-portal-1",
        dbContainerName: process.env.DPF_PRODUCTION_DB_CONTAINER ?? "dpf-postgres-1",
        repositoryRemote: process.env.DPF_SELF_UPGRADE_REMOTE ?? "origin",
        repositoryBranch: process.env.DPF_SELF_UPGRADE_BRANCH ?? "main",
        healthUrl: process.env.DPF_SELF_UPGRADE_HEALTH_URL ?? "http://localhost:3000/api/health",
        promoterImage: process.env.DPF_PROMOTER_IMAGE ?? "dpf-promoter",
      },
    },
  });
  console.log("Seeded platform config flags");
}

/**
 * Generate a stable pseudonymous client identity at first install.
 * Called every seed — only writes if clientId is not already set.
 *
 * Identity design for 10,000-client hive (see identity-privacy.ts):
 * - email: agent-<sha256(clientId)[:16]>@hive.dpf  — unique per install
 * - name:  derived at render time as "dpf-agent-<first 8 chars of the email hash>"
 *
 * The SHA256 hash of the clientId means:
 * - The same install always produces the same pseudonym (stable across restarts)
 * - Two installs never collide (UUID entropy + 2^32 name namespace)
 * - The upstream repo sees a distinguishable pseudonymous contributor
 * - The hash cannot be reverse-engineered to reveal the client or their org
 * - Repeat contributions from one install group under one pseudonym in GitHub UI
 */
async function seedClientIdentity(): Promise<void> {
  const existing = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { clientId: true, gitAgentEmail: true },
  });

  // Already initialized — never regenerate (would change git author history)
  if (existing?.clientId && existing?.gitAgentEmail) {
    console.log(`[seed] Client identity already set: ${existing.gitAgentEmail}`);
    return;
  }

  const clientId = crypto.randomUUID();
  const hash = crypto.createHash("sha256").update(clientId).digest("hex").slice(0, 16);
  const gitAgentEmail = `agent-${hash}@hive.dpf`;

  await prisma.platformDevConfig.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      clientId,
      gitAgentEmail,
      // Fail-closed default for a fresh install (EP-1A78BAE1): keep everything
      // private until the operator opts into contributing. Set explicitly here
      // rather than via the column default so the 2-state intent is unambiguous.
      contributionMode: "private",
    },
    update: {
      clientId,
      gitAgentEmail,
    },
  });

  const shortId = hash.slice(0, 8);
  console.log(`[seed] Client identity generated: dpf-agent-${shortId} <${gitAgentEmail}>`);
}

/**
 * Seed the hive-contribution credential entry.
 *
 * If HIVE_CONTRIBUTION_TOKEN env var is set, stores it as the credential.
 * Otherwise creates an "unconfigured" placeholder so the admin UI knows
 * the provider exists. The token enables anonymous direct-branch-push
 * contributions to the upstream repo (Option B in the contribution model).
 */
async function seedHiveContributionCredential(): Promise<void> {
  const token = process.env.HIVE_CONTRIBUTION_TOKEN;

  await prisma.credentialEntry.upsert({
    where: { providerId: "hive-contribution" },
    create: {
      providerId: "hive-contribution",
      secretRef: token ?? null,
      status: token ? "active" : "unconfigured",
    },
    // Never overwrite an active credential on re-seed — admin may have
    // changed it via the portal. Only upgrade unconfigured → active.
    update: token
      ? { secretRef: token, status: "active" }
      : {},
  });

  console.log(`[seed] Hive contribution credential: ${token ? "active (from env)" : "unconfigured"}`);
}

/**
 * Seed provider registry from the JSON file.
 *
 * This MUST run before seedCodexModels/seedLocalModels/seedChatGPTModels
 * because those functions look up providers by providerId. On a fresh
 * install, if providers don't exist yet, those functions silently skip
 * and the platform starts with no working AI routing.
 *
 * Previously this only ran when an admin visited /platform/ai/providers
 * and clicked "Update Providers" — a manual step that was easy to miss.
 */
async function seedProviderRegistry(): Promise<void> {
  const registryPath = join(__dirname, "..", "data", "providers-registry.json");
  if (!existsSync(registryPath)) {
    console.warn("[seed] providers-registry.json not found — skipping provider seed");
    return;
  }

  let entries: Array<Record<string, unknown>>;
  try {
    entries = JSON.parse(readFileSync(registryPath, "utf-8"));
  } catch (err) {
    console.warn("[seed] Failed to parse providers-registry.json:", err);
    return;
  }

  let added = 0;
  let updated = 0;

  function inferServiceKind(entry: Record<string, unknown>): "mcp" | "built_in" | undefined {
    if (entry.endpointType !== "service") return undefined;
    const explicit = entry.serviceKind;
    if (explicit === "mcp" || explicit === "built_in") return explicit;
    if (["brave-search", "public-fetch", "public-web-fetch", "branding-analyzer"].includes(String(entry.providerId))) {
      return "built_in";
    }
    return "mcp";
  }

  function buildCatalogEntry(entry: Record<string, unknown>): Prisma.InputJsonValue | undefined {
    const existing = entry.catalogEntry;
    const value = {
      ...(existing && typeof existing === "object" && !Array.isArray(existing)
        ? existing as Record<string, unknown>
        : {}),
      ...(typeof entry.catalogProviderId === "string"
        ? { catalogProviderId: entry.catalogProviderId }
        : {}),
      ...(entry.trustCatalog && typeof entry.trustCatalog === "object" && !Array.isArray(entry.trustCatalog)
        ? { trustCatalog: entry.trustCatalog }
        : {}),
    };
    return Object.keys(value).length > 0 ? value as Prisma.InputJsonValue : undefined;
  }

  for (const entry of entries) {
    const providerId = entry.providerId as string;
    if (!providerId) continue;
    const serviceKind = inferServiceKind(entry);
    const catalogEntry = buildCatalogEntry(entry);

    const existing = await prisma.modelProvider.findUnique({ where: { providerId } });
    if (existing) {
      // Slice 1.5 backfill: rows that pre-date the auto-activate logic may
      // exist with status='unconfigured' and/or empty sensitivityClearance
      // for non-LLM authMethod='none' providers. Flip them to active + full
      // local clearance on reseed so existing installs don't need manual SQL
      // to get voice working. Admin-configured rows (status='active' already,
      // clearance already set) are left alone — the .length===0 gate
      // preserves operator intent.
      //
      // LLM providers (local Docker Model Runner, Ollama) are excluded:
      // they depend on runtime model discovery (seedLocalModels) to acquire
      // active ModelProfile rows. Activating an LLM provider without models
      // trips INV-2 ("active LLM provider with zero active model profiles")
      // in the routing-invariants audit.
      //
      // Edge case: providers like local/ollama that omit `endpointType` in
      // the JSON catalog get the schema default of "llm" when inserted, but
      // on UPDATE we read from `existing.endpointType` which is always set.
      // Default to "llm" on missing — safest for the invariant.
      const effectiveAuthMethod =
        (existing.authMethod as string | null) ??
        (entry.authMethod as string | undefined);
      const effectiveEndpointType =
        (existing.endpointType as string | null) ??
        (entry.endpointType as string | undefined) ??
        "llm";
      const isAutoActivateEligible =
        effectiveAuthMethod === "none" && effectiveEndpointType !== "llm";
      const existingClearance = (existing.sensitivityClearance as string[]) ?? [];
      const shouldBackfillStatus =
        isAutoActivateEligible && existing.status === "unconfigured";
      const shouldBackfillClearance =
        isAutoActivateEligible && existingClearance.length === 0;

      // Update metadata but preserve admin config (status, endpoint, enabledFamilies)
      await prisma.modelProvider.update({
        where: { providerId },
        data: {
          name: entry.name as string,
          families: (entry.families as string[]) ?? [],
          category: entry.category as string ?? "direct",
          baseUrl: (entry.baseUrl as string) ?? null,
          authMethod: existing.authMethod ?? (entry.authMethod as string) ?? "none",
          supportedAuthMethods: (entry.supportedAuthMethods as string[]) ?? [],
          authHeader: (entry.authHeader as string) ?? null,
          costModel: entry.costModel as string ?? "token",
          ...(entry.inputPricePerMToken !== undefined && { inputPricePerMToken: entry.inputPricePerMToken as number }),
          ...(entry.outputPricePerMToken !== undefined && { outputPricePerMToken: entry.outputPricePerMToken as number }),
          ...(entry.computeWatts !== undefined && { computeWatts: entry.computeWatts as number }),
          ...(entry.electricityRateKwh !== undefined && { electricityRateKwh: entry.electricityRateKwh as number }),
          docsUrl: (entry.docsUrl as string) ?? null,
          consoleUrl: (entry.consoleUrl as string) ?? null,
          ...(entry.billingLabel !== undefined && { billingLabel: entry.billingLabel as string }),
          ...(entry.costPerformanceNotes !== undefined && { costPerformanceNotes: entry.costPerformanceNotes as string }),
          ...(entry.catalogVisibility !== undefined && { catalogVisibility: entry.catalogVisibility as string }),
          ...(catalogEntry !== undefined && { catalogEntry }),
          ...(entry.endpointType !== undefined && { endpointType: entry.endpointType as string }),
          ...(serviceKind !== undefined && { serviceKind }),
          ...(entry.supportsToolUse !== undefined && { supportsToolUse: entry.supportsToolUse as boolean }),
          ...(entry.cliEngine !== undefined && { cliEngine: entry.cliEngine as string | null }),
          ...(entry.authorizeUrl !== undefined && { authorizeUrl: (entry.authorizeUrl as string) ?? null }),
          ...(entry.tokenUrl !== undefined && { tokenUrl: (entry.tokenUrl as string) ?? null }),
          ...(entry.oauthClientId !== undefined && { oauthClientId: (entry.oauthClientId as string) ?? null }),
          ...(entry.oauthRedirectUri !== undefined && { oauthRedirectUri: (entry.oauthRedirectUri as string) ?? null }),
          ...(shouldBackfillStatus && { status: "active" }),
          ...(shouldBackfillClearance && {
            sensitivityClearance: ["public", "internal", "confidential", "restricted"],
          }),
        },
      });
      updated++;
    } else {
      // Slice 1.5: non-LLM auth-none providers (the STT sidecar today, future
      // TTS/embedding sidecars) auto-activate on a fresh install so the
      // operator doesn't need to click anything to make voice work.
      // Providers requiring OAuth / API keys correctly start unconfigured.
      // Voice Slice 1.5: docs/superpowers/specs/2026-05-17-voice-input-slice-1-5-default-on-cpu.md
      //
      // LLM providers (local Docker Model Runner, Ollama) — even with
      // authMethod=none — STAY unconfigured. They depend on runtime model
      // discovery (seedLocalModels) to acquire active ModelProfile rows;
      // activating them without models trips INV-2 in the routing-invariants
      // audit. seedLocalModels owns flipping them active+cleared lazily.
      //
      // Edge case: providers like local/ollama in the JSON catalog omit
      // `endpointType` — the schema default is "llm" but applies AFTER
      // insert. Treat missing as "llm" for the purposes of the
      // auto-activate predicate so we don't accidentally activate them.
      //
      // Active providers MUST declare sensitivityClearance (enforced by
      // assertActiveProvidersHaveClearance). Local sidecars never send data
      // off-machine, so we grant the full clearance set.
      const effectiveEntryEndpointType =
        (entry.endpointType as string | undefined) ?? "llm";
      const isAutoActivateEligible =
        (entry.authMethod as string | undefined) === "none" &&
        effectiveEntryEndpointType !== "llm";
      const initialStatus = isAutoActivateEligible ? "active" : "unconfigured";
      const initialClearance = isAutoActivateEligible
        ? ["public", "internal", "confidential", "restricted"]
        : [];
      await prisma.modelProvider.create({
        data: {
          providerId,
          name: entry.name as string ?? providerId,
          families: (entry.families as string[]) ?? [],
          enabledFamilies: [],
          status: initialStatus,
          sensitivityClearance: initialClearance,
          category: entry.category as string ?? "direct",
          baseUrl: (entry.baseUrl as string) ?? null,
          authMethod: entry.authMethod as string ?? "none",
          supportedAuthMethods: (entry.supportedAuthMethods as string[]) ?? [],
          authHeader: (entry.authHeader as string) ?? null,
          costModel: entry.costModel as string ?? "token",
          inputPricePerMToken: (entry.inputPricePerMToken as number) ?? null,
          outputPricePerMToken: (entry.outputPricePerMToken as number) ?? null,
          computeWatts: (entry.computeWatts as number) ?? null,
          electricityRateKwh: (entry.electricityRateKwh as number) ?? null,
          docsUrl: (entry.docsUrl as string) ?? null,
          consoleUrl: (entry.consoleUrl as string) ?? null,
          billingLabel: (entry.billingLabel as string) ?? null,
          costPerformanceNotes: (entry.costPerformanceNotes as string) ?? null,
          catalogVisibility: (entry.catalogVisibility as string) ?? "visible",
          ...(catalogEntry !== undefined && { catalogEntry }),
          ...(entry.endpointType !== undefined && { endpointType: entry.endpointType as string }),
          ...(serviceKind !== undefined && { serviceKind }),
          ...(entry.supportsToolUse !== undefined && { supportsToolUse: entry.supportsToolUse as boolean }),
          ...(entry.cliEngine !== undefined && { cliEngine: entry.cliEngine as string | null }),
          authorizeUrl: (entry.authorizeUrl as string) ?? null,
          tokenUrl: (entry.tokenUrl as string) ?? null,
          oauthClientId: (entry.oauthClientId as string) ?? null,
          oauthRedirectUri: (entry.oauthRedirectUri as string) ?? null,
        },
      });
      added++;
    }
    await ensureDefaultProviderConnection(prisma, {
      providerId,
      name: String(entry.name ?? providerId),
      category: String(entry.category ?? "direct"),
      authMethod: String(entry.authMethod ?? "none"),
      ...(typeof entry.endpointType === "string" ? { endpointType: entry.endpointType } : {}),
    }, existing?.status);
  }

  console.log(`[seed] Provider registry: ${added} added, ${updated} updated (${entries.length} total)`);
}

/**
 * Discover and profile local LLM models from Docker Model Runner.
 * Runs at seed time so the routing system has endpoints immediately
 * without waiting for a page visit to trigger checkBundledProviders().
 */
async function seedLocalModels(): Promise<void> {
  const provider = await prisma.modelProvider.findFirst({
    where: { providerId: "local" },
  });
  if (!provider) return;

  const baseUrl = process.env.LLM_BASE_URL ?? provider.baseUrl ?? "http://model-runner.docker.internal/v1";
  const modelsUrl = baseUrl.includes("/v1") ? `${baseUrl}/models` : `${baseUrl}/v1/models`;

  let models: Array<{ id: string }> = [];
  try {
    const res = await fetch(modelsUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) { console.log("  → Local LLM not reachable, skipping model discovery"); return; }
    const data = await res.json() as { data?: Array<{ id: string }> };
    models = data.data ?? [];
  } catch {
    console.log("  → Local LLM not reachable, skipping model discovery");
    return;
  }

  if (models.length === 0) { console.log("  → No local models found"); return; }

  // Activate provider and grant full sensitivity clearance (local = data never leaves machine).
  // The installer guarantees a model pull (or pre-existing model) *before* portal up
  // for the bundled Docker Model Runner case. If models are visible at seed time,
  // we treat "disabled" (possible initial seed state or prior manual disable) the same
  // as "unconfigured" so the provider comes up enabled by default. This avoids the
  // first-experience "disabled + unknown:unknown" state when the pull succeeded pre-portal.
  if (
    provider.status === "unconfigured" ||
    provider.status === "disabled" ||
    (provider.sensitivityClearance as string[]).length === 0
  ) {
    await activateProviderWithDefaultConnection(prisma, {
      providerId: "local",
      sensitivityClearance: ["public", "internal", "confidential", "restricted"],
    });
  }

  let discovered = 0;
  for (const m of models) {
    // Upsert DiscoveredModel
    await prisma.discoveredModel.upsert({
      where: { providerId_modelId: { providerId: "local", modelId: m.id } },
      create: { providerId: "local", modelId: m.id, rawMetadata: m as any },
      update: { rawMetadata: m as any },
    });

    // Upsert a basic ModelProfile so routing has an endpoint
    const existing = await prisma.modelProfile.findUnique({
      where: { providerId_modelId: { providerId: "local", modelId: m.id } },
    });
    if (existing && (existing.modelStatus === "retired" || existing.retiredAt !== null)) {
      // DMR lists this model right now, so it is loadable — a retired profile
      // here is a stale tombstone from an outage-time 404 or a dedupe
      // migration (BI-84792669 deferred exactly this reactivation decision).
      // Healing at boot keeps the bundled local fallback routable without
      // waiting for the next discovery cycle (BI-B6B8C1F9).
      //
      // The `retiredAt !== null` arm matters independently of modelStatus:
      // queryEndpointManifests (apps/web/lib/routing/loader.ts) filters on
      // `retiredAt: null`, NOT on modelStatus, so a row can read
      // modelStatus="active" in the admin UI while being invisible to routing.
      // A transient local-engine admission timeout auto-retires the bundled
      // model and leaves exactly that split state; because the old condition
      // only matched modelStatus="retired", boot never healed it. On an install
      // where the local model is the ONLY provider cleared for restricted data,
      // that silently removed the last eligible endpoint and every HR/finance
      // coworker request failed with "No AI model can handle this request right
      // now" — for weeks, with the model itself perfectly healthy.
      await prisma.modelProfile.update({
        where: { id: existing.id },
        data: { modelStatus: "active", retiredAt: null, retiredReason: null },
      });
      console.log(`  ↻ Reactivated retired local model profile ${m.id} (currently listed by DMR)`);
    }
    if (!existing) {
      // Capability-aware bootstrap prior, keyed on model family. These are only
      // priors (profileSource="seed", confidence "low") — the activation-time
      // deterministic dimension eval promotes them to "evaluated" with measured
      // scores. Replaces the prior flat toolFidelity=20 that made routing unable
      // to distinguish a strong tool-caller from a reasoning model from an
      // embedding model. See packages/db/src/local-model-capabilities.ts.
      const prior = deriveLocalModelCapabilityPrior(m.id);
      await prisma.modelProfile.create({
        data: {
          providerId: "local",
          modelId: m.id,
          friendlyName: m.id.replace(/^docker\.io\/ai\//, "").replace(/^ai\//, ""),
          summary: prior.isEmbedding
            ? "Local embedding model via Docker Model Runner"
            : "Local model via Docker Model Runner",
          capabilityCategory: prior.capabilityCategory,
          costTier: "free",
          bestFor: prior.bestFor,
          avoidFor: prior.avoidFor,
          modelStatus: "active",
          generatedBy: "system:seed",
          profileSource: "seed",
          profileConfidence: "low",
          supportsToolUse: prior.supportsToolUse,
          reasoning: prior.reasoning, codegen: prior.codegen, toolFidelity: prior.toolFidelity,
          instructionFollowingScore: prior.instructionFollowingScore,
          structuredOutputScore: prior.structuredOutputScore,
          conversational: prior.conversational, contextRetention: prior.contextRetention,
          // imageInput/audioInput drive the routing floors so vision/audio tasks
          // can select a multimodal local model (e.g. Gemma 4) with no provider pin.
          capabilities: {
            streaming: true,
            embedding: prior.isEmbedding,
            ...(prior.supportsVision ? { imageInput: true } : {}),
            ...(prior.supportsAudio ? { audioInput: true } : {}),
          } as any,
          // An embedding model must never be born modelClass="chat" (the schema
          // default): routing would dispatch chat completions at an
          // embeddings-only llama.cpp context, which 500s with "the current
          // context does not logits computation".
          modelClass: prior.isEmbedding ? "embedding" : "chat",
          inputModalities: localInputModalities(prior),
          outputModalities: localOutputModalities(m.id),
          supportedModalities: {
            input: localInputModalities(prior),
            output: localOutputModalities(m.id),
          },
        },
      });
      discovered++;
    }
  }
  console.log(`  ✓ Discovered ${models.length} local model(s), ${discovered} new profile(s)`);
}

/**
 * Seed known Codex models. OAuth agent providers can't discover models
 * via /v1/models, so we seed them from the registry.
 */
async function seedCodexModels(): Promise<void> {
  const codexFamilies = ["gpt-5.4", "gpt-5.3-codex", "codex-mini"];

  // Ensure codex provider exists and is active. Codex remains the canonical
  // OAuth-backed route for governed custom-tool coworker work.
  await prisma.modelProvider.upsert({
    where: { providerId: "codex" },
    create: {
      providerId: "codex",
      name: "Codex (OpenAI)",
      families: codexFamilies,
      enabledFamilies: codexFamilies,
      status: "active",
      endpointType: "responses",
      supportsToolUse: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      sensitivityClearance: ["public", "internal", "confidential"],
    },
    update: {
      status: "active",
      supportsToolUse: true,
      sensitivityClearance: ["public", "internal", "confidential"],
    },
  });

  // INTENTIONALLY NO PIN for build-specialist.
  //
  // Previous seed pinned build-specialist to codex/gpt-5.4 so "it gets MCP
  // tools". That framing was obsolete after two shipments:
  //   * #107 introduced provider-tier preference so user-configured
  //     providers always beat bundled local in routing — no pin needed to
  //     keep build-specialist off Gemma4.
  //   * Coworker tool execution is routed by capability floor and backend
  //     contract, not by hard provider pins.
  //
  // Per feedback_no_provider_pinning: routing picks the right LLM for the
  // job from capability tier + task type. Pins are a lie about the world —
  // they force one model regardless of health, superseded by better ones,
  // or actual task fit. No agent in the system should have a seeded pin.
  // If build-specialist needs specific capabilities, encode them in
  // minimumCapabilities / minimumTier / requiredModelClass (done below in
  // seedAgentModelDefaults).

  const provider = await prisma.modelProvider.findFirst({ where: { providerId: "codex" } });
  if (!provider) return;

  const codeModels = [
    {
      modelId: "gpt-5.3-codex",
      friendlyName: "GPT-5 Codex",
      summary: "OpenAI flagship Codex coding model — advanced coding, reasoning, and tool use",
      modelClass: "code",
      costTier: "$$$",
      bestFor: ["coding", "reasoning", "agentic-tasks"] as string[],
      avoidFor: ["conversation"] as string[],
      reasoning: 88, codegen: 96, toolFidelity: 80,
      instructionFollowingScore: 86, structuredOutputScore: 84,
      conversational: 50, contextRetention: 78,
    },
    {
      modelId: "gpt-5.4",
      friendlyName: "GPT-5.4 (Codex)",
      summary: "OpenAI GPT-5.4 via Codex — supports custom function tools via the Responses API",
      modelClass: "code",
      costTier: "$$$$",
      bestFor: ["coding", "reasoning", "tool-use"] as string[],
      avoidFor: [] as string[],
      reasoning: 95, codegen: 97, toolFidelity: 80,
      instructionFollowingScore: 93, structuredOutputScore: 92,
      conversational: 85, contextRetention: 90,
    },
    {
      modelId: "codex-mini-latest",
      friendlyName: "Codex Mini",
      summary: "OpenAI Codex mini model — retained for catalog visibility, but disabled by default for platform routing",
      modelClass: "code",
      costTier: "$$",
      bestFor: ["coding", "agentic-tasks"] as string[],
      avoidFor: ["conversation", "custom-tool-use"] as string[],
      reasoning: 70, codegen: 90, toolFidelity: 10,
      instructionFollowingScore: 80, structuredOutputScore: 70,
      conversational: 40, contextRetention: 60,
    },
  ];

  let created = 0;
  let updated = 0;
  for (const m of codeModels) {
    await prisma.discoveredModel.upsert({
      where: { providerId_modelId: { providerId: "codex", modelId: m.modelId } },
      create: { providerId: "codex", modelId: m.modelId, rawMetadata: { id: m.modelId } as any, lastSeenAt: new Date() },
      update: {},
    });
    const existing = await prisma.modelProfile.findUnique({
      where: { providerId_modelId: { providerId: "codex", modelId: m.modelId } },
      select: { profileSource: true },
    });
    const scoreFields = {
      reasoning: m.reasoning, codegen: m.codegen, toolFidelity: m.toolFidelity,
      instructionFollowingScore: m.instructionFollowingScore, structuredOutputScore: m.structuredOutputScore,
      conversational: m.conversational, contextRetention: m.contextRetention,
    };
    if (!existing) {
      await prisma.modelProfile.create({
        data: {
          providerId: "codex",
          modelId: m.modelId,
          friendlyName: m.friendlyName,
          summary: m.summary,
          capabilityCategory: "advanced",
          costTier: m.costTier,
          bestFor: m.bestFor,
          avoidFor: m.avoidFor,
          modelClass: m.modelClass,
          modelStatus: m.modelId === "codex-mini-latest" ? "disabled" : "active",
          generatedBy: "system:seed",
          profileSource: "seed",
          profileConfidence: "medium",
          maxContextTokens: m.modelId === "gpt-5.4" ? 1000000 : 128000,
          maxOutputTokens: m.modelId === "gpt-5.4" ? 128000 : 16384,
          supportsToolUse: m.modelId !== "codex-mini-latest",
          capabilities: { toolUse: m.modelId !== "codex-mini-latest", streaming: true, structuredOutput: true } as any,
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
          ...scoreFields,
        },
      });
      created++;
    } else if (existing.profileSource === "seed") {
      // Refresh scores AND capability flags from catalog when profile hasn't been overridden by eval or admin.
      // EP-AGENT-CAP-002 fix: capability flags must be refreshed alongside scores,
      // otherwise a stale supportsToolUse=false survives even after profileSource is reset to 'seed'.
      await prisma.modelProfile.update({
        where: { providerId_modelId: { providerId: "codex", modelId: m.modelId } },
        data: {
          ...scoreFields,
          supportsToolUse: m.modelId !== "codex-mini-latest",
          capabilities: { toolUse: m.modelId !== "codex-mini-latest", streaming: true, structuredOutput: true } as any,
        },
      });
      updated++;
    }
  }
  if (created > 0 || updated > 0) console.log(`  Seeded ${created} / updated ${updated} Codex model profile(s)`);
}

  /**
   * Seed ChatGPT subscription models under the chatgpt provider.
   * These are chat models accessed via the same OpenAI OAuth as Codex.
   * The chatgpt provider is auto-activated when Codex OAuth completes.
   */
async function seedChatGPTModels(): Promise<void> {
  const provider = await prisma.modelProvider.findFirst({ where: { providerId: "chatgpt" } });
  if (!provider) return;

  const models = [
    {
      modelId: "gpt-5.4",
      friendlyName: "GPT-5.4 (ChatGPT Subscription)",
      // ChatGPT backend (/codex/responses) does not support custom function tools —
      // only built-in Codex tools work. toolFidelity=10 so the router skips this
      // endpoint for any task that requires tool use.
      summary: "OpenAI GPT-5.4 via ChatGPT subscription — conversation and coding only (no custom tool use)",
      bestFor: ["conversation", "coding", "general-purpose", "reasoning"] as string[],
      avoidFor: ["custom-tool-use"] as string[],
      reasoning: 85, codegen: 90, toolFidelity: 10,
      instructionFollowingScore: 85, structuredOutputScore: 80,
      conversational: 80, contextRetention: 75,
    },
  ];

  let created = 0;
  let updated = 0;
  for (const m of models) {
    const existing = await prisma.modelProfile.findUnique({
      where: { providerId_modelId: { providerId: "chatgpt", modelId: m.modelId } },
      select: { profileSource: true },
    });
    const scoreFields = {
      reasoning: m.reasoning, codegen: m.codegen, toolFidelity: m.toolFidelity,
      instructionFollowingScore: m.instructionFollowingScore, structuredOutputScore: m.structuredOutputScore,
      conversational: m.conversational, contextRetention: m.contextRetention,
    };
    if (!existing) {
      await prisma.modelProfile.create({
        data: {
          providerId: "chatgpt",
          modelId: m.modelId,
          friendlyName: m.friendlyName,
          summary: m.summary,
          capabilityCategory: "advanced",
          costTier: "subscription",
          bestFor: m.bestFor,
          avoidFor: m.avoidFor,
          modelClass: "chat",
          modelStatus: "active",
          generatedBy: "system:seed",
          profileSource: "seed",
          profileConfidence: "medium",
          maxContextTokens: 128000,
          maxOutputTokens: 16384,
          // ChatGPT backend does not support custom function tools
          supportsToolUse: false,
          capabilities: { toolUse: false, streaming: true, structuredOutput: true, imageInput: true } as any,
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
          ...scoreFields,
        },
      });
      created++;
    } else if (existing.profileSource === "seed") {
      await prisma.modelProfile.update({
        where: { providerId_modelId: { providerId: "chatgpt", modelId: m.modelId } },
        data: {
          ...scoreFields,
          supportsToolUse: false,
          capabilities: { toolUse: false, streaming: true, structuredOutput: true, imageInput: true } as any,
        },
      });
      updated++;
    }
  }
  if (created > 0 || updated > 0) console.log(`  Seeded ${created} / updated ${updated} ChatGPT model profile(s)`);
}

async function seedAnthropicSubScope(): Promise<void> {
  await prisma.credentialEntry.upsert({
    where: { providerId: "anthropic-sub" },
    create: {
      providerId: "anthropic-sub",
      scope: "user:inference user:profile",
      status: "unconfigured",
    },
    update: {},  // preserve existing credentials on re-seed
  });

  // anthropic-sub uses the Claude CLI adapter. Platform tools are injected as
  // tool descriptions, Claude Code native tools are suppressed, and the
  // agentic loop executes parsed platform tool_use events server-side. Keep
  // the seed aligned with that adapter contract so active paid Claude models
  // remain eligible for coworker turns that require tools.
  await prisma.modelProvider.updateMany({
    where: { providerId: "anthropic-sub" },
    data: { supportsToolUse: true },
  });
  await prisma.modelProfile.updateMany({
    where: {
      providerId: "anthropic-sub",
      modelStatus: { in: ["active", "degraded"] },
      NOT: { profileSource: "admin" },
    },
    data: { supportsToolUse: true },
  });
  await prisma.$executeRaw`
    UPDATE "ModelProfile"
    SET "capabilities" = jsonb_set(
      COALESCE("capabilities", '{}'::jsonb),
      '{toolUse}',
      'true'::jsonb,
      true
    )
    WHERE "providerId" = 'anthropic-sub'
      AND "modelStatus" IN ('active', 'degraded')
      AND ("profileSource" IS NULL OR "profileSource" <> 'admin')
      AND NOT (COALESCE("capabilityOverrides", '{}'::jsonb) ? 'toolUse')
  `;

  console.log("Seeded anthropic-sub credential scope (toolUse=true)");
}

/**
 * Ensure model profiles are properly configured for Build Studio.
 * Seed known-good model profiles from exported JSON so fresh installs
 * start with profiled models immediately (no need to run eval pipeline).
 * Only creates profiles that don't already exist — won't overwrite
 * profiles that have been updated by live eval runs.
 */
async function seedModelProfiles(): Promise<void> {
  const profilePath = join(__dirname, "..", "data", "model-profiles.json");
  if (!existsSync(profilePath)) {
    console.log("  No model-profiles.json found — skipping profile seed");
    return;
  }
  const profiles = JSON.parse(readFileSync(profilePath, "utf-8")) as Record<string, unknown>[];
  let created = 0, skipped = 0;
  for (const p of profiles) {
    const providerId = p.providerId as string;
    const modelId = p.modelId as string;
    const existing = await prisma.modelProfile.findUnique({
      where: { providerId_modelId: { providerId, modelId } },
      select: { id: true },
    });
    if (existing) { skipped++; continue; }
    try {
      await prisma.modelProfile.create({ data: toModelProfileSeedCreateData(p) as never });
      created++;
    } catch { skipped++; }
  }
  console.log(`  Seeded ${created} model profiles (${skipped} already existed)`);
}

/**
 * Voice Input Slice 1 / Task 2 — speaches transcription model + perf baseline.
 *
 * Owning plan: docs/superpowers/plans/2026-05-16-voice-input-slice-1-portal-mic.md
 *
 * Idempotent: re-running this seed updates the profile fields (per the standard
 * codex/chatgpt seed pattern, profileSource="seed" rows get refreshed on
 * re-seed; evaluated/admin-tuned rows are preserved).
 *
 * Depends on: seedProviderRegistry() having already created the speaches
 * provider row from packages/db/data/providers-registry.json with
 * endpointType="transcription". If that row is missing, this seed logs a
 * warning and skips — the provider catalog is the source of truth, not
 * this function.
 */
async function seedSpeachesTranscriptionModel(): Promise<void> {
  const provider = await prisma.modelProvider.findUnique({
    where: { providerId: SPEACHES_PROVIDER_ID },
  });
  if (!provider) {
    console.warn(
      `[seed] speaches provider not found in ModelProvider — packages/db/data/providers-registry.json must include providerId='${SPEACHES_PROVIDER_ID}'. Skipping transcription model seed.`,
    );
    return;
  }

  // Slice 1.5: migrate any existing speaches ModelProfile row that points at
  // the legacy speaches modelId ("Systran/faster-distil-whisper-large-v3")
  // — that model only exists in the old speaches sidecar; the new
  // hwdsl2/whisper-server CPU default uses simpler model names like "base".
  // Delete the stale profile + its EndpointTaskPerformance row so endpoint
  // resolution picks the new profile cleanly. Idempotent: no-op on fresh
  // installs.
  const staleProfiles = await prisma.modelProfile.findMany({
    where: {
      providerId: SPEACHES_PROVIDER_ID,
      modelId: { not: SPEACHES_MODEL_ID },
    },
    select: { id: true, modelId: true },
  });
  if (staleProfiles.length > 0) {
    for (const stale of staleProfiles) {
      await prisma.endpointTaskPerformance.deleteMany({
        where: { endpointId: stale.id },
      });
      await prisma.modelProfile.delete({ where: { id: stale.id } });
      console.log(
        `  Cleaned stale speaches ModelProfile (modelId=${stale.modelId}) per Slice 1.5 image swap`,
      );
    }
  }

  // Upsert the ModelProfile. profileSource="seed" + profileSource check at
  // refresh time mirror the codex pattern (seed.ts seedCodexModels).
  const { providerId: _pid, modelId: _mid, ...profileData } = SPEACHES_MODEL_PROFILE_CONFIG;
  const existingProfile = await prisma.modelProfile.findUnique({
    where: { providerId_modelId: { providerId: SPEACHES_PROVIDER_ID, modelId: SPEACHES_MODEL_ID } },
    select: { id: true, profileSource: true },
  });

  let profileId: string;
  if (!existingProfile) {
    const created = await prisma.modelProfile.create({
      data: {
        providerId: SPEACHES_PROVIDER_ID,
        modelId: SPEACHES_MODEL_ID,
        ...profileData,
        bestFor: profileData.bestFor as Prisma.InputJsonValue,
        avoidFor: profileData.avoidFor as Prisma.InputJsonValue,
        inputModalities: profileData.inputModalities as Prisma.InputJsonValue,
        outputModalities: profileData.outputModalities as Prisma.InputJsonValue,
        capabilities: profileData.capabilities as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    profileId = created.id;
    console.log(`  Seeded speaches transcription profile (${SPEACHES_MODEL_ID})`);
  } else if (existingProfile.profileSource === "seed") {
    // Refresh from catalog when the row hasn't been overridden by eval or admin.
    await prisma.modelProfile.update({
      where: { id: existingProfile.id },
      data: {
        ...profileData,
        bestFor: profileData.bestFor as Prisma.InputJsonValue,
        avoidFor: profileData.avoidFor as Prisma.InputJsonValue,
        inputModalities: profileData.inputModalities as Prisma.InputJsonValue,
        outputModalities: profileData.outputModalities as Prisma.InputJsonValue,
        capabilities: profileData.capabilities as Prisma.InputJsonValue,
      },
    });
    profileId = existingProfile.id;
    console.log(`  Refreshed speaches transcription profile (${SPEACHES_MODEL_ID})`);
  } else {
    profileId = existingProfile.id;
    console.log(
      `  Preserved speaches transcription profile (profileSource=${existingProfile.profileSource})`,
    );
  }

  // Upsert the EndpointTaskPerformance baseline. endpointId is the profile cuid.
  // The unique constraint is (endpointId, taskType), so upsert by that pair.
  await prisma.endpointTaskPerformance.upsert({
    where: {
      endpointId_taskType: {
        endpointId: profileId,
        taskType: SPEACHES_ENDPOINT_PERFORMANCE_BASELINE.taskType,
      },
    },
    create: {
      endpointId: profileId,
      modelId: SPEACHES_MODEL_ID,
      ...SPEACHES_ENDPOINT_PERFORMANCE_BASELINE,
      recentScores: [...SPEACHES_ENDPOINT_PERFORMANCE_BASELINE.recentScores] as number[],
      dimensionScores: SPEACHES_ENDPOINT_PERFORMANCE_BASELINE.dimensionScores as Prisma.InputJsonValue,
    },
    update: {
      // Re-seed does NOT clobber accumulated evaluation history — only ensures
      // the row exists. Real telemetry from inference traffic owns the scores.
      modelId: SPEACHES_MODEL_ID,
    },
  });
  console.log(`  Ensured EndpointTaskPerformance(${SPEACHES_PROVIDER_ID}/${SPEACHES_MODEL_ID}, taskType=${SPEACHES_ENDPOINT_PERFORMANCE_BASELINE.taskType})`);
}

  /**
   * Keep Anthropic subscription profiles in a healthy fallback state for
   * Build Studio and coworker flows when Codex is unavailable.
   *
   * This runs on every seed to fix profiles that may have been incorrectly
   * set by model discovery or provider sync.
   */
/**
 * Seed known per-M-token pricing for recognized model-name patterns.
 *
 * Why this matters: cost-per-success ranking in pipeline-v2 compares
 * paid candidates by `pricing.inputPerMToken` + `outputPerMToken`.
 * When pricing is null (as it was for every paid model in model-profiles.json
 * before this seed), every paid candidate gets the same penalized
 * rank of `successProb * 50`, they all tie, and routing picks whichever
 * is first in the list. Net effect: summarization on Opus, code-gen on
 * Opus, greeting on Opus — every task lands on the same model.
 *
 * Using public API rates as proxy values works even for subscription-
 * backed providers (anthropic-sub, codex). The routing uses RELATIVE
 * cost ordering, so as long as Haiku < Sonnet < Opus and cheaper coder
 * models < frontier generalist models, the ranking picks the right
 * model for the job. Real subscription users pay a flat fee; the
 * ranking just tells the router to prefer the cheapest capable option.
 *
 * Only touches rows where pricing.inputPerMToken is currently null —
 * admin-tuned prices are preserved.
 */
async function seedModelPricing(): Promise<void> {
  // Public API rates (per 1M tokens) live in model-pricing-brackets.ts as a
  // pure, unit-tested module (BI-6F42465E). Substring matching means new model
  // versions pick up the right bracket automatically.
  const profiles = await prisma.modelProfile.findMany({
    select: { id: true, providerId: true, modelId: true, pricing: true },
  });

  let updated = 0;
  let skipped = 0;
  for (const mp of profiles) {
    const currentPricing = (mp.pricing as Record<string, unknown>) ?? {};
    // Preserve admin-tuned values: skip if input/output per M is already non-null.
    if (currentPricing.inputPerMToken != null && currentPricing.outputPerMToken != null) {
      skipped++;
      continue;
    }
    const price = resolveSeedPrice(mp.providerId, mp.modelId);
    if (!price) {
      skipped++;
      continue;
    }
    await prisma.modelProfile.update({
      where: { id: mp.id },
      data: {
        pricing: {
          ...currentPricing,
          inputPerMToken: price.inputPerMToken,
          outputPerMToken: price.outputPerMToken,
        } as never,
        inputPricePerMToken: price.inputPerMToken,
        outputPricePerMToken: price.outputPerMToken,
      },
    });
    updated++;
  }
  console.log(`  Seeded pricing for ${updated} model profiles (${skipped} already set or unknown)`);
}

async function ensureBuildStudioModelConfig(): Promise<void> {
  // ── Ensure all current Anthropic models have correct status ──────────────
  // Sonnet 4.6 and Opus 4.6 are the primary models for Build Studio and
  // complex tasks. They must be active with correct scores so routing
  // picks them over Haiku.

  const anthropicModels = await prisma.modelProfile.findMany({
    where: { providerId: "anthropic-sub" },
  });

  for (const mp of anthropicModels) {
    // Sonnet 4.6 and Opus 4.6: ensure active with frontier-tier scores
    if (mp.modelId === "claude-sonnet-4-6" || mp.modelId === "claude-opus-4-6") {
      const updates: Record<string, unknown> = {
        modelStatus: "active",
        retiredAt: null,
        retiredReason: null,
      };
      // Fix scores if they're at the default 50 (below "strong" tier minimum of 70)
      if (mp.codegen <= 50 || mp.toolFidelity <= 50 || mp.reasoning <= 50) {
        Object.assign(updates, {
          codegen: 95, toolFidelity: 95, reasoning: 95,
          instructionFollowingScore: 95, structuredOutputScore: 93,
          conversational: 95, contextRetention: 95,
          qualityTier: "frontier",
          profileSource: "seed",
          profileConfidence: "medium",
        });
        console.log(`  ${mp.modelId}: fixed default-50 scores → frontier (95)`);
      }
      await prisma.modelProfile.update({ where: { id: mp.id }, data: updates as never });
      console.log(`  ${mp.modelId} set to active`);
    }

    // Haiku 4.5: ensure active
    if (mp.modelId === "claude-haiku-4-5-20251001") {
      const updates: Record<string, unknown> = {
        modelStatus: "active",
        retiredAt: null,
      };
      // Fix inflated scores (codegen:100 → 75 for "strong" tier)
      if (mp.codegen > 80 || mp.toolFidelity > 80) {
        Object.assign(updates, {
          codegen: 75, toolFidelity: 75, reasoning: 75,
          instructionFollowingScore: 75, structuredOutputScore: 72,
          conversational: 75, contextRetention: 72,
          qualityTier: "strong",
          profileSource: "seed",
          profileConfidence: "medium",
        });
        console.log(`  ${mp.modelId}: fixed inflated scores → strong (75)`);
      }
      await prisma.modelProfile.update({ where: { id: mp.id }, data: updates as never });
      console.log(`  Haiku 4.5 set to active`);
    }

    // Haiku 3.0: retire — returns empty via subscription OAuth
    if (mp.modelId === "claude-3-haiku-20240307") {
      await prisma.modelProfile.update({
        where: { id: mp.id },
        data: {
          modelStatus: "retired",
          retiredReason: "Claude 3 Haiku returns empty responses via subscription OAuth — use Haiku 4.5 instead",
        },
      });
      console.log("  Haiku 3.0 retired (returns empty via OAuth subscription)");
    }
  }

  console.log("Ensured Build Studio model configuration");
}

/**
 * EP-INF-012: Seed factory-default agent model configuration.
 *
 * Every agent gets an explicit row in AgentModelConfig so the admin UI at
 * /platform/ai/model-assignment shows real values instead of implied
 * code-level defaults.  Admins can change any row without touching code.
 *
 * Uses upsert — existing admin overrides are NOT clobbered.
 */
async function seedAgentModelDefaults(): Promise<void> {
  // No pinnedProviderId / pinnedModelId fields here by design.
  // See feedback_no_provider_pinning: routing picks the right LLM
  // dynamically from capability tier + task type. Pins would overwrite
  // routing's decision and drag agents down to stale models as the
  // provider landscape shifts. Encode real requirements as
  // minimumTier / minimumCapabilities / minimumContextTokens.
  let seeded = 0;
  let existed = 0;
  for (const d of AGENT_MODEL_CONFIG_DEFAULTS) {
    const existing = await prisma.agentModelConfig.findUnique({
      where: { agentId: d.agentId },
    });
    if (existing) {
      const update = resolveAgentModelDefaultUpdate(existing, d);
      if (update) {
        await prisma.agentModelConfig.update({
          where: { agentId: d.agentId },
          data: update,
        });
        console.log(
          `  Updated ${existing.configuredById === null ? "system" : "operator"} config for ${d.agentId}`,
        );
      }
      existed++;
      continue;
    }
    await prisma.agentModelConfig.create({
      data: {
        agentId: d.agentId,
        minimumTier: d.minimumTier,
        budgetClass: d.budgetClass,
        // pinnedProviderId / pinnedModelId deliberately left null —
        // see feedback_no_provider_pinning.
        ...(d.minimumCapabilities !== undefined ? { minimumCapabilities: d.minimumCapabilities } : {}),
        minimumContextTokens: d.minimumContextTokens ?? null,
        configuredAt: new Date(),
        // configuredById left null — system seed, not a user action
      },
    });
    seeded++;
  }
  console.log(`  Seeded ${seeded} agent model defaults (${existed} already configured)`);
}

async function seedWorkQueues(): Promise<void> {
  await prisma.workQueue.upsert({
    where: { queueId: "triage-default" },
    create: {
      queueId: "triage-default",
      name: "Triage",
      queueType: "triage",
      routingPolicy: { mode: "manual", considerAvailability: false, considerPerformance: false, maxConcurrentPerWorker: 10 },
      isActive: true,
    },
    update: {},
  });

  await prisma.workQueue.upsert({
    where: { queueId: "escalation-default" },
    create: {
      queueId: "escalation-default",
      name: "Escalation",
      queueType: "escalation",
      routingPolicy: { mode: "manual", considerAvailability: false, considerPerformance: false, maxConcurrentPerWorker: 10 },
      isActive: true,
    },
    update: {},
  });

  console.log("  Work queues: triage-default, escalation-default");
}

async function main(): Promise<void> {
  console.log("Starting seed...");

  // Fault-isolation: every step runs independently. A failure is recorded and
  // logged loudly but does NOT abort the remaining steps — so an unrelated
  // failure (e.g. a ScheduledJob schema drift) can no longer silently skip the
  // idempotent catalog/provider reconciles that follow on a portal update.
  // Reconciles are upsert/merge only and never delete operator-owned rows
  // (enforced by seed-reconcile-no-wipe.test.ts).
  const failures: Array<{ step: string; error: string }> = [];
  const step = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ step: name, error: message });
      console.error(`  ✗ [seed] step "${name}" FAILED (continuing): ${message}`);
    }
  };

  // Bootstrap org is a hard prerequisite for everything below; if it cannot be
  // created the seed genuinely cannot proceed, so it is intentionally not isolated.
  const bootstrapOrganizationId = await ensureBootstrapOrganization();

  await step("integrationCoverage", () => seedIntegrationCoverage(prisma, bootstrapOrganizationId));
  await step("absorptionPosture", () => seedAbsorptionPosture(prisma));
  await step("stallThresholds", () => seedStallThresholds(prisma));
  await step("geographicData", () => seedGeographicData(prisma));
  await step("taxJurisdictions", () => seedTaxJurisdictions(prisma));
  await step("licenseRequirements", () => seedLicenseRequirements(prisma));
  await step("roles", () => seedRoles());
  await step("governanceReferenceData", () => seedGovernanceReferenceData(prisma));
  await step("workforceReferenceData", () => seedWorkforceReferenceData(prisma));
  await step("portfolios", () => seedPortfolios());
  await step("businessModels", () => seedBusinessModels());
  await step("agents", () => seedAgents());
  await step("coworkerAgents", () => seedCoworkerAgents());
  // BI-53C26E60: §11 Principal convergence applies to agents too, and has to
  // run after BOTH agent seeders — the AGT-* roster and the slug-id coworker
  // rows — because either can introduce an agent with no identity. Without it
  // every `independent: true` review lane attributes to the delegating human.
  await step("agentPrincipals", () => seedAgentPrincipals());
  // EP-AI-WORKFORCE-001: Seed unified agent lifecycle data
  await step("coworkerSkills", () => seedCoworkerSkills());
  await step("agentPromptContexts", () => seedAgentPromptContexts());
  await step("featureDegradationMappings", () => seedFeatureDegradationMappings());
  await step("taxonomyNodes", () => seedTaxonomyNodes());
  await step("discoveryFingerprints", () => seedDiscoveryFingerprints());
  await step("macVendorOui", () => seedMacVendorOui());
  await step("agentControlPlaneMaturity", () => seedAgentControlPlaneMaturity(prisma));
  await step("eaReferenceModels", () => seedEaReferenceModels());
  await step("digitalProducts", () => seedDigitalProducts());
  await step("eaArchimate4", () => seedEaArchimate4());
  await step("eaBpmn20", () => seedEaBpmn20());
  await step("eaSysml2", () => seedEaSysml2());
  await step("eaCrossNotation", () => seedEaCrossNotation());
  await step("eaStructureRules", () => seedEaStructureRules());
  await step("eaViewpoints", () => seedEaViewpoints());
  await step("eaViews", () => seedEaViews());
  await step("eaSysmlAgentAuthority", () => seedEaSysmlAgentAuthority());
  await step("eaSysmlCada", () => seedEaSysmlCada());
  await step("eaSysmlDataAuthority", () => seedEaSysmlDataAuthority());
  await step("dpfSelfRegistration", () => seedDpfSelfRegistration());
  await step("platformSbom", () => seedPlatformSbom());
  await step("coworkerServiceCatalog", () => seedCoworkerServiceCatalog(prisma));
  await step("platformCapabilityPortfolio", () => projectPlatformCapabilities());
  // BI-8F9EDD6C: project AI coworkers as Workforce DigitalProducts under
  // for_employees and back-link Agent.portfolioId + CoworkerService.digitalProductId.
  // Runs after coworkerServiceCatalog so services exist to link.
  await step("coworkerWorkforcePortfolio", () => projectCoworkerWorkforce());
  // BI-D5C9C3F7: project the DOC-1996319D Workforce surfaces (AI Workforce Ops,
  // roster, finance/tax) as for_employees DigitalProducts so surface-to-product
  // mappings are structural, not just documented.
  await step("bomWorkforceSurfaces", () => projectBomWorkforceSurfaces());
  await step("defaultAdminUser", () => seedDefaultAdminUser());
  await step("discoveryTriageScheduledTask", () => ensureDiscoveryTriageScheduledTask(prisma));
  await step("dataModelMirrorScheduledTask", () => ensureDataModelMirrorScheduledTask(prisma));
  await step("bookkeepingCycleScheduledTask", () => ensureBookkeepingCycleScheduledTask(prisma));
  await step("sysmlProjectionScheduledTask", () => ensureSysmlProjectionScheduledTask(prisma));
  await step("selfOptimizationSweepScheduledTask", () => ensureSelfOptimizationSweepScheduledTask(prisma));
  await step("hiveScoutScheduledTask", () => ensureHiveScoutScheduledTask(prisma));
  await step("allBackupScheduledJobs", () => ensureAllBackupScheduledJobs(prisma));
  await step("dataRetentionScheduledJob", () => ensureDataRetentionScheduledJob(prisma));
  await step("inngestRetentionScheduledJob", () => ensureInngestRetentionScheduledJob(prisma));
  await step("contributorInventoryScheduledJob", () => ensureContributorInventoryScheduledJob(prisma));
  await step("mcpServers", () => seedMcpServers());
  await step("sandboxPool", () => seedSandboxPool());
  await step("runtimeTargets", () => seedRuntimeTargets());
  await step("providerRegistry", () => seedProviderRegistry());
  await step("codexModels", () => seedCodexModels());
  await step("chatGPTModels", () => seedChatGPTModels());
  await step("localModels", () => seedLocalModels());
  await step("modelProfiles", () => seedModelProfiles());
  await step("speachesTranscriptionModel", () => seedSpeachesTranscriptionModel());
  await step("anthropicSubScope", () => seedAnthropicSubScope());
  await step("buildStudioModelConfig", () => ensureBuildStudioModelConfig());
  await step("modelPricing", () => seedModelPricing());
  await step("agentModelDefaults", () => seedAgentModelDefaults());
  await step("platformConfig", () => seedPlatformConfig());
  await step("clientIdentity", () => seedClientIdentity());
  await step("hiveContributionCredential", () => seedHiveContributionCredential());
  await step("storefrontArchetypes", () => seedStorefrontArchetypes(prisma));
  // EP-EMPLOYEE-OCCUPATION: occupation registry depends on the storefront archetype
  // catalog (categories) + the coworker roster, so it seeds after both.
  await step("occupations", () => seedOccupations(prisma));
  await step("publicSectorCompliance", () => seedPublicSectorCompliance(prisma));
  await step("cooperativeCompliance", () => seedCooperativeCompliance(prisma));
  await step("lawEnforcementCompliance", () => seedLawEnforcementCompliance(prisma));
  await step("bankingCompliance", () => seedBankingCompliance(prisma));
  await step("ukCorpGovCompliance", () => seedUkCorpGovCompliance(prisma));
  await step("softwareHorizontalCompliance", () => seedSoftwareHorizontalCompliance(prisma));
  await step("hrEmploymentCompliance", () => seedHrEmploymentCompliance(prisma));
  await step("businessOperationsCompliance", () => seedBusinessOperationsCompliance(prisma));
  await step("verticalRecurringCompliance", () => seedVerticalRecurringCompliance(prisma));
  await step("peoplePremisesCompliance", () => seedPeoplePremisesCompliance(prisma));
  await step("industrialVerticalCompliance", () => seedIndustrialVerticalCompliance(prisma));
  await step("businessCapabilityPerspective", async () => {
    const capabilityPerspectiveSeed = await seedBusinessCapabilityPerspective(prisma);
    console.log(
      `  business-capability-perspective: sources=${capabilityPerspectiveSeed.sourcePerspectiveIds.join(",")} ` +
        `active=${capabilityPerspectiveSeed.appliedCount} deactivated=${capabilityPerspectiveSeed.deactivatedCount}`,
    );
  });
  await step("workQueues", () => seedWorkQueues());
  await step("promptTemplates", () => seedPromptTemplates(prisma));
  await step("skills", () => seedSkills(prisma));
  await step("wikiKernel", async () => {
    const wikiSeed = await seedWikiKernel(prisma);
    if (wikiSeed.emptyKernel) {
      console.log("  founder-kernel: empty (no docs/founder-kernel/wiki/ or raw-sources/ content yet)");
    } else {
      const qdrantSummary = wikiSeed.embeddingsSidecarPresent
        ? `qdrant=${wikiSeed.qdrantPointsSeeded}`
        : "qdrant=no-sidecar";
      console.log(
        `  founder-kernel: kernelVersion=${wikiSeed.kernelVersion} ` +
          `pages=${wikiSeed.pageCount} sources=${wikiSeed.sourceCount} ` +
          `orphan-links=${wikiSeed.orphanLinks.length} ${qdrantSummary}`,
      );
    }
  });
  await step("deliberationPatterns", () => seedDeliberationPatterns(prisma));
  await step("decisionPerspective", async () => {
    const decisionPerspectiveSeed = await seedDecisionPerspective(prisma);
    console.log(
      `  decision-perspective: profile=${decisionPerspectiveSeed.profileId} ` +
        `version=${decisionPerspectiveSeed.versionId} materials=${decisionPerspectiveSeed.materialCount}`,
    );
  });
  await step("professionProfiles", async () => {
    const result = await seedProfessionProfiles(prisma);
    console.log(`  profession-profiles: seeded=${result.seeded} skipped=${result.skipped}`);
  });
  await step("professionCorpus", async () => {
    const result = await seedProfessionCorpus(prisma);
    if (result.emptyCorpus) {
      console.log("  profession-corpus: empty (no docs/professions/*/wiki/ content yet)");
    } else {
      const fmt = (cov: Record<string, number>) =>
        Object.entries(cov)
          .map(([k, v]) => `${k}=${v}`)
          .join(",") || "none";
      console.log(
        `  profession-corpus: sources=${result.sourceCount} pages=${result.pageCount} ` +
          `orphan-links=${result.orphanLinks.length} ` +
          `jurisdiction[${fmt(result.jurisdictionCoverage)}] ` +
          `competency[${fmt(result.competencyCoverage)}]`,
      );
    }
  });
  // WSID Phase 6 (BI-3B02FF9C): the corpus pages above become decision-bearing
  // PerspectiveMaterial on their wsid-* profiles, so the profession gate can
  // confirm instead of deferring. Idempotent; never downgrades a tier.
  await step("professionCraftMaterials", async () => {
    const result = await backfillProfessionCraftMaterials(prisma);
    console.log(
      `  profession-craft-materials: scanned=${result.scanned} promoted=${result.promoted} ` +
        `gate-live=${result.gateLive} held-for-review=${result.heldForReview} ` +
        `kept-higher-tier=${result.keptHigherTier} context-only=${result.notDecisionBearing} ` +
        `skipped=${result.skipped.length}`,
    );
    for (const skip of result.skipped) {
      console.warn(`  [profession-craft-materials] SKIP ${skip.slug}: ${skip.reason}`);
    }
  });
  // BI-2535D6F4: ship the founder's recorded seed voice on the platform profile.
  await step("platformVoice", async () => {
    const platformVoice = await seedPlatformVoice(prisma);
    console.log(`  platform-voice: ${platformVoice.status} (clip-copied=${platformVoice.copiedClip})`);
  });
  await step("syncCapabilities", () => syncCapabilities(prisma));
  await step("aiProviderPortfolio", () => projectAiProviders());
  await step("integrationPortfolio", () => projectIntegrations());
  await step("supplyChainPortfolio", () => projectSupplyChain());
  await step("productDependencyGraph", async () => {
    const depRegistry = readJson<{
      digital_products: Array<{
        product_id: string;
        depends_on_product_ids?: string[];
        is_part_of_product_ids?: string[];
      }>;
    }>("digital_product_registry.json");
    await projectProductDependencyGraph({ registryProducts: depRegistry.digital_products });
  });
  await step("backlogPortfolioAttribution", () => backfillBacklogPortfolios());
  // Invariant asserts — isolated so a violation is surfaced in the summary
  // rather than aborting the whole seed (they run after all seeding).
  await step("assert:activeProvidersHaveClearance", () => assertActiveProvidersHaveClearance());
  await step("assert:anthropicSubToolCapability", () => assertAnthropicSubToolCapability());
  await step("assert:coworkerAgentsHaveGrants", () => assertCoworkerAgentsHaveGrants());
  await step("assert:sharedOAuthClientsHaveSharedRedirectUri", () => assertSharedOAuthClientsHaveSharedRedirectUri());

  if (failures.length > 0) {
    console.error(`\n================ SEED INCOMPLETE: ${failures.length} step(s) failed ================`);
    for (const f of failures) console.error(`  - ${f.step}: ${f.error}`);
    console.error("  Surfaced (not swallowed) so a partially-failed update is visible. Other steps still ran.");
    console.error("============================================================================");
    process.exitCode = 1;
  } else {
    console.log("Seed complete.");
  }
}

/**
 * Providers that share an `oauthClientId` (today: codex + chatgpt sharing the
 * OpenAI client `app_EMoamEEZ73f0CkXaXp7hrann`) MUST also share an
 * `oauthRedirectUri`. The upstream OAuth client only accepts redirect URIs
 * present in its registered whitelist; if one provider has the registered URI
 * and a sibling has `null`, the sibling's authorize request gets
 * `error_code: unknown_error` on auth.openai.com BEFORE the callback runs.
 *
 * History: chatgpt's `oauthRedirectUri` was null from 41c1e0a7 (Mar 22) until
 * this guard landed; the regression bypassed all prior OAuth-area "fixes"
 * because none touched the seed. See
 * docs/triage/2026-05-23-chatgpt-oauth-unknown-error.md.
 */
async function assertSharedOAuthClientsHaveSharedRedirectUri(): Promise<void> {
  const providers = await prisma.modelProvider.findMany({
    where: { oauthClientId: { not: null } },
    select: { providerId: true, oauthClientId: true, oauthRedirectUri: true },
  });

  const byClient = new Map<string, Array<{ providerId: string; oauthRedirectUri: string | null }>>();
  for (const p of providers) {
    const clientId = p.oauthClientId as string;
    const bucket = byClient.get(clientId) ?? [];
    bucket.push({ providerId: p.providerId, oauthRedirectUri: p.oauthRedirectUri });
    byClient.set(clientId, bucket);
  }

  const offenders: string[] = [];
  for (const [clientId, members] of byClient.entries()) {
    if (members.length < 2) continue;
    const uniqueUris = new Set(members.map((m) => m.oauthRedirectUri ?? "<null>"));
    if (uniqueUris.size > 1) {
      const detail = members
        .map((m) => `${m.providerId}=${m.oauthRedirectUri ?? "<null>"}`)
        .join(", ");
      offenders.push(`client ${clientId}: ${detail}`);
    }
  }

  if (offenders.length > 0) {
    throw new Error(
      `Seed invariant violated: providers sharing an oauthClientId must share oauthRedirectUri. ` +
        `Offenders: ${offenders.join("; ")}. ` +
        `Set the same oauthRedirectUri on all rows sharing the client_id in providers-registry.json — ` +
        `the upstream OAuth client only accepts pre-registered redirect URIs.`,
    );
  }
}

/**
 * Every active ModelProvider must declare sensitivityClearance. An empty array
 * silently excludes the provider from all routing (hard-filter in pipeline-v2),
 * which has caused the Codex pin to regress repeatedly after Docker rebuilds.
 * Fail the seed loudly rather than ship a broken configuration.
 */
async function assertActiveProvidersHaveClearance(): Promise<void> {
  const offenders = await prisma.modelProvider.findMany({
    where: { status: "active" },
    select: { providerId: true, name: true, sensitivityClearance: true },
  });
  const empty = offenders.filter(
    (p) => !Array.isArray(p.sensitivityClearance) || p.sensitivityClearance.length === 0,
  );
  if (empty.length > 0) {
    const list = empty.map((p) => `${p.providerId} (${p.name})`).join(", ");
    throw new Error(
      `Seed invariant violated: active providers without sensitivityClearance: ${list}. ` +
        `Add sensitivityClearance to the relevant seed function (see seedLocalModels/seedCodexModels for reference).`,
    );
  }
}

/**
 * anthropic-sub is the paid subscription provider most likely to be active on
 * local installs. If its tool capability seed drifts false, every coworker
 * with the default toolUse floor routes to the bundled local model even though
 * Claude is connected. Fail seed instead of silently shipping that state.
 */
async function assertAnthropicSubToolCapability(): Promise<void> {
  const provider = await prisma.modelProvider.findUnique({
    where: { providerId: "anthropic-sub" },
    select: { status: true, supportsToolUse: true },
  });
  if (!provider || (provider.status !== "active" && provider.status !== "degraded")) return;

  const profiles = await prisma.modelProfile.findMany({
    where: {
      providerId: "anthropic-sub",
      modelStatus: { in: ["active", "degraded"] },
      retiredAt: null,
    },
    select: {
      modelId: true,
      supportsToolUse: true,
      capabilities: true,
      capabilityOverrides: true,
      profileSource: true,
    },
  });

  const offenders = profiles.filter((profile) => {
    const overrides = profile.capabilityOverrides as Record<string, unknown> | null;
    if (profile.profileSource === "admin" || (overrides && "toolUse" in overrides)) {
      return false;
    }
    const capabilities =
      profile.capabilities &&
      typeof profile.capabilities === "object" &&
      !Array.isArray(profile.capabilities)
        ? (profile.capabilities as Record<string, unknown>)
        : {};
    return provider.supportsToolUse !== true ||
      profile.supportsToolUse !== true ||
      capabilities.toolUse !== true;
  });

  if (offenders.length > 0) {
    throw new Error(
      `Seed invariant violated: anthropic-sub is active but ${offenders.length} active profile(s) ` +
        `are not tool-capable: ${offenders.map((p) => p.modelId).join(", ")}. ` +
        `Keep providers-registry.json, model-profiles.json, and seedAnthropicSubScope aligned with the Claude CLI adapter contract.`,
    );
  }
}

/**
 * Every coworker and onboarding agent the user can talk to must have at least
 * one tool grant. Without grants, isToolAllowedByGrants() denies every tool
 * and the agent can only hallucinate tool calls (it will claim reviews passed,
 * claim evidence was saved, etc. — all with no DB effect). Fail the seed
 * loudly rather than ship a broken configuration.
 */
async function assertCoworkerAgentsHaveGrants(): Promise<void> {
  const offenders = await prisma.agent.findMany({
    where: {
      type: { in: ["coworker", "onboarding"] },
      archived: false,
    },
    select: { agentId: true, name: true, type: true, toolGrants: { select: { id: true } } },
  });
  const missing = offenders.filter((a) => a.toolGrants.length === 0);
  if (missing.length > 0) {
    const list = missing.map((a) => `${a.agentId} (${a.name}, type=${a.type})`).join(", ");
    throw new Error(
      `Seed invariant violated: ${missing.length} interactive agent(s) without tool grants: ${list}. ` +
        `Without grants these agents will silently fail every tool call and hallucinate successful outcomes. ` +
        `Add grants to HARDCODED_COWORKER_GRANTS in seedCoworkerAgents() (for hardcoded coworkers), ` +
        `to seedOnboardingAgent() in apps/web/lib/inference/bootstrap-first-run.ts (for onboarding agents), ` +
        `or to tool_grants in packages/db/data/agent_registry.json (for registry agents).`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
