import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/self-upgrade/run-store", () => ({
  getLatestSucceededRun: vi.fn(),
}));
vi.mock("@/lib/self-upgrade/completion", () => ({
  getDeployedSha: vi.fn(),
}));

import { summarizeUpgradeImpact } from "./index";
import { _resetCacheForTest } from "./cache";
import { getLatestSucceededRun } from "@/lib/self-upgrade/run-store";
import { getDeployedSha } from "@/lib/self-upgrade/completion";
import type { InstallSignals, RawCommit } from "./types";

afterEach(() => {
  _resetCacheForTest();
  vi.clearAllMocks();
});

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
});
