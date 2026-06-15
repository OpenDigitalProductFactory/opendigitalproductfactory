import { describe, expect, it, vi } from "vitest";
import { reconcileSysmlProjections } from "./reconcile-sysml-projections";

// Inject a db whose notation lookup returns null → every notation-backed reconcile
// takes the "skipped" path; reference model absent → value-streams skips; code graph
// unavailable → code-structure skips. That all come back skipped proves each ran and
// its result was threaded — without deep-mocking any reconcile (no module mocks → no
// forks-pool bleed).
describe("reconcileSysmlProjections", () => {
  it("runs every domain reconcile and threads their results", async () => {
    const db = {
      eaNotation: { findUnique: vi.fn().mockResolvedValue(null) },
      eaReferenceModel: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const getFreshness = vi.fn().mockResolvedValue({ available: false, indexStatus: "missing", warnings: [], summary: "" });
    const r = await reconcileSysmlProjections({ db: db as never, codeGraph: { getFreshness: getFreshness as never } });
    expect(r.mcpAuthority.status).toBe("skipped");
    expect(r.coworkerAuthority.status).toBe("skipped");
    expect(r.valueStreams.status).toBe("skipped");
    expect(r.routes.status).toBe("skipped");
    expect(r.codeStructure.status).toBe("skipped");
    expect(r.processModels.status).toBe("skipped");
    // mcp + coworker + routes (sysml2) + process (bpmn20) are notation-backed;
    // value-streams checks the reference model first; code-structure checks graph
    // freshness first.
    expect(db.eaNotation.findUnique).toHaveBeenCalledTimes(4);
    expect(db.eaReferenceModel.findUnique).toHaveBeenCalledTimes(1);
    expect(getFreshness).toHaveBeenCalledTimes(1);
  });
});
