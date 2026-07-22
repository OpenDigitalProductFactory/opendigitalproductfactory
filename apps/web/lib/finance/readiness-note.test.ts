import { describe, expect, it } from "vitest";
import { buildFinanceReadinessNotePrompt } from "./readiness-note";
import { resolveFinanceSurface, type FinanceMetricKey } from "./finance-surface";
import type { ReadinessMetricValue } from "./readiness-note";

const METRICS: Partial<Record<FinanceMetricKey, ReadinessMetricValue>> = {
  "outstanding-receivables": { value: "£1,250.00", hint: "3 invoices outstanding" },
  "money-in-month": { value: "£8,400.00", hint: "42 invoices paid this month" },
  "overdue-count": { value: "2", hint: "oldest: Bramley Wedding" },
  "supplier-bills-due": { value: "£640.00", hint: "5 bills awaiting payment" },
  "cash-position": { value: "£12,000.00", hint: "across 2 accounts" },
};

function promptFor(archetypeId: string, metrics = METRICS) {
  const surface = resolveFinanceSurface("food-hospitality", archetypeId);
  return buildFinanceReadinessNotePrompt({
    subtype: surface.subtype!,
    moneyJobs: surface.moneyJobs,
    metrics,
  });
}

describe("buildFinanceReadinessNotePrompt", () => {
  it("names the business in the owner's own terms", () => {
    expect(promptFor("restaurant")).toContain("my restaurant");
    expect(promptFor("catering")).toContain("my catering business");
    expect(promptFor("bakery")).toContain("my bakery");
  });

  it("grounds the note in the live figures on screen", () => {
    const prompt = promptFor("restaurant");
    expect(prompt).toContain("£1,250.00");
    expect(prompt).toContain("3 invoices outstanding");
    expect(prompt).toContain("£640.00");
    expect(prompt).toContain("Today's position:");
  });

  it("uses the subtype's money-job language", () => {
    expect(promptFor("catering")).toContain("Ingredient & staffing bills");
    expect(promptFor("bakery")).toContain("Custom order deposits & balances");
    expect(promptFor("restaurant")).toContain("Order & ticket payments");
  });

  it("forbids inventing numbers", () => {
    expect(promptFor("restaurant").toLowerCase()).toContain("do not invent numbers");
  });

  // The same honesty boundary the payment-run disclosure enforces: DPF is not
  // the payment rail, so a drafted note must not claim money moved.
  it("constrains the coworker to a draft and forbids claiming money moved", () => {
    const prompt = promptFor("catering").toLowerCase();
    expect(prompt).toContain("draft");
    expect(prompt).toContain("do not take any action");
    expect(prompt).toContain("not a bank transfer");
  });

  it("omits money jobs that have no live figure rather than inventing a placeholder", () => {
    // Only one metric supplied — the other monitor jobs must not appear.
    const prompt = promptFor("restaurant", {
      "supplier-bills-due": { value: "£640.00" },
    });
    expect(prompt).toContain("Supplier bills: £640.00");
    expect(prompt).not.toContain("Order & ticket payments");
    expect(prompt).not.toContain("undefined");
  });

  it("never quotes action jobs, which carry no figure", () => {
    expect(promptFor("restaurant")).not.toContain("No-show & cancellation fees:");
    expect(promptFor("catering")).not.toContain("Quote a catering job:");
  });

  it("falls back to a setup-oriented note when no figures exist yet", () => {
    const prompt = promptFor("bakery", {});
    expect(prompt).toContain("No live finance figures are available yet");
    expect(prompt).toContain("set up first");
    expect(prompt).not.toContain("Today's position:");
    expect(prompt.toLowerCase()).toContain("do not take any action");
  });
});
