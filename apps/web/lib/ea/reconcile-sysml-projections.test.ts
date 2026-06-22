import { describe, expect, it, vi } from "vitest";
import { reconcileSysmlProjections } from "./reconcile-sysml-projections";

// Inject a db whose notation lookup returns null → every notation-backed reconcile
// takes the "skipped" path; reference model absent → value-streams skips; code graph
// unavailable → code-structure skips. That all come back skipped proves each ran and
// its result was threaded — without deep-mocking any reconcile (no module mocks → no
// forks-pool bleed).
describe("reconcileSysmlProjections", () => {
  it("runs every domain reconcile and threads their results", async () => {
    const empty = { findMany: vi.fn().mockResolvedValue([]) };
    const db = {
      eaNotation: { findUnique: vi.fn().mockResolvedValue(null) },
      eaReferenceModel: { findUnique: vi.fn().mockResolvedValue(null) },
      skillDefinition: { findMany: vi.fn().mockResolvedValue([]) },
      // Living-graph bridges skip on empty source tables (before notation lookup).
      runtimeTarget: empty,
      edgeNode: empty,
      inventoryEntity: empty,
      integrationCredential: empty,
    };
    const getFreshness = vi.fn().mockResolvedValue({ available: false, indexStatus: "missing", warnings: [], summary: "" });
    const r = await reconcileSysmlProjections({ db: db as never, codeGraph: { getFreshness: getFreshness as never } });
    expect(r.mcpAuthority.status).toBe("skipped");
    expect(r.coworkerAuthority.status).toBe("skipped");
    expect(r.valueStreams.status).toBe("skipped");
    expect(r.routes.status).toBe("skipped");
    expect(r.navigation.status).toBe("skipped"); // notation null -> applySysmlModel skips
    expect(r.codeStructure.status).toBe("skipped");
    expect(r.processModels.status).toBe("skipped");
    expect(r.skillToolchain.status).toBe("skipped"); // no SkillDefinition rows → skipped before notation
    expect(r.operationalGraph.status).toBe("skipped"); // no RuntimeTarget rows
    expect(r.networkTopology.status).toBe("skipped"); // no EdgeNode/InventoryEntity rows
    expect(r.integrations.status).toBe("skipped"); // no IntegrationCredential rows
    expect(r.scheduledJobs.status).toBe("skipped"); // notation null -> applySysmlModel skips
    // mcp + coworker + routes + navigation + process + scheduling are notation-backed
    // (all sysml2 except process=bpmn20); value-streams checks the reference model
    // first; code-structure checks graph freshness first.
    expect(db.eaNotation.findUnique).toHaveBeenCalledTimes(6);
    expect(db.eaReferenceModel.findUnique).toHaveBeenCalledTimes(1);
    expect(getFreshness).toHaveBeenCalledTimes(1);
  });
});
