import { beforeEach, describe, expect, it, vi } from "vitest";

// resolveActiveBuildId (from build-tool-helpers) reads prisma.featureBuild.
// Mock it so the build-scoped handlers resolve "no active build" hermetically.
const db = vi.hoisted(() => ({
  featureBuildFindFirst: vi.fn(),
  featureBuildFindUnique: vi.fn(),
  featureBuildUpdate: vi.fn(),
  buildActivityCreate: vi.fn(),
}));
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
