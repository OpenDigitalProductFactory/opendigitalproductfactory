// @vitest-environment jsdom
//
// BI-87C9C91C: the interactive save-state suite this file used to carry is gone
// with the control it exercised. Proactivity is owned by the outcome-specific
// Workroom, so this surface reports and does not write — and the load-bearing
// assertion is now that no control is offered here at all.

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";


import { ProactivityRosterList } from "./ProactivityRosterList";
import type { ProactivityRosterRow } from "@/lib/proactivity/proactivity-roster";
import type { OwnerFacingArea } from "@/lib/coworker-record/owner-areas";

const CUSTOMERS: OwnerFacingArea = {
  key: "products_and_services_sold",
  label: "Customers and sales",
  order: 1,
};
const PLATFORM: OwnerFacingArea = {
  key: "foundational",
  label: "Platform and back office",
  order: 4,
};

const rows: ProactivityRosterRow[] = [
  {
    agentId: "coo",
    displayName: "Chief Operating Officer",
    role: "orchestrator",
    level: "balanced",
    isOverride: false,
    explanation: "Derived from the business risk posture.",
    area: PLATFORM,
  },
  {
    agentId: "bookkeeper",
    displayName: "Bookkeeper",
    role: "analyst",
    level: "assertive",
    isOverride: true,
    explanation: "Owner override.",
    area: CUSTOMERS,
  },
];

afterEach(cleanup);


describe("ProactivityRosterList", () => {
  it("renders the coworkers grouped under their business-area headings", () => {
    render(<ProactivityRosterList rows={rows} />);
    expect(screen.getByText("Customers and sales")).toBeTruthy();
    expect(screen.getByText("Platform and back office")).toBeTruthy();
    expect(screen.getByText("Chief Operating Officer")).toBeTruthy();
    expect(screen.getByText("Bookkeeper")).toBeTruthy();
  });

  it("shows an empty message when there are no coworkers", () => {
    render(<ProactivityRosterList rows={[]} />);
    expect(screen.getByText(/No coworkers yet/i)).toBeTruthy();
  });

  it("states each coworker's level as a plain read-only label", () => {
    render(<ProactivityRosterList rows={rows} />);
    // The levels in the fixture are balanced and assertive.
    expect(screen.getAllByText(/Balanced|Assertive/i).length).toBeGreaterThan(0);
  });

  // BI-87C9C91C — proactivity is owned by the outcome-specific Workroom. This
  // roster reports; it must not offer to set a level on a coworker. Asserted as
  // an ABSENCE because the defect is a control reappearing on this surface.
  it("offers no control to change a coworker's proactivity", () => {
    render(<ProactivityRosterList rows={rows} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByText(/You set this/i)).toBeNull();
  });
});
