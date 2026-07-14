import { describe, expect, it, vi } from "vitest";
import { reconcileCodeStructure } from "./reconcile-code-structure";

const freshOk = { available: true, indexStatus: "ready", warnings: [], summary: "" };

describe("reconcileCodeStructure", () => {
  it("skips when the code graph has not been built", async () => {
    const getFreshness = vi.fn().mockResolvedValue({ ...freshOk, available: false });
    const queryRawUnsafe = vi.fn();
    const db = { $queryRawUnsafe: queryRawUnsafe };
    const r = await reconcileCodeStructure({ getFreshness: getFreshness as never, db: db as never });
    expect(r.status).toBe("skipped");
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("queries the graph mirror and threads import edges to the seeder", async () => {
    // notation absent → applySysmlModel skips, but the freshness + query path is exercised.
    const getFreshness = vi.fn().mockResolvedValue(freshOk);
    const queryRawUnsafe = vi.fn().mockResolvedValue([
      { fromPath: "apps/web/lib/routing/p.ts", toPath: "apps/web/lib/ea/q.ts" },
      { fromPath: "apps/web/lib/ea/q.ts", toPath: null },
    ]);
    const db = {
      $queryRawUnsafe: queryRawUnsafe,
      eaNotation: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const r = await reconcileCodeStructure({
      getFreshness: getFreshness as never,
      db: db as never,
    });
    expect(r.status).toBe("skipped");
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("IMPORTS"), "source-code");
  });
});
