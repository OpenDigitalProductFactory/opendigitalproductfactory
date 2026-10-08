// BI-D80F2EA0 — founder decision (2026-09-25): once review passes, Build Studio
// opens its PR itself. A PR is not a merge: required checks, the merge queue and
// human review still gate what lands.
import { describe, expect, it, vi } from "vitest";

import { SHIP_PR_RETRY_MS, createPortalPrForBuild, openBuildStudioPrAfterShip, retryBuildStudioPrForShipBuild } from "./auto-open-build-pr";

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

describe("createPortalPrForBuild", () => {
  it("names the build in the tool params, where create_portal_pr reads it", async () => {
    const executeTool = vi.fn().mockResolvedValue({ success: true, message: "ok" });
    await createPortalPrForBuild(executeTool as never, "FB-2E891686", "u1");
    expect(executeTool).toHaveBeenCalledWith(
      "create_portal_pr",
      { buildId: "FB-2E891686" },
      "u1",
      expect.objectContaining({ featureBuildId: "FB-2E891686" }),
    );
  });
});

describe("retryBuildStudioPrForShipBuild", () => {
  const now = new Date("2026-10-08T02:00:00Z");

  it("retries a ship build whose last PR attempt was refused over an hour ago", async () => {
    const d = deps();
    const out = await retryBuildStudioPrForShipBuild({
      buildId: "FB-1", actorUserId: "u1", now, deps: d,
      lastAttemptAt: new Date(now.getTime() - SHIP_PR_RETRY_MS - 1),
    });
    expect(out).toBe("opened");
    expect(d.createPr).toHaveBeenCalledWith("FB-1", "u1");
  });

  it("waits out the retry interval after a recent attempt", async () => {
    const d = deps();
    const out = await retryBuildStudioPrForShipBuild({
      buildId: "FB-1", actorUserId: "u1", now, deps: d,
      lastAttemptAt: new Date(now.getTime() - 60_000),
    });
    expect(out).toBe("skipped");
    expect(d.createPr).not.toHaveBeenCalled();
  });
});
