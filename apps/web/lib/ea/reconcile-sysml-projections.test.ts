import { describe, expect, it, vi } from "vitest";
import { reconcileSysmlProjections } from "./reconcile-sysml-projections";

// Inject a db whose notation lookup returns null → both domain reconciles take the
// "skipped" path. That both come back skipped proves both ran and their results were
// threaded — without deep-mocking either reconcile (and with no module mocks → no
// forks-pool bleed).
describe("reconcileSysmlProjections", () => {
  it("runs every domain reconcile and threads their results", async () => {
    // notation absent → the two notation-backed reconciles skip; reference model
    // absent → the value-stream reconcile skips. All three come back skipped, which
    // proves all three ran and were threaded — no module mocks → no forks-pool bleed.
    const db = {
      eaNotation: { findUnique: vi.fn().mockResolvedValue(null) },
      eaReferenceModel: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const r = await reconcileSysmlProjections({ db: db as never });
    expect(r.mcpAuthority.status).toBe("skipped");
    expect(r.coworkerAuthority.status).toBe("skipped");
    expect(r.valueStreams.status).toBe("skipped");
    expect(db.eaNotation.findUnique).toHaveBeenCalledTimes(2);
    expect(db.eaReferenceModel.findUnique).toHaveBeenCalledTimes(1);
  });
});
