import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();
const upsertMock = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: {
    upgradeImpactSummary: {
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
      upsert: (...a: unknown[]) => upsertMock(...a),
    },
  },
  Prisma: {},
}));

import { getPersistedSummary, getPersistedSummaryRow, persistSummary } from "./store";
import type { UpgradeImpactSummary } from "./types";

const LINEAGE = "a".repeat(40);
const TARGET = "b".repeat(40);

function summary(overrides: Partial<UpgradeImpactSummary> = {}): UpgradeImpactSummary {
  return {
    currentLineageSha: LINEAGE,
    targetSha: TARGET,
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

beforeEach(() => {
  findUniqueMock.mockReset();
  upsertMock.mockReset();
});

describe("impact store", () => {
  it("getPersistedSummary reads by the (lineage, target) compound key", async () => {
    findUniqueMock.mockResolvedValue({ summary: summary() });
    const out = await getPersistedSummary(LINEAGE, TARGET);
    expect(out).toMatchObject({ currentLineageSha: LINEAGE, targetSha: TARGET });
    expect(findUniqueMock.mock.calls[0]![0].where).toEqual({
      currentLineageSha_targetSha: { currentLineageSha: LINEAGE, targetSha: TARGET },
    });
  });

  it("getPersistedSummary returns null when no row exists", async () => {
    findUniqueMock.mockResolvedValue(null);
    expect(await getPersistedSummary(LINEAGE, TARGET)).toBeNull();
  });

  it("getPersistedSummaryRow returns the row id alongside the summary", async () => {
    findUniqueMock.mockResolvedValue({ id: "UIS-7", summary: summary() });
    const out = await getPersistedSummaryRow(LINEAGE, TARGET);
    expect(out?.id).toBe("UIS-7");
    expect(out?.summary.targetSha).toBe(TARGET);
  });

  it("getPersistedSummaryRow returns null when no row exists", async () => {
    findUniqueMock.mockResolvedValue(null);
    expect(await getPersistedSummaryRow(LINEAGE, TARGET)).toBeNull();
  });

  it("persistSummary upserts by the compound key and returns the row id", async () => {
    upsertMock.mockResolvedValue({ id: "UIS-42" });
    const id = await persistSummary(summary());
    expect(id).toBe("UIS-42");

    const arg = upsertMock.mock.calls[0]![0];
    expect(arg.where).toEqual({
      currentLineageSha_targetSha: { currentLineageSha: LINEAGE, targetSha: TARGET },
    });
    // create carries the key + the summary blob + the original generatedAt.
    expect(arg.create.currentLineageSha).toBe(LINEAGE);
    expect(arg.create.targetSha).toBe(TARGET);
    expect(arg.create.summary).toMatchObject({ targetSha: TARGET });
    expect(arg.create.generatedAt).toBeInstanceOf(Date);
    // update overwrites the blob in place (idempotent recompute).
    expect(arg.update.summary).toMatchObject({ targetSha: TARGET });
  });
});
