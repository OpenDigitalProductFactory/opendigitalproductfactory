// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { loadInitiativeOperation, loadWorkroomCoordination, loadWorkroomInitiatives } from "@/lib/ea/workroom-architecture";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { measureUxBudget } from "@/lib/ux-budget/measure";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/ea/workrooms" }));
vi.mock("@/lib/ea/workroom-architecture", () => ({
  loadWorkroomInitiatives: vi.fn(async () => ({ readAt: "2026-09-22T00:00:00Z", partial: false, truncated: false, unresolvedRooms: 0,
    initiatives: [{ id: "EP-ONE", title: "Reliable delivery", description: "Work continues without a connected client.", scopeKind: "platform",
      operation: "initiative:EP-ONE", storedRefs: ["EP-ONE", "epic-row"], openRooms: 5 }] })),
  loadInitiativeOperation: vi.fn(async () => ({ id: "EP-ONE", title: "Reliable delivery", storedRefs: ["EP-ONE", "epic-row"] })),
  // The install this page was reported against: hundreds of rooms, no team
  // plans, most rooms with no recorded placement (BI-0EB855CC).
  loadRoomInventory: vi.fn(async () => ({
    openTotal: 451,
    unclassified: 367,
    byRole: { foundational: 71, manufactureAndDeliver: 13, forEmployees: 0, productsAndServicesSold: 0 },
  })),
  loadWorkroomCoordination: vi.fn(async () => ({ readAt: "2026-09-06T12:00:00.000Z", truncated: true, contextPartial: true, nextCursor: "WC-REVIEW", rooms: [
    { roomId: "WC-REVIEW", title: "Review change", status: "blocked", teamId: null, assignedActorRef: null, parentItemId: null, accountability: null, accountableName: null, relationships: [], href: "/workspace/cases/work-capsule%3AWC-REVIEW?operation=unmapped" },
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
  it("offers initiative context and passes both persisted identities to coordination", async () => {
    render(await WorkroomArchitecturePage({ searchParams: Promise.resolve({ operation: "initiative:EP-ONE", coordinationQuery: "Recovery" }) }));
    expect(screen.getByRole("combobox", { name: "Operation" })).toHaveValue("initiative:EP-ONE");
    expect(screen.getByRole("link", { name: "Reliable delivery" })).toHaveAttribute("href", "/ea/workrooms?operation=initiative%3AEP-ONE#coordination");
    expect(vi.mocked(loadWorkroomCoordination)).toHaveBeenCalledWith({}, expect.any(Date), expect.objectContaining({
      initiative: { id: "EP-ONE", storedRefs: ["EP-ONE", "epic-row"] }, query: "Recovery",
    }));
  });
  it("keeps unavailable initiative selection explicit and does not broaden the room filter", async () => {
    vi.mocked(loadInitiativeOperation).mockResolvedValueOnce(null);
    render(await WorkroomArchitecturePage({ searchParams: Promise.resolve({ operation: "initiative:EP-MISSING" }) }));
    expect(screen.getByText(/selected initiative could not be resolved/)).toBeInTheDocument();
    expect(vi.mocked(loadWorkroomCoordination)).toHaveBeenCalledWith({}, expect.any(Date), expect.objectContaining({
      initiative: { id: "EP-MISSING", storedRefs: [] },
    }));
  });
  it("resolves a selected initiative outside the inventory page", async () => {
    vi.mocked(loadInitiativeOperation).mockResolvedValueOnce({ id: "EP-LATE", title: "Rescue intake", storedRefs: ["EP-LATE", "late-row"] });
    vi.mocked(loadWorkroomCoordination).mockResolvedValueOnce({ rooms: [{ roomId: "WC-LATE", title: "Intake review", status: "ready", waitReason: null, teamId: null, initiativeRef: "late-row", assignedActorRef: null, parentItemId: null, accountability: null, accountableName: null, relationships: [], href: "/workspace/cases/work-capsule%3AWC-LATE?operation=initiative%3AEP-LATE" }], nextCursor: null, truncated: false, contextPartial: false, readAt: "2026-09-22T00:00:00Z" });
    render(await WorkroomArchitecturePage({ searchParams: Promise.resolve({ operation: "initiative:EP-LATE" }) }));
    expect(screen.getByRole("combobox", { name: "Operation" })).toHaveValue("initiative:EP-LATE");
    expect(screen.getByText("Rescue intake")).toBeInTheDocument();
    expect(vi.mocked(loadWorkroomCoordination)).toHaveBeenCalledWith({}, expect.any(Date), expect.objectContaining({ initiative: { id: "EP-LATE", storedRefs: ["EP-LATE", "late-row"] } }));
  });
  it("restores the selected operation and opens its coordination view", async () => {
    const html = renderToStaticMarkup(await WorkroomArchitecturePage({ searchParams: Promise.resolve({ operation: "unmapped" }) }));
    expect(html).toContain("<details open=\"\">");
    expect(html).toContain("Review change");
  });
  it("connects architecture to an actual room without inventing placement or a total", async () => {
    const html = renderToStaticMarkup(await WorkroomArchitecturePage());
    expect(html).toContain('href="/workspace/cases/work-capsule%3AWC-REVIEW?operation=unmapped"');
    expect(html).toContain("No value stream linked");
    expect(html).toContain("Next rooms");
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

  // The page used to lead with "No Workroom plans are set yet" and stat cards of
  // zero while hundreds of rooms were open, so an owner read "we have no rooms".
  // It must lead with what exists, report the unclassified rather than default
  // them, and never instruct an action the product cannot perform.
  it("leads with the rooms that exist, not a plan count nothing can create", async () => {
    const html = renderToStaticMarkup(await WorkroomArchitecturePage());
    expect(html).toContain("451 rooms are open.");
    expect(html).toContain("367 of them have no portfolio recorded.");
    expect(html).toContain("No team plans are configured on this install.");
    expect(html).not.toContain("No Workroom plans are set yet");
    expect(html).not.toContain("Set up a value stream team");
  });
  it("counts each portfolio by its real rooms and never defaults an unplaced room into one", async () => {
    const html = renderToStaticMarkup(await WorkroomArchitecturePage());
    expect(html).toContain("71 open rooms");
    expect(html).toContain("13 open rooms");
    expect(html).toContain("No open rooms in For Employees");
    expect(html).toContain("Not configured on this install");
  });
  it("labels a truncated architecture read as partial rather than a total", async () => {
    const html = renderToStaticMarkup(await WorkroomArchitecturePage());
    expect(html).toContain("More plans exist");
  });
});

describe("Coordination discovery", () => {
  it("preserves initiative search when filtering rooms and room context when searching initiatives", async () => {
    render(await WorkroomArchitecturePage({ searchParams: Promise.resolve({ operation: "initiative:EP-ONE", initiativeQuery: "Reliable", coordinationQuery: "Recovery", coordinationStatus: "blocked" }) }));
    expect(vi.mocked(loadWorkroomInitiatives)).toHaveBeenCalledWith({}, expect.any(Date), "Reliable");
    expect(vi.mocked(loadWorkroomCoordination)).toHaveBeenCalledWith({}, expect.any(Date), expect.objectContaining({ initiativeQuery: "Reliable" }));
    const roomForm = screen.getByRole("searchbox", { name: "Search room title or ID" }).closest("form")!;
    expect(roomForm.querySelector('[name="initiativeQuery"]')).toHaveValue("Reliable");
    const initiativeForm = screen.getByRole("searchbox", { name: "Search initiative name or ID" }).closest("form")!;
    expect(initiativeForm.querySelector('[name="operation"]')).toHaveValue("initiative:EP-ONE");
    expect(initiativeForm.querySelector('[name="coordinationQuery"]')).toHaveValue("Recovery");
    expect(initiativeForm.querySelector('[name="coordinationStatus"]')).toHaveValue("blocked");
    expect(screen.getByRole("link", { name: "Reliable delivery" })).toHaveAttribute("href", "/ea/workrooms?operation=initiative%3AEP-ONE&initiativeQuery=Reliable#coordination");
  });
  it("keeps search, operation and status while paging, and resets the cursor on a new search", async () => {
    vi.mocked(loadWorkroomCoordination).mockResolvedValue({ rooms: [], nextCursor: "WC-199", truncated: true, contextPartial: false, readAt: "2026-09-21T06:00:00Z" });
    render(await WorkroomArchitecturePage({ searchParams: Promise.resolve({ operation: "unmapped", coordinationQuery: "review", coordinationStatus: "blocked", coordinationAfter: "WC-099" }) }));
    expect(vi.mocked(loadWorkroomCoordination)).toHaveBeenCalledWith({}, expect.any(Date), { teamId: null, query: "review", status: "blocked", after: "WC-099" });
    expect(screen.getByRole("searchbox", { name: "Search room title or ID" })).toHaveValue("review");
    expect(screen.getByRole("combobox", { name: "Room status" })).toHaveValue("blocked");
    expect(screen.getByRole("link", { name: "Next rooms" })).toHaveAttribute("href", "/ea/workrooms?operation=unmapped&coordinationQuery=review&coordinationStatus=blocked&coordinationAfter=WC-199#coordination");
    expect(screen.getByRole("link", { name: "First page" })).toHaveAttribute("href", "/ea/workrooms?operation=unmapped&coordinationQuery=review&coordinationStatus=blocked#coordination");
    expect(screen.getByRole("searchbox", { name: "Search room title or ID" }).closest("form")?.querySelector('[name="coordinationAfter"]')).toBeNull();
  });

  it("treats the all-operation return context as an unfiltered read and rejects array parameters", async () => {
    vi.mocked(loadWorkroomCoordination).mockResolvedValue({ rooms: [], nextCursor: null, truncated: false, contextPartial: false, readAt: "2026-09-21T06:00:00Z" });
    render(await WorkroomArchitecturePage({ searchParams: Promise.resolve({ operation: "all", coordinationQuery: ["one", "two"] }) }));
    expect(vi.mocked(loadWorkroomCoordination)).toHaveBeenCalledWith({}, expect.any(Date), { teamId: undefined, query: "", status: "", after: "" });
    expect(screen.queryByRole("link", { name: "Next rooms" })).not.toBeInTheDocument();
    expect(screen.getByText("No matching open rooms")).toBeInTheDocument();
  });
});
