// AI-assisted identity-resolution fallback (EP-ASSET-INTELLIGENCE, spec §4.2 / §8).
//
// Deterministic fingerprint rules (discovery-normalize) resolve only the confident
// head of an estate; entities whose day-one signals match no rule land with
// catalogIdentityId=null / identityStatus in {null, needs_review, needs_reresolve}
// — the "ambiguous tail". This module is the decoupled, cost-guarded stage that
// resolves that tail with a cheap model (spec §4.2: "a cheap-model fallback resolves
// the ambiguous tail"). It is the altitude the kernel selected (DI-7D4E383E9944):
// a new decoupled stage, not inline in the hot discovery-normalize path nor folded
// into the CatalogIdentity enrichment sweep.
//
// Shadow discipline (spec §8 auto-promote path):
//   - Each AI resolution writes an IdentityResolutionLog row (resolutionType='ai_resolved').
//   - During the shadow window it does NOT write InventoryEntity.catalogIdentityId.
//   - Repeated identical AI resolutions of the same entity promote a status='shadow'
//     DiscoveryFingerprintRule (append-only lineage; the rule generalizes the signal).
//   - Only a confidence >= autoApplyThreshold (0.97) resolution auto-applies the
//     identity (writes catalogIdentityId + identityStatus='ai_resolved').
//   - A contradicting human_confirmed / human_corrected resolution demotes the shadow
//     rule to 'rejected', and a human_confirmed InventoryEntity identity is NEVER
//     overwritten (spec §4.1 / §6.3.1) — the scan excludes it and the auto-apply
//     write is additionally guarded.
//
// Cost guardrail (spec §4.2 / gap-closure §11 Q2): the model calls are BATCHED and
// bounded by a per-run inference-token budget cap plus a hard call cap, so a
// 10k+-entity estate cannot blow the budget in one pass. Stalest-first + poll-on-
// request, the same governed-loop shape as catalog-enrichment-sweep.ts.
//
// Pure orchestration over an injectable inference fn + client (no prisma import), so
// it stays unit-testable with mocks — the governed apps/web runner wires the real
// prisma + a routeAndCall(minimize_cost) inference fn (dynamic model discovery, no
// vendor pinning).

/** One unresolved InventoryEntity the AI fallback will attempt to identify. */
export type UnresolvedEntityRow = {
  id: string;
  name: string;
  entityType: string;
  manufacturer: string | null;
  productModel: string | null;
  observedVersion: string | null;
  normalizedVersion: string | null;
  identityStatus: string | null;
  properties: unknown;
};

/** An identity the model proposes for one entity. */
export type ProposedIdentity = {
  /** The UnresolvedEntityRow.id this proposal resolves. */
  entityId: string;
  manufacturer: string;
  product: string;
  productVersion?: string | null;
  edition?: string | null;
  /** CPE 2.3 part: a (application) | o (os) | h (hardware). Defaults to 'a'. */
  part?: string;
  /** 0..1 self-reported confidence; auto-apply only clears at autoApplyThreshold. */
  confidence: number;
  /** Optional evidence packet echoed into the IdentityResolutionLog row. */
  evidence?: Record<string, unknown>;
};

/**
 * The injectable inference fn: takes a batch of unresolved entities and returns the
 * subset it could confidently identify (entities it cannot resolve are omitted), plus
 * the tokens the call consumed so the runner can enforce the per-run budget cap. It
 * must never throw — a failed batch returns `{ proposals: [], tokensUsed }` so the
 * loop degrades to "resolved nothing this batch" rather than aborting the run.
 */
export type IdentityInferenceFn = (
  batch: UnresolvedEntityRow[],
) => Promise<{ proposals: ProposedIdentity[]; tokensUsed: number }>;

export type IdentityInferenceOptions = {
  /** Max unresolved entities to scan per run (stalest-first). Default 200. */
  scanLimit?: number;
  /** Entities per inference call — the batch half of the cost guardrail. Default 20. */
  batchSize?: number;
  /**
   * Per-run inference-token budget cap. Once cumulative tokensUsed reaches this, no
   * further batch is dispatched (the budget half of the cost guardrail). Default 200_000.
   */
  maxInferenceTokens?: number;
  /** Hard backstop on inference calls per run, independent of tokens. Default 25. */
  maxInferenceCalls?: number;
  /**
   * Repeated identical AI resolutions of one entity needed before a shadow rule is
   * promoted (spec §8). Default 3. Below-threshold resolutions only log lineage.
   */
  shadowPromotionThreshold?: number;
  /**
   * Confidence at/above which an AI resolution auto-applies catalogIdentityId
   * (spec §8 auto-promote path). Default 0.97.
   */
  autoApplyThreshold?: number;
};

const DEFAULTS = {
  scanLimit: 200,
  batchSize: 20,
  maxInferenceTokens: 200_000,
  maxInferenceCalls: 25,
  shadowPromotionThreshold: 3,
  autoApplyThreshold: 0.97,
} as const;

export type IdentityInferenceResult = {
  /** Total unresolved entities (for coverage reporting — a bounded run is not full coverage). */
  unresolvedTotal: number;
  /** Candidates examined this run (<= scanLimit). */
  entitiesScanned: number;
  /** Entities actually sent to the model (skips those already settled into shadow). */
  entitiesInferred: number;
  /** Proposals the model returned. */
  proposalsReceived: number;
  /** IdentityResolutionLog(ai_resolved) rows written. */
  aiResolutionsLogged: number;
  /** Shadow DiscoveryFingerprintRules promoted this run. */
  shadowRulesPromoted: number;
  /** Entities auto-applied (confidence >= threshold → catalogIdentityId written). */
  autoApplied: number;
  /** Shadow rules demoted to 'rejected' by a contradicting human resolution. */
  shadowRulesDemoted: number;
  inferenceCalls: number;
  inferenceTokensSpent: number;
  /** True when the token/call budget stopped the run before the scan was exhausted. */
  budgetExhausted: boolean;
  failures: number;
};

// ─── Minimal prisma surface (mock-friendly; real client satisfies structurally) ──

type AiResolvedLogRow = { id: string; catalogIdentityId: string | null };

type ShadowRuleRow = {
  id: string;
  catalogIdentityId: string | null;
  sourceObservationIds: string[];
};

export type IdentityInferenceClient = {
  inventoryEntity: {
    count(args?: unknown): Promise<number>;
    findMany(args: unknown): Promise<UnresolvedEntityRow[]>;
    updateMany(args: {
      where: { id: string; identityStatus?: { not: string } };
      data: { catalogIdentityId: string; identityStatus: string; identityConfidence: number };
    }): Promise<{ count: number }>;
  };
  identityResolutionLog: {
    findMany(args: {
      where: { inventoryEntityId: string; resolutionType: string };
      select: { id: true; catalogIdentityId: true };
    }): Promise<AiResolvedLogRow[]>;
    findFirst(args: unknown): Promise<{ id: string; catalogIdentityId: string | null } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  catalogIdentity: {
    upsert(args: {
      where: { identityKey: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
      select: { id: true };
    }): Promise<{ id: string }>;
  };
  discoveryFingerprintRule: {
    findMany(args: {
      where: { status: string };
      select: { id: true; catalogIdentityId: true; sourceObservationIds: true };
    }): Promise<ShadowRuleRow[]>;
    findFirst(args: {
      where: { ruleKey: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    updateMany(args: {
      where: { id: { in: string[] } };
      data: { status: string };
    }): Promise<{ count: number }>;
  };
};

// ─── Pure helpers ────────────────────────────────────────────────────────────

const slug = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/**
 * Stable canonical key for a proposed identity, aligned with deriveCatalogIdentity's
 * `part:manufacturer:product` scheme but extended with version+edition so distinct
 * versions resolve to distinct CatalogIdentity rows (each carries its own lifecycle
 * milestones). The `:` separator is safe — slug() strips it from every field.
 */
export function identityKeyForProposal(p: {
  manufacturer: string;
  product: string;
  productVersion?: string | null;
  edition?: string | null;
  part?: string;
}): string {
  return [
    p.part && p.part.trim() ? p.part.trim() : "a",
    slug(p.manufacturer),
    slug(p.product),
    slug(p.productVersion ?? ""),
    slug(p.edition ?? ""),
  ].join(":");
}

/** Deterministic shadow-rule key for an (entity, identity) promotion. */
function shadowRuleKey(entityId: string, identityKey: string): string {
  return `ai-shadow:${entityId}:${identityKey}`;
}

function normalizeProposal(p: ProposedIdentity): {
  ok: boolean;
  manufacturer: string;
  product: string;
  productVersion: string | null;
  edition: string | null;
  part: string;
  identityKey: string;
} {
  const manufacturer = (p.manufacturer ?? "").trim();
  const product = (p.product ?? "").trim();
  const part = p.part && p.part.trim() ? p.part.trim() : "a";
  const productVersion = p.productVersion?.trim() ? p.productVersion.trim() : null;
  const edition = p.edition?.trim() ? p.edition.trim() : null;
  const identityKey = identityKeyForProposal({ manufacturer, product, productVersion, edition, part });
  // A proposal with no manufacturer+product cannot key a canonical identity — reject it
  // (never fabricate an identity from a blank; spec §4.1 raw strings never leak a name).
  const ok = manufacturer.length > 0 && product.length > 0;
  return { ok, manufacturer, product, productVersion, edition, part, identityKey };
}

// ─── Demotion: humans win (spec §4.1 / §6.3.1) ───────────────────────────────

/**
 * Reject any shadow rule contradicted by a human. A shadow rule carries its source
 * entity id in `sourceObservationIds`; if a human_confirmed / human_corrected
 * IdentityResolutionLog exists for that entity resolving to a DIFFERENT
 * CatalogIdentity, the human overrides the AI-promoted rule and it is set to
 * 'rejected'. Runs before inference so a rejected rule is not re-promoted the same pass.
 */
export async function demoteHumanContradictedShadowRules(
  db: IdentityInferenceClient,
): Promise<number> {
  const shadowRules = await db.discoveryFingerprintRule.findMany({
    where: { status: "shadow" },
    select: { id: true, catalogIdentityId: true, sourceObservationIds: true },
  });

  const toReject: string[] = [];
  for (const rule of shadowRules) {
    const sourceEntityId = rule.sourceObservationIds[0];
    if (!sourceEntityId) continue;
    const humanLog = await db.identityResolutionLog.findFirst({
      where: {
        inventoryEntityId: sourceEntityId,
        resolutionType: { in: ["human_confirmed", "human_corrected"] },
      },
      select: { id: true, catalogIdentityId: true },
    });
    // A human resolution that lands on a DIFFERENT identity than the shadow rule
    // contradicts it. A human confirming the SAME identity leaves it shadow (it will
    // graduate through the normal promotion path).
    if (humanLog && humanLog.catalogIdentityId !== rule.catalogIdentityId) {
      toReject.push(rule.id);
    }
  }

  if (toReject.length === 0) return 0;
  const { count } = await db.discoveryFingerprintRule.updateMany({
    where: { id: { in: toReject } },
    data: { status: "rejected" },
  });
  return count;
}

// ─── Main loop ───────────────────────────────────────────────────────────────

/**
 * Run one bounded, budget-capped AI identity-resolution pass over the unresolved
 * tail. Idempotent and safe to call repeatedly; per-entity failures are counted,
 * never fatal. Never writes over a human_confirmed identity.
 */
export async function runIdentityInferenceFallback(
  db: IdentityInferenceClient,
  infer: IdentityInferenceFn,
  options: IdentityInferenceOptions = {},
): Promise<IdentityInferenceResult> {
  const scanLimit = options.scanLimit ?? DEFAULTS.scanLimit;
  const batchSize = Math.max(1, options.batchSize ?? DEFAULTS.batchSize);
  const maxInferenceTokens = options.maxInferenceTokens ?? DEFAULTS.maxInferenceTokens;
  const maxInferenceCalls = options.maxInferenceCalls ?? DEFAULTS.maxInferenceCalls;
  const promotionThreshold = Math.max(1, options.shadowPromotionThreshold ?? DEFAULTS.shadowPromotionThreshold);
  const autoApplyThreshold = options.autoApplyThreshold ?? DEFAULTS.autoApplyThreshold;

  const result: IdentityInferenceResult = {
    unresolvedTotal: 0,
    entitiesScanned: 0,
    entitiesInferred: 0,
    proposalsReceived: 0,
    aiResolutionsLogged: 0,
    shadowRulesPromoted: 0,
    autoApplied: 0,
    shadowRulesDemoted: 0,
    inferenceCalls: 0,
    inferenceTokensSpent: 0,
    budgetExhausted: false,
    failures: 0,
  };

  // Humans win first, so a rejected rule is not re-promoted in the same pass.
  try {
    result.shadowRulesDemoted = await demoteHumanContradictedShadowRules(db);
  } catch {
    result.failures += 1;
  }

  const unresolvedWhere = {
    catalogIdentityId: null,
    OR: [
      { identityStatus: null },
      { identityStatus: { in: ["unresolved", "needs_review", "needs_reresolve"] } },
    ],
  };

  result.unresolvedTotal = await db.inventoryEntity.count({ where: unresolvedWhere });

  const candidates = await db.inventoryEntity.findMany({
    where: unresolvedWhere,
    // Stalest-first so repeated polls rotate through the whole tail. An auto-applied
    // entity leaves the pool (catalogIdentityId set); a shadow-settled one is skipped
    // below, so forward progress is guaranteed without a cursor.
    orderBy: { lastSeenAt: "asc" },
    take: scanLimit,
    select: {
      id: true,
      name: true,
      entityType: true,
      manufacturer: true,
      productModel: true,
      observedVersion: true,
      normalizedVersion: true,
      identityStatus: true,
      properties: true,
    },
  });
  result.entitiesScanned = candidates.length;

  // Pre-load each candidate's prior ai_resolved lineage so we can (a) skip entities
  // already settled into shadow (>= threshold prior resolutions — awaiting a human or
  // a fresher discovery signal) and (b) compute the identical-resolution count for
  // promotion. Bounded by scanLimit.
  const priorLogsByEntity = new Map<string, AiResolvedLogRow[]>();
  const toInfer: UnresolvedEntityRow[] = [];
  for (const entity of candidates) {
    let priorLogs: AiResolvedLogRow[] = [];
    try {
      priorLogs = await db.identityResolutionLog.findMany({
        where: { inventoryEntityId: entity.id, resolutionType: "ai_resolved" },
        select: { id: true, catalogIdentityId: true },
      });
    } catch {
      result.failures += 1;
    }
    priorLogsByEntity.set(entity.id, priorLogs);
    // Already settled into shadow — do not burn budget re-inferring it.
    if (priorLogs.length < promotionThreshold) {
      toInfer.push(entity);
    }
  }

  // Batched, budget-capped inference loop.
  for (let i = 0; i < toInfer.length; i += batchSize) {
    if (result.inferenceCalls >= maxInferenceCalls || result.inferenceTokensSpent >= maxInferenceTokens) {
      result.budgetExhausted = true;
      break;
    }
    const batch = toInfer.slice(i, i + batchSize);

    let proposals: ProposedIdentity[] = [];
    try {
      const inference = await infer(batch);
      proposals = inference.proposals;
      result.inferenceTokensSpent += Math.max(0, inference.tokensUsed || 0);
      result.inferenceCalls += 1;
      result.entitiesInferred += batch.length;
    } catch {
      // The inference fn is contracted not to throw, but stay defensive: count the
      // batch as a failure and keep going rather than aborting the whole run.
      result.failures += 1;
      result.inferenceCalls += 1;
      continue;
    }

    const byEntityId = new Map(batch.map((e) => [e.id, e]));
    for (const proposal of proposals) {
      const entity = byEntityId.get(proposal.entityId);
      if (!entity) continue; // proposal for an entity not in this batch — ignore.
      result.proposalsReceived += 1;
      try {
        await processProposal(db, entity, proposal, {
          priorLogs: priorLogsByEntity.get(entity.id) ?? [],
          promotionThreshold,
          autoApplyThreshold,
          result,
        });
      } catch {
        result.failures += 1;
      }
    }
  }

  return result;
}

async function processProposal(
  db: IdentityInferenceClient,
  entity: UnresolvedEntityRow,
  proposal: ProposedIdentity,
  ctx: {
    priorLogs: AiResolvedLogRow[];
    promotionThreshold: number;
    autoApplyThreshold: number;
    result: IdentityInferenceResult;
  },
): Promise<void> {
  const { result } = ctx;
  const norm = normalizeProposal(proposal);
  if (!norm.ok) return; // never fabricate an identity from a blank proposal.

  // Materialize the canonical CatalogIdentity (idempotent on identityKey). Needed as
  // the FK target for the resolution-log row, the shadow-rule link, and any auto-apply.
  const confidence = Number.isFinite(proposal.confidence) ? proposal.confidence : 0;
  const identity = await db.catalogIdentity.upsert({
    where: { identityKey: norm.identityKey },
    update: {
      part: norm.part,
      manufacturer: norm.manufacturer,
      product: norm.product,
      productVersion: norm.productVersion,
      edition: norm.edition,
      source: "ai_resolved",
    },
    create: {
      identityKey: norm.identityKey,
      part: norm.part,
      manufacturer: norm.manufacturer,
      product: norm.product,
      productVersion: norm.productVersion,
      edition: norm.edition,
      source: "ai_resolved",
      confidence,
    },
    select: { id: true },
  });

  // Append the ai_resolved lineage row (spec §4.1). Always written on a valid
  // proposal — the shadow window keeps InventoryEntity.catalogIdentityId untouched
  // until either promotion+auto-apply or a human confirmation.
  await db.identityResolutionLog.create({
    data: {
      inventoryEntityId: entity.id,
      catalogIdentityId: identity.id,
      resolutionType: "ai_resolved",
      confidence,
      evidence: {
        proposedIdentityKey: norm.identityKey,
        manufacturer: norm.manufacturer,
        product: norm.product,
        productVersion: norm.productVersion,
        edition: norm.edition,
        part: norm.part,
        signals: {
          name: entity.name,
          entityType: entity.entityType,
          manufacturer: entity.manufacturer,
          productModel: entity.productModel,
          observedVersion: entity.observedVersion,
        },
        ...(proposal.evidence ? { model: proposal.evidence } : {}),
      },
    },
  });
  result.aiResolutionsLogged += 1;

  // Count identical prior resolutions of THIS entity to THIS identity. Repeated
  // identical resolutions (the AI is consistent about this entity) promote a shadow
  // rule; an inconsistent AI (different identity each time) never crosses the bar.
  const identicalPrior = ctx.priorLogs.filter((l) => l.catalogIdentityId === identity.id).length;
  const identicalTotal = identicalPrior + 1; // include the row we just wrote.
  if (identicalTotal >= ctx.promotionThreshold) {
    await ensureShadowRule(db, entity, identity.id, norm, confidence, result);
  }

  // Auto-apply only for a high-confidence resolution (spec §8). The updateMany guard
  // (identityStatus not human_confirmed) is belt-and-braces on top of the scan
  // exclusion — a human_confirmed identity is NEVER overwritten (spec §4.1).
  if (confidence >= ctx.autoApplyThreshold) {
    const { count } = await db.inventoryEntity.updateMany({
      where: { id: entity.id, identityStatus: { not: "human_confirmed" } },
      data: {
        catalogIdentityId: identity.id,
        identityStatus: "ai_resolved",
        identityConfidence: confidence,
      },
    });
    if (count > 0) result.autoApplied += 1;
  }
}

async function ensureShadowRule(
  db: IdentityInferenceClient,
  entity: UnresolvedEntityRow,
  catalogIdentityId: string,
  norm: ReturnType<typeof normalizeProposal>,
  confidence: number,
  result: IdentityInferenceResult,
): Promise<void> {
  const ruleKey = shadowRuleKey(entity.id, norm.identityKey);
  const existing = await db.discoveryFingerprintRule.findFirst({
    where: { ruleKey },
    select: { id: true },
  });
  if (existing) return; // already promoted — idempotent.

  await db.discoveryFingerprintRule.create({
    data: {
      ruleKey,
      status: "shadow",
      scope: "global",
      source: "auto_promoted",
      // A minimal name/type match expression derived from the entity's stable signals.
      // Kept advisory during the shadow window — no deterministic auto-attribution
      // happens off a shadow rule; only 'active' rules match in discovery-normalize.
      matchExpression: {
        entityType: entity.entityType,
        name: entity.name,
      },
      resolvedIdentity: {
        kind: norm.part === "h" ? "hardware" : norm.part === "o" ? "os" : "software",
        name: norm.product,
        vendor: norm.manufacturer,
      },
      catalogIdentityId,
      identityConfidence: confidence,
      taxonomyConfidence: 0,
      // Source lineage: the entity that promoted this rule. Used by the demotion pass
      // to detect a contradicting human resolution.
      sourceObservationIds: [entity.id],
    },
  });
  result.shadowRulesPromoted += 1;
}
