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
    expect(r.it4itCoverage.status).toBe("skipped"); // IT4IT reference model absent -> skips
    expect(r.securityPosture.status).toBe("skipped"); // notation null -> applySysmlModel skips
    expect(r.workPatternArchitecture.status).toBe("skipped"); // notation null -> applySysmlModel skips
    expect(r.federatedDemandArchitecture.status).toBe("skipped");
    // mcp + coworker + routes + navigation + process + scheduling + security +
    // work-pattern architecture are notation-backed (all sysml2 except process=bpmn20); value-streams +
    // it4it-coverage check the reference model first; code-structure checks graph
    // freshness first.
    expect(db.eaNotation.findUnique).toHaveBeenCalledTimes(9);
    // value-streams and it4it-coverage both look up the IT4IT reference model.
    expect(db.eaReferenceModel.findUnique).toHaveBeenCalledTimes(2);
    expect(getFreshness).toHaveBeenCalledTimes(1);
  });

  it("isolates a throwing domain so the rest of the engine still runs", async () => {
    const empty = { findMany: vi.fn().mockResolvedValue([]) };
    // eaReferenceModel.findUnique throws — this is the dependency value-streams AND
    // it4it-coverage hit first. Before domain isolation, that throw aborted the whole
    // orchestrator and blocked every later domain (the live nightly failure mode).
    const db = {
      eaNotation: { findUnique: vi.fn().mockResolvedValue(null) },
      eaReferenceModel: { findUnique: vi.fn().mockRejectedValue(new Error("missing EaRelationshipType")) },
      skillDefinition: { findMany: vi.fn().mockResolvedValue([]) },
      runtimeTarget: empty,
      edgeNode: empty,
      inventoryEntity: empty,
      integrationCredential: empty,
    };
    const getFreshness = vi.fn().mockResolvedValue({ available: false, indexStatus: "missing", warnings: [], summary: "" });

    // Must resolve (not reject) despite the throwing domain.
    const r = await reconcileSysmlProjections({ db: db as never, codeGraph: { getFreshness: getFreshness as never } });

    // The throwing domains fall back to skipped instead of aborting the run...
    expect(r.valueStreams.status).toBe("skipped");
    expect(r.it4itCoverage.status).toBe("skipped");
    // ...and unrelated domains still ran.
    expect(r.routes.status).toBe("skipped");
    expect(r.mcpAuthority.status).toBe("skipped");
    expect(r.scheduledJobs.status).toBe("skipped");
    expect(r.workPatternArchitecture.status).toBe("skipped");
  });
});
