// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/ops/workrooms" }));
vi.mock("@/lib/i18n/locale-context.server", () => ({ getLocaleContext: async () => ({ language: "en-US" }) }));
vi.mock("@/lib/i18n/t.server", async () => {
  const { translate } = await import("@dpf/i18n");
  return { getT: async (namespace: string) => (key: string, args?: Record<string, unknown>) => translate("en-US", namespace as never, key as never, args as never) };
});

vi.mock("@/lib/work-management/atlas-projection.server", async () => {
  const { projectAtlas } = await import("@/lib/work-management/atlas-projection");
  const base = { isLive: true, liveness: "live", status: "working", trueLivenessAt: "2026-11-10T09:00:00.000Z", drive: null, stageKey: null };
  const rooms = [
    { ...base, capsuleId: "WC-RUN", title: "Reconcile payables", portfolioRole: "forEmployees", shapeKey: "delivery-small", stageKey: "repair" },
    { ...base, capsuleId: "WC-CLOSE", title: "Release review", portfolioRole: "manufactureAndDeliver", status: "ready-for-promotion", shapeKey: "delivery-small" },
    { ...base, capsuleId: "WC-HELD", title: "Onboard new foster", portfolioRole: "manufactureAndDeliver", shapeKey: "delivery-small",
      drive: { action: "pause", reason: "conformance_pause" } },
    { ...base, capsuleId: "WC-NOWHERE", title: "Unplaced work", portfolioRole: null, isLive: false, liveness: "no-signal", trueLivenessAt: null, shapeKey: null },
  ];
  return { loadAtlasPicture: vi.fn(async () => projectAtlas({ rooms, owners: new Map(), limit: 2000, observedAt: new Date("2026-11-12T00:00:00.000Z") })) };
});

vi.mock("@/lib/work-management/held-workrooms", () => ({
  loadHeldWorkrooms: vi.fn(async () => [{
    capsuleId: "WC-HELD", title: "Onboard new foster", action: "pause", reason: "conformance_pause",
    deviationCodes: ["missing_explicit_coordinator"], stageKey: "intake",
    since: "2026-11-11T21:00:00.000Z", stuckTicks: 12, notifiedAt: null,
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

async function render(params: Record<string, string> = {}) {
  const html = renderToStaticMarkup(await WorkroomsPage({ searchParams: Promise.resolve(params) }));
  return { html, document: new DOMParser().parseFromString(html, "text/html") };
}

describe("Work in progress leads with the Work Atlas (BI-3791FDD8)", () => {
  it("asks today's question with live numbers and links the room quiet longest", async () => {
    const { document } = await render();
    const question = document.querySelector("[data-atlas-question]")!;
    expect(question.textContent).toContain("What is waiting on a person?");
    expect(question.textContent).toContain("1 rooms are waiting on a person.");
    expect(question.innerHTML).toContain("/workspace/cases/work-capsule%3AWC-CLOSE");
  });

  it("shows the five triage counts as filter links", async () => {
    const { document } = await render();
    const counts = [...document.querySelectorAll("[data-atlas-count]")];
    expect(counts.map((count) => count.getAttribute("data-atlas-count"))).toEqual(["needs-person", "stuck", "working", "waiting", "no-signal"]);
    expect(counts[1]!.getAttribute("href")).toBe("/ops/workrooms?state=stuck");
    expect(counts[1]!.textContent).toContain("1");
  });

  it("draws one cell per room, grouped by portfolio then shape, with unplaced rooms last", async () => {
    const { document } = await render();
    expect([...document.querySelectorAll("[data-atlas-portfolio]")].map((node) => node.getAttribute("data-atlas-portfolio")))
      .toEqual(["manufactureAndDeliver", "forEmployees", "unplaced"]);
    expect(document.querySelectorAll("[data-atlas-cell]")).toHaveLength(4);
    expect(document.querySelector("[data-atlas-portfolio=unplaced]")!.textContent).toContain("Unshaped");
    expect(document.querySelector('[data-atlas-cell="WC-NOWHERE"]')!.getAttribute("aria-label")).toBe("Unplaced work: No recent signal");
  });

  it("expands a group into rows from the URL, with the hold's cause on a held room", async () => {
    const closed = await render();
    expect(closed.document.querySelectorAll("[data-atlas-row]")).toHaveLength(0);
    const { document } = await render({ group: "manufactureAndDeliver/delivery-small" });
    const rows = [...document.querySelectorAll("[data-atlas-row]")];
    expect(rows.map((row) => row.getAttribute("data-atlas-row"))).toEqual(["WC-HELD", "WC-CLOSE"]);
    expect(rows[0]!.textContent).toContain("conformance pause, missing explicit coordinator");
    expect(rows[1]!.textContent).toContain("Ready for closeout");
  });

  it("dims rooms outside the selected state and narrows by portfolio", async () => {
    const { document } = await render({ state: "stuck", portfolio: "manufactureAndDeliver" });
    expect(document.querySelectorAll("[data-atlas-portfolio]")).toHaveLength(1);
    expect(document.querySelector('[data-atlas-cell="WC-CLOSE"]')!.parentElement!.className).toContain("opacity-25");
    expect(document.querySelector('[data-atlas-cell="WC-HELD"]')!.parentElement!.className ?? "").not.toContain("opacity-25");
  });

  it("no longer renders the retired lead band, inventory, held section or activity tree", async () => {
    const { html } = await render();
    expect(html).not.toContain("data-dpf-lead");
    expect(html).not.toContain("Shared recovery issues");
    expect(html).not.toContain("Activity by portfolio");
    // The old in-page anchor still lands on the map.
    expect(html).toContain('id="live-workrooms-heading"');
  });

  it("keeps the Day-to-day operations band (BI-D8A6F0F2)", async () => {
    const { html } = await render();
    expect(html).toContain("Day-to-day operations");
    expect(html).toContain("Last 14 days for Payables watch");
  });
});
