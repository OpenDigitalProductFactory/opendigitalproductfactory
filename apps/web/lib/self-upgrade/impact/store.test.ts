import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();
const upsertMock = vi.fn();
const queryRawMock = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: {
    upgradeImpactSummary: {
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
      upsert: (...a: unknown[]) => upsertMock(...a),
    },
    $queryRaw: (...a: unknown[]) => queryRawMock(...a),
  },
  Prisma: {},
}));

import {
  getPersistedSummary,
  getPersistedSummaryDigests,
  getPersistedSummaryRow,
  persistSummary,
} from "./store";
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
  queryRawMock.mockReset();
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

  // The Run History table needs two fields per row. Reading the whole `summary`
  // JSON to get them would haul every item of every summary on the page, so the
  // projection happens in Postgres.
  it("getPersistedSummaryDigests projects counts + headline and keys by id", async () => {
    queryRawMock.mockResolvedValue([
      { id: "UIS-1", counts: { breaking: 1, total: 4 }, headline: " Four changes. " },
      { id: "UIS-2", counts: { breaking: 0, total: 2 }, headline: null },
    ]);
    const out = await getPersistedSummaryDigests(["UIS-1", "UIS-2"]);
    expect(out.get("UIS-1")).toEqual({
      counts: { breaking: 1, total: 4 },
      headline: "Four changes.",
    });
    expect(out.get("UIS-2")?.headline).toBeNull();
  });

  it("getPersistedSummaryDigests de-duplicates ids and skips the query when empty", async () => {
    expect((await getPersistedSummaryDigests([])).size).toBe(0);
    expect(queryRawMock).not.toHaveBeenCalled();

    queryRawMock.mockResolvedValue([]);
    await getPersistedSummaryDigests(["UIS-1", "UIS-1", ""]);
    // Tagged-template call: values are passed as trailing args, never inlined.
    expect(queryRawMock.mock.calls[0]!.slice(1)).toEqual([["UIS-1"]]);
  });

  it("getPersistedSummaryDigests drops a row whose counts are unreadable", async () => {
    queryRawMock.mockResolvedValue([{ id: "UIS-3", counts: null, headline: "x" }]);
    expect((await getPersistedSummaryDigests(["UIS-3"])).size).toBe(0);
  });
});
