import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { JourneyHealthCard } from "./JourneyHealthCard";
import type { JourneyHealthRow } from "@/lib/business-journeys/journey-health";

function row(overrides: Partial<JourneyHealthRow> = {}): JourneyHealthRow {
  return {
    journeyId: "storefront-booking",
    outcome: "Customers can book a time with you",
    businessImpact: "Customers cannot reserve a slot.",
    revenueBearing: true,
    status: "passed",
    achievedDepth: "reachability",
    checkedSentence: "Checked: the page opens.",
    notCheckedSentence:
      "Not checked: the setup is complete; a real record can be saved; a customer doing this in a browser.",
    steps: [
      {
        stepId: "booking-page-loads",
        label: "The booking page opens",
        depth: "reachability",
        outcome: "passed",
        detail: "Responded 200.",
        durationMs: 12,
      },
    ],
    durationMs: 12,
    ...overrides,
  };
}

describe("JourneyHealthCard — the honesty rules must survive into the DOM", () => {
  it("shows the unchecked line OUTSIDE the technical-details boundary", () => {
    const html = renderToStaticMarkup(<JourneyHealthCard row={row()} />);
    const detailsStart = html.indexOf("<details");
    const uncheckedAt = html.indexOf("Not checked:");

    expect(uncheckedAt).toBeGreaterThan(-1);
    expect(detailsStart).toBeGreaterThan(-1);
    // A reader who never opens the disclosure must still see the limit.
    expect(uncheckedAt).toBeLessThan(detailsStart);
  });

  it("never labels a shallow pass 'healthy' or 'verified'", () => {
    const html = renderToStaticMarkup(<JourneyHealthCard row={row()} />);
    expect(html).toContain("Working");
    expect(html).not.toMatch(/healthy|fully verified/i);
  });

  it("puts step-level evidence behind the disclosure, not in the primary hierarchy", () => {
    const html = renderToStaticMarkup(
      <JourneyHealthCard
        row={row({
          status: "failed",
          achievedDepth: null,
          checkedSentence: null,
          steps: [
            {
              stepId: "booking-page-loads",
              label: "The booking page opens",
              depth: "reachability",
              outcome: "failed",
              detail: "The page a customer would open returned 503.",
              expected: "a status below 400",
              actual: "503 Service Unavailable",
              durationMs: 30,
            },
          ],
        })}
      />,
    );

    const detailsStart = html.indexOf("<details");
    expect(html.indexOf("503 Service Unavailable")).toBeGreaterThan(detailsStart);
    // The business consequence stays in the primary hierarchy.
    expect(html.indexOf("Customers cannot reserve a slot.")).toBeLessThan(detailsStart);
  });

  it("explains a not-applicable journey instead of showing it as a problem", () => {
    const html = renderToStaticMarkup(
      <JourneyHealthCard
        row={row({
          status: "not-applicable",
          achievedDepth: null,
          checkedSentence: null,
          notCheckedSentence: null,
          notApplicableReason: "This install has no bookable service.",
          steps: [],
        })}
      />,
    );

    expect(html).toContain("Not set up");
    expect(html).toContain("This install has no bookable service.");
    expect(html).not.toContain("Not checked:");
    // Nothing to disclose when nothing ran.
    expect(html).not.toContain("<details");
  });

  it("uses design tokens rather than hardcoded colors", () => {
    const html = renderToStaticMarkup(<JourneyHealthCard row={row()} />);
    expect(html).toContain("var(--dpf-");
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("marks the deep-linked journey so an attention link lands somewhere obvious", () => {
    const html = renderToStaticMarkup(<JourneyHealthCard row={row()} highlighted />);
    expect(html).toContain('id="storefront-booking"');
    expect(html).toContain('data-journey-id="storefront-booking"');
    expect(html).toContain("--dpf-accent");
  });
});
