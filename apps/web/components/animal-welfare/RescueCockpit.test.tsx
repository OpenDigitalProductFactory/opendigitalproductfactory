// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";

import { sourceAvailable, sourceEmpty, sourceUnavailable } from "@/lib/animal-welfare/cockpit";
import { auditUxBudget, measureUxBudget } from "@/lib/ux-budget";
import { RescueCockpit } from "./RescueCockpit";

afterEach(() => cleanup());

describe("RescueCockpit", () => {
  it("gives every rescue destination a non-scrolling 390px layout and explicit 44px target", () => {
    const asOf = "2026-09-04T12:00:00.000Z";
    const html = renderToStaticMarkup(<RescueCockpit data={{
      attention: [],
      queue: null,
      presentation: { asOf, currency: "USD", locale: "en-US", timeZone: "America/Chicago" },
      sources: {
        animals: sourceEmpty({ inCare: 0, intakeReview: 0, legalHold: 0, placementReady: 0 }, asOf),
        capacity: sourceEmpty({ free: 0, blocked: 0 }, asOf),
        care: sourceEmpty({ dueToday: 0, missed: 0, exceptions: 0 }, asOf),
        adoptions: sourceEmpty({ activeApplications: 0, readyWithoutInterest: 0 }, asOf),
        stewardship: sourceEmpty({ restrictedFunds: 0, postedAnimalCost: 0 }, asOf),
      },
    }} />);

    const navigation = html.match(/<nav aria-label="Rescue operations"[^>]*>[\s\S]*?<\/nav>/)?.[0];
    expect(navigation).toBeDefined();
    expect(navigation).toContain("grid-cols-3");
    expect(navigation).toContain("sm:flex");
    expect(navigation).not.toContain("overflow-x-auto");
    const links = [...navigation!.matchAll(/<a\b[^>]*>/g)].map(([tag]) => tag);
    expect(links).toHaveLength(7);
    for (const link of links) {
      expect(link).toContain("dpf-tap-target");
      expect(link).toContain("min-h-11");
    }
  });

  it("holds the measured detail-shell budget with no detectable accessibility violations", async () => {
    const asOf = "2026-09-04T12:00:00.000Z";
    const { container } = render(<RescueCockpit data={{
      attention: [],
      queue: null,
      presentation: { asOf, currency: "USD", locale: "en-US", timeZone: "America/Chicago" },
      sources: {
        animals: sourceAvailable({ inCare: 6, intakeReview: 1, legalHold: 1, placementReady: 2 }, asOf),
        capacity: sourceEmpty({ free: 0, blocked: 0 }, asOf),
        care: sourceAvailable({ dueToday: 4, missed: 1, exceptions: 0 }, asOf),
        adoptions: sourceAvailable({ activeApplications: 2, readyWithoutInterest: 1 }, asOf),
        stewardship: sourceAvailable({ restrictedFunds: 1, postedAnimalCost: 220 }, asOf),
      },
    }} />);

    const metrics = measureUxBudget(container.innerHTML);
    const blocking = auditUxBudget(container.innerHTML, "detail", { routeStatus: "net-new" })
      .findings.filter((finding) => !finding.ok && finding.severity === "blocking");
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);

    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
    console.log(`[ux-budget rescue-cockpit] ${JSON.stringify({
      ...metrics,
      axeViolations: results.violations.length,
    })}`);
  });

  it.each([
    ["overview", "/workspace/rescue/intake"],
    ["animals", "/workspace/ward"],
    ["intake", "/workspace/ward"],
    ["care", "/workspace/rescue/care?filter=missed"],
    ["adoptions", "/workspace/rescue/adoptions?filter=no-interest"],
    ["stewardship", "/finance"],
  ] as const)("keeps a truthful owner-first next action on the %s route when no exception is active", (area, href) => {
    const asOf = "2026-09-04T12:00:00.000Z";
    const html = renderToStaticMarkup(<RescueCockpit
      area={area}
      data={{
        attention: [],
        presentation: { asOf, currency: "USD", locale: "en-US", timeZone: "America/Chicago" },
        queue: null,
        sources: {
          animals: sourceEmpty({ inCare: 0, intakeReview: 0, legalHold: 0, placementReady: 0 }, asOf),
          capacity: sourceEmpty({ free: 0, blocked: 0 }, asOf),
          care: sourceEmpty({ dueToday: 0, missed: 0, exceptions: 0 }, asOf),
          adoptions: sourceEmpty({ activeApplications: 0, readyWithoutInterest: 0 }, asOf),
          stewardship: sourceEmpty({ restrictedFunds: 0, postedAnimalCost: 0 }, asOf),
        },
      }}
    />);

    expect(html).toContain("data-owner-first-next-action");
    expect(html).toContain(`href="${href.replaceAll("&", "&amp;")}"`);
  });

  it("names the three rescue value streams and never hides unavailable sources as zero", () => {
    const html = renderToStaticMarkup(<RescueCockpit data={{
      attention: [],
      queue: null,
      presentation: {
        asOf: "2026-09-04T12:00:00.000Z",
        currency: "GBP",
        locale: "en-GB",
        timeZone: "Europe/London",
      },
      sources: {
        animals: sourceAvailable({ inCare: 4, intakeReview: 1, legalHold: 0, placementReady: 2 }),
        capacity: sourceEmpty({ free: 0, blocked: 0 }),
        care: sourceUnavailable("care source offline"),
        adoptions: sourceAvailable({ activeApplications: 3, readyWithoutInterest: 1 }),
        stewardship: sourceAvailable({ restrictedFunds: 1, postedAnimalCost: 220 }),
      },
    }} />);
    expect(html).toContain("Intake and protect");
    expect(html).toContain("Maintain health and welfare");
    expect(html).toContain("Place and support");
    expect(html).toContain("Unavailable");
    expect(html).toContain("No records yet");
    expect(html).toContain("£220");
    expect(html).toContain("As of");
  });

  it("shows a validated drill-in filter and bounded factual rows without pretending they have detail routes", () => {
    const asOf = "2026-09-04T12:00:00.000Z";
    const html = renderToStaticMarkup(<RescueCockpit
      area="care"
      filter="missed"
      data={{
        attention: [],
        presentation: { asOf, currency: "USD", locale: "en-US", timeZone: "America/Chicago" },
        queue: sourceAvailable({
          title: "Missed care work",
          description: "Showing up to 25 dated animal work items.",
          limit: 25,
          action: null,
          rows: [{
            id: "work-1",
            reference: "ANIMAL-001",
            primary: "Give morning medication",
            detail: "ANIMAL-001",
            status: "in-progress",
            occurredAt: "2026-09-04T11:00:00.000Z",
          }],
        }, asOf),
        sources: {
          animals: sourceAvailable({ inCare: 1, intakeReview: 0, legalHold: 0, placementReady: 0 }, asOf),
          capacity: sourceAvailable({ free: 1, blocked: 0 }, asOf),
          care: sourceAvailable({ dueToday: 0, missed: 1, exceptions: 0 }, asOf),
          adoptions: sourceEmpty({ activeApplications: 0, readyWithoutInterest: 0 }, asOf),
          stewardship: sourceUnavailable("Finance access is required.", asOf),
        },
      }}
    />);

    expect(html).toContain("Missed care work");
    expect(html).toContain("Give morning medication");
    expect(html).toContain("Showing up to 25");
    expect(html).toContain('href="/workspace/rescue/care?filter=missed"');
    expect(html).not.toContain('href="/workspace/rescue/care/work-1"');
  });
});
