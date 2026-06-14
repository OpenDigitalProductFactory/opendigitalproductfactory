import { describe, expect, it, vi } from "vitest";
import { reconcileSysmlProjections } from "./reconcile-sysml-projections";

// Inject a db whose notation lookup returns null → every notation-backed reconcile
// takes the "skipped" path. That all come back skipped proves each ran and its result
// was threaded — without deep-mocking any reconcile (and with no module mocks → no
// forks-pool bleed).
describe("reconcileSysmlProjections", () => {
  it("runs every domain reconcile and threads their results", async () => {
    // notation absent → the three notation-backed reconciles (mcp, coworker, routes)
    // skip; reference model absent → the value-stream reconcile skips. The routes
    // reconcile reaches its seeder because the committed manifest is non-empty. All
    // four come back skipped, which proves all four ran and were threaded — no module
    // mocks → no forks-pool bleed.
    const db = {
      eaNotation: { findUnique: vi.fn().mockResolvedValue(null) },
      eaReferenceModel: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const r = await reconcileSysmlProjections({ db: db as never });
    expect(r.mcpAuthority.status).toBe("skipped");
    expect(r.coworkerAuthority.status).toBe("skipped");
    expect(r.valueStreams.status).toBe("skipped");
    expect(r.routes.status).toBe("skipped");
    expect(db.eaNotation.findUnique).toHaveBeenCalledTimes(3);
    expect(db.eaReferenceModel.findUnique).toHaveBeenCalledTimes(1);
  });
});
