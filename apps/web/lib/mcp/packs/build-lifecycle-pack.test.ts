import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  featureBuildFindFirst: vi.fn(),
  featureBuildFindUnique: vi.fn(),
  featureBuildFindMany: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: {
      findFirst: (...a: unknown[]) => db.featureBuildFindFirst(...a),
      findUnique: (...a: unknown[]) => db.featureBuildFindUnique(...a),
      findMany: (...a: unknown[]) => db.featureBuildFindMany(...a),
    },
  },
}));

import { buildLifecyclePack } from "./build-lifecycle-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "update_feature_brief",
  "register_digital_product_from_build",
  "create_build_epic",
  "verification_preflight",
  "start_build",
  "deploy_feature",
  "create_portal_pr",
  "run_ux_test",
  "start_ideate_research",
  "start_scout_research",
];

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no active build resolves, so lifecycle handlers hit their early
  // "no active build" guard without touching the rest of the pipeline.
  db.featureBuildFindFirst.mockResolvedValue(null);
  db.featureBuildFindUnique.mockResolvedValue(null);
  db.featureBuildFindMany.mockResolvedValue([]);
});

describe("build-lifecycle pack — registration", () => {
  it("exposes exactly the ten lifecycle tools with a handler each (no handler-only asymmetry)", () => {
    expect(buildLifecyclePack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(buildLifecyclePack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
    // Every definition has a handler and vice-versa — no def-without-handler or
    // handler-without-def guard to assert here.
    const defNames = new Set(buildLifecyclePack.definitions.map((d) => d.name));
    const handlerNames = new Set(Object.keys(buildLifecyclePack.handlers));
    expect([...defNames].filter((n) => !handlerNames.has(n))).toEqual([]);
    expect([...handlerNames].filter((n) => !defNames.has(n))).toEqual([]);
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of buildLifecyclePack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants TOOL_TO_GRANTS for each tool", () => {
    expect(buildLifecyclePack.grants.update_feature_brief).toEqual(["backlog_write"]);
    expect(buildLifecyclePack.grants.register_digital_product_from_build).toEqual(["registry_read", "backlog_write"]);
    expect(buildLifecyclePack.grants.create_build_epic).toEqual(["backlog_write"]);
    expect(buildLifecyclePack.grants.verification_preflight).toEqual(["build_plan_write"]);
    expect(buildLifecyclePack.grants.start_build).toEqual(["sandbox_execute"]);
    expect(buildLifecyclePack.grants.deploy_feature).toEqual(["iac_execute"]);
    expect(buildLifecyclePack.grants.create_portal_pr).toEqual(["sandbox_execute"]);
    expect(buildLifecyclePack.grants.run_ux_test).toEqual(["file_read"]);
    expect(buildLifecyclePack.grants.start_ideate_research).toEqual(["sandbox_execute", "file_read"]);
    expect(buildLifecyclePack.grants.start_scout_research).toEqual(["sandbox_execute", "file_read", "web_search"]);

    expect(isToolAllowedByGrants("start_build", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("deploy_feature", ["iac_execute"])).toBe(true);
    expect(isToolAllowedByGrants("create_portal_pr", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("start_scout_research", ["sandbox_execute", "file_read", "web_search"])).toBe(true);
  });

  it("marks the mutating tools as side-effecting and the read tools as not", () => {
    const byName = Object.fromEntries(buildLifecyclePack.definitions.map((d) => [d.name, d]));
    expect(byName.verification_preflight.sideEffect).toBe(false);
    expect(byName.start_build.sideEffect).toBe(false);
    expect(byName.run_ux_test.sideEffect).toBe(false);
    expect(byName.update_feature_brief.sideEffect).toBe(true);
    expect(byName.deploy_feature.sideEffect).toBe(true);
    expect(byName.create_portal_pr.sideEffect).toBe(true);
    expect(byName.register_digital_product_from_build.sideEffect).toBe(true);
  });
});

describe("build-lifecycle pack — handler behavior (delegation preserved)", () => {
  it("start_build guards on no active build", async () => {
    const res = await buildLifecyclePack.handlers.start_build({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("No active build.");
  });

  it("update_feature_brief guards on no active build", async () => {
    const res = await buildLifecyclePack.handlers.update_feature_brief({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("No active build");
  });

  it("register_digital_product_from_build guards on no active build", async () => {
    const res = await buildLifecyclePack.handlers.register_digital_product_from_build({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("No active build");
  });

  it("run_ux_test guards on no active build", async () => {
    const res = await buildLifecyclePack.handlers.run_ux_test({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("No active build.");
  });

  it("start_ideate_research refuses when no ideate build resolves", async () => {
    const res = await buildLifecyclePack.handlers.start_ideate_research(
      { reusabilityScope: "one_off", userContext: "x" },
      "u1",
    );
    expect(res.success).toBe(false);
  });

  it("start_scout_research refuses when no ideate build resolves", async () => {
    const res = await buildLifecyclePack.handlers.start_scout_research({}, "u1");
    expect(res.success).toBe(false);
  });
});
