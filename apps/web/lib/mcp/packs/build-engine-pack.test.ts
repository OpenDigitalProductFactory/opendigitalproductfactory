import { beforeEach, describe, expect, it, vi } from "vitest";

const reconcile = vi.hoisted(() => ({ reconcileBuildEngines: vi.fn() }));
vi.mock("@/lib/build/build-engine-reconcile", () => reconcile);

const provision = vi.hoisted(() => ({ provisionBuildEngine: vi.fn() }));
vi.mock("@/lib/build/build-engine-provision", () => provision);

const readiness = vi.hoisted(() => ({
  loadBuildEngineReadiness: vi.fn(),
  probeBuildEngineReadiness: vi.fn(),
}));
vi.mock("@/lib/build/build-engine-readiness", () => readiness);

import { buildEnginePack } from "./build-engine-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "reconcile_build_engines",
  "provision_build_engine",
  "get_build_engine_readiness",
];

const EXPECTED_GRANTS: Record<string, string[]> = {
  reconcile_build_engines: ["sandbox_execute"],
  provision_build_engine: ["sandbox_execute"],
  get_build_engine_readiness: ["work_capsule_read"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("build-engine pack — registration", () => {
  it("exposes exactly the three build-engine tools", () => {
    expect(buildEnginePack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(buildEnginePack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(buildEnginePack.packId).toBe("build-engine");
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of buildEnginePack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("preserves execution metadata verbatim", () => {
    const byName = Object.fromEntries(buildEnginePack.definitions.map((d) => [d.name, d]));
    expect(byName.reconcile_build_engines.sideEffect).toBe(true);
    expect(byName.provision_build_engine.sideEffect).toBe(true);
    expect(byName.get_build_engine_readiness.sideEffect).toBe(false);
    for (const t of EXPECTED_TOOLS) {
      expect(byName[t].requiredCapability, t).toBe("view_platform");
      expect(byName[t].executionMode, t).toBe("immediate");
      expect(byName[t].buildPhases, t).toEqual(["ideate", "plan", "build", "review"]);
    }
    expect(byName.provision_build_engine.inputSchema.required).toEqual(["engineId"]);
  });

  it("grants mirror agent-grants for every tool", () => {
    for (const t of EXPECTED_TOOLS) {
      expect(buildEnginePack.grants[t]).toEqual(EXPECTED_GRANTS[t]);
      expect(isToolAllowedByGrants(t, EXPECTED_GRANTS[t])).toBe(true);
    }
  });
});

describe("build-engine pack — handler behavior (delegation preserved)", () => {
  it("reconcile_build_engines forwards offline + actor and reports no-op", async () => {
    reconcile.reconcileBuildEngines.mockResolvedValue({ checked: 2, restored: [], skipped: 2 });
    const res = await buildEnginePack.handlers.reconcile_build_engines({ offline: true }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("No engines needed restoring");
    expect(reconcile.reconcileBuildEngines).toHaveBeenCalledWith({ offline: true, actorUserId: "u1" });
  });

  it("provision_build_engine rejects a missing engineId without delegating", async () => {
    const res = await buildEnginePack.handlers.provision_build_engine({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("engineId is required.");
    expect(provision.provisionBuildEngine).not.toHaveBeenCalled();
  });

  it("provision_build_engine reports a successful provision", async () => {
    provision.provisionBuildEngine.mockResolvedValue({ kind: "provisioned", version: "1.2.3", recipe: "npm" });
    const res = await buildEnginePack.handlers.provision_build_engine({ engineId: "claude" }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("Provisioned claude v1.2.3");
    expect(provision.provisionBuildEngine).toHaveBeenCalledWith("claude", { offline: false, actorUserId: "u1" });
  });

  it("get_build_engine_readiness live re-probes when refresh is true", async () => {
    readiness.probeBuildEngineReadiness.mockResolvedValue([
      { engineId: "claude", present: true },
      { engineId: "codex", present: false },
    ]);
    const res = await buildEnginePack.handlers.get_build_engine_readiness({ refresh: true }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("present: claude");
    expect(res.message).toContain("not installed: codex");
    expect(readiness.probeBuildEngineReadiness).toHaveBeenCalled();
    expect(readiness.loadBuildEngineReadiness).not.toHaveBeenCalled();
  });

  it("get_build_engine_readiness loads last-known state by default", async () => {
    readiness.loadBuildEngineReadiness.mockResolvedValue([]);
    const res = await buildEnginePack.handlers.get_build_engine_readiness({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("No build engines registered yet");
    expect(readiness.loadBuildEngineReadiness).toHaveBeenCalled();
    expect(readiness.probeBuildEngineReadiness).not.toHaveBeenCalled();
  });
});
