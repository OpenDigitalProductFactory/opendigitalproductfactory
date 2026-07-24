// BI-5BB1A364: retrieval-side consumer-context filter for listPrinciplesByTier.
//
// Kept in its own file (rather than folded into wiki-store.test.ts) so this
// addition doesn't grow the already-baselined wiki-store.test.ts past its
// module-size ratchet ceiling (BI-OPT-RATCHETS) — the ratchet only allows a
// baselined file to shrink.
//
// Mirrors the existing ring-scope filter tests in wiki-store.test.ts on the
// same contract shape: empty/omitted caller declaration is a no-op, a
// declared context builds an AND/OR clause (empty-passes OR intersection).

import { describe, expect, it, vi } from "vitest";
import { listPrinciplesByTier } from "./wiki-store";

function makeListMocks() {
  const findMany = vi.fn();
  const db = { wikiPage: { findMany } };
  return { db, findMany };
}

describe("listPrinciplesByTier — consumer-context filter (BI-5BB1A364)", () => {
  it("skips the filter when the caller declared no consumerContexts", async () => {
    const { db, findMany } = makeListMocks();
    findMany.mockResolvedValueOnce([]);

    await listPrinciplesByTier(db, { tier: "commandment" });

    const arg = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where.AND).toBeUndefined();
  });

  it("skips the filter when the caller declared an empty array", async () => {
    const { db, findMany } = makeListMocks();
    findMany.mockResolvedValueOnce([]);

    await listPrinciplesByTier(db, { tier: "commandment", consumerContexts: [] });

    const arg = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where.AND).toBeUndefined();
  });

  it("builds an AND/OR clause for a declared consumer context (empty OR intersection)", async () => {
    const { db, findMany } = makeListMocks();
    findMany.mockResolvedValueOnce([]);

    await listPrinciplesByTier(db, {
      tier: "commandment",
      consumerContexts: ["ui"],
    });

    const arg = findMany.mock.calls[0][0] as {
      where: { AND: Array<{ OR: Array<Record<string, unknown>> }> };
    };
    expect(arg.where.AND).toEqual([
      {
        OR: [
          { principleConsumerContexts: { isEmpty: true } },
          { principleConsumerContexts: { hasSome: ["ui"] } },
        ],
      },
    ]);
  });

  it("composes ring-scope AND consumer-context filters as independent AND clauses", async () => {
    const { db, findMany } = makeListMocks();
    findMany.mockResolvedValueOnce([]);

    await listPrinciplesByTier(db, {
      tier: "commandment",
      ringScope: ["ring-2-workflow"],
      consumerContexts: ["ui"],
    });

    const arg = findMany.mock.calls[0][0] as {
      where: { AND: Array<{ OR: Array<Record<string, unknown>> }> };
    };
    expect(arg.where.AND).toHaveLength(2);
    expect(arg.where.AND[0].OR).toEqual([
      { principleRingScope: { isEmpty: true } },
      { principleRingScope: { has: "universal-ring" } },
      { principleRingScope: { hasSome: ["ring-2-workflow"] } },
    ]);
    expect(arg.where.AND[1].OR).toEqual([
      { principleConsumerContexts: { isEmpty: true } },
      { principleConsumerContexts: { hasSome: ["ui"] } },
    ]);
  });

  it("threads multi-context caller scope through to hasSome verbatim", async () => {
    const { db, findMany } = makeListMocks();
    findMany.mockResolvedValueOnce([]);

    await listPrinciplesByTier(db, {
      tier: "commandment",
      consumerContexts: ["ui", "storefront"],
    });

    const arg = findMany.mock.calls[0][0] as {
      where: { AND: Array<{ OR: Array<Record<string, unknown>> }> };
    };
    const hasSomeClause = arg.where.AND[0].OR[1] as {
      principleConsumerContexts: { hasSome: string[] };
    };
    expect(hasSomeClause.principleConsumerContexts.hasSome).toEqual([
      "ui",
      "storefront",
    ]);
  });
});
