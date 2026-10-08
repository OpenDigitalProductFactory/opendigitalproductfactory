// BI-D80F2EA0 — founder decision (2026-09-25): once review passes, Build Studio
// opens its PR itself. A PR is not a merge: required checks, the merge queue and
// human review still gate what lands.
import { describe, expect, it, vi } from "vitest";

import { openBuildStudioPrAfterShip } from "./auto-open-build-pr";

const deps = (overrides = {}) => ({
  phaseOf: vi.fn().mockResolvedValue("ship"),
  existingPrUrl: vi.fn().mockResolvedValue(null),
  createPr: vi.fn().mockResolvedValue({ success: true, message: "Opened https://github.com/o/r/pull/9001" }),
  log: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe("openBuildStudioPrAfterShip", () => {
  it("opens the PR once the build is in ship and has none", async () => {
    const d = deps();
    expect(await openBuildStudioPrAfterShip({ buildId: "FB-1", actorUserId: "u1", deps: d })).toBe("opened");
    expect(d.createPr).toHaveBeenCalledWith("FB-1", "u1");
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("pull/9001"));
  });

  it("does nothing before ship or when a PR already exists", async () => {
    const early = deps({ phaseOf: vi.fn().mockResolvedValue("review") });
    expect(await openBuildStudioPrAfterShip({ buildId: "FB-1", actorUserId: "u1", deps: early })).toBe("skipped");
    const existing = deps({ existingPrUrl: vi.fn().mockResolvedValue("https://github.com/o/r/pull/1") });
    expect(await openBuildStudioPrAfterShip({ buildId: "FB-1", actorUserId: "u1", deps: existing })).toBe("skipped");
    expect(early.createPr).not.toHaveBeenCalled();
    expect(existing.createPr).not.toHaveBeenCalled();
  });

  it("records a refusal from the publication guards instead of hiding it", async () => {
    const d = deps({ createPr: vi.fn().mockResolvedValue({ success: false, message: "Blocked: preflight record missing for tree abc" }) });
    expect(await openBuildStudioPrAfterShip({ buildId: "FB-1", actorUserId: "u1", deps: d })).toBe("blocked");
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("preflight record missing"));
  });
});

// BI-D9287821: mcp-tools reads context.featureBuildId as a row cuid, so an FB- id
// there set no build hint and create_portal_pr fell back to "the owner's only
// active build" — none, or the wrong one, for an owner with several builds.
describe("production create_portal_pr call", () => {
  it("names the build explicitly by its FB- id", async () => {
    vi.resetModules();
    const executeTool = vi.fn().mockResolvedValue({ success: true, message: "Opened" });
    vi.doMock("@/lib/mcp-tools", () => ({ executeTool }));
    vi.doMock("@dpf/db", () => ({
      prisma: {
        featureBuild: { findUnique: vi.fn().mockResolvedValue({ phase: "ship", id: "row1" }) },
        workroom: { findFirst: vi.fn().mockResolvedValue(null) },
        buildActivity: { create: vi.fn().mockResolvedValue({}) },
      },
    }));
    const { openBuildStudioPrAfterShip: open } = await import("./auto-open-build-pr");
    await expect(open({ buildId: "FB-1", actorUserId: "u1" })).resolves.toBe("opened");
    expect(executeTool).toHaveBeenCalledWith("create_portal_pr", { buildId: "FB-1" }, "u1", expect.anything());
  });
});
