import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The next/link mock MUST forward ...rest so the data-owner-first-next-action
// attribute survives to the rendered markup — the UX audit keys off it.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

import { OwnerFirstSummaryBand } from "./OwnerFirstSummary";
import {
  buildCustomerOwnerSummary,
  buildEmployeeOwnerSummary,
  buildFinanceOwnerSummary,
} from "@/lib/owner-first/domain-summary";
import { resolveOwnerVocabulary } from "@/lib/owner-first/vocabulary";
import { auditOwnerFirst, countWords } from "@/lib/owner-first/ux-audit";

const restaurant = resolveOwnerVocabulary("food-hospitality");

const customer = buildCustomerOwnerSummary(
  {
    pendingReservations: 3,
    pendingOrders: 1,
    newInquiries: 2,
    unworkedEngagements: 2,
    overdueInvoices: 1,
    renewalsDueSoon: 0,
  },
  restaurant,
);
const finance = buildFinanceOwnerSummary(
  {
    billsDue: 2,
    overdueInvoices: 1,
    pendingExpenses: 1,
    oldestOverdueName: "Ada Bistro",
    currencySymbol: "£",
    moneyOwedToYou: 4200,
  },
  restaurant,
);
const employee = buildEmployeeOwnerSummary(
  { submittedTimesheets: 2, teamSize: 8, unassignedRoles: 1 },
  restaurant,
);

describe("OwnerFirstSummaryBand — rendered UX checks", () => {
  for (const [name, summary] of [
    ["customer", customer],
    ["finance", finance],
    ["employee", employee],
  ] as const) {
    it(`renders an owner-first ${name} band that passes every UX check`, () => {
      const html = renderToStaticMarkup(
        <OwnerFirstSummaryBand summary={summary} density="full" />,
      );
      const { ok, findings } = auditOwnerFirst(html);
      const failed = findings.filter((f) => !f.ok);
      expect(failed, JSON.stringify(failed)).toHaveLength(0);
      expect(ok).toBe(true);
    });
  }

  it("stamps an owner-first next action and uses no generic decision labels", () => {
    const html = renderToStaticMarkup(
      <OwnerFirstSummaryBand summary={customer} density="full" />,
    );
    expect(html).toContain("data-owner-first-next-action");
    expect(html).not.toContain("Make this business decision?");
    expect(html).not.toContain("Technical detail");
  });

  it("Simple mode reduces the body content of the band", () => {
    const full = renderToStaticMarkup(
      <OwnerFirstSummaryBand summary={customer} density="full" />,
    );
    const simple = renderToStaticMarkup(
      <OwnerFirstSummaryBand summary={customer} density="simple" />,
    );
    // Simple mode drops the subhead and each per-action "why" line.
    expect(countWords(simple)).toBeLessThan(countWords(full));
    // But the actionable controls remain.
    expect(simple).toContain("data-owner-first-next-action");
  });
});
