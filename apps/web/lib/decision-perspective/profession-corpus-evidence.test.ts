import { describe, expect, it } from "vitest";

import type { ProfessionCorpusContext } from "./profession-corpus";
import {
  corpusGapFingerprint,
  corpusUsageDay,
  gapReasonForContext,
  recordProfessionCorpusEvidence,
  recordProviderComplianceAnswerGaps,
  recordProfessionCorpusGap,
  recordProfessionCorpusUsage,
  UNMAPPED_PROFESSION_KEY,
  type ProfessionCorpusEvidenceClient,
} from "./profession-corpus-evidence";

// ─── Stateful in-memory fake (interprets prisma {increment} semantics) ────────

type GapRow = {
  fingerprint: string;
  professionKey: string;
  reason: string;
  query: string;
  occurrences: number;
  agentId: string | null;
  routeContext: string | null;
  suggestedSource: string | null;
  status: string;
};
type UsageRow = { professionKey: string; day: string; injectedCount: number; missedCount: number };

function applyIncrement(current: number, op: unknown): number {
  if (op && typeof op === "object" && "increment" in op) {
    return current + (op as { increment: number }).increment;
  }
  return typeof op === "number" ? op : current;
}

function fakeEvidenceDb() {
  const gaps = new Map<string, GapRow>();
  const usage = new Map<string, UsageRow>();
  const db: ProfessionCorpusEvidenceClient = {
    professionCorpusGap: {
      upsert: async ({ where, create, update }) => {
        const existing = gaps.get(where.fingerprint);
        if (!existing) {
          gaps.set(where.fingerprint, {
            fingerprint: where.fingerprint,
            professionKey: create.professionKey as string,
            reason: create.reason as string,
            query: create.query as string,
            occurrences: (create.occurrences as number) ?? 1,
            agentId: (create.agentId as string | null) ?? null,
            routeContext: (create.routeContext as string | null) ?? null,
            suggestedSource: (create.suggestedSource as string | null) ?? null,
            status: (create.status as string) ?? "open",
          });
        } else {
          existing.occurrences = applyIncrement(existing.occurrences, update.occurrences);
          if ("query" in update) existing.query = update.query as string;
          if ("agentId" in update) existing.agentId = update.agentId as string | null;
        }
        return gaps.get(where.fingerprint);
      },
    },
    professionCorpusUsageStat: {
      upsert: async ({ where, create, update }) => {
        const key = `${where.professionKey_day.professionKey}:${where.professionKey_day.day}`;
        const existing = usage.get(key);
        if (!existing) {
          usage.set(key, {
            professionKey: where.professionKey_day.professionKey,
            day: where.professionKey_day.day,
            injectedCount: (create.injectedCount as number) ?? 0,
            missedCount: (create.missedCount as number) ?? 0,
          });
        } else {
          existing.injectedCount = applyIncrement(existing.injectedCount, update.injectedCount);
          existing.missedCount = applyIncrement(existing.missedCount, update.missedCount);
        }
        return usage.get(key);
      },
    },
  };
  return { db, gaps, usage };
}

function makeContext(over: Partial<ProfessionCorpusContext>): ProfessionCorpusContext {
  return {
    status: "injected",
    professionKey: "software-engineer",
    familyLabel: "Software Engineer",
    profileId: "wsid-software-engineer",
    pages: [],
    promptBlock: "PROFESSION CORPUS — Software Engineer",
    compactBlock: "compact",
    tokenCount: 10,
    compactTokenCount: 4,
    lowRelevance: false,
    missingTopic: "topic",
    suggestedSource: null,
    ...over,
  };
}

const FIXED_DAY = new Date("2026-06-16T09:30:00.000Z");

// ─── Fingerprint ──────────────────────────────────────────────────────────────

describe("corpusGapFingerprint", () => {
  it("is stable across whitespace/case/punctuation variants of the same topic", () => {
    const a = corpusGapFingerprint("finance", "How do I book a deferral?", "low-relevance");
    const b = corpusGapFingerprint("finance", "  how do i book a   DEFERRAL  ", "low-relevance");
    expect(a).toBe(b);
  });

  it("differs by reason and by profession", () => {
    expect(corpusGapFingerprint("finance", "x topic", "low-relevance")).not.toBe(
      corpusGapFingerprint("finance", "x topic", "empty-corpus"),
    );
    expect(corpusGapFingerprint("finance", "x topic", "low-relevance")).not.toBe(
      corpusGapFingerprint("security", "x topic", "low-relevance"),
    );
  });
});

describe("corpusUsageDay", () => {
  it("buckets to a UTC YYYY-MM-DD string", () => {
    expect(corpusUsageDay(FIXED_DAY)).toBe("2026-06-16");
  });
});

// ─── Usage stat ───────────────────────────────────────────────────────────────

describe("recordProfessionCorpusUsage", () => {
  it("increments injected/missed counters in the same day bucket", async () => {
    const { db, usage } = fakeEvidenceDb();
    await recordProfessionCorpusUsage({ professionKey: "finance", injected: true, now: FIXED_DAY }, { db });
    await recordProfessionCorpusUsage({ professionKey: "finance", injected: true, now: FIXED_DAY }, { db });
    await recordProfessionCorpusUsage({ professionKey: "finance", injected: false, now: FIXED_DAY }, { db });

    const row = usage.get("finance:2026-06-16")!;
    expect(row.injectedCount).toBe(2);
    expect(row.missedCount).toBe(1);
  });
});

// ─── Gap dedup / idempotency ──────────────────────────────────────────────────

describe("recordProfessionCorpusGap", () => {
  it("coalesces re-detections into occurrences (idempotent dedup)", async () => {
    const { db, gaps } = fakeEvidenceDb();
    const input = {
      professionKey: "finance",
      reason: "low-relevance" as const,
      query: "How do I book a multi-year deferral?",
    };
    const first = await recordProfessionCorpusGap(input, { db });
    const second = await recordProfessionCorpusGap(input, { db });

    expect(first.recorded).toBe(true);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(gaps.size).toBe(1);
    expect(gaps.get(first.fingerprint)!.occurrences).toBe(2);
  });

  it("keeps distinct rows for different reasons on the same topic", async () => {
    const { db, gaps } = fakeEvidenceDb();
    await recordProfessionCorpusGap({ professionKey: "finance", reason: "low-relevance", query: "topic x" }, { db });
    await recordProfessionCorpusGap({ professionKey: "finance", reason: "deferred", query: "topic x" }, { db });
    expect(gaps.size).toBe(2);
  });

  it("does not record an empty-topic gap", async () => {
    const { db, gaps } = fakeEvidenceDb();
    const result = await recordProfessionCorpusGap({ professionKey: "finance", reason: "deferred", query: "   " }, { db });
    expect(result.recorded).toBe(false);
    expect(gaps.size).toBe(0);
  });
});

describe("recordProviderComplianceAnswerGaps", () => {
  it("deduplicates repeated validation reasons into legal-compliance repair signals", async () => {
    const { db, gaps } = fakeEvidenceDb();
    await recordProviderComplianceAnswerGaps({
      reasons: ["stale-source", "citation-mismatch", "stale-source"],
      query: "Can this provider handle employee records?",
      agentId: "AGT-902",
      routeContext: "/setup",
    }, { db });

    expect(gaps.size).toBe(2);
    expect([...gaps.values()].map((gap) => gap.reason).sort()).toEqual([
      "citation-mismatch",
      "stale-source",
    ]);
    expect([...gaps.values()].every((gap) => gap.professionKey === "legal-compliance")).toBe(true);
  });
});

// ─── gapReasonForContext ──────────────────────────────────────────────────────

describe("gapReasonForContext", () => {
  it("maps statuses to gap reasons", () => {
    expect(gapReasonForContext(makeContext({ status: "missed-unmapped" }))).toBe("unmapped");
    expect(gapReasonForContext(makeContext({ status: "missed-empty-corpus" }))).toBe("empty-corpus");
    expect(gapReasonForContext(makeContext({ status: "injected", lowRelevance: true }))).toBe("low-relevance");
    expect(gapReasonForContext(makeContext({ status: "injected", lowRelevance: false }))).toBeNull();
    expect(gapReasonForContext(makeContext({ status: "error" }))).toBeNull();
  });
});

// ─── Orchestrator ─────────────────────────────────────────────────────────────

describe("recordProfessionCorpusEvidence", () => {
  it("records an injection (usage only, no gap) for a healthy hit", async () => {
    const { db, gaps, usage } = fakeEvidenceDb();
    await recordProfessionCorpusEvidence(
      { context: makeContext({ status: "injected" }), query: "secure coding", agentId: "AGT-1", routeContext: "/workspace", now: FIXED_DAY },
      { db },
    );
    expect(usage.get("software-engineer:2026-06-16")!.injectedCount).toBe(1);
    expect(gaps.size).toBe(0);
  });

  it("records a miss + gap for an unmapped coworker (not silently swallowed)", async () => {
    const { db, gaps, usage } = fakeEvidenceDb();
    await recordProfessionCorpusEvidence(
      {
        context: makeContext({ status: "missed-unmapped", professionKey: null, profileId: null }),
        query: "What is our refund policy?",
        agentId: "AGT-2",
        routeContext: "/workspace",
        now: FIXED_DAY,
      },
      { db },
    );
    expect(usage.get(`${UNMAPPED_PROFESSION_KEY}:2026-06-16`)!.missedCount).toBe(1);
    expect(gaps.size).toBe(1);
    expect([...gaps.values()][0]!.reason).toBe("unmapped");
  });

  it("records a low-relevance gap when the corpus did not cover the question", async () => {
    const { db, gaps } = fakeEvidenceDb();
    await recordProfessionCorpusEvidence(
      { context: makeContext({ status: "injected", lowRelevance: true, suggestedSource: "Seed corpus covering: x" }), query: "kubernetes rollout strategy", now: FIXED_DAY },
      { db },
    );
    expect(gaps.size).toBe(1);
    expect([...gaps.values()][0]!.reason).toBe("low-relevance");
  });

  it("records nothing on a transient DB error (no infra noise in the backlog)", async () => {
    const { db, gaps, usage } = fakeEvidenceDb();
    await recordProfessionCorpusEvidence(
      { context: makeContext({ status: "error" }), query: "secure coding", now: FIXED_DAY },
      { db },
    );
    expect(gaps.size).toBe(0);
    expect(usage.size).toBe(0);
  });
});
