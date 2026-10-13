import { describe, expect, it, vi } from "vitest";
import {
  isRefreshableDivergence,
  refreshDivergedShipBuild,
  SHIP_SOURCE_REFRESH_RETRY_MS,
  type ShipSourceRefreshDeps,
} from "./ship-source-refresh";

// The live refusal on FB-2E891686 (2026-10-08 → 2026-10-13).
const diverged = {
  source: "sandbox-git",
  status: "diverged",
  recommendedAction: "pause",
  dirty: false,
  aheadBy: 4,
  behindBy: 21,
  targetRef: "client/5727856b-3296-4e17-97f0-c59401ace4f2",
};

const NOW = new Date("2026-10-13T17:00:00Z");

function deps(overrides: Partial<ShipSourceRefreshDeps> = {}) {
  const base: ShipSourceRefreshDeps = {
    loadBuild: vi.fn(async () => ({ phase: "ship", buildExecState: { sourceCurrency: diverged, step: "kept" } })),
    lastAttemptAt: vi.fn(async () => null),
    refresh: vi.fn(async () => ({ status: "refreshed" as const, headSha: "a".repeat(40), clientSha: "b".repeat(40) })),
    returnToReview: vi.fn(async () => true),
    queueReview: vi.fn(async () => {}),
    record: vi.fn(async () => {}),
    now: () => NOW,
  };
  return { ...base, ...overrides };
}

describe("isRefreshableDivergence", () => {
  it("is the diverged/pause refusal on a clean tree only", () => {
    expect(isRefreshableDivergence(diverged as never)).toBe(true);
    expect(isRefreshableDivergence({ ...diverged, dirty: true } as never)).toBe(false);
    expect(isRefreshableDivergence({ ...diverged, status: "dirty" } as never)).toBe(false);
    expect(isRefreshableDivergence({ ...diverged, status: "ahead", recommendedAction: "allow" } as never)).toBe(false);
    expect(isRefreshableDivergence(null)).toBe(false);
  });
});

describe("refreshDivergedShipBuild", () => {
  it("rebases a diverged ship build and returns it to review with the old tree's evidence dropped", async () => {
    const d = deps();
    await expect(refreshDivergedShipBuild("FB-2E891686", d)).resolves.toBe("returned-to-review");
    expect(d.refresh).toHaveBeenCalledWith("FB-2E891686");
    expect(d.returnToReview).toHaveBeenCalledWith("FB-2E891686", { step: "kept" });
    expect(d.queueReview).toHaveBeenCalledWith("FB-2E891686");
    expect(vi.mocked(d.record).mock.calls[0]?.[1]).toMatch(/was 4 ahead \/ 21 behind .*Returned to review/);
  });

  it("leaves a conflicted build in ship, names the files and does not re-queue review", async () => {
    const d = deps({ refresh: vi.fn(async () => ({ status: "conflict" as const, files: ["apps/web/lib/a.ts", "docs/b.md"] })) });
    await expect(refreshDivergedShipBuild("FB-1", d)).resolves.toBe("conflict");
    expect(d.returnToReview).not.toHaveBeenCalled();
    expect(d.queueReview).not.toHaveBeenCalled();
    expect(vi.mocked(d.record).mock.calls[0]?.[1]).toContain("apps/web/lib/a.ts, docs/b.md");
  });

  it("does not attempt again within the retry window after a recorded attempt", async () => {
    const d = deps({ lastAttemptAt: vi.fn(async () => new Date(NOW.getTime() - SHIP_SOURCE_REFRESH_RETRY_MS + 60_000)) });
    await expect(refreshDivergedShipBuild("FB-1", d)).resolves.toBe("recently-attempted");
    expect(d.refresh).not.toHaveBeenCalled();
  });

  it("tries again once the window has passed", async () => {
    const d = deps({ lastAttemptAt: vi.fn(async () => new Date(NOW.getTime() - SHIP_SOURCE_REFRESH_RETRY_MS - 1)) });
    await expect(refreshDivergedShipBuild("FB-1", d)).resolves.toBe("returned-to-review");
  });

  it("leaves current, dirty and non-ship builds to their own paths", async () => {
    const current = deps({ loadBuild: vi.fn(async () => ({ phase: "ship", buildExecState: { sourceCurrency: { ...diverged, status: "ahead", recommendedAction: "allow" } } })) });
    await expect(refreshDivergedShipBuild("FB-1", current)).resolves.toBe("not-diverged");
    const dirty = deps({ loadBuild: vi.fn(async () => ({ phase: "ship", buildExecState: { sourceCurrency: { ...diverged, dirty: true } } })) });
    await expect(refreshDivergedShipBuild("FB-1", dirty)).resolves.toBe("not-diverged");
    const review = deps({ loadBuild: vi.fn(async () => ({ phase: "review", buildExecState: { sourceCurrency: diverged } })) });
    await expect(refreshDivergedShipBuild("FB-1", review)).resolves.toBe("not-ship");
    for (const d of [current, dirty, review]) expect(d.refresh).not.toHaveBeenCalled();
  });

  it("records an unrefreshable client branch or a thrown refresh and stays in ship", async () => {
    const blocked = deps({ refresh: vi.fn(async () => ({ status: "client-not-refreshable" as const, reason: "client diverged" })) });
    await expect(refreshDivergedShipBuild("FB-1", blocked)).resolves.toBe("not-refreshed");
    const thrown = deps({ refresh: vi.fn(async () => { throw new Error("sandbox git lock busy"); }) });
    await expect(refreshDivergedShipBuild("FB-1", thrown)).resolves.toBe("not-refreshed");
    expect(vi.mocked(thrown.record).mock.calls[0]?.[1]).toContain("sandbox git lock busy");
    expect(blocked.returnToReview).not.toHaveBeenCalled();
  });

  it("does not queue review when the row left ship before the flip", async () => {
    const d = deps({ returnToReview: vi.fn(async () => false) });
    await expect(refreshDivergedShipBuild("FB-1", d)).resolves.toBe("not-ship");
    expect(d.queueReview).not.toHaveBeenCalled();
  });
});
