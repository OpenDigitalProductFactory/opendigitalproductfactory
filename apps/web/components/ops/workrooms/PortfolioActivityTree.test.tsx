import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PortfolioActivityTree, ActivitySymbol, type BranchRowView } from "./PortfolioActivityTree";
import {
  projectPortfolioActivityPage,
  type BranchRow,
  type RoomActivityInput,
} from "@/lib/work-management/portfolio-activity-projection";

const NOW = new Date("2026-09-07T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function room(over: Partial<RoomActivityInput> & { roomId: string }): RoomActivityInput {
  return {
    title: `Room ${over.roomId}`,
    portfolioRole: "forEmployees",
    branchId: "finance",
    href: `/workspace/cases/${over.roomId}`,
    status: "working",
    latestAction: null,
    blocker: null,
    evidenceAt: null,
    ...over,
  };
}

const label = (id: string) => (id === "finance" ? "Finance" : id);

/** Rows arrive from the server with their label already resolved. */
const withLabels = (rows: readonly BranchRow[]): BranchRowView[] =>
  rows.map((row) => ({ ...row, label: label(row.branchId) }));

describe("PortfolioActivityTree", () => {
  const page = projectPortfolioActivityPage({
    rooms: [
      room({ roomId: "r-run", latestAction: "Checking invoice matching", evidenceAt: ago(1_000) }),
      room({ roomId: "r-block", blocker: "Waiting for release review" }),
      room({ roomId: "r-done", verifiedComplete: true }),
    ],
    now: NOW,
  });

  it("states concrete actions and blockers rather than counts alone", () => {
    const html = renderToStaticMarkup(
      <PortfolioActivityTree rows={withLabels(page.rows)} partial={page.partial} />,
    );
    expect(html).toContain("blocked: Waiting for release review");
    expect(html).toContain("Checking invoice matching");
    // The count is present, but as a supplement beside the statements.
    expect(html).toContain("3 rooms");
    expect(html).toContain("1 need attention");
  });

  it("gives every representative activity a one-click destination", () => {
    const html = renderToStaticMarkup(
      <PortfolioActivityTree rows={withLabels(page.rows)} partial={page.partial} />,
    );
    expect(html).toContain('href="/workspace/cases/r-block"');
    expect(html).toContain('href="/workspace/cases/r-run"');
  });

  it("labels every symbol accessibly so colour and motion never carry meaning alone", () => {
    const html = renderToStaticMarkup(
      <PortfolioActivityTree rows={withLabels(page.rows)} partial={page.partial} />,
    );
    expect(html).toContain('aria-label="Blocked"');
    expect(html).toContain('aria-label="Working now"');
    expect(html).toContain('aria-label="Verified complete"');
  });

  it("animates only the executing state, and stills it under reduced motion", () => {
    const running = renderToStaticMarkup(<ActivitySymbol state="executing" label="Working now" />);
    expect(running).toContain("animate-pulse");
    expect(running).toContain("motion-reduce:animate-none");
    for (const state of ["stale", "unknown", "blocked", "completed", "queued", "waiting-on-person"] as const) {
      expect(renderToStaticMarkup(<ActivitySymbol state={state} label="x" />)).not.toContain("animate-pulse");
    }
  });

  it("starts collapsed, with the branch expandable independently of selection", () => {
    const html = renderToStaticMarkup(
      <PortfolioActivityTree rows={withLabels(page.rows)} partial={page.partial} />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Expand Finance");
    // Representative activity is visible while collapsed: the operator does not
    // have to expand to learn what is happening.
    expect(html).toContain("Checking invoice matching");
  });

  it("marks the selected room without collapsing or reordering the tree", () => {
    const html = renderToStaticMarkup(
      <PortfolioActivityTree rows={withLabels(page.rows)} partial={page.partial} selectedRoomId="r-run" />,
    );
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('aria-expanded="false"');
    const order = ["blocked: Waiting for release review", "Checking invoice matching"];
    expect(html.indexOf(order[0]!)).toBeLessThan(html.indexOf(order[1]!));
  });

  it("labels a partial read instead of presenting it as everything", () => {
    const many = Array.from({ length: 60 }, (_, i) => room({ roomId: `r-${i}`, branchId: `b-${String(i).padStart(3, "0")}` }));
    const paged = projectPortfolioActivityPage({ rooms: many, now: NOW, pageSize: 50 });
    const html = renderToStaticMarkup(
      <PortfolioActivityTree rows={withLabels(paged.rows)} partial={paged.partial} />,
    );
    expect(html).toContain("Partial read");
  });

  it("says so plainly when there is nothing to show", () => {
    const html = renderToStaticMarkup(
      <PortfolioActivityTree rows={[]} partial={false} />,
    );
    expect(html).toContain("No activity to show.");
  });

  it("stays compact with 1,000 rooms: branch rows, not a row per room", () => {
    const many = Array.from({ length: 1_000 }, (_, i) => room({
      roomId: `r-${String(i).padStart(4, "0")}`,
      branchId: `b-${String(i % 40).padStart(3, "0")}`,
      latestAction: `Agent ${i % 100} step ${i}`,
      evidenceAt: ago(i * 1_000),
    }));
    const paged = projectPortfolioActivityPage({ rooms: many, now: NOW, pageSize: 50 });
    const html = renderToStaticMarkup(
      <PortfolioActivityTree rows={withLabels(paged.rows)} partial={paged.partial} />,
    );
    // 40 branches, at most 3 statements each: never 1,000 links.
    const links = html.split("/workspace/cases/").length - 1;
    expect(links).toBeLessThanOrEqual(120);
    expect(paged.observedRooms).toBe(1_000);
  });
  it("takes only serializable props, so it can cross the server/client boundary", () => {
    // Regression guard. This is a "use client" component rendered from a Server
    // Component, so a function prop (a label formatter, a click handler) cannot
    // be passed: React refuses to serialize it and the surrounding page loses
    // content at runtime. Unit tests that call the component directly do NOT
    // exercise that boundary, which is exactly how it shipped once.
    const props = { rows: withLabels(page.rows), partial: page.partial, selectedRoomId: null };
    for (const [key, value] of Object.entries(props)) {
      expect(typeof value, `prop "${key}" must be serializable`).not.toBe("function");
    }
    expect(() => JSON.stringify(props)).not.toThrow();
  });
});

describe("expansion actually discloses (BI-8DACBA07 scale verification)", () => {
  // Caught by rendering /ops/workrooms against 1,001 rooms: the chevron flipped
  // `aria-expanded` and its own glyph while the list below it never changed.
  // A disclosure control that discloses nothing is the defect this pins.
  const page = projectPortfolioActivityPage({
    rooms: Array.from({ length: 40 }, (_, i) =>
      room({ roomId: `r-${String(i).padStart(3, "0")}`, branchId: "finance" }),
    ),
    now: NOW,
  });
  const branch = page.rows[0]!;

  it("carries more rooms to disclose than the collapsed summary shows", () => {
    expect(branch.representative.length).toBe(3);
    expect(branch.disclosed.length).toBeGreaterThan(branch.representative.length);
  });

  it("bounds an expanded branch instead of emptying every room into the page", () => {
    expect(branch.disclosed.length).toBe(25);
    expect(branch.disclosedTruncated).toBe(true);
    expect(branch.undisclosedCount).toBe(15);
    expect(branch.disclosed.length + branch.undisclosedCount).toBe(branch.roomCount);
  });

  it("opens on the representative rooms it was already summarising", () => {
    // Opening a branch must not reshuffle what the operator was just reading.
    expect(branch.disclosed.slice(0, 3).map((a) => a.roomId)).toEqual(
      branch.representative.map((a) => a.roomId),
    );
  });

  it("renders the collapsed summary, not the disclosed set, before any click", () => {
    const html = renderToStaticMarkup(
      <PortfolioActivityTree rows={withLabels(page.rows)} partial={page.partial} />,
    );
    const links = html.match(/\/workspace\/cases\//g) ?? [];
    expect(links.length).toBe(3);
    expect(html).toContain('aria-expanded="false"');
  });
});

describe("statements and counts stay truthful at scale (BI-8DACBA07)", () => {
  it("names the room in a blocker line so identical blockers stay distinguishable", () => {
    // At 1,001 rooms several rooms shared one generic liveness reason and
    // rendered as three identical "Blocked: ..." lines.
    const page = projectPortfolioActivityPage({
      rooms: [
        room({ roomId: "r-a", title: "Payroll run", blocker: "Synced 12m ago." }),
        room({ roomId: "r-b", title: "Invoice sync", blocker: "Synced 12m ago." }),
      ],
      now: NOW,
    });
    const statements = page.rows[0]!.representative.map((a) => a.statement);
    expect(new Set(statements).size).toBe(statements.length);
    expect(statements.some((s) => s.includes("Payroll run"))).toBe(true);
    expect(statements.some((s) => s.includes("Invoice sync"))).toBe(true);
  });

  it("marks counts as read-scoped when the room read was bounded", () => {
    const page = projectPortfolioActivityPage({
      rooms: [room({ roomId: "r-1" }), room({ roomId: "r-2" })],
      now: NOW,
    });
    const bounded = renderToStaticMarkup(
      <PortfolioActivityTree rows={withLabels(page.rows)} partial={false} roomReadBounded />,
    );
    expect(bounded).toContain("2 rooms read");
    expect(bounded).toContain("not every Workroom in");

    const complete = renderToStaticMarkup(
      <PortfolioActivityTree rows={withLabels(page.rows)} partial={false} />,
    );
    expect(complete).toContain("2 rooms");
    expect(complete).not.toContain("2 rooms read");
    expect(complete).not.toContain("not every Workroom in");
  });
});
