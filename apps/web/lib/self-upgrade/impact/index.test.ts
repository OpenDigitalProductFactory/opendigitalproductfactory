import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/self-upgrade/run-store", () => ({
  getLatestSucceededRun: vi.fn(),
}));
vi.mock("@/lib/self-upgrade/completion", () => ({
  getDeployedSha: vi.fn(),
}));

// Mock the durable store so the orchestrator tests stay DB-free; store.ts has
// its own test for the prisma interaction.
const {
  persistSummaryMock,
  getPersistedSummaryMock,
  getPersistedSummaryByIdMock,
  getPersistedSummaryRowMock,
} = vi.hoisted(() => ({
  persistSummaryMock: vi.fn(),
  getPersistedSummaryMock: vi.fn(),
  getPersistedSummaryByIdMock: vi.fn(),
  getPersistedSummaryRowMock: vi.fn(),
}));
vi.mock("./store", () => ({
  persistSummary: (...a: unknown[]) => persistSummaryMock(...a),
  getPersistedSummary: (...a: unknown[]) => getPersistedSummaryMock(...a),
  getPersistedSummaryById: (...a: unknown[]) => getPersistedSummaryByIdMock(...a),
  getPersistedSummaryRow: (...a: unknown[]) => getPersistedSummaryRowMock(...a),
}));

import {
  summarizeUpgradeImpact,
  loadPersistedImpactSummary,
  loadRunImpactDigest,
  getCurrentImpactSummaryId,
} from "./index";
import { _resetCacheForTest } from "./cache";
import { getLatestSucceededRun } from "@/lib/self-upgrade/run-store";
import { getDeployedSha } from "@/lib/self-upgrade/completion";
import type { InstallSignals, RawCommit, UpgradeImpactSummary } from "./types";

beforeEach(() => {
  // Defaults: nothing persisted, writes succeed. Individual tests override.
  persistSummaryMock.mockResolvedValue("UIS-1");
  getPersistedSummaryMock.mockResolvedValue(null);
  getPersistedSummaryByIdMock.mockResolvedValue(null);
  getPersistedSummaryRowMock.mockResolvedValue(null);
});

afterEach(() => {
  _resetCacheForTest();
  vi.clearAllMocks();
});

function storedSummary(
  overrides: Partial<UpgradeImpactSummary> = {},
): UpgradeImpactSummary {
  return {
    currentLineageSha: "a".repeat(40),
    targetSha: "b".repeat(40),
    counts: { breaking: 0, security: 0, feature: 1, fix: 0, performance: 0, dependency: 0, documentation: 0, maintenance: 0, other: 0, total: 1 },
    topItems: [],
    allItems: [],
    phrased: null,
    enrichment: { githubReachable: false, prsEnriched: 0 },
    generatedAt: "2026-01-01T00:00:00.000Z",
    fromCache: false,
    ...overrides,
  };
}

const SIGNALS: InstallSignals = {
  archetypeId: "field-service",
  industry: "field-service",
  customizationPaths: ["apps/web/lib/field-service/"],
  customizationVerticals: ["field-service"],
  openIssueKeywords: ["dispatch"],
  relevantPrLabels: ["field-service"],
};

function rawCommit(subject: string, files: string[] = [], sha = "0".padEnd(40, "0")): RawCommit {
  return {
    sha,
    subject,
    author: "X",
    authorDate: "2026-05-01T00:00:00Z",
    files,
  };
}

describe("summarizeUpgradeImpact — orchestrator", () => {
  it("returns no-lineage when there is no succeeded run on record", async () => {
    const out = await summarizeUpgradeImpact({}, {
      loadCurrentLineageSha: async () => null,
      loadTargetSha: async () => "b".repeat(40),
      loadInstallSignals: async () => SIGNALS,
      loadChangeSet: async () => [],
      enrichPrs: async () => ({ reachable: false, enriched: 0, byPr: new Map() }),
      phraseSummary: async () => null,
    });
    expect(out).toMatchObject({ ok: false, reason: "no-lineage" });
  });

  it("returns no-target when the upstream HEAD cannot be resolved", async () => {
    const out = await summarizeUpgradeImpact({}, {
      loadCurrentLineageSha: async () => "a".repeat(40),
      loadTargetSha: async () => null,
      loadInstallSignals: async () => SIGNALS,
      loadChangeSet: async () => [],
      enrichPrs: async () => ({ reachable: false, enriched: 0, byPr: new Map() }),
      phraseSummary: async () => null,
    });
    expect(out).toMatchObject({ ok: false, reason: "no-target" });
  });

  it("returns lineage-equals-target when there is nothing to summarize", async () => {
    const sha = "a".repeat(40);
    const out = await summarizeUpgradeImpact({}, {
      loadCurrentLineageSha: async () => sha,
      loadTargetSha: async () => sha,
      loadInstallSignals: async () => SIGNALS,
      loadChangeSet: async () => [],
      enrichPrs: async () => ({ reachable: false, enriched: 0, byPr: new Map() }),
      phraseSummary: async () => null,
    });
    expect(out).toMatchObject({ ok: false, reason: "lineage-equals-target" });
  });

  it("builds a scored, ordered summary and threads enrichment + signals through", async () => {
    const out = await summarizeUpgradeImpact({ skipPhrasing: true }, {
      loadCurrentLineageSha: async () => "a".repeat(40),
      loadTargetSha: async () => "b".repeat(40),
      loadInstallSignals: async () => SIGNALS,
      loadChangeSet: async () => [
        rawCommit("feat!: bk", [], "1".repeat(40)),
        rawCommit("fix(field-service): dispatch fix", ["apps/web/lib/field-service/dispatch.ts"], "2".repeat(40)),
        rawCommit("chore: noise", [], "3".repeat(40)),
      ],
      enrichPrs: async () => ({ reachable: true, enriched: 0, byPr: new Map() }),
      phraseSummary: async () => null,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.summary.counts.total).toBe(3);
    expect(out.summary.counts.breaking).toBe(1);
    expect(out.summary.allItems.length).toBe(3);
    // Breaking change ranks first.
    expect(out.summary.allItems[0]!.category).toBe("breaking");
    // Field-service fix is amplified by archetype+path+keyword overlap; it
    // outscores the chore commit and should land in the top items above it.
    const fieldFix = out.summary.allItems.find((i) => i.scope === "field-service")!;
    const chore = out.summary.allItems.find((i) => i.type === "chore")!;
    expect(fieldFix.score).toBeGreaterThan(chore.score);
    expect(fieldFix.touchesCustomizations).toBe(true);
    expect(out.summary.enrichment.githubReachable).toBe(true);
  });

  it("returns git-log-failed when the change-set collector throws", async () => {
    const out = await summarizeUpgradeImpact({}, {
      loadCurrentLineageSha: async () => "a".repeat(40),
      loadTargetSha: async () => "b".repeat(40),
      loadInstallSignals: async () => SIGNALS,
      loadChangeSet: async () => { throw new Error("fatal: bad revision"); },
      enrichPrs: async () => ({ reachable: false, enriched: 0, byPr: new Map() }),
      phraseSummary: async () => null,
    });
    expect(out).toMatchObject({ ok: false, reason: "git-log-failed" });
  });

  it("serves the cached summary on the second call and marks fromCache=true", async () => {
    const change = vi.fn().mockResolvedValue([rawCommit("feat: x", [], "1".repeat(40))]);
    const deps = {
      loadCurrentLineageSha: async () => "a".repeat(40),
      loadTargetSha: async () => "b".repeat(40),
      loadInstallSignals: async () => SIGNALS,
      loadChangeSet: change,
      enrichPrs: async () => ({ reachable: false, enriched: 0, byPr: new Map() }),
      phraseSummary: async () => null,
    };
    const first = await summarizeUpgradeImpact({ skipPhrasing: true }, deps);
    const second = await summarizeUpgradeImpact({ skipPhrasing: true }, deps);
    expect(change).toHaveBeenCalledTimes(1);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.summary.fromCache).toBe(true);
  });

  it("falls back to the deployed git SHA as the baseline when no succeeded run exists", async () => {
    // A never-upgraded but CI-stamped ("labeled") install: no succeeded run, but
    // the image identity IS a git SHA, so we can still summarize since-install.
    vi.mocked(getLatestSucceededRun).mockResolvedValue(null as never);
    vi.mocked(getDeployedSha).mockResolvedValue("c".repeat(40));
    const out = await summarizeUpgradeImpact({ skipPhrasing: true }, {
      // loadCurrentLineageSha intentionally NOT injected → exercises the default
      // fallback chain (succeeded-run marker → deployed git SHA → null).
      loadTargetSha: async () => "b".repeat(40),
      loadInstallSignals: async () => SIGNALS,
      loadChangeSet: async () => [rawCommit("feat: x", [], "1".repeat(40))],
      enrichPrs: async () => ({ reachable: false, enriched: 0, byPr: new Map() }),
      phraseSummary: async () => null,
    });
    expect(out.ok).toBe(true);
  });

  it("stays no-lineage when neither a succeeded run nor a git-SHA image identity exists", async () => {
    // A local/content-hash build: image identity is a 64-char content hash, not a
    // git SHA, so there is genuinely no comparable baseline.
    vi.mocked(getLatestSucceededRun).mockResolvedValue(null as never);
    vi.mocked(getDeployedSha).mockResolvedValue("e".repeat(64));
    const out = await summarizeUpgradeImpact({}, {
      loadTargetSha: async () => "b".repeat(40),
      loadInstallSignals: async () => SIGNALS,
      loadChangeSet: async () => [],
      enrichPrs: async () => ({ reachable: false, enriched: 0, byPr: new Map() }),
      phraseSummary: async () => null,
    });
    expect(out).toMatchObject({ ok: false, reason: "no-lineage" });
  });

  it("refresh=true bypasses the cache and reruns the change-set collector", async () => {
    const change = vi.fn().mockResolvedValue([rawCommit("feat: x", [], "1".repeat(40))]);
    const deps = {
      loadCurrentLineageSha: async () => "a".repeat(40),
      loadTargetSha: async () => "b".repeat(40),
      loadInstallSignals: async () => SIGNALS,
      loadChangeSet: change,
      enrichPrs: async () => ({ reachable: false, enriched: 0, byPr: new Map() }),
      phraseSummary: async () => null,
    };
    await summarizeUpgradeImpact({ skipPhrasing: true }, deps);
    await summarizeUpgradeImpact({ skipPhrasing: true, refresh: true }, deps);
    expect(change).toHaveBeenCalledTimes(2);
  });

  it("persists a freshly computed summary to the durable store", async () => {
    const out = await summarizeUpgradeImpact({ skipPhrasing: true }, {
      loadCurrentLineageSha: async () => "a".repeat(40),
      loadTargetSha: async () => "b".repeat(40),
      loadInstallSignals: async () => SIGNALS,
      loadChangeSet: async () => [rawCommit("feat: x", [], "1".repeat(40))],
      enrichPrs: async () => ({ reachable: false, enriched: 0, byPr: new Map() }),
      phraseSummary: async () => null,
    });
    expect(out.ok).toBe(true);
    expect(persistSummaryMock).toHaveBeenCalledTimes(1);
    expect(persistSummaryMock.mock.calls[0]![0]).toMatchObject({
      currentLineageSha: "a".repeat(40),
      targetSha: "b".repeat(40),
    });
  });

  it("serves a persisted summary on an L1 miss without recomputing", async () => {
    getPersistedSummaryMock.mockResolvedValue(storedSummary());
    const change = vi.fn().mockResolvedValue([]);
    const out = await summarizeUpgradeImpact({ skipPhrasing: true }, {
      loadCurrentLineageSha: async () => "a".repeat(40),
      loadTargetSha: async () => "b".repeat(40),
      loadInstallSignals: async () => SIGNALS,
      loadChangeSet: change,
      enrichPrs: async () => ({ reachable: false, enriched: 0, byPr: new Map() }),
      phraseSummary: async () => null,
    });
    // Durable hit → no git walk, no re-persist, marked fromCache.
    expect(change).not.toHaveBeenCalled();
    expect(persistSummaryMock).not.toHaveBeenCalled();
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.summary.fromCache).toBe(true);
  });

  it("refresh=true bypasses the durable store and recomputes", async () => {
    getPersistedSummaryMock.mockResolvedValue(storedSummary());
    const change = vi.fn().mockResolvedValue([rawCommit("feat: x", [], "1".repeat(40))]);
    await summarizeUpgradeImpact({ skipPhrasing: true, refresh: true }, {
      loadCurrentLineageSha: async () => "a".repeat(40),
      loadTargetSha: async () => "b".repeat(40),
      loadInstallSignals: async () => SIGNALS,
      loadChangeSet: change,
      enrichPrs: async () => ({ reachable: false, enriched: 0, byPr: new Map() }),
      phraseSummary: async () => null,
    });
    expect(getPersistedSummaryMock).not.toHaveBeenCalled();
    expect(change).toHaveBeenCalledTimes(1);
    expect(persistSummaryMock).toHaveBeenCalledTimes(1);
  });

  it("a persistence failure does not break the returned summary", async () => {
    persistSummaryMock.mockRejectedValue(new Error("db down"));
    const out = await summarizeUpgradeImpact({ skipPhrasing: true }, {
      loadCurrentLineageSha: async () => "a".repeat(40),
      loadTargetSha: async () => "b".repeat(40),
      loadInstallSignals: async () => SIGNALS,
      loadChangeSet: async () => [rawCommit("feat: x", [], "1".repeat(40))],
      enrichPrs: async () => ({ reachable: false, enriched: 0, byPr: new Map() }),
      phraseSummary: async () => null,
    });
    expect(out.ok).toBe(true);
  });

  // The categories a commit subject can prove are settled before enrichment;
  // "this bump closes an advisory" is only knowable from the PR. Counts are
  // therefore taken AFTER the refinement pass — if they were taken before, the
  // headline would say "dependency update" while the badge said "security".
  it("counts categories after PR enrichment refines them", async () => {
    const out = await summarizeUpgradeImpact({ skipPhrasing: true }, {
      loadCurrentLineageSha: async () => "a".repeat(40),
      loadTargetSha: async () => "b".repeat(40),
      loadInstallSignals: async () => SIGNALS,
      loadChangeSet: async () => [
        rawCommit("build(deps): bump nanoid (#77)", [], "1".repeat(40)),
        rawCommit("build(deps): bump next (#78)", [], "2".repeat(40)),
        rawCommit("docs: explain the gate (#79)", [], "3".repeat(40)),
      ],
      enrichPrs: async () => ({
        reachable: true,
        enriched: 1,
        byPr: new Map([
          [77, { prNumber: 77, title: "Bump nanoid", labels: ["security"], body: null }],
        ]),
      }),
      phraseSummary: async () => null,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.summary.counts).toMatchObject({
      security: 1,
      dependency: 1,
      documentation: 1,
      other: 0,
      total: 3,
    });
    // …and the promoted item outranks the routine bump in the ordered list.
    expect(out.summary.topItems[0]!.category).toBe("security");
  });
});

describe("loadPersistedImpactSummary", () => {
  it("returns the persisted summary marked fromCache", async () => {
    getPersistedSummaryMock.mockResolvedValue(storedSummary());
    const out = await loadPersistedImpactSummary("b".repeat(40), {
      loadCurrentLineageSha: async () => "a".repeat(40),
    });
    expect(out?.ok).toBe(true);
    if (out?.ok) expect(out.summary.fromCache).toBe(true);
  });

  it("returns null when there is no target", async () => {
    expect(await loadPersistedImpactSummary(null)).toBeNull();
  });

  it("returns null when lineage equals target (nothing to summarize)", async () => {
    const out = await loadPersistedImpactSummary("a".repeat(40), {
      loadCurrentLineageSha: async () => "a".repeat(40),
    });
    expect(out).toBeNull();
    expect(getPersistedSummaryMock).not.toHaveBeenCalled();
  });

  it("returns null when nothing is persisted yet", async () => {
    getPersistedSummaryMock.mockResolvedValue(null);
    const out = await loadPersistedImpactSummary("b".repeat(40), {
      loadCurrentLineageSha: async () => "a".repeat(40),
    });
    expect(out).toBeNull();
  });
});

describe("loadRunImpactDigest", () => {
  it("returns counts + headline from the run's own summary id", async () => {
    getPersistedSummaryByIdMock.mockResolvedValue(
      storedSummary({
        counts: { breaking: 1, security: 0, feature: 5, fix: 3, performance: 0, dependency: 0, documentation: 0, maintenance: 0, other: 0, total: 9 },
        phrased: {
          headline: "Nine changes, one breaking.",
          itemPhrasings: [],
          touchesCustomizationsCallout: "",
        },
      }),
    );
    const out = await loadRunImpactDigest("UIS-42");
    expect(getPersistedSummaryByIdMock).toHaveBeenCalledWith("UIS-42");
    expect(out).toEqual({
      counts: { breaking: 1, security: 0, feature: 5, fix: 3, performance: 0, dependency: 0, documentation: 0, maintenance: 0, other: 0, total: 9 },
      headline: "Nine changes, one breaking.",
    });
  });

  it("returns a null headline when phrasing was skipped", async () => {
    getPersistedSummaryByIdMock.mockResolvedValue(storedSummary({ phrased: null }));
    const out = await loadRunImpactDigest("UIS-1");
    expect(out?.headline).toBeNull();
    expect(out?.counts.total).toBe(1);
  });

  it("returns a null headline when the phrased headline is blank", async () => {
    getPersistedSummaryByIdMock.mockResolvedValue(
      storedSummary({
        phrased: { headline: "   ", itemPhrasings: [], touchesCustomizationsCallout: "" },
      }),
    );
    expect((await loadRunImpactDigest("UIS-1"))?.headline).toBeNull();
  });

  it("returns null for a run that recorded no summary (null id)", async () => {
    expect(await loadRunImpactDigest(null)).toBeNull();
    expect(getPersistedSummaryByIdMock).not.toHaveBeenCalled();
  });

  it("degrades to null when the store read throws", async () => {
    getPersistedSummaryByIdMock.mockRejectedValue(new Error("db down"));
    expect(await loadRunImpactDigest("UIS-1")).toBeNull();
  });
});

describe("getCurrentImpactSummaryId", () => {
  it("returns the persisted row id for the current pair", async () => {
    getPersistedSummaryRowMock.mockResolvedValue({ id: "UIS-9", summary: storedSummary() });
    const id = await getCurrentImpactSummaryId({
      loadCurrentLineageSha: async () => "a".repeat(40),
      loadTargetSha: async () => "b".repeat(40),
    });
    expect(id).toBe("UIS-9");
  });

  it("returns null when no summary is persisted for the current pair", async () => {
    getPersistedSummaryRowMock.mockResolvedValue(null);
    const id = await getCurrentImpactSummaryId({
      loadCurrentLineageSha: async () => "a".repeat(40),
      loadTargetSha: async () => "b".repeat(40),
    });
    expect(id).toBeNull();
  });

  it("returns null (never throws) when resolution fails", async () => {
    const id = await getCurrentImpactSummaryId({
      loadCurrentLineageSha: async () => {
        throw new Error("boom");
      },
      loadTargetSha: async () => "b".repeat(40),
    });
    expect(id).toBeNull();
  });
});
