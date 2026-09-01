/**
 * EP-INF-001: Load routing data from the database.
 * Converts Prisma rows into the routing pipeline's type system.
 */
import { prisma } from "@dpf/db";
import { providerHasConfiguredCredential } from "@/lib/ai-provider-internals";
import type {
  EndpointManifest,
  ProviderTier,
  TaskRequirementContract,
  PolicyRuleEval,
  EndpointOverride,
  SensitivityLevel,
} from "./types";

// ── Request/turn-scoped loader cache ────────────────────────────────────────
//
// The three loaders below (loadEndpointManifests, loadPolicyRules, loadOverrides)
// are re-run on EVERY agentic-loop iteration via prepareRoute (up to 200 times a
// turn), each time returning identical rows — ~40-60 redundant identical queries
// on the most latency-sensitive code on the platform. These are loader INPUTS to
// routing, not the routing DECISION: a short TTL memo collapses the per-iteration
// reloads to one DB round-trip per turn while routeEndpointV2 still runs every
// iteration against fresh, process-local circuit-breaker state (markEndpoint
// Unavailable / getEndpointRuntimeState) — so a cooled-down endpoint is still
// skipped and a recovered provider still re-selected. Caching the inputs never
// changes the decision.
//
// Mirrors the proven TTL idiom on this same hot path (lib/inference/local-only.ts):
// a small TTL plus an explicit invalidator that the rare degrade/cooldown
// mutations call so a status change takes effect on the next iteration rather than
// waiting out the window. The injectable `now` keeps the behaviour deterministic
// for tests (no wall-clock flake).
//
// TTL sizing: longer than local-only's 5s because a multi-iteration build turn can
// run for tens of seconds and the goal is one load PER TURN; still bounded so an
// operator config edit (provider toggled, policy added, endpoint pinned) propagates
// within the window even absent an explicit bust. Degrade/cooldown mutations bust
// immediately, so the bound only governs the benign config-edit case.
const ROUTING_LOADER_TTL_MS = 30_000;

interface LoaderCacheEntry<T> {
  value: T;
  at: number;
}

let manifestsCache: LoaderCacheEntry<EndpointManifest[]> | null = null;
let policyRulesCache: LoaderCacheEntry<PolicyRuleEval[]> | null = null;
// Overrides are keyed by taskType — a turn routes one taskType, but a process
// serves many, so memo per key rather than a single slot.
const overridesCache = new Map<string, LoaderCacheEntry<EndpointOverride[]>>();

/**
 * Drop all cached routing-loader inputs. Called by the degrade/cooldown
 * mutations (markModelDegraded, markEndpointUnavailable) so a candidate-pool
 * health change is reflected on the very next routing iteration, and exported for
 * tests. Cheap and idempotent — clearing an already-cold cache is a no-op.
 */
export function invalidateRoutingLoaderCache(): void {
  manifestsCache = null;
  policyRulesCache = null;
  overridesCache.clear();
}

/**
 * Providers that ship with DPF and require no user action to be usable.
 * All other providers are classified as `user_configured` — the user
 * had to actively connect them (OAuth or API key), and that action
 * expresses a preference the router must honour over bundled defaults.
 */
const BUNDLED_PROVIDER_IDS = new Set<string>(["local", "ollama"]);

export function classifyProviderTier(providerId: string): ProviderTier {
  return BUNDLED_PROVIDER_IDS.has(providerId) ? "bundled" : "user_configured";
}
import type { QualityTier } from "./quality-tiers";
import type { ModelCardCapabilities, ModelCardPricing } from "./model-card-types";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";
import {
  normalizeRouteDecisionActor,
  type RouteDecisionActor,
} from "./route-decision-attribution";
import { MODEL_ROUTING_ENDPOINT_TYPES } from "./provider-eligibility";
import { serializeActivityHarnessAudit } from "./activity-harness-audit";
import { codexSubscriptionModelExclusionReason } from "./codex-subscription-model-eligibility";

/**
 * EP-MODEL-CAP-001-B: Source-priority tool use resolution.
 *
 * Precedence (highest to lowest):
 *   0. provider.supportsToolUse === false — hard backend floor, cannot be overridden
 *   1. capabilityOverrides.toolUse — explicit admin field-level override
 *   2. profile.supportsToolUse === false — explicit profile-level floor
 *   3. capabilities.toolUse (discovery-owned profiles only)
 *   4. capabilities.toolUse (catalog-owned profiles only)
 *   5. profile.supportsToolUse — positive profile-level fallback
 *   6. provider.supportsToolUse — permissive floor
 */
export function resolveToolUse(
  profile: {
    profileSource: string | null;
    capabilityOverrides: unknown;
    capabilities: unknown;
    supportsToolUse: boolean | null;
    provider: { supportsToolUse: boolean | null };
  },
): boolean | null {
  if (profile.provider.supportsToolUse === false) {
    return false;
  }

  // 1. Admin field-level override
  const overrides = profile.capabilityOverrides as Record<string, unknown> | null;
  if (overrides !== null && overrides !== undefined && "toolUse" in overrides) {
    return overrides.toolUse as boolean;
  }

  // 2. Explicit profile-level floor
  if (profile.supportsToolUse === false) {
    return false;
  }

  const caps = profile.capabilities as Record<string, unknown> | null;
  const src = profile.profileSource ?? "seed";

  // 3. Discovery-owned: use adapter-extracted value
  if (src === "auto-discover" || src === "evaluated") {
    if (caps?.toolUse !== undefined && caps.toolUse !== null) return caps.toolUse as boolean;
  }

  // 4. Catalog-owned: use reconciled value
  if (src === "catalog" || src === "seed") {
    if (caps?.toolUse !== undefined && caps.toolUse !== null) return caps.toolUse as boolean;
  }

  // 5. Profile-level boolean (set by provider-sync null-backfill or seed)
  if (profile.supportsToolUse !== null && profile.supportsToolUse !== undefined) {
    return profile.supportsToolUse;
  }

  // 6. Provider floor
  return profile.provider.supportsToolUse ?? null;
}

/**
 * Load all active/degraded endpoints as EndpointManifest objects.
 * Queries ModelProfile joined with ModelProvider — each manifest entry represents
 * a specific model, not just a provider.
 *
 * Request/turn-scoped TTL cached (see invalidateRoutingLoaderCache): on the
 * agentic hot path this is hit once per loop iteration with identical results;
 * the memo serves the same array for the rest of the turn. Degrade/cooldown
 * mutations bust the cache so a status change lands on the next iteration. `now`
 * is injectable for deterministic tests.
 */
export async function loadEndpointManifests(
  now: number = Date.now(),
): Promise<EndpointManifest[]> {
  if (manifestsCache && now - manifestsCache.at < ROUTING_LOADER_TTL_MS) {
    return manifestsCache.value;
  }
  const value = await queryEndpointManifests();
  manifestsCache = { value, at: now };
  return value;
}

async function queryEndpointManifests(): Promise<EndpointManifest[]> {
  const profiles = await prisma.modelProfile.findMany({
    where: {
      modelStatus: { in: ["active", "degraded"] },
      retiredAt: null,
      provider: {
        status: { in: ["active", "degraded"] },
        endpointType: { in: [...MODEL_ROUTING_ENDPOINT_TYPES] },
      },
    },
    include: {
      provider: true,
    },
  });

  const providers = new Map(
    profiles.map((profile) => [profile.providerId, profile.provider.authMethod] as const),
  );
  const readiness = new Map(await Promise.all(
    [...providers].map(async ([providerId, authMethod]) => [
      providerId,
      await providerHasConfiguredCredential(providerId, authMethod),
    ] as const),
  ));

  return profiles
    .filter((profile) => readiness.get(profile.providerId) === true)
    .map((profile) => profileToManifest(profile));
}

type ProfileWithProvider = Awaited<
  ReturnType<typeof prisma.modelProfile.findMany<{ include: { provider: true } }>>
>[number];

/**
 * Map a ModelProfile (joined with its provider) into an EndpointManifest.
 * Shared by the live candidate query (loadEndpointManifests) and the
 * enable-candidate preview (loadEnableCandidateManifests), so both describe an
 * endpoint identically. `statusOverride` lets the preview ask "would this
 * endpoint be eligible IF its provider were enabled?" by forcing status to
 * "active" without mutating the DB.
 */
function profileToManifest(
  mp: ProfileWithProvider,
  statusOverride?: EndpointManifest["status"],
): EndpointManifest {
  const eligibilityExclusionReason = codexSubscriptionModelExclusionReason({
    providerId: mp.providerId,
    authMethod: mp.provider.authMethod,
    modelId: mp.modelId,
  });

  return {
    id: mp.id,
    providerId: mp.providerId,
    modelId: mp.modelId,
    name: mp.friendlyName || mp.modelId,
    endpointType: mp.provider.endpointType,
    // EP-INF-004: Derive status from worse of provider and model status
    status: (statusOverride ??
      (mp.modelStatus === "degraded" || mp.provider.status === "degraded"
        ? "degraded"
        : mp.provider.status)) as EndpointManifest["status"],
    providerTier: classifyProviderTier(mp.providerId),
    sensitivityClearance: mp.provider.sensitivityClearance as SensitivityLevel[],
    // Keep null (UNKNOWN) distinct from false (an explicit floor). Coercing to
    // false here made every undiscoverable-capability endpoint permanently
    // ineligible for tool work with no recovery path (BI-DFC30977).
    supportsToolUse: resolveToolUse(mp),
    supportsStructuredOutput: mp.provider.supportsStructuredOutput,
    supportsStreaming: mp.provider.supportsStreaming,
    maxContextTokens: mp.maxContextTokens ?? mp.provider.maxContextTokens,
    maxOutputTokens: mp.maxOutputTokens ?? mp.provider.maxOutputTokens,
    modelRestrictions: mp.provider.modelRestrictions,
    ...(eligibilityExclusionReason ? { eligibilityExclusionReason } : {}),
    reasoning: mp.reasoning,
    codegen: mp.codegen,
    toolFidelity: mp.toolFidelity,
    instructionFollowing: mp.instructionFollowingScore,
    structuredOutput: mp.structuredOutputScore,
    conversational: mp.conversational,
    contextRetention: mp.contextRetention,
    customScores: (mp.customScores as Record<string, number>) ?? {},
    avgLatencyMs: mp.provider.avgLatencyMs,
    recentFailureRate: mp.provider.recentFailureRate,
    costPerOutputMToken: (mp.pricing as any)?.outputPerMToken ?? mp.outputPricePerMToken ?? mp.provider.outputPricePerMToken,
    profileSource: mp.profileSource as EndpointManifest["profileSource"],
    profileConfidence: mp.profileConfidence as EndpointManifest["profileConfidence"],
    retiredAt: mp.retiredAt,
    qualityTier: (mp.qualityTier as QualityTier | null) ?? undefined,

    // EP-INF-003: ModelCard fields
    modelClass: mp.modelClass ?? "chat",
    modelFamily: mp.modelFamily ?? null,
    inputModalities: (mp.inputModalities as string[]) ?? ["text"],
    outputModalities: (mp.outputModalities as string[]) ?? ["text"],
    capabilities: (mp.capabilities as unknown as ModelCardCapabilities) ?? EMPTY_CAPABILITIES,
    pricing: (mp.pricing as unknown as ModelCardPricing) ?? EMPTY_PRICING,
    supportedParameters: (mp.supportedParameters as string[]) ?? [],
    deprecationDate: mp.deprecationDate ?? null,
    metadataSource: mp.metadataSource ?? "inferred",
    metadataConfidence: mp.metadataConfidence ?? "low",
    perRequestLimits: mp.perRequestLimits as any ?? null,
  };
}

/**
 * Load endpoint manifests for providers that are NOT currently active/degraded
 * (i.e. disabled / inactive / unconfigured), with each manifest's status forced
 * to "active". These are NOT routing candidates — they are used only to answer,
 * for a blocked phase, "which currently-off provider WOULD satisfy this phase's
 * routing contract if it were enabled?" (F10/F11). Reuses the exact same
 * profile→manifest mapping as the live query so the hard-filter check
 * (getExclusionReasonV2) behaves identically to real routing.
 */
export async function loadEnableCandidateManifests(): Promise<EndpointManifest[]> {
  const profiles = await prisma.modelProfile.findMany({
    where: {
      modelStatus: { in: ["active", "degraded"] },
      retiredAt: null,
      provider: {
        status: { notIn: ["active", "degraded"] },
        endpointType: { in: [...MODEL_ROUTING_ENDPOINT_TYPES] },
        catalogVisibility: { not: "hidden" },
      },
    },
    include: { provider: true },
  });
  return profiles.map((mp) => profileToManifest(mp, "active"));
}

/**
 * Load a task requirement by task type.
 * Falls back to a permissive default if the task type isn't registered.
 */
export async function loadTaskRequirement(
  taskType: string,
): Promise<TaskRequirementContract> {
  const req = await prisma.taskRequirement.findUnique({
    where: { taskType },
  });

  if (req) {
    return {
      taskType: req.taskType,
      description: req.description,
      selectionRationale: req.selectionRationale,
      requiredCapabilities: req.requiredCapabilities as TaskRequirementContract["requiredCapabilities"],
      preferredMinScores: req.preferredMinScores as Record<string, number>,
      maxLatencyMs: req.maxLatencyMs ?? undefined,
      preferCheap: req.preferCheap,
    };
  }

  // Default for unknown task types — no hard requirements, prefer conversational
  return {
    taskType,
    description: `Unregistered task type: ${taskType}`,
    selectionRationale: "No specific requirements — using general-purpose routing",
    requiredCapabilities: {},
    preferredMinScores: { conversational: 40, reasoning: 40 },
    preferCheap: false,
  };
}

/**
 * Load active policy rules.
 *
 * Request/turn-scoped TTL cached (see invalidateRoutingLoaderCache) — same
 * per-iteration hot-path memo as loadEndpointManifests. The effectiveFrom/Until
 * window is evaluated at load time; a rule crossing its boundary mid-window is
 * served for at most the TTL, acceptable for rarely-edited operator policy.
 * `nowMs` is injectable for deterministic tests.
 */
export async function loadPolicyRules(
  nowMs: number = Date.now(),
): Promise<PolicyRuleEval[]> {
  if (policyRulesCache && nowMs - policyRulesCache.at < ROUTING_LOADER_TTL_MS) {
    return policyRulesCache.value;
  }
  const value = await queryPolicyRules();
  policyRulesCache = { value, at: nowMs };
  return value;
}

async function queryPolicyRules(): Promise<PolicyRuleEval[]> {
  const now = new Date();
  const rules = await prisma.policyRule.findMany({
    where: {
      effectiveFrom: { lte: now },
      OR: [
        { effectiveUntil: null },
        { effectiveUntil: { gt: now } },
      ],
    },
  });

  return rules.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    condition: r.condition as unknown as PolicyRuleEval["condition"],
  }));
}

/**
 * Load pinned/blocked overrides for a task type.
 *
 * Request/turn-scoped TTL cached per taskType (see invalidateRoutingLoaderCache)
 * — the per-iteration hot-path memo, keyed because a process serves many task
 * types while one turn routes a single one. `now` is injectable for deterministic
 * tests.
 */
export async function loadOverrides(
  taskType: string,
  now: number = Date.now(),
): Promise<EndpointOverride[]> {
  const cached = overridesCache.get(taskType);
  if (cached && now - cached.at < ROUTING_LOADER_TTL_MS) {
    return cached.value;
  }
  const value = await queryOverrides(taskType);
  overridesCache.set(taskType, { value, at: now });
  return value;
}

async function queryOverrides(taskType: string): Promise<EndpointOverride[]> {
  const perf = await prisma.endpointTaskPerformance.findMany({
    where: {
      taskType,
      OR: [{ pinned: true }, { blocked: true }],
    },
    select: {
      endpointId: true,
      taskType: true,
      pinned: true,
      blocked: true,
    },
  });

  return perf.map((p) => ({
    endpointId: p.endpointId,
    taskType: p.taskType,
    pinned: p.pinned,
    blocked: p.blocked,
  }));
}

/**
 * Persist a RouteDecision to the audit log.
 */
type RouteDecisionPersistenceContext = {
  actor?: RouteDecisionActor | null;
  /** @deprecated Prefer actor: { kind: "agent", id }. */
  agentId?: string | null;
  agentMessageId?: string | null;
  /**
   * The portal route whose static context supplied the decision's sensitivity,
   * e.g. "/customer/marketing". Omitted by non-route callers (scheduled jobs,
   * system tasks), which genuinely have no route.
   */
  routeContext?: string | null;
};

export async function persistRouteDecision(
  decision: import("./types").RouteDecision,
  context?: string | RouteDecisionPersistenceContext,
  shadowMode = false,
): Promise<string> {
  const agentMessageId = typeof context === "string" ? context : context?.agentMessageId;
  const routeContext = typeof context === "string" ? null : context?.routeContext ?? null;
  const actor = normalizeRouteDecisionActor(
    typeof context === "string"
      ? null
      : context?.actor ?? (context?.agentId ? { kind: "agent", id: context.agentId } : null),
  );
  const record = await prisma.routeDecisionLog.create({
    data: {
      traceId: decision.traceId ?? null,
      designRevision: decision.designRevision ?? null,
      agentMessageId: agentMessageId ?? null,
      actorKind: actor.actorKind,
      actorId: actor.actorId,
      agentId: actor.agentId,
      routeContext,
      selectedEndpointId: decision.selectedEndpoint ?? "none",
      selectedModelId: decision.selectedModelId ?? null,
      taskType: decision.taskType,
      sensitivity: decision.sensitivity,
      reason: decision.reason,
      // Normalize to DB invariant 0..1 (pipeline scores are 0..100 or unbounded).
      fitnessScore: Math.min(Math.max(decision.fitnessScore / 100, 0), 1),
      candidateTrace: serializeCandidateTraceForAudit(decision) as any,
      excludedTrace: decision.candidates.filter((c) => c.excluded) as any,
      policyRulesApplied: decision.policyRulesApplied,
      fallbackChain: decision.fallbackChain,
      shadowMode,
      suitabilityReceipt: decision.providerSuitabilityReceipt ?? undefined,
      inferenceDataScreenReceipt: decision.inferenceDataScreenReceipt ?? undefined,
    },
  });
  return record.id;
}

/**
 * BI-F4D3B9E9(c): persist a FAILED route decision (no endpoint selected) so the
 * per-endpoint excludedTrace — which names the real excluder (clearance vs
 * context vs cooldown vs capability) — survives for diagnosis instead of being
 * dropped with the NoEligibleEndpointsError. Fire-and-forget with its own
 * catch: audit failure must never mask the routing error itself. Callers pass
 * their RouteAndCallOptions-shaped fields; `persistDecision: false` opts out,
 * matching the success-path contract in routed-inference.
 */
export function persistFailedRouteDecision(
  decision: import("./types").RouteDecision,
  options?: {
    persistDecision?: boolean;
    routingActor?: RouteDecisionActor | null;
    agentId?: string;
    agentMessageId?: string | null;
  },
): void {
  if (options?.persistDecision === false) return;
  persistRouteDecision(decision, {
    actor:
      options?.routingActor ??
      (options?.agentId
        ? { kind: "agent", id: options.agentId }
        : { kind: "system", id: "routed-inference" }),
    agentMessageId: options?.agentMessageId ?? null,
  }).catch((err) => {
    console.error("[routing] Failed to persist no-eligible-endpoints route decision:", err);
  });
}

export async function updateProviderSuitabilityReceipt(
  routeDecisionLogId: string,
  receipt: import("./provider-suitability/evidence").ProviderSuitabilityRouteReceipt,
): Promise<void> {
  await prisma.routeDecisionLog.update({
    where: { id: routeDecisionLogId },
    data: { suitabilityReceipt: receipt as any },
  });
}

function serializeCandidateTraceForAudit(
  decision: import("./types").RouteDecision,
): Array<import("./types").CandidateTrace & { activityHarness?: unknown }> {
  const activityHarness = serializeActivityHarnessAudit(decision.executionPlan?.harness);
  if (!activityHarness || !decision.selectedEndpoint) {
    return decision.candidates;
  }

  return decision.candidates.map((candidate) =>
    candidate.endpointId === decision.selectedEndpoint
      ? { ...candidate, activityHarness }
      : candidate,
  );
}
