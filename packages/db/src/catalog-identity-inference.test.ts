import { describe, expect, it } from "vitest";

import {
  runIdentityInferenceFallback,
  demoteHumanContradictedShadowRules,
  identityKeyForProposal,
  type IdentityInferenceClient,
  type IdentityInferenceFn,
  type ProposedIdentity,
  type UnresolvedEntityRow,
} from "./catalog-identity-inference";

// ─── In-memory fake prisma surface ───────────────────────────────────────────

type EntityRow = UnresolvedEntityRow & {
  catalogIdentityId: string | null;
  lastSeenAt: number;
  identityConfidence: number | null;
};
type LogRow = {
  id: string;
  inventoryEntityId: string | null;
  catalogIdentityId: string | null;
  resolutionType: string;
  confidence: number | null;
  evidence: unknown;
};
type IdentityRow = { id: string; identityKey: string; source: string };
type RuleRow = {
  id: string;
  ruleKey: string;
  status: string;
  catalogIdentityId: string | null;
  sourceObservationIds: string[];
};

function makeDb(seed: {
  entities?: EntityRow[];
  logs?: LogRow[];
  rules?: RuleRow[];
}) {
  const entities = seed.entities ?? [];
  const logs: LogRow[] = seed.logs ?? [];
  const identities: IdentityRow[] = [];
  const rules: RuleRow[] = seed.rules ?? [];
  let seq = 0;
  const nextId = (p: string) => `${p}-${++seq}`;

  const isUnresolved = (e: EntityRow) =>
    e.catalogIdentityId === null &&
    (e.identityStatus === null ||
      ["unresolved", "needs_review", "needs_reresolve"].includes(e.identityStatus));

  const db: IdentityInferenceClient = {
    inventoryEntity: {
      count: async () => entities.filter(isUnresolved).length,
      findMany: async (args: unknown) => {
        const { take } = (args ?? {}) as { take?: number };
        return entities
          .filter(isUnresolved)
          .sort((a, b) => a.lastSeenAt - b.lastSeenAt)
          .slice(0, take ?? entities.length)
          .map((e) => ({
            id: e.id,
            name: e.name,
            entityType: e.entityType,
            manufacturer: e.manufacturer,
            productModel: e.productModel,
            observedVersion: e.observedVersion,
            normalizedVersion: e.normalizedVersion,
            identityStatus: e.identityStatus,
            properties: e.properties,
          }));
      },
      updateMany: async ({ where, data }) => {
        const target = entities.find((e) => e.id === where.id);
        if (!target) return { count: 0 };
        if (where.identityStatus?.not && target.identityStatus === where.identityStatus.not) {
          return { count: 0 };
        }
        target.catalogIdentityId = data.catalogIdentityId;
        target.identityStatus = data.identityStatus;
        target.identityConfidence = data.identityConfidence;
        return { count: 1 };
      },
    },
    identityResolutionLog: {
      findMany: async ({ where }) =>
        logs
          .filter(
            (l) =>
              l.inventoryEntityId === where.inventoryEntityId &&
              l.resolutionType === where.resolutionType,
          )
          .map((l) => ({ id: l.id, catalogIdentityId: l.catalogIdentityId })),
      findFirst: async (args: unknown) => {
        const { where } = (args ?? {}) as {
          where: { inventoryEntityId: string; resolutionType: { in: string[] } };
        };
        const found = logs.find(
          (l) =>
            l.inventoryEntityId === where.inventoryEntityId &&
            where.resolutionType.in.includes(l.resolutionType),
        );
        return found ? { id: found.id, catalogIdentityId: found.catalogIdentityId } : null;
      },
      create: async ({ data }) => {
        logs.push({
          id: nextId("log"),
          inventoryEntityId: (data.inventoryEntityId as string) ?? null,
          catalogIdentityId: (data.catalogIdentityId as string) ?? null,
          resolutionType: data.resolutionType as string,
          confidence: (data.confidence as number) ?? null,
          evidence: data.evidence,
        });
        return {};
      },
    },
    catalogIdentity: {
      upsert: async ({ where, create }) => {
        const existing = identities.find((i) => i.identityKey === where.identityKey);
        if (existing) {
          existing.source = "ai_resolved";
          return { id: existing.id };
        }
        const row = { id: nextId("ci"), identityKey: where.identityKey, source: create.source as string };
        identities.push(row);
        return { id: row.id };
      },
    },
    discoveryFingerprintRule: {
      findMany: async ({ where }) =>
        rules
          .filter((r) => r.status === where.status)
          .map((r) => ({
            id: r.id,
            catalogIdentityId: r.catalogIdentityId,
            sourceObservationIds: r.sourceObservationIds,
          })),
      findFirst: async ({ where }) => {
        const found = rules.find((r) => r.ruleKey === where.ruleKey);
        return found ? { id: found.id } : null;
      },
      create: async ({ data }) => {
        rules.push({
          id: nextId("rule"),
          ruleKey: data.ruleKey as string,
          status: data.status as string,
          catalogIdentityId: (data.catalogIdentityId as string) ?? null,
          sourceObservationIds: (data.sourceObservationIds as string[]) ?? [],
        });
        return {};
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const r of rules) {
          if (where.id.in.includes(r.id)) {
            r.status = data.status;
            count += 1;
          }
        }
        return { count };
      },
    },
  };

  return { db, entities, logs, identities, rules };
}

function entity(id: string, over: Partial<EntityRow> = {}): EntityRow {
  return {
    id,
    name: over.name ?? `entity-${id}`,
    entityType: over.entityType ?? "application",
    manufacturer: over.manufacturer ?? null,
    productModel: over.productModel ?? null,
    observedVersion: over.observedVersion ?? null,
    normalizedVersion: over.normalizedVersion ?? null,
    identityStatus: over.identityStatus ?? null,
    properties: over.properties ?? {},
    catalogIdentityId: over.catalogIdentityId ?? null,
    lastSeenAt: over.lastSeenAt ?? 0,
    identityConfidence: over.identityConfidence ?? null,
  };
}

/** An inference fn that resolves each entity to a fixed proposal at a chosen confidence. */
function inferAll(
  proposal: (e: UnresolvedEntityRow) => Omit<ProposedIdentity, "entityId"> | null,
  tokensPerCall = 100,
): IdentityInferenceFn {
  return async (batch) => ({
    proposals: batch
      .map((e) => {
        const p = proposal(e);
        return p ? { entityId: e.id, ...p } : null;
      })
      .filter((p): p is ProposedIdentity => p !== null),
    tokensUsed: tokensPerCall,
  });
}

// ─── identityKeyForProposal ──────────────────────────────────────────────────

describe("identityKeyForProposal", () => {
  it("builds a slugged part:manufacturer:product:version:edition key", () => {
    expect(
      identityKeyForProposal({
        manufacturer: "PostgreSQL Global Dev Group",
        product: "PostgreSQL",
        productVersion: "16.2",
        edition: null,
        part: "a",
      }),
    ).toBe("a:postgresql-global-dev-group:postgresql:16-2:");
  });

  it("defaults part to 'a' and tolerates missing version/edition", () => {
    expect(identityKeyForProposal({ manufacturer: "Nginx", product: "Nginx" })).toBe(
      "a:nginx:nginx::",
    );
  });
});

// ─── shadow window: log-only, no catalogIdentityId ───────────────────────────

describe("runIdentityInferenceFallback — shadow window", () => {
  it("logs ai_resolved but does NOT write catalogIdentityId below the auto-apply threshold", async () => {
    const { db, entities, logs } = makeDb({ entities: [entity("e1")] });
    const result = await runIdentityInferenceFallback(
      db,
      inferAll(() => ({ manufacturer: "Acme", product: "Widget", confidence: 0.8 })),
    );

    expect(result.aiResolutionsLogged).toBe(1);
    expect(result.autoApplied).toBe(0);
    expect(result.shadowRulesPromoted).toBe(0);
    expect(logs).toHaveLength(1);
    expect(logs[0].resolutionType).toBe("ai_resolved");
    // Shadow window: the entity's canonical link is untouched.
    expect(entities[0].catalogIdentityId).toBeNull();
    expect(entities[0].identityStatus).toBeNull();
  });

  it("ignores a proposal with no manufacturer/product (never fabricates an identity)", async () => {
    const { db, logs } = makeDb({ entities: [entity("e1")] });
    const result = await runIdentityInferenceFallback(
      db,
      inferAll(() => ({ manufacturer: "", product: "", confidence: 0.99 })),
    );
    expect(result.proposalsReceived).toBe(1);
    expect(result.aiResolutionsLogged).toBe(0);
    expect(result.autoApplied).toBe(0);
    expect(logs).toHaveLength(0);
  });

  it("resolves nothing when the model omits the entity", async () => {
    const { db, entities } = makeDb({ entities: [entity("e1")] });
    const result = await runIdentityInferenceFallback(db, inferAll(() => null));
    expect(result.entitiesInferred).toBe(1);
    expect(result.proposalsReceived).toBe(0);
    expect(result.aiResolutionsLogged).toBe(0);
    expect(entities[0].catalogIdentityId).toBeNull();
  });
});

// ─── auto-apply at >= 0.97 ───────────────────────────────────────────────────

describe("runIdentityInferenceFallback — auto-apply", () => {
  it("writes catalogIdentityId + identityStatus at confidence >= 0.97", async () => {
    const { db, entities } = makeDb({ entities: [entity("e1")] });
    const result = await runIdentityInferenceFallback(
      db,
      inferAll(() => ({ manufacturer: "Acme", product: "Widget", confidence: 0.98 })),
    );
    expect(result.autoApplied).toBe(1);
    expect(entities[0].catalogIdentityId).not.toBeNull();
    expect(entities[0].identityStatus).toBe("ai_resolved");
    expect(entities[0].identityConfidence).toBe(0.98);
  });

  it("respects a custom autoApplyThreshold", async () => {
    const { db, entities } = makeDb({ entities: [entity("e1")] });
    const result = await runIdentityInferenceFallback(
      db,
      inferAll(() => ({ manufacturer: "Acme", product: "Widget", confidence: 0.9 })),
      { autoApplyThreshold: 0.85 },
    );
    expect(result.autoApplied).toBe(1);
    expect(entities[0].catalogIdentityId).not.toBeNull();
  });

  it("NEVER overwrites a human_confirmed identity", async () => {
    // The scan excludes it (identityStatus not in the unresolved set), and even if it
    // reached the write the guard blocks it. Assert the scan exclusion here.
    const { db, entities } = makeDb({
      entities: [entity("e1", { identityStatus: "human_confirmed" })],
    });
    const result = await runIdentityInferenceFallback(
      db,
      inferAll(() => ({ manufacturer: "Acme", product: "Widget", confidence: 0.99 })),
    );
    expect(result.entitiesScanned).toBe(0);
    expect(result.autoApplied).toBe(0);
    expect(entities[0].identityStatus).toBe("human_confirmed");
  });
});

// ─── shadow rule promotion ───────────────────────────────────────────────────

describe("runIdentityInferenceFallback — shadow rule promotion", () => {
  it("promotes a shadow rule after N identical resolutions of the same entity", async () => {
    const seed = makeDb({ entities: [entity("e1")] });
    const infer = inferAll(() => ({ manufacturer: "Acme", product: "Widget", confidence: 0.8 }));

    // Runs 1 and 2: below threshold (3) — log only, no rule.
    await runIdentityInferenceFallback(seed.db, infer, { shadowPromotionThreshold: 3 });
    let r = await runIdentityInferenceFallback(seed.db, infer, { shadowPromotionThreshold: 3 });
    expect(r.shadowRulesPromoted).toBe(0);
    expect(seed.rules).toHaveLength(0);

    // Run 3: the 3rd identical resolution crosses the bar → shadow rule.
    r = await runIdentityInferenceFallback(seed.db, infer, { shadowPromotionThreshold: 3 });
    expect(r.shadowRulesPromoted).toBe(1);
    expect(seed.rules).toHaveLength(1);
    expect(seed.rules[0].status).toBe("shadow");
    expect(seed.rules[0].sourceObservationIds).toEqual(["e1"]);

    // Run 4: entity is now settled into shadow (>= threshold logs) → skipped, not re-inferred.
    r = await runIdentityInferenceFallback(seed.db, infer, { shadowPromotionThreshold: 3 });
    expect(r.entitiesInferred).toBe(0);
    expect(r.shadowRulesPromoted).toBe(0);
    expect(seed.rules).toHaveLength(1); // idempotent — no duplicate rule.
  });

  it("does not promote when the AI is inconsistent (different identity each run)", async () => {
    const seed = makeDb({ entities: [entity("e1")] });
    let n = 0;
    const infer: IdentityInferenceFn = async (batch) => ({
      proposals: batch.map((e) => ({
        entityId: e.id,
        manufacturer: "Acme",
        product: `Widget${n++}`,
        confidence: 0.8,
      })),
      tokensUsed: 50,
    });
    await runIdentityInferenceFallback(seed.db, infer, { shadowPromotionThreshold: 3 });
    await runIdentityInferenceFallback(seed.db, infer, { shadowPromotionThreshold: 3 });
    const r = await runIdentityInferenceFallback(seed.db, infer, { shadowPromotionThreshold: 3 });
    expect(r.shadowRulesPromoted).toBe(0);
    expect(seed.rules).toHaveLength(0);
  });
});

// ─── cost guardrail: batching + per-run budget cap ───────────────────────────

describe("runIdentityInferenceFallback — cost guardrail", () => {
  it("batches entities per inference call", async () => {
    const ents = Array.from({ length: 45 }, (_, i) => entity(`e${i}`, { lastSeenAt: i }));
    const { db } = makeDb({ entities: ents });
    let calls = 0;
    let maxBatch = 0;
    const infer: IdentityInferenceFn = async (batch) => {
      calls += 1;
      maxBatch = Math.max(maxBatch, batch.length);
      return { proposals: [], tokensUsed: 10 };
    };
    const r = await runIdentityInferenceFallback(db, infer, { batchSize: 20 });
    expect(maxBatch).toBe(20);
    expect(calls).toBe(3); // 20 + 20 + 5
    expect(r.inferenceCalls).toBe(3);
  });

  it("stops dispatching once the per-run token budget is exhausted", async () => {
    const ents = Array.from({ length: 100 }, (_, i) => entity(`e${i}`, { lastSeenAt: i }));
    const { db } = makeDb({ entities: ents });
    const infer: IdentityInferenceFn = async () => ({ proposals: [], tokensUsed: 500 });
    const r = await runIdentityInferenceFallback(db, infer, {
      batchSize: 10,
      maxInferenceTokens: 1000, // budget covers ~2 calls (500 each) before the 3rd is blocked.
    });
    expect(r.budgetExhausted).toBe(true);
    expect(r.inferenceCalls).toBe(2);
    expect(r.inferenceTokensSpent).toBe(1000);
  });

  it("enforces the hard inference-call cap", async () => {
    const ents = Array.from({ length: 100 }, (_, i) => entity(`e${i}`, { lastSeenAt: i }));
    const { db } = makeDb({ entities: ents });
    const infer: IdentityInferenceFn = async () => ({ proposals: [], tokensUsed: 1 });
    const r = await runIdentityInferenceFallback(db, infer, {
      batchSize: 5,
      maxInferenceCalls: 3,
      maxInferenceTokens: 10_000_000,
    });
    expect(r.budgetExhausted).toBe(true);
    expect(r.inferenceCalls).toBe(3);
  });

  it("reports the total unresolved count for coverage even when bounded", async () => {
    const ents = Array.from({ length: 30 }, (_, i) => entity(`e${i}`, { lastSeenAt: i }));
    const { db } = makeDb({ entities: ents });
    const r = await runIdentityInferenceFallback(db, inferAll(() => null), { scanLimit: 10 });
    expect(r.unresolvedTotal).toBe(30);
    expect(r.entitiesScanned).toBe(10);
  });
});

// ─── human demotion of a contradicted shadow rule ────────────────────────────

describe("demoteHumanContradictedShadowRules", () => {
  it("rejects a shadow rule when a human resolved its source entity to a different identity", async () => {
    const { db, rules } = makeDb({
      rules: [
        {
          id: "rule-x",
          ruleKey: "ai-shadow:e1:a:acme:widget::",
          status: "shadow",
          catalogIdentityId: "ci-widget",
          sourceObservationIds: ["e1"],
        },
      ],
      logs: [
        {
          id: "log-h",
          inventoryEntityId: "e1",
          catalogIdentityId: "ci-gadget", // human landed on a DIFFERENT identity
          resolutionType: "human_confirmed",
          confidence: 1,
          evidence: {},
        },
      ],
    });
    const demoted = await demoteHumanContradictedShadowRules(db);
    expect(demoted).toBe(1);
    expect(rules[0].status).toBe("rejected");
  });

  it("leaves a shadow rule alone when the human confirms the SAME identity", async () => {
    const { db, rules } = makeDb({
      rules: [
        {
          id: "rule-x",
          ruleKey: "ai-shadow:e1:a:acme:widget::",
          status: "shadow",
          catalogIdentityId: "ci-widget",
          sourceObservationIds: ["e1"],
        },
      ],
      logs: [
        {
          id: "log-h",
          inventoryEntityId: "e1",
          catalogIdentityId: "ci-widget", // same identity — no contradiction
          resolutionType: "human_confirmed",
          confidence: 1,
          evidence: {},
        },
      ],
    });
    const demoted = await demoteHumanContradictedShadowRules(db);
    expect(demoted).toBe(0);
    expect(rules[0].status).toBe("shadow");
  });

  it("is invoked at the start of a run and reported in the result", async () => {
    const { db, rules } = makeDb({
      entities: [],
      rules: [
        {
          id: "rule-x",
          ruleKey: "ai-shadow:e1:a:acme:widget::",
          status: "shadow",
          catalogIdentityId: "ci-widget",
          sourceObservationIds: ["e1"],
        },
      ],
      logs: [
        {
          id: "log-h",
          inventoryEntityId: "e1",
          catalogIdentityId: "ci-other",
          resolutionType: "human_corrected",
          confidence: 1,
          evidence: {},
        },
      ],
    });
    const r = await runIdentityInferenceFallback(db, inferAll(() => null));
    expect(r.shadowRulesDemoted).toBe(1);
    expect(rules[0].status).toBe("rejected");
  });
});
