import { describe, expect, it, vi } from "vitest";
import { reconcileCodeStructure } from "./reconcile-code-structure";

const freshOk = { available: true, indexStatus: "ready", warnings: [], summary: "" };

describe("reconcileCodeStructure", () => {
  it("skips when the code graph has not been built", async () => {
    const getFreshness = vi.fn().mockResolvedValue({ ...freshOk, available: false });
    const runCypherFn = vi.fn();
    const r = await reconcileCodeStructure({ getFreshness: getFreshness as never, runCypherFn: runCypherFn as never });
    expect(r.status).toBe("skipped");
    expect(runCypherFn).not.toHaveBeenCalled();
  });

  it("queries the code graph and threads import edges to the seeder", async () => {
    // notation absent → applySysmlModel skips, but the freshness + cypher path is exercised.
    const getFreshness = vi.fn().mockResolvedValue(freshOk);
    const runCypherFn = vi.fn().mockResolvedValue([
      { fromPath: "apps/web/lib/routing/p.ts", toPath: "apps/web/lib/ea/q.ts" },
      { fromPath: "apps/web/lib/ea/q.ts", toPath: null },
    ]);
    const db = { eaNotation: { findUnique: vi.fn().mockResolvedValue(null) } };
    const r = await reconcileCodeStructure({
      getFreshness: getFreshness as never,
      runCypherFn: runCypherFn as never,
      db: db as never,
    });
    expect(r.status).toBe("skipped");
    expect(runCypherFn).toHaveBeenCalledTimes(1);
    expect(runCypherFn).toHaveBeenCalledWith(expect.stringContaining("IMPORTS"), { graphKey: "source-code" });
  });
});
