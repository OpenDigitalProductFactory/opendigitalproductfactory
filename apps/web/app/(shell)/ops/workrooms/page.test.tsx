import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/ops/workrooms" }));

const now = new Date();
const fresh = new Date(now.getTime() - 5_000).toISOString();

vi.mock("@/lib/work-capsules/liveness-inventory", () => ({
  loadCapsuleLivenessInventory: vi.fn(async () => ({
    livenessSummary: {
      scanned: 3, live: 2, history: 1, reapable: 0, byLiveness: { live: 2, "no-signal": 1 },
      heavyLane: { executing: 1, nextReady: 1, dormant: 0 },
      progressSlo: { oldestWaitMs: null, maxNoTransitionMs: null },
    },
    capsulesAll: [
      {
        capsuleId: "WC-RUN", backlogItemId: null, title: "Reconcile payables", status: "working",
        source: "external-adoption", executorKind: "claude", portfolioRole: "forEmployees",
        headBranch: null, pullRequestUrl: null, updatedAt: now, liveness: "live", isLive: true,
        isReapable: false, livenessReason: "lease active", trueLivenessAt: fresh,
      },
      {
        capsuleId: "WC-BLOCK", backlogItemId: null, title: "Release review", status: "blocked",
        source: "external-adoption", executorKind: "codex", portfolioRole: "foundational",
        headBranch: null, pullRequestUrl: null, updatedAt: now, liveness: "live", isLive: true,
        isReapable: false, livenessReason: "waiting on reviewer", trueLivenessAt: fresh,
      },
      {
        capsuleId: "WC-NOWHERE", backlogItemId: null, title: "Unplaced work", status: "ready",
        source: "external-adoption", executorKind: null, portfolioRole: null,
        headBranch: null, pullRequestUrl: null, updatedAt: now, liveness: "no-signal", isLive: false,
        isReapable: false, livenessReason: "no signal", trueLivenessAt: null,
      },
    ],
  })),
}));

import WorkroomsPage from "./page";

describe("Work activity page", () => {
  it("groups activity under portfolio labels and keeps unplaced work outside them", async () => {
    const html = renderToStaticMarkup(await WorkroomsPage());
    expect(html).toContain("Activity by portfolio");
    expect(html).toContain("Workforce");
    expect(html).toContain("Not placed in a portfolio");
  });

  it("shows a recorded blocker as a concrete statement, not a count", async () => {
    const html = renderToStaticMarkup(await WorkroomsPage());
    // The room is named alongside its blocker: measured at scale, rooms
    // sharing one generic liveness reason rendered as identical lines.
    expect(html).toContain("blocked: waiting on reviewer");
    expect(html).toMatch(/[^<>]+ · blocked: waiting on reviewer/);
  });

  it("opens each room in one click from its activity line", async () => {
    const html = renderToStaticMarkup(await WorkroomsPage());
    expect(html).toContain("/workspace/cases/work-capsule%3AWC-BLOCK");
    expect(html).toContain("/workspace/cases/work-capsule%3AWC-RUN");
  });

  it("does not claim work is executing without evidence", async () => {
    const html = renderToStaticMarkup(await WorkroomsPage());
    // The unplaced room has no liveness timestamp, so it must read unknown.
    expect(html).toContain('aria-label="Unknown"');
  });
});
