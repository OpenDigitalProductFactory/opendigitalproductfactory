import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  businessProfileFindFirst: vi.fn(),
  releaseBundleFindUnique: vi.fn(),
  releaseBundleCreate: vi.fn(),
  releaseBundleUpdate: vi.fn(),
  featureBuildFindMany: vi.fn(),
  featureBuildUpdateMany: vi.fn(),
  changePromotionFindUnique: vi.fn(),
  changePromotionFindFirst: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    businessProfile: { findFirst: (...a: unknown[]) => db.businessProfileFindFirst(...a) },
    releaseBundle: {
      findUnique: (...a: unknown[]) => db.releaseBundleFindUnique(...a),
      create: (...a: unknown[]) => db.releaseBundleCreate(...a),
      update: (...a: unknown[]) => db.releaseBundleUpdate(...a),
    },
    featureBuild: {
      findMany: (...a: unknown[]) => db.featureBuildFindMany(...a),
      updateMany: (...a: unknown[]) => db.featureBuildUpdateMany(...a),
    },
    changePromotion: {
      findUnique: (...a: unknown[]) => db.changePromotionFindUnique(...a),
      findFirst: (...a: unknown[]) => db.changePromotionFindFirst(...a),
    },
  },
}));

import { releasePack } from "./release-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "check_deployment_windows",
  "schedule_promotion",
  "execute_promotion",
  "create_release_bundle",
  "run_release_gate",
  "schedule_release_bundle",
  "get_release_status",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("release pack — registration", () => {
  it("exposes exactly the seven release & promotion tools with a handler each", () => {
    expect(releasePack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(releasePack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of releasePack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants TOOL_TO_GRANTS for each tool", () => {
    expect(releasePack.grants.check_deployment_windows).toEqual(["deployment_plan_create"]);
    expect(releasePack.grants.schedule_promotion).toEqual(["deployment_plan_create"]);
    expect(releasePack.grants.execute_promotion).toEqual(["iac_execute"]);
    expect(releasePack.grants.create_release_bundle).toEqual(["release_gate_create"]);
    expect(releasePack.grants.run_release_gate).toEqual(["release_gate_create"]);
    expect(releasePack.grants.schedule_release_bundle).toEqual(["release_plan_create"]);
    expect(releasePack.grants.get_release_status).toEqual(["release_plan_read"]);

    expect(isToolAllowedByGrants("check_deployment_windows", ["deployment_plan_create"])).toBe(true);
    expect(isToolAllowedByGrants("execute_promotion", ["iac_execute"])).toBe(true);
    expect(isToolAllowedByGrants("create_release_bundle", ["release_gate_create"])).toBe(true);
    expect(isToolAllowedByGrants("schedule_release_bundle", ["release_plan_create"])).toBe(true);
    expect(isToolAllowedByGrants("get_release_status", ["release_plan_read"])).toBe(true);
  });

  it("marks the mutating tools as side-effecting and the read tools as not", () => {
    const byName = Object.fromEntries(releasePack.definitions.map((d) => [d.name, d]));
    expect(byName.check_deployment_windows.sideEffect).toBe(false);
    expect(byName.get_release_status.sideEffect).toBe(false);
    expect(byName.execute_promotion.sideEffect).toBe(true);
    expect(byName.create_release_bundle.sideEffect).toBe(true);
    expect(byName.schedule_release_bundle.sideEffect).toBe(true);
  });
});

describe("release pack — handler behavior (delegation preserved)", () => {
  it("check_deployment_windows treats an unconfigured profile as unrestricted", async () => {
    db.businessProfileFindFirst.mockResolvedValue(null);
    const res = await releasePack.handlers.check_deployment_windows({}, "u1");
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ available: true, unrestricted: true });
  });

  it("schedule_promotion requires a promotion_id", async () => {
    const res = await releasePack.handlers.schedule_promotion({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("promotion_id is required.");
    expect(db.changePromotionFindUnique).not.toHaveBeenCalled();
  });

  it("execute_promotion rejects a malformed promotion_id before any lookup", async () => {
    const res = await releasePack.handlers.execute_promotion({ promotion_id: "bad id!" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid promotion_id");
    expect(db.changePromotionFindFirst).not.toHaveBeenCalled();
  });

  it("create_release_bundle requires a title and at least one build id", async () => {
    const noTitle = await releasePack.handlers.create_release_bundle({ build_ids: ["FB-1"] }, "u1");
    expect(noTitle.success).toBe(false);
    expect(noTitle.error).toBe("title is required.");

    const noBuilds = await releasePack.handlers.create_release_bundle({ title: "Rel" }, "u1");
    expect(noBuilds.success).toBe(false);
    expect(noBuilds.error).toBe("build_ids is required.");
    expect(db.featureBuildFindMany).not.toHaveBeenCalled();
  });

  it("run_release_gate errors when the bundle does not exist", async () => {
    db.releaseBundleFindUnique.mockResolvedValue(null);
    const res = await releasePack.handlers.run_release_gate({ bundle_id: "RB-GHOST" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Bundle not found.");
  });

  it("schedule_release_bundle refuses a bundle that has not passed gate checks", async () => {
    db.releaseBundleFindUnique.mockResolvedValue({ status: "assembling", builds: [] });
    const res = await releasePack.handlers.schedule_release_bundle({ bundle_id: "RB-1" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toContain("Bundle must be approved first.");
  });

  it("get_release_status returns a bundle summary when found by bundle_id", async () => {
    db.releaseBundleFindUnique.mockResolvedValue({
      bundleId: "RB-1",
      title: "Rel",
      status: "assembling",
      builds: [{ buildId: "FB-1", title: "A", phase: "review" }],
      scheduledAt: null,
      deployedAt: null,
    });
    const res = await releasePack.handlers.get_release_status({ bundle_id: "RB-1" }, "u1");
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ bundleId: "RB-1", status: "assembling" });
  });

  it("get_release_status requires either a bundle_id or a promotion_id", async () => {
    const res = await releasePack.handlers.get_release_status({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Provide bundle_id or promotion_id.");
  });
});
