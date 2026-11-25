import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import {
  PEER_OWNED_BODY_MARKER,
  asksFromRows,
  backlogFromRows,
  buildsFromRows,
  loadClosureCounts,
  proposalsFromRows,
  selfFiledFromRows,
  signalsFromRows,
} from "./load-closure-counts";

// BI-97C56E20: the SQL returns raw counts per state; these tests pin the
// state-to-bucket classification and the query shapes the review asked for.

describe("state classification", () => {
  it("counts only resolved and dismissed signals as closed; unknown states stay open", () => {
    expect(signalsFromRows([{ key: "open", n: 3n }, { key: "resolved", n: 2n }, { key: "dismissed", n: 1n }, { key: "weird", n: 4n }]))
      .toEqual({ total: 10, closed: 3, open: 7 });
  });

  it("separates implemented/verified from rejected proposals", () => {
    expect(proposalsFromRows([
      { key: "proposed", n: 5 }, { key: "prioritized", n: 2 }, { key: "implemented", n: 3 },
      { key: "verified", n: 1 }, { key: "rejected", n: 4 },
    ])).toEqual({ total: 15, open: 7, implemented: 4, rejected: 4 });
  });

  it("reads builds, backlog and self-filed totals by state", () => {
    expect(buildsFromRows([{ key: "complete", n: 1 }, { key: "abandoned", n: 3 }, { key: "review", n: 2 }], 5))
      .toEqual({ total: 6, complete: 1, abandoned: 3, failed: 0, stranded: 5 });
    expect(backlogFromRows([{ key: "done", n: 2 }, { key: "retired", n: 1 }, { key: "open", n: 4 }])).toEqual({ total: 7, done: 2, retired: 1 });
    expect(selfFiledFromRows([{ key: "done", n: 2 }, { key: "open", n: 1 }])).toEqual({ total: 3, done: 2 });
  });

  it("classifies each owner-attention ask once, owner first", () => {
    expect(asksFromRows([
      { for_owner: true, routed: true },
      { for_owner: true, routed: false },
      { for_owner: false, routed: true },
      { for_owner: null, routed: null },
    ])).toEqual({ forOwner: 2, routedToAgent: 1 });
  });
});

describe("loadClosureCounts query shapes", () => {
  it("reads through indexed columns, matches the peer marker literally, and never counts a flow by updatedAt", async () => {
    const sqls: string[] = [];
    const values: unknown[][] = [];
    const db = {
      $queryRaw: vi.fn(async (q: TemplateStringsArray, ...v: unknown[]) => {
        sqls.push(q.join("?"));
        values.push(v);
        return [];
      }),
    };
    const result = await loadClosureCounts({ since: new Date("2026-11-18T00:00:00Z"), until: new Date("2026-11-25T00:00:00Z") }, db as never);
    const all = sqls.join("\n");
    expect(all).not.toMatch(/\bLIKE\b/i);
    expect(all).toMatch(/position\(\? IN coalesce\(body, ''\)\)/);
    expect(values.flat()).toContain(PEER_OWNED_BODY_MARKER);
    expect(all).toMatch(/GROUP BY coalesce\("dedupeKey", id\)/);
    // updatedAt appears only in the stranded stock and the acceptance age, never in a window filter.
    for (const sql of sqls.filter((s) => /"createdAt" >= \?/.test(s))) expect(sql).not.toMatch(/"updatedAt"/);
    expect(result.snapshot.signals).toEqual({ total: 0, closed: 0, open: 0 });
    expect(result.window.asks).toEqual({ forOwner: 0, routedToAgent: 0 });
  });
});
