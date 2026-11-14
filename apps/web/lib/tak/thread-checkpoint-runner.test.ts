import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.hoisted(() => vi.fn());
vi.mock("@dpf/db", () => ({ prisma: { $queryRaw: queryRaw } }));

import { FOLD_MESSAGE_ROLES, findThreadsWithFoldBacklog } from "./thread-checkpoint-runner";

// BI-546A9E36: the nightly sweep admits threads by how far behind their own
// watermark they are. The query is the admission rule, so its shape is pinned
// here: it must count the same roles the fold reads, compare against each
// thread's own watermark, leave cancelled threads out, and order most-behind
// first, or the sweep goes back to missing the threads that need it.
describe("findThreadsWithFoldBacklog", () => {
  beforeEach(() => {
    queryRaw.mockReset();
  });

  it("asks for threads at least minUnfolded behind their own watermark, most-behind first", async () => {
    queryRaw.mockResolvedValue([]);

    await findThreadsWithFoldBacklog({ minUnfolded: 18, take: 200 });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join("?").replace(/\s+/g, " ");
    expect(values).toEqual([[...FOLD_MESSAGE_ROLES], 18, 200]);
    expect(sql).toContain('m."threadId" = t."id"');
    expect(sql).toContain('m."role" = ANY(?::text[])');
    expect(sql).toContain('t."compactionWatermarkAt" IS NULL OR m."createdAt" > t."compactionWatermarkAt"');
    expect(sql).toContain('t."cancelledAt" IS NULL');
    expect(sql).toContain('b."unfolded" >= ?');
    expect(sql).toContain('ORDER BY b."unfolded" DESC, t."id" ASC');
    expect(sql).toContain("LIMIT ?");
  });

  it("returns plain numbers whatever the driver hands back for the count", async () => {
    queryRaw.mockResolvedValue([
      { id: "t1", contextKey: "coworker", unfolded: BigInt(145) },
      { id: "t2", contextKey: "build:FB-1", unfolded: 30 },
    ]);

    const rows = await findThreadsWithFoldBacklog({ minUnfolded: 18, take: 200 });

    expect(rows).toEqual([
      { id: "t1", contextKey: "coworker", unfolded: 145 },
      { id: "t2", contextKey: "build:FB-1", unfolded: 30 },
    ]);
  });

  it("counts exactly the roles a fold reads", () => {
    expect([...FOLD_MESSAGE_ROLES]).toEqual(["user", "assistant"]);
  });
});
