import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  featureBuildFindFirst: vi.fn(),
  featureBuildFindUnique: vi.fn(),
  buildActivityFindMany: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: {
      findFirst: (...a: unknown[]) => db.featureBuildFindFirst(...a),
      findUnique: (...a: unknown[]) => db.featureBuildFindUnique(...a),
    },
    buildActivity: {
      findMany: (...a: unknown[]) => db.buildActivityFindMany(...a),
    },
  },
}));

import { buildVisibilityPack } from "./build-visibility-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "get_build_dispatch_history",
  "get_build_progress_visibility",
  "get_build_scoped_verification",
  "list_build_activity_since",
  "inspect_build_code_impact",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("build-visibility pack — registration", () => {
  it("exposes exactly the five observability tools with a handler each", () => {
    expect(buildVisibilityPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(buildVisibilityPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of buildVisibilityPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants: read observability tools need read grants", () => {
    expect(buildVisibilityPack.grants.get_build_dispatch_history).toEqual(["work_capsule_read"]);
    expect(buildVisibilityPack.grants.get_build_progress_visibility).toEqual(["work_capsule_read"]);
    expect(buildVisibilityPack.grants.get_build_scoped_verification).toEqual(["work_capsule_read"]);
    expect(buildVisibilityPack.grants.list_build_activity_since).toEqual(["work_capsule_read"]);
    expect(buildVisibilityPack.grants.inspect_build_code_impact).toEqual(["code_graph_read"]);

    expect(isToolAllowedByGrants("get_build_dispatch_history", ["work_capsule_read"])).toBe(true);
    expect(isToolAllowedByGrants("get_build_progress_visibility", ["work_capsule_read"])).toBe(true);
    expect(isToolAllowedByGrants("get_build_scoped_verification", ["work_capsule_read"])).toBe(true);
    expect(isToolAllowedByGrants("list_build_activity_since", ["work_capsule_read"])).toBe(true);
    expect(isToolAllowedByGrants("inspect_build_code_impact", ["code_graph_read"])).toBe(true);
  });
});

describe("build-visibility pack — handler behavior (delegation preserved)", () => {
  it("get_build_dispatch_history reports the no-active-build state", async () => {
    db.featureBuildFindFirst.mockResolvedValue(null);
    const res = await buildVisibilityPack.handlers.get_build_dispatch_history({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("No active build");
  });

  it("get_build_scoped_verification reports the no-active-build state", async () => {
    db.featureBuildFindFirst.mockResolvedValue(null);
    const res = await buildVisibilityPack.handlers.get_build_scoped_verification({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("No active build");
  });

  it("inspect_build_code_impact reports the no-active-build state without touching the diff", async () => {
    db.featureBuildFindFirst.mockResolvedValue(null);
    const res = await buildVisibilityPack.handlers.inspect_build_code_impact({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("No active build.");
    expect(db.featureBuildFindUnique).not.toHaveBeenCalled();
  });

  it("list_build_activity_since rejects a non-ISO cursor after resolving the build", async () => {
    db.featureBuildFindFirst.mockResolvedValue({ buildId: "FB-1" });
    const res = await buildVisibilityPack.handlers.list_build_activity_since(
      { cursor: "not-a-date" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid cursor");
    expect(db.buildActivityFindMany).not.toHaveBeenCalled();
  });
});
