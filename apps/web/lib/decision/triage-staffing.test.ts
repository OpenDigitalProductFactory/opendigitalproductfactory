import { describe, expect, it } from "vitest";

import {
  MAX_STAFFED_FAMILIES,
  planTriageStaffing,
  resolveStaffedCoworkers,
  subjectMatterFamilies,
} from "./triage-staffing";

const BASE = {
  domainClass: "kernel-consult",
  gateKey: null,
  question: "Should we do the thing?",
};

describe("subjectMatterFamilies", () => {
  it("routes by what a person would actually hand to a department", () => {
    expect(subjectMatterFamilies("Raise the invoice price for late payment?")).toContain("finance");
    expect(subjectMatterFamilies("Should we publish this campaign announcement?")).toContain("marketing");
    expect(subjectMatterFamilies("Can we terminate a contractor mid-engagement?")).toContain("hr-people-ops");
    expect(subjectMatterFamilies("Does this need a signed DPA before we ingest?")).toContain("legal-compliance");
  });

  it("matches nothing on a question with no subject matter", () => {
    expect(subjectMatterFamilies("Should we do the thing?")).toEqual([]);
  });
});

describe("planTriageStaffing", () => {
  it("says plainly when nothing justifies a specialist", () => {
    const plan = planTriageStaffing(BASE);
    expect(plan.uncovered).toBe(true);
    expect(plan.families).toEqual([]);
    expect(plan.basis).toContain("general platform doctrine");
  });

  it("trusts the profession gate above any inference", () => {
    const plan = planTriageStaffing({
      ...BASE,
      gateKey: "profession",
      professionKey: "finance",
      question: "Should we publish this campaign?",
    });
    expect(plan.families[0]).toMatchObject({ professionKey: "finance", via: "profession-gate" });
  });

  it("ignores a profession key that the registry does not carry", () => {
    const plan = planTriageStaffing({
      ...BASE,
      gateKey: "profession",
      professionKey: "astrology",
    });
    expect(plan.uncovered).toBe(true);
  });

  it("uses the domain class only where it is unambiguous", () => {
    expect(
      planTriageStaffing({ ...BASE, domainClass: "risk-assessment" }).families.map((f) => f.professionKey),
    ).toEqual(["security", "legal-compliance"]);
    // kernel-consult and professional-practice say nothing about subject matter.
    expect(planTriageStaffing({ ...BASE, domainClass: "professional-practice" }).uncovered).toBe(true);
  });

  it("caps the panel rather than convening a committee", () => {
    const plan = planTriageStaffing({
      ...BASE,
      domainClass: "risk-assessment",
      question: "Publish the payroll contract terms to customers after the incident?",
    });
    expect(plan.families.length).toBeLessThanOrEqual(MAX_STAFFED_FAMILIES);
    expect(new Set(plan.families.map((f) => f.professionKey)).size).toBe(plan.families.length);
  });

  it("names what the staffing was based on", () => {
    const plan = planTriageStaffing({ ...BASE, question: "Refund the customer invoice?" });
    expect(plan.basis).toContain("what the question is about");
  });
});

describe("resolveStaffedCoworkers", () => {
  const plan = planTriageStaffing({ ...BASE, question: "Refund the customer invoice?" });

  it("binds a family to a live coworker across case and separator differences", () => {
    const { staffed, unstaffedFamilies } = resolveStaffedCoworkers(plan, [
      { agentId: "AGT-FIN", name: "FinanceAgent", displayName: "Finance Agent" },
      { agentId: "AGT-CS", name: "customer-advisor", displayName: null },
    ]);
    expect(staffed.some((s) => s.professionKey === "finance" && s.agentId === "AGT-FIN")).toBe(true);
    expect(unstaffedFamilies).not.toContain("Finance");
  });

  it("reports a family this install cannot staff instead of pretending it sat on the panel", () => {
    const { staffed, unstaffedFamilies } = resolveStaffedCoworkers(plan, []);
    expect(staffed).toEqual([]);
    expect(unstaffedFamilies.length).toBe(plan.families.length);
  });
});
