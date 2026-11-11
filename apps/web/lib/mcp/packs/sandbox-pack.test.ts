import { beforeEach, describe, expect, it, vi } from "vitest";

// resolveActiveBuildId (from build-tool-helpers) reads prisma.featureBuild.
// Mock it so the build-scoped handlers resolve "no active build" hermetically.
const db = vi.hoisted(() => ({
  featureBuildFindFirst: vi.fn(),
  featureBuildFindUnique: vi.fn(),
  featureBuildUpdate: vi.fn(),
  buildActivityCreate: vi.fn(),
}));
const nativeVerification = vi.hoisted(() => ({ verify: vi.fn(), legacy: vi.fn(), save: vi.fn(), repair: vi.fn() }));
vi.mock("@/lib/build/deterministic-build-verification", () => ({ runDeterministicBuildVerificationFor: nativeVerification.verify }));
vi.mock("@/lib/coding-agent", () => ({ runSandboxTests: nativeVerification.legacy, diagnoseTestFailures: () => ({ failingTests: [], summary: "fixture" }) }));
vi.mock("@/lib/build/sandbox/build-branch", () => ({ isSandboxAvailable: async () => true, resolveBuildWorkdir: (id: string) => `/workspace/.builds/${id}` }));
vi.mock("@/lib/build/sandbox-state", () => ({ getSandboxStateForBuild: async () => ({ sourceDiffstat: [{ path: "stale-projection.ts" }] }) }));
vi.mock("@/lib/build/build-artifact-provenance", () => ({ saveBuildArtifactRevision: nativeVerification.save }));
vi.mock("@/lib/build/build-orchestrator", () => ({ runGauntletRepairTask: nativeVerification.repair }));
vi.mock("@/lib/sandbox", () => ({ execInSandbox: vi.fn() }));
vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: {
      findFirst: (...a: unknown[]) => db.featureBuildFindFirst(...a),
      findUnique: (...a: unknown[]) => db.featureBuildFindUnique(...a),
      update: (...a: unknown[]) => db.featureBuildUpdate(...a),
    },
    buildActivity: { create: (...a: unknown[]) => db.buildActivityCreate(...a) },
  },
}));

// check_sandbox shells out via lazy-node; mock so `docker inspect` throws and the
// handler takes its not_found branch without touching a real docker daemon.
vi.mock("@/lib/shared/lazy-node", () => ({
  lazyChildProcess: () => ({ exec: () => undefined }),
  lazyUtil: () => ({ promisify: () => async () => { throw new Error("docker unavailable"); } }),
  lazyFsPromises: () => ({}),
  lazyPath: () => ({}),
}));

import { sandboxPack } from "./sandbox-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { verificationFromSandboxResult } from "@/lib/build/verification-output";

// iterate_sandbox is a removed-tool guard: it carries a handler but no
// advertised definition (there is nothing to expose on tools/list).
const EXPECTED_DEFINITIONS = [
  "get_build_sandbox_state",
  "diagnose_sandbox",
  "recover_sandbox",
  "check_sandbox",
  "start_sandbox",
  "run_sandbox_tests",
  "read_sandbox_file",
  "write_sandbox_file",
  "edit_sandbox_file",
  "search_sandbox",
  "list_sandbox_files",
  "run_sandbox_command",
];
const EXPECTED_HANDLERS = [...EXPECTED_DEFINITIONS, "iterate_sandbox"];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sandbox pack — registration", () => {
  it("exposes the twelve advertised sandbox tools as definitions", () => {
    expect(sandboxPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_DEFINITIONS].sort());
  });

  it("carries a handler for every advertised tool plus the iterate_sandbox removed-guard", () => {
    expect(Object.keys(sandboxPack.handlers).sort()).toEqual([...EXPECTED_HANDLERS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of sandboxPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants: sandbox tools need sandbox_execute; the read-state tool needs work_capsule_read", () => {
    expect(sandboxPack.grants.get_build_sandbox_state).toEqual(["work_capsule_read"]);
    expect(sandboxPack.grants.diagnose_sandbox).toEqual(["sandbox_execute", "work_capsule_read"]);
    expect(sandboxPack.grants.recover_sandbox).toEqual(["sandbox_execute"]);
    expect(sandboxPack.grants.check_sandbox).toEqual(["sandbox_execute"]);
    expect(sandboxPack.grants.start_sandbox).toEqual(["sandbox_execute"]);
    expect(sandboxPack.grants.run_sandbox_tests).toEqual(["sandbox_execute"]);
    expect(sandboxPack.grants.read_sandbox_file).toEqual(["sandbox_execute"]);
    expect(sandboxPack.grants.write_sandbox_file).toEqual(["sandbox_execute"]);
    expect(sandboxPack.grants.edit_sandbox_file).toEqual(["sandbox_execute"]);
    expect(sandboxPack.grants.search_sandbox).toEqual(["sandbox_execute"]);
    expect(sandboxPack.grants.list_sandbox_files).toEqual(["sandbox_execute"]);
    expect(sandboxPack.grants.run_sandbox_command).toEqual(["sandbox_execute"]);
    expect(sandboxPack.grants.iterate_sandbox).toEqual(["sandbox_execute"]);

    expect(isToolAllowedByGrants("get_build_sandbox_state", ["work_capsule_read"])).toBe(true);
    expect(isToolAllowedByGrants("diagnose_sandbox", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("run_sandbox_command", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("run_sandbox_tests", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("start_sandbox", ["sandbox_execute"])).toBe(true);
  });
});

describe("sandbox pack — handler behavior (delegation preserved)", () => {
  it("iterate_sandbox reports the removed-tool guidance", async () => {
    const res = await sandboxPack.handlers.iterate_sandbox({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Tool removed.");
    expect(res.message).toContain("have been removed");
  });

  it("build-scoped handlers short-circuit when there is no active build", async () => {
    db.featureBuildFindFirst.mockResolvedValue(null);
    db.featureBuildFindUnique.mockResolvedValue(null);

    const diag = await sandboxPack.handlers.diagnose_sandbox({}, "u1");
    expect(diag.success).toBe(false);
    expect(diag.error).toBe("No active build.");

    const state = await sandboxPack.handlers.get_build_sandbox_state({}, "u1");
    expect(state.success).toBe(false);
    expect(state.error).toBe("No active build");

    const cmd = await sandboxPack.handlers.run_sandbox_command({ command: "ls" }, "u1");
    expect(cmd.success).toBe(false);
    expect(cmd.error).toBe("No active build.");
  });

  it("recover_sandbox rejects an invalid recovery action once a build resolves", async () => {
    db.featureBuildFindFirst.mockResolvedValue({ buildId: "FB-ABCDEF12" });
    const res = await sandboxPack.handlers.recover_sandbox({ action: "not-a-real-action" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("invalid_action");
  });

  it("check_sandbox reports not_found when the container cannot be inspected", async () => {
    const res = await sandboxPack.handlers.check_sandbox({}, "u1");
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ status: "not_found" });
  });
});

describe("native verification writer", () => {
  let prior: unknown;
  const result = (failed = 0, passed = 0, applicable = false) => ({ passed: failed === 0, typeCheckPassed: true,
    testsPassed: passed, testsFailed: failed, testsExecuted: passed + failed > 0, testsApplicable: applicable,
    scope: applicable ? "scoped" as const : "none" as const, testCommandPassed: applicable ? failed === 0 : null,
    testSummariesComplete: true, testCommands: applicable ? ['cd /isolated/apps/web && pnpm exec vitest run "lib/fixture.test.ts"'] : [],
    testOutput: applicable ? `Tests ${passed} passed | ${failed} failed` : "No tests ran.", typeCheckOutput: "" });
  const observed = (raw = result()) => ({ result: raw, changedFiles: ["docs/current-source.md"], output: raw.testOutput,
    verification: { ...verificationFromSandboxResult(raw), verificationSource: {
      workdir: "/workspace/.builds/FB-FIXTURE", baseRef: "fixture-base", digest: "a".repeat(64), unchanged: true, checkedAt: "2026-11-11T00:00:00Z" } } });
  beforeEach(() => {
    prior = null;
    db.featureBuildFindUnique.mockImplementation(async () => ({ buildId: "FB-FIXTURE", createdById: "u1", verificationOut: prior }));
    db.featureBuildUpdate.mockResolvedValue({});
    db.buildActivityCreate.mockResolvedValue({});
    nativeVerification.verify.mockReset().mockResolvedValue(observed());
    nativeVerification.legacy.mockReset().mockResolvedValue(result());
    nativeVerification.save.mockReset().mockResolvedValue({ status: "accepted" });
    nativeVerification.repair.mockReset().mockResolvedValue(true);
  });
  it("advertises the existing explicit build target", () => {
    const definition = sandboxPack.definitions.find((entry) => entry.name === "run_sandbox_tests");
    expect(definition?.inputSchema).toMatchObject({ properties: { buildId: { type: "string" } } });
  });
  it("records no-test counts through native artifact provenance without a fabricated pass", async () => {
    const out = await sandboxPack.handlers.run_sandbox_tests({ buildId: "FB-FIXTURE" }, "u1");
    expect(out.data).toMatchObject({ testsPassed: 0, testsFailed: 0, testsExecuted: false, testsApplicable: false });
    expect(nativeVerification.verify).toHaveBeenCalledWith("FB-FIXTURE", [], expect.any(String));
    expect(nativeVerification.save).toHaveBeenCalledWith(expect.objectContaining({ buildId: "FB-FIXTURE", savedByUserId: "u1", field: "verificationOut" }));
    expect(db.featureBuildUpdate).not.toHaveBeenCalled();
  });
  it("retains prior QA conflict when the native command observes passing cases", async () => {
    prior = { testEvidenceConflict: true, reportedQa: { testsPassed: 99, testsFailed: 3, content: "Incomplete prior failure scope" } };
    nativeVerification.verify.mockResolvedValue(observed(result(0, 4, true)));
    const out = await sandboxPack.handlers.run_sandbox_tests({ buildId: "FB-FIXTURE" }, "u1");
    expect(out.data).toMatchObject({ testsPassed: 4, testsQualified: false, testEvidenceConflict: true,
      reportedQa: { testsFailed: 3, content: "Incomplete prior failure scope" } });
  });
  it("uses central bounded repair and rediscovers the same build for each retry", async () => {
    nativeVerification.verify.mockResolvedValueOnce(observed(result(1, 3, true))).mockResolvedValueOnce(observed(result(0, 4, true)));
    nativeVerification.legacy.mockResolvedValue(result(1, 3, true));
    const out = await sandboxPack.handlers.run_sandbox_tests({ buildId: "FB-FIXTURE", auto_fix: true }, "u1");
    expect(nativeVerification.repair).toHaveBeenCalledOnce();
    expect(nativeVerification.repair).toHaveBeenCalledWith(expect.objectContaining({ buildId: "FB-FIXTURE", userId: "u1" }));
    expect(nativeVerification.verify).toHaveBeenCalledTimes(2);
    expect(nativeVerification.legacy).not.toHaveBeenCalled();
    expect(out.data).toMatchObject({ testsPassed: 4, testsFailed: 0, autoFixAttempts: 1, testsQualified: true });
  });
  it("does not repair or typecheck unrelated source when scope discovery fails", async () => {
    nativeVerification.verify.mockRejectedValue(new Error("fixture source unavailable"));
    const out = await sandboxPack.handlers.run_sandbox_tests({ buildId: "FB-FIXTURE", auto_fix: true }, "u1");
    expect(out.data).toMatchObject({ typecheckPassed: null, testsPassed: 0, testsFailed: 0, testsQualified: false, autoFixAttempts: 0 });
    expect(nativeVerification.repair).not.toHaveBeenCalled();
    expect(nativeVerification.legacy).not.toHaveBeenCalled();
  });
  it("retains observed failures but invalidates current typecheck after a refused repair", async () => {
    nativeVerification.verify.mockResolvedValue(observed(result(1, 3, true)));
    nativeVerification.repair.mockResolvedValue(false);
    const out = await sandboxPack.handlers.run_sandbox_tests({ buildId: "FB-FIXTURE", auto_fix: true }, "u1");
    expect(out.data).toMatchObject({ testsPassed: 3, testsFailed: 1, typecheckPassed: null, testsQualified: false, autoFixAttempts: 1 });
    expect(nativeVerification.verify).toHaveBeenCalledOnce();
    expect(out.message).toContain("no qualified recovery claimed");
  });
  it("records an unknown retry without resurrecting the pre-repair verdict", async () => {
    nativeVerification.verify.mockResolvedValueOnce(observed(result(1, 3, true))).mockRejectedValueOnce(new Error("fixture retry unavailable"));
    const out = await sandboxPack.handlers.run_sandbox_tests({ buildId: "FB-FIXTURE", auto_fix: true }, "u1");
    expect(out.data).toMatchObject({ testsPassed: 0, testsFailed: 0, typecheckPassed: null, testsQualified: false, autoFixAttempts: 1 });
    expect(nativeVerification.repair).toHaveBeenCalledOnce();
    expect(out.message).toContain("no qualified recovery claimed");
  });
  it("does not report successful persistence if the native artifact writer refuses", async () => {
    nativeVerification.save.mockRejectedValue(new Error("fixture artifact refused"));
    await expect(sandboxPack.handlers.run_sandbox_tests({ buildId: "FB-FIXTURE" }, "u1")).rejects.toThrow("fixture artifact refused");
    expect(db.featureBuildUpdate).not.toHaveBeenCalled();
  });
  it("refuses a foreign explicit build without fallback or execution", async () => {
    db.featureBuildFindUnique.mockResolvedValue({ buildId: "FB-FIXTURE", createdById: "another-owner" });
    const out = await sandboxPack.handlers.run_sandbox_tests({ buildId: "FB-FIXTURE" }, "u1");
    expect(out.success).toBe(false);
    expect(nativeVerification.verify).not.toHaveBeenCalled();
    expect(nativeVerification.save).not.toHaveBeenCalled();
  });
});
