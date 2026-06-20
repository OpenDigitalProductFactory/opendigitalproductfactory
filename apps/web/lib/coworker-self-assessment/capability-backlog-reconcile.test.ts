import { describe, expect, it, vi } from "vitest";

import {
  reconcileCapabilityNeedBacklog,
  type CapabilityReconcileStore,
} from "./capability-backlog-reconcile";

function makeStore(orphans: Array<Record<string, unknown>>): {
  store: CapabilityReconcileStore;
  findManyArgs: unknown[];
} {
  const findManyArgs: unknown[] = [];
  const store: CapabilityReconcileStore = {
    coworkerCapabilityNeed: {
      findMany: async (args) => {
        findManyArgs.push(args);
        return orphans as never;
      },
    },
  };
  return { store, findManyArgs };
}

const ORPHAN = {
  needId: "CWN-7E22A20D",
  agentId: "marketing-specialist",
  kind: "tool",
  severity: "important",
  need: "Publish proof assets.",
  blocks: "Cannot create campaign assets.",
};

describe("reconcileCapabilityNeedBacklog", () => {
  it("files each orphan through the front door and links it back", async () => {
    const { store } = makeStore([ORPHAN]);
    const file = vi.fn(async (_n: typeof ORPHAN) => ({ itemId: "BI-CAP-NEW001" }));
    const link = vi.fn(async () => ({}));

    const result = await reconcileCapabilityNeedBacklog({ store, file, link });

    expect(result).toEqual({ filed: 1, itemIds: ["BI-CAP-NEW001"] });
    expect(file).toHaveBeenCalledWith(ORPHAN);
    expect(link).toHaveBeenCalledWith("CWN-7E22A20D", "BI-CAP-NEW001");
  });

  it("queries only orphaned, non-dismissed needs (the filter contract)", async () => {
    const { store, findManyArgs } = makeStore([]);
    await reconcileCapabilityNeedBacklog({
      store,
      file: async () => ({ itemId: "x" }),
      link: async () => ({}),
    });
    expect(findManyArgs[0]).toMatchObject({
      where: {
        linkedBacklogItemId: null,
        status: { notIn: ["discarded", "duplicate", "resolved"] },
      },
    });
  });

  it("is a zero-write no-op when there are no orphans (idempotent after convergence)", async () => {
    const { store } = makeStore([]);
    const file = vi.fn(async (_n: typeof ORPHAN) => ({ itemId: "x" }));
    const link = vi.fn(async () => ({}));

    const result = await reconcileCapabilityNeedBacklog({ store, file, link });

    expect(result).toEqual({ filed: 0, itemIds: [] });
    expect(file).not.toHaveBeenCalled();
    expect(link).not.toHaveBeenCalled();
  });

  it("does not link when the front door fails to file (non-fatal)", async () => {
    const { store } = makeStore([ORPHAN]);
    const file = vi.fn(async (_n: typeof ORPHAN) => null);
    const link = vi.fn(async () => ({}));

    const result = await reconcileCapabilityNeedBacklog({ store, file, link });

    expect(result).toEqual({ filed: 0, itemIds: [] });
    expect(link).not.toHaveBeenCalled();
  });

  it("files multiple orphans in order", async () => {
    const second = { ...ORPHAN, needId: "CWN-4876FEAA", kind: "grant" };
    const { store } = makeStore([ORPHAN, second]);
    let n = 0;
    const file = vi.fn(async (_x: typeof ORPHAN) => ({ itemId: `BI-CAP-${++n}` }));
    const linked: Array<[string, string]> = [];
    const link = vi.fn(async (needId: string, itemId: string) => {
      linked.push([needId, itemId]);
      return {};
    });

    const result = await reconcileCapabilityNeedBacklog({ store, file, link });

    expect(result.itemIds).toEqual(["BI-CAP-1", "BI-CAP-2"]);
    expect(linked).toEqual([
      ["CWN-7E22A20D", "BI-CAP-1"],
      ["CWN-4876FEAA", "BI-CAP-2"],
    ]);
  });
});
