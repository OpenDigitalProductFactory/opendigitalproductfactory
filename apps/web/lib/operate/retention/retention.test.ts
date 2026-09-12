// EP-DATA-RETENTION — engine + registry tests.
//
// Spec: docs/superpowers/specs/2026-06-14-data-retention-lifecycle-governance-design.md
//
// The load-bearing invariant: a regulated model must NEVER be enrolled for
// automatic purge. That guard fails the build if anyone adds, say, "invoice" to
// PURGE_POLICIES. The rest exercises floor math (industries lengthen, never
// shorten) and the executor (batched delete, per-policy cap, dry-run count-only,
// cascade-ordered chat handler, error isolation).

import { describe, it, expect } from "vitest";

import {
  RETENTION_FLOOR_BUCKETS,
  RETENTION_OVERRIDES,
  type RetentionPrismaClient,
  TOOL_EXECUTION_SHORT_LIVED_AUDIT_CLASSES,
} from "./policies";
import {
  buildPurgePolicies,
  buildRetainedDatasets,
  floorBucket,
  orphanOverrides,
  readDeclarationsFromSchemaFiles,
} from "./declarations";

// EP-A33A5C61 slice 4d: the registry under test IS the schema. Every
// declaration below is read from packages/db/prisma/schema `/// @dpf` tags —
// the same source the catalog is converged from at portal boot.
const DECLARATIONS = readDeclarationsFromSchemaFiles();
const PURGE_POLICIES = buildPurgePolicies(DECLARATIONS);
const RETAINED_DATASETS = buildRetainedDatasets(DECLARATIONS);
const PURGE_MODELS = PURGE_POLICIES.map((p) => p.model);
const RETAINED_MODELS = RETAINED_DATASETS.map((d) => d.model);
const POLICIES = PURGE_POLICIES;
import { AUDIT_CLASSES } from "../../audit-classes";
import {
  resolveEffectiveRetentionDays,
  toFloorKey,
  INDUSTRY_RETENTION_FLOORS,
} from "./industry-floors";
import { runRetentionSweep } from "./execute";
import { SCHEDULED_JOB_CATALOG } from "../scheduled-jobs/catalog";

describe("retention registry invariants", () => {
  it("every behavioural override names a model the schema declares purgeable", () => {
    expect(orphanOverrides(DECLARATIONS, RETENTION_OVERRIDES)).toEqual([]);
  });

  it("derives the floor bucket from the DataCategory tag, never from a declared category", () => {
    expect(floorBucket({ lifecycle: "telemetry-bounded", categories: ["security-audit"] })).toBe("audit");
    expect(floorBucket({ lifecycle: "telemetry-bounded", categories: ["authorization", "telemetry"] })).toBe("audit");
    expect(floorBucket({ lifecycle: "telemetry-bounded", categories: ["content"] })).toBe("chat");
    expect(floorBucket({ lifecycle: "telemetry-bounded", categories: ["telemetry"] })).toBe("telemetry");
    expect(floorBucket({ lifecycle: "telemetry-bounded" })).toBe("telemetry");
  });

  it("expands a partition override into one policy per partition with the model window as default", () => {
    const policies = buildPurgePolicies(
      [{ model: "Widget", table: "Widget", metadata: { lifecycle: "telemetry-bounded", retention: { kind: "purge", days: 200 }, timeAxis: "seenAt" } }],
      { widget: { partitions: [{ label: "a", extraWhere: { kind: "a" } }, { label: "b", extraWhere: { kind: "b" }, days: 10 }] } },
    );
    expect(policies.map((p) => [p.model, p.timestampField, p.baseRetentionDays, p.extraWhere])).toEqual([
      ["widget", "seenAt", 200, { kind: "a" }],
      ["widget", "seenAt", 10, { kind: "b" }],
    ]);
  });

  it("NEVER enrolls a regulated model for purge (the load-bearing guard)", () => {
    const overlap = PURGE_MODELS.filter((m) => RETAINED_MODELS.includes(m));
    expect(overlap).toEqual([]);
  });

  it("retains the core financial models for at least 7 years", () => {
    for (const model of ["invoice", "payment", "bill"]) {
      const entry = RETAINED_DATASETS.find((d) => d.model === model);
      expect(entry, `${model} must be a retained dataset`).toBeDefined();
      expect(entry!.minRetentionYears).toBeGreaterThanOrEqual(7);
    }
  });

  it("never auto-purges permanent initiative artifact retention pins", () => {
    const entry = RETAINED_DATASETS.find((dataset) => dataset.model === "initiativeArtifactRetentionPin");
    expect(entry?.minRetentionYears).toBe(Number.POSITIVE_INFINITY);
    expect(PURGE_MODELS).not.toContain("initiativeArtifactRetentionPin");
  });

  it("every purge policy is well-formed", () => {
    for (const p of PURGE_POLICIES) {
      expect(p.model.length).toBeGreaterThan(0);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.timestampField.length).toBeGreaterThan(0);
      expect(RETENTION_FLOOR_BUCKETS).toContain(p.category);
      // Nothing is ever purged younger than a week — a tripwire against a
      // fat-fingered tiny window deleting live data.
      expect(p.baseRetentionDays).toBeGreaterThanOrEqual(7);
    }
  });

  it("has no duplicate policies: a model appears once per distinct extraWhere partition", () => {
    // A model MAY be enrolled more than once when each entry selects a
    // disjoint partition (ToolExecution by auditClass). Two entries with the
    // same model AND the same extraWhere would double-count and double-delete.
    const keys = PURGE_POLICIES.map((p) => `${p.model}::${JSON.stringify(p.extraWhere ?? null)}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(RETAINED_MODELS).size).toBe(RETAINED_MODELS.length);
  });

  it("splits ToolExecution by audit class exactly as lib/audit-classes.ts states (BI-A55A651B)", () => {
    const branches = PURGE_POLICIES.filter((p) => p.model === "toolExecution");
    const byClass = new Map<string, number>();
    let complement: (typeof branches)[number] | undefined;
    for (const b of branches) {
      const where = b.extraWhere as { auditClass?: unknown; NOT?: { auditClass?: { in?: readonly string[] } } } | undefined;
      if (typeof where?.auditClass === "string") byClass.set(where.auditClass, b.baseRetentionDays);
      else if (where?.NOT?.auditClass?.in) complement = b;
    }
    // journal + metrics_only are the short-lived classes, 30 days each.
    expect(TOOL_EXECUTION_SHORT_LIVED_AUDIT_CLASSES).toEqual(["journal", "metrics_only"]);
    for (const cls of TOOL_EXECUTION_SHORT_LIVED_AUDIT_CLASSES) {
      expect(AUDIT_CLASSES).toContain(cls);
      expect(byClass.get(cls)).toBe(30);
    }
    // ledger is the complement branch (so NULL auditClass can never escape),
    // and it is the long window.
    expect(complement).toBeDefined();
    const complementWhere = complement!.extraWhere as { NOT: { auditClass: { in: readonly string[] } } };
    expect([...complementWhere.NOT.auditClass.in]).toEqual([...TOOL_EXECUTION_SHORT_LIVED_AUDIT_CLASSES]);
    expect(complement!.baseRetentionDays).toBe(365);
    // Every declared audit class is covered by exactly one branch.
    const uncovered = AUDIT_CLASSES.filter(
      (c) => !byClass.has(c) && !TOOL_EXECUTION_SHORT_LIVED_AUDIT_CLASSES.includes(c as never) && c !== "ledger",
    );
    expect(uncovered).toEqual([]);
    expect(branches).toHaveLength(3);
  });

  it("routes coworker chat through a cascade-correct custom handler", () => {
    const chat = PURGE_POLICIES.find((p) => p.model === "agentThread");
    expect(chat).toBeDefined();
    expect(chat!.customPurge).toBeTypeOf("function");
    expect(chat!.timestampField).toBe("updatedAt"); // last activity, not creation
  });

  it("is registered in the scheduled-jobs catalog as an editable run-now job", () => {
    const entry = SCHEDULED_JOB_CATALOG.find(
      (e) => e.jobId === "data-retention-sweep",
    );
    expect(entry).toBeDefined();
    expect(entry!.category).toBe("editable"); // operator can disable a destructive purge
    expect(entry!.runNowEvent).toBe("ops/data-retention.requested");
    expect(entry!.tracksRunData).toBe(true);
  });
});

describe("industry / archetype retention floors", () => {
  it("lets a confirmed processing activity lengthen, never shorten, the effective floor", () => {
    const policy = { category: "audit" as const, baseRetentionDays: 365 };
    expect(resolveEffectiveRetentionDays(policy, null, 730)).toBe(730);
    expect(resolveEffectiveRetentionDays(policy, null, 30)).toBe(365);
  });

  const auditPolicy = { category: "audit" as const, baseRetentionDays: 365 };

  it("applies the base window when industry is null/unknown", () => {
    expect(resolveEffectiveRetentionDays(auditPolicy, null)).toBe(365);
    expect(resolveEffectiveRetentionDays(auditPolicy, "coffee-shop")).toBe(365);
  });

  it("lengthens audit retention to 7 years for banking", () => {
    expect(
      resolveEffectiveRetentionDays(auditPolicy, "banking-financial-services"),
    ).toBe(INDUSTRY_RETENTION_FLOORS["banking-financial-services"]["audit"]);
    expect(
      resolveEffectiveRetentionDays(auditPolicy, "banking-financial-services"),
    ).toBe(2555);
  });

  it("never shortens: a base longer than the floor wins", () => {
    const longPolicy = { category: "audit" as const, baseRetentionDays: 5000 };
    expect(
      resolveEffectiveRetentionDays(longPolicy, "banking-financial-services"),
    ).toBe(5000);
  });

  it("normalizes industry aliases onto the canonical floor key", () => {
    expect(toFloorKey("financial")).toBe("banking-financial-services");
    expect(toFloorKey("Healthcare")).toBe("healthcare-wellness");
    expect(toFloorKey("public_sector")).toBe("public-sector");
    // unknown stays normalized (and simply hits no floor)
    expect(toFloorKey("Widget Co")).toBe("widget-co");
  });
});

// ── Executor (in-memory fake prisma) ────────────────────────────────────────

interface FakeModelState {
  remaining: number;
  log: string[];
  calls: Array<{ op: string; where: unknown; take?: number }>;
}

function makeFakeModel(
  name: string,
  remaining: number,
  sharedLog: string[],
  opts: { throwOn?: "findMany" | "deleteMany" } = {},
) {
  const state: FakeModelState = { remaining, log: sharedLog, calls: [] };
  let counter = 0;
  const model = {
    state,
    async findMany({ where, take }: { where: unknown; take: number }) {
      state.calls.push({ op: "findMany", where, take });
      sharedLog.push(`${name}.findMany`);
      if (opts.throwOn === "findMany") throw new Error(`${name} findMany boom`);
      const n = Math.min(take, state.remaining);
      return Array.from({ length: n }, () => ({ id: `${name}-${++counter}` }));
    },
    async deleteMany({ where }: { where: Record<string, unknown> }) {
      state.calls.push({ op: "deleteMany", where });
      sharedLog.push(`${name}.deleteMany`);
      if (opts.throwOn === "deleteMany") throw new Error(`${name} deleteMany boom`);
      const idClause = where?.id as { in?: string[] } | undefined;
      if (idClause?.in) {
        const n = idClause.in.length;
        state.remaining -= n;
        return { count: n };
      }
      // Non-id delete (e.g. chat proposals by threadId): doesn't drain the pool.
      return { count: 0 };
    },
    async count() {
      state.calls.push({ op: "count", where: undefined });
      sharedLog.push(`${name}.count`);
      return state.remaining;
    },
  };
  return model;
}

function makeFakePrisma(
  models: Record<string, number>,
  opts: { throwOn?: Record<string, "findMany" | "deleteMany"> } = {},
) {
  const sharedLog: string[] = [];
  const built: Record<string, ReturnType<typeof makeFakeModel>> = {};
  for (const [name, remaining] of Object.entries(models)) {
    built[name] = makeFakeModel(name, remaining, sharedLog, {
      throwOn: opts.throwOn?.[name],
    });
  }
  const prisma = {
    ...built,
    sharedLog,
    async $transaction(ops: unknown[]) {
      return Promise.all(ops as Promise<unknown>[]);
    },
  };
  return prisma as unknown as RetentionPrismaClient & {
    sharedLog: string[];
    [k: string]: unknown;
  };
}

describe("retention executor", () => {
  const NOW = new Date("2026-06-14T04:00:00.000Z");

  it("dry-run counts and never deletes", async () => {
    const prisma = makeFakePrisma({ tokenUsage: 42 });
    const report = await runRetentionSweep({
      prisma,
      now: NOW,
      dryRun: true,
      industryKey: null,
      policies: POLICIES,
      onlyModels: ["tokenUsage"],
    });
    expect(report.dryRun).toBe(true);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].affected).toBe(42);
    expect(prisma.sharedLog).toContain("tokenUsage.count");
    expect(prisma.sharedLog).not.toContain("tokenUsage.deleteMany");
  });

  it("batch-deletes all eligible rows on a real run", async () => {
    const prisma = makeFakePrisma({ toolExecution: 2300 });
    const report = await runRetentionSweep({
      prisma,
      now: NOW,
      dryRun: false,
      industryKey: null,
      policies: POLICIES,
      onlyModels: ["toolExecution"],
      batchSize: 1000,
      perPolicyCap: 100_000,
    });
    expect(report.results[0].affected).toBe(2300);
    expect(report.results[0].capped).toBe(false);
    // 3 delete batches: 1000 + 1000 + 300
    const deletes = prisma.sharedLog.filter((l) => l === "toolExecution.deleteMany");
    expect(deletes).toHaveLength(3);
  });

  it("stops at the per-policy cap and flags capped", async () => {
    const prisma = makeFakePrisma({ toolExecution: 10_000 });
    const report = await runRetentionSweep({
      prisma,
      now: NOW,
      dryRun: false,
      industryKey: null,
      policies: POLICIES,
      onlyModels: ["toolExecution"],
      batchSize: 1000,
      perPolicyCap: 2500,
    });
    expect(report.results[0].affected).toBe(2500);
    expect(report.results[0].capped).toBe(true);
  });

  it("computes the cutoff from the industry-widened retention", async () => {
    const prisma = makeFakePrisma({ toolExecution: 1 });
    const report = await runRetentionSweep({
      prisma,
      now: NOW,
      dryRun: false,
      industryKey: "banking-financial-services", // audit-log floor = 2555d
      policies: POLICIES,
      onlyModels: ["toolExecution"],
    });
    expect(report.results[0].effectiveRetentionDays).toBe(2555);
    const findManyCall = (
      prisma.toolExecution as unknown as { state: FakeModelState }
    ).state.calls.find((c) => c.op === "findMany");
    const where = findManyCall!.where as { createdAt: { lt: Date } };
    const expectedCutoff = new Date(NOW.getTime() - 2555 * 86_400_000);
    expect(where.createdAt.lt.toISOString()).toBe(expectedCutoff.toISOString());
  });

  it("purges chat via the cascade-ordered handler: proposals before threads", async () => {
    const prisma = makeFakePrisma({
      agentThread: 5,
      agentActionProposal: 0,
    });
    const report = await runRetentionSweep({
      prisma,
      now: NOW,
      dryRun: false,
      industryKey: null,
      policies: POLICIES,
      onlyModels: ["agentThread"],
    });
    expect(report.results[0].affected).toBe(5);
    const log = prisma.sharedLog;
    const proposalsAt = log.indexOf("agentActionProposal.deleteMany");
    const threadsAt = log.indexOf("agentThread.deleteMany");
    expect(proposalsAt).toBeGreaterThanOrEqual(0);
    expect(threadsAt).toBeGreaterThan(proposalsAt);
  });

  it("isolates a failing policy: others still run", async () => {
    const prisma = makeFakePrisma(
      { routeDecisionLog: 10, tokenUsage: 10 },
      { throwOn: { routeDecisionLog: "findMany" } },
    );
    const report = await runRetentionSweep({
      prisma,
      now: NOW,
      dryRun: false,
      industryKey: null,
      policies: POLICIES,
      onlyModels: ["routeDecisionLog", "tokenUsage"],
    });
    expect(report.errorCount).toBe(1);
    const failed = report.results.find((r) => r.model === "routeDecisionLog");
    const ok = report.results.find((r) => r.model === "tokenUsage");
    expect(failed!.error).toBeTruthy();
    expect(ok!.affected).toBe(10);
  });

  it("only purges read notifications (extraWhere is honored)", async () => {
    const prisma = makeFakePrisma({ notification: 7 });
    await runRetentionSweep({
      prisma,
      now: NOW,
      dryRun: false,
      industryKey: null,
      policies: POLICIES,
      onlyModels: ["notification"],
    });
    const findManyCall = (
      prisma.notification as unknown as { state: FakeModelState }
    ).state.calls.find((c) => c.op === "findMany");
    const where = findManyCall!.where as { read?: boolean };
    expect(where.read).toBe(true);
  });
});

describe("legal hold (BI-90A8D153 GAP 2)", () => {
  const NOW2 = new Date("2026-06-14T04:00:00.000Z");

  it("does not add a legalHold filter to an enrolled model that has no such column", async () => {
    // The exclusion spread must be a strict no-op for the 20 real policies (none
    // of which target a legalHold-bearing model) — it must not corrupt their
    // WHERE clause or accidentally spare rows.
    const prisma = makeFakePrisma({ tokenUsage: 3 });
    await runRetentionSweep({
      prisma,
      now: NOW2,
      dryRun: false,
      industryKey: null,
      policies: POLICIES,
      onlyModels: ["tokenUsage"],
    });
    const findManyCall = (
      prisma.tokenUsage as unknown as { state: FakeModelState }
    ).state.calls.find((c) => c.op === "findMany");
    const where = findManyCall!.where as Record<string, unknown>;
    expect(where).not.toHaveProperty("legalHold");
    // The timestamp arm is still the sole filter — behaviour unchanged.
    expect(Object.keys(where)).toEqual(["createdAt"]);
  });

  it("the exclusion clause spares only an explicit hold (unit — the held path is not enrollable today)", async () => {
    // No legalHold-bearing model is purge-enrolled, so an end-to-end sweep can
    // never reach one — which is precisely why the defect was latent. The
    // engine now composes `...legalHoldExclusion(policy.model)` into both the
    // live and dry-run WHERE clauses (execute.ts); legalHoldExclusion is proven
    // for both the held and non-held cases in legal-hold.schema.test.ts. Here we
    // pin the sparing semantics the engine relies on: `{ not: true }` excludes
    // only legalHold=true, leaving false/null purge-eligible.
    const { legalHoldExclusion } = await import("./legal-hold");
    expect(legalHoldExclusion("patientProfile")).toEqual({ legalHold: { not: true } });
    expect(legalHoldExclusion("toolExecution")).toEqual({});
  });
});
