// BI-D80F2EA0 — founder decision (2026-09-25): once review passes, Build Studio
// opens its PR itself. A PR is not a merge: required checks, the merge queue and
// human review still gate what lands.
import { describe, expect, it, vi } from "vitest";

import { REPUBLISHED_PREFIX, SHIP_PR_RETRY_MS, missingPublishedPaths, openBuildStudioPrAfterShip, retryBuildStudioPrForShipBuild } from "./auto-open-build-pr";
import { PR_FOLLOW_UP_PREFIX, PR_FOLLOW_UP_UNCHANGED, PR_FOLLOW_UP_UNCHANGED_PREFIX } from "./pr-ci-repair-markers";

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

// BI-085A37EC: a build sent back to repair because its PR went red returns to
// ship with the PR still open; the repair must reach that PR as a follow-up.
describe("a CI repair reaches the open pull request", () => {
  const existing = { existingPrUrl: vi.fn().mockResolvedValue("https://github.com/o/r/pull/6983") };

  it("publishes the repaired build onto its open PR as a follow-up", async () => {
    const d = deps({ ...existing, followUpPending: vi.fn().mockResolvedValue(true) });
    expect(await openBuildStudioPrAfterShip({ buildId: "FB-1", actorUserId: "u1", deps: d })).toBe("opened");
    expect(d.createPr).toHaveBeenCalledWith("FB-1", "u1");
    expect(d.log).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${PR_FOLLOW_UP_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)));
  });

  it("leaves an open PR alone when no repair is pending", async () => {
    const d = deps({ ...existing, followUpPending: vi.fn().mockResolvedValue(false) });
    expect(await openBuildStudioPrAfterShip({ buildId: "FB-1", actorUserId: "u1", deps: d })).toBe("skipped");
    expect(d.createPr).not.toHaveBeenCalled();
  });

  it("settles a repair that changed nothing and tells a person, instead of retrying it", async () => {
    const followUpUnchanged = vi.fn().mockResolvedValue(undefined);
    const d = deps({
      ...existing,
      followUpPending: vi.fn().mockResolvedValue(true),
      followUpUnchanged,
      createPr: vi.fn().mockResolvedValue({ success: false, error: PR_FOLLOW_UP_UNCHANGED }),
    });
    expect(await openBuildStudioPrAfterShip({ buildId: "FB-1", actorUserId: "u1", deps: d })).toBe("blocked");
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining(PR_FOLLOW_UP_UNCHANGED_PREFIX));
    expect(followUpUnchanged).toHaveBeenCalledWith("FB-1", expect.stringContaining("changed nothing"));
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

describe("BI-F31DB5F8: a pull request missing files of the change is republished once", () => {
  const existingPrUrl = () => vi.fn().mockResolvedValue("https://github.com/o/r/pull/1");

  it("names the change's paths the published commit does not carry", () => {
    expect(missingPublishedPaths(["a.ts", "src/b.ts"], ["a.ts"])).toEqual(["src/b.ts"]);
    expect(missingPublishedPaths(["a.ts"], ["a.ts", "other.ts"])).toEqual([]);
  });

  it("publishes again when the open pull request is incomplete, and says so on the trail", async () => {
    const d = deps({ existingPrUrl: existingPrUrl(), publishedIncomplete: vi.fn().mockResolvedValue(true) });
    expect(await openBuildStudioPrAfterShip({ buildId: "FB-1", actorUserId: "u1", deps: d })).toBe("opened");
    expect(d.createPr).toHaveBeenCalledWith("FB-1", "u1");
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining(REPUBLISHED_PREFIX));
  });

  it("leaves a complete pull request alone", async () => {
    const d = deps({ existingPrUrl: existingPrUrl(), publishedIncomplete: vi.fn().mockResolvedValue(false) });
    expect(await openBuildStudioPrAfterShip({ buildId: "FB-1", actorUserId: "u1", deps: d })).toBe("skipped");
    expect(d.createPr).not.toHaveBeenCalled();
  });
});
