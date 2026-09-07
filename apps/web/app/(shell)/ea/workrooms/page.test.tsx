import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { measureUxBudget } from "@/lib/ux-budget/measure";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/ea/workrooms" }));
vi.mock("@/lib/ea/workroom-architecture", () => ({
  loadWorkroomCoordination: vi.fn(async () => ({ readAt: "2026-09-06T12:00:00.000Z", truncated: true, rooms: [
    { roomId: "WC-REVIEW", title: "Review change", status: "blocked", teamId: null, assignedActorRef: null, parentItemId: null, href: "/workspace/cases/work-capsule%3AWC-REVIEW?operation=unmapped" },
  ] })),
  loadWorkroomArchitecture: vi.fn(async () => ({
    bands: [
      { role: "foundational", label: "Foundational", definitions: [] },
      { role: "manufactureAndDeliver", label: "Manufacture and Deliver", definitions: [] },
      { role: "forEmployees", label: "For Employees", definitions: [] },
      { role: "productsAndServicesSold", label: "Products and Services Sold", definitions: [] },
    ],
    unplaced: [
      {
        id: "team-unplaced", name: "Mystery stream", valueStream: "vs", shape: "specialist-dispatch",
        coordinationPattern: {}, isActive: true, participants: [], triggers: [], queues: [],
        instanceCount: 0, eaProcessId: null, eaViewId: null,
        placement: { role: null, source: "unresolved", reason: 'Portfolio "mystery-stream" matches no canonical portfolio role.' },
      },
    ],
    truncated: true,
    observed: 1,
  })),
}));

import WorkroomArchitecturePage from "./page";

describe("WorkroomArchitecturePage", () => {
  it("restores the selected operation and opens its coordination view", async () => {
    const html = renderToStaticMarkup(await WorkroomArchitecturePage({ searchParams: Promise.resolve({ operation: "unmapped" }) }));
    expect(html).toContain("<details open=\"\">");
    expect(html).toContain("Review change");
  });
  it("connects architecture to an actual room without inventing placement or a total", async () => {
    const html = renderToStaticMarkup(await WorkroomArchitecturePage());
    expect(html).toContain('href="/workspace/cases/work-capsule%3AWC-REVIEW?operation=unmapped"');
    expect(html).toContain("No value stream linked");
    expect(html).toContain("More rooms exist");
    expect(html).toContain("blocked");
  });
  it("keeps the empty definition home within the high-school reading cap", async () => {
    const html = renderToStaticMarkup(await WorkroomArchitecturePage());

    expect(measureUxBudget(html).readingGradeLevel).toBeLessThanOrEqual(9);
  });
  it("shows unplaced work as a labelled exception outside the four portfolios", async () => {
    const html = renderToStaticMarkup(await WorkroomArchitecturePage());
    expect(html).toContain("Not placed in a portfolio");
    expect(html).toContain("Mystery stream");
    expect(html).toContain("matches no canonical portfolio role");
  });

  it("labels a truncated architecture read as partial rather than a total", async () => {
    const html = renderToStaticMarkup(await WorkroomArchitecturePage());
    expect(html).toContain("Partial read");
  });
});
