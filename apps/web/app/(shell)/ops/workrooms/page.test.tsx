// @vitest-environment jsdom
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
        attribution: { executor: "claude", invocation: "Session payables-session" },
        headBranch: null, pullRequestUrl: null, updatedAt: now, liveness: "live", isLive: true,
        isReapable: false, livenessReason: "lease active", trueLivenessAt: fresh,
      },
      {
        capsuleId: "WC-BLOCK", backlogItemId: null, title: "Release review", status: "blocked",
        source: "external-adoption", executorKind: "codex", portfolioRole: "foundational",
        attribution: { executor: "codex", invocation: "Session release-session" },
        headBranch: null, pullRequestUrl: null, updatedAt: now, liveness: "live", isLive: true,
        isReapable: false, livenessReason: "waiting on reviewer", trueLivenessAt: fresh,
      },
      {
        capsuleId: "WC-NOWHERE", backlogItemId: null, title: "Unplaced work", status: "ready",
        source: "external-adoption", executorKind: null, portfolioRole: null,
        attribution: { executor: "Executor not recorded", invocation: "Invocation history not recorded" },
        headBranch: null, pullRequestUrl: null, updatedAt: now, liveness: "no-signal", isLive: false,
        isReapable: false, livenessReason: "no signal", trueLivenessAt: null,
      },
    ],
  })),
}));

vi.mock("@/lib/operate/coo-surface.server", () => ({
  loadCooSupervision: vi.fn(async (_db: unknown, input: { rooms: Array<{ capsuleId: string; title: string }> }) => ({
    rooms: input.rooms.map((room) => ({
      roomId: room.capsuleId, title: room.title, ownerPrincipalId: null, ownerDisplayName: null,
      ownerIsSuggestion: false, stallRecipientPrincipalId: null, lastCycleKey: null, lastAction: null,
      lastReason: null, ticksSinceAdvance: null, nextWakeAt: null, spanOfControl: 0, overSpan: false,
      unowned: true, paused: false, escalationLabel: null, missingAckCount: 0,
      actionHref: `/workspace/cases/work-capsule%3A${room.capsuleId}`,
    })),
    unowned: input.rooms, paused: [], overSpanOwners: [], missingAcks: [],
  })),
}));

vi.mock("@/lib/work-management/held-workrooms", () => ({
  loadHeldWorkrooms: vi.fn(async () => [{
    capsuleId: "WC-HELD", title: "Onboard new foster", action: "pause", reason: "conformance_pause",
    deviationCodes: ["missing_explicit_coordinator"], stageKey: "intake",
    since: new Date(Date.now() - 3 * 3_600_000).toISOString(), stuckTicks: 12, notifiedAt: new Date().toISOString(),
  }]),
}));

vi.mock("@/lib/work-management/standing-run-history.server", async () => {
  const { classifyStandingRhythm } = await import("@/lib/work-management/standing-run-history");
  return {
    loadStandingRhythms: vi.fn(async () => [{
      capsuleId: "WC-PAYABLES", title: "Payables watch",
      rhythm: classifyStandingRhythm({ rows: [], currentRunKey: "payables-watch@1.1.0:2026-10-07", now: new Date() }),
    }]),
  };
});

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
    const document = new DOMParser().parseFromString(html, "text/html");
    const details = Array.from(document.querySelectorAll("details"));
    const activity = details.find((detail) => detail.querySelector("summary")?.textContent === "Activity by portfolio");
    expect(activity).toBeDefined();
    expect(activity!.innerHTML).toContain("/workspace/cases/work-capsule%3AWC-BLOCK");
    expect(activity!.innerHTML).toContain("/workspace/cases/work-capsule%3AWC-RUN");
    expect(activity!.textContent).not.toContain("Session payables-session");
    expect(activity!.textContent).not.toContain("Session release-session");
    expect(activity!.textContent).toContain("blocked: waiting on reviewer");
    const provenance = details.find((detail) => detail.textContent?.includes("Session release-session"));
    expect(provenance?.querySelector("summary")?.textContent).toBe("Technical evidence");
    expect(provenance?.open).toBe(false);
  });

  it("does not claim work is executing without evidence", async () => {
    const html = renderToStaticMarkup(await WorkroomsPage());
    // The unplaced room has no liveness timestamp, so it must read unknown.
    expect(html).toContain('aria-label="Unknown"');
  });

  it("lists held Workrooms with why and for how long (BI-E8C78E80)", async () => {
    const html = renderToStaticMarkup(await WorkroomsPage());
    expect(html).toContain("Shared recovery issues");
    expect(html).toContain("Onboard new foster");
    expect(html).toContain("missing explicit coordinator");
    expect(html).toContain("3 h");
  });

  it("gives standing operations their own band with each room's last 14 days (BI-D8A6F0F2)", async () => {
    const html = renderToStaticMarkup(await WorkroomsPage());
    expect(html).toContain("Day-to-day operations");
    expect(html).toContain("Last 14 days for Payables watch");
    expect(html).toContain("Running since Oct 7");
  });

  it("adds nothing to the page when the install has no standing rooms (BI-D8A6F0F2)", async () => {
    const { loadStandingRhythms } = await import("@/lib/work-management/standing-run-history.server");
    vi.mocked(loadStandingRhythms).mockResolvedValueOnce([]);
    const html = renderToStaticMarkup(await WorkroomsPage());
    expect(html).not.toContain("Day-to-day operations");
    expect(html).not.toContain("standing-rhythm-heading");
  });
});
