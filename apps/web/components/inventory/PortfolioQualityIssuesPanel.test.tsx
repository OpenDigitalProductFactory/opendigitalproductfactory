// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PortfolioQualityIssuesPanel } from "./PortfolioQualityIssuesPanel";

type PanelIssue = Parameters<typeof PortfolioQualityIssuesPanel>[0]["issues"][number];

function issue(id: string, issueType: string, severity = "warn"): PanelIssue {
  return {
    id,
    issueType,
    severity,
    summary: `summary for ${id}`,
    inventoryEntity: null,
    portfolio: null,
    taxonomyNode: null,
    digitalProduct: null,
  };
}

describe("PortfolioQualityIssuesPanel", () => {
  afterEach(() => {
    cleanup();
  });

  // A discovery queue is unbounded by nature — one row per unenriched device.
  // Rendering it flat produced a page on which the handful of operator-actionable
  // rows were unfindable among hundreds of identical cards.
  it("previews only the first few cards of a large queue while stating its true size", () => {
    const issues = Array.from({ length: 12 }, (_, index) =>
      issue(`qi-${index}`, "catalog_match_ambiguous"),
    );

    render(<PortfolioQualityIssuesPanel issues={issues} />);

    expect(screen.getAllByText(/^summary for qi-/)).toHaveLength(5);
    // Containment must never disguise the queue's size: the panel total and the
    // per-group count both stay visible, and the toggle names the full count.
    expect(screen.getByText("12 open")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show all 12" })).toBeTruthy();
  });

  it("expands a group on demand and collapses it again", () => {
    const issues = Array.from({ length: 8 }, (_, index) =>
      issue(`qi-${index}`, "lifecycle_unverified"),
    );

    render(<PortfolioQualityIssuesPanel issues={issues} />);
    expect(screen.getAllByText(/^summary for qi-/)).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "Show all 8" }));
    expect(screen.getAllByText(/^summary for qi-/)).toHaveLength(8);

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.getAllByText(/^summary for qi-/)).toHaveLength(5);
  });

  it("groups by issue type and preserves the server's severity-first ordering", () => {
    // The server sorts severity desc, so the first group must stay first —
    // re-sorting by count would bury a single `error` behind a large `warn` queue.
    const issues = [
      issue("err-1", "journey_failure", "error"),
      ...Array.from({ length: 6 }, (_, index) =>
        issue(`warn-${index}`, "lifecycle_unverified"),
      ),
    ];

    render(<PortfolioQualityIssuesPanel issues={issues} />);

    const headings = screen
      .getAllByText(/journey_failure|lifecycle_unverified/)
      .map((node) => node.textContent ?? "");
    expect(headings[0]).toContain("journey_failure");

    // A group under the preview threshold gets no toggle at all.
    expect(screen.queryByRole("button", { name: /Show all 1$/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Show all 6" })).toBeTruthy();
  });

  it("renders the empty state when there is nothing open", () => {
    render(<PortfolioQualityIssuesPanel issues={[]} />);
    expect(screen.getByText("No open portfolio quality issues from discovery.")).toBeTruthy();
  });
});
