// Fixtures here are deliberately synthetic. Real statutory figures are
// operator-ratified, source-cited reference data (BI-4EB27955); a plausible
// number invented in a test is how a fabricated rate ends up quoted as fact.

import { describe, expect, it } from "vitest";
import {
  checkStatutoryProposal,
  checkStatutoryRatification,
  missingRatifiedRules,
  resolveStatutoryRule,
  rulesSupersededBy,
  type ResolvableStatutoryRule,
  type StatutoryProposalInput,
} from "./statutory-rules";

function rule(over: Partial<ResolvableStatutoryRule> & { id: string }): ResolvableStatutoryRule {
  return {
    taxType: "social_security",
    ruleKind: "rate",
    side: "employee_withheld",
    taxYear: 2026,
    value: 0.5,
    status: "ratified",
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    sourceUrl: "https://authority.example/pub",
    ...over,
  };
}

const ON = new Date("2026-06-15");
const SELECT = { taxType: "social_security", ruleKind: "rate" as const, side: "employee_withheld" };

describe("resolveStatutoryRule", () => {
  it("returns the ratified figure in force", () => {
    expect(resolveStatutoryRule([rule({ id: "a" })], ON, SELECT)?.id).toBe("a");
  });

  it("REFUSES to use a proposed figure", () => {
    // The load-bearing assertion. A proposal is an agent's reading of a web
    // page; using it would let that reading decide what is withheld from
    // someone's pay before any person checked it.
    const rules = [rule({ id: "p", status: "proposed" })];
    expect(resolveStatutoryRule(rules, ON, SELECT)).toBeNull();
  });

  it("ignores rejected and superseded figures", () => {
    const rules = [
      rule({ id: "r", status: "rejected" }),
      rule({ id: "s", status: "superseded" }),
    ];
    expect(resolveStatutoryRule(rules, ON, SELECT)).toBeNull();
  });

  it("does not cross tax type, kind or side", () => {
    const rules = [
      rule({ id: "other-type", taxType: "medicare" }),
      rule({ id: "other-kind", ruleKind: "wage_base" }),
      rule({ id: "other-side", side: "employer_contribution" }),
    ];
    expect(resolveStatutoryRule(rules, ON, SELECT)).toBeNull();
  });

  it("matches a side-less figure only when none is asked for", () => {
    const rules = [rule({ id: "threshold", ruleKind: "threshold", side: null })];
    const got = resolveStatutoryRule(rules, ON, { taxType: "social_security", ruleKind: "threshold" });
    expect(got?.id).toBe("threshold");
  });

  it("lets a mid-year correction supersede the earlier figure", () => {
    const rules = [
      rule({ id: "jan", effectiveFrom: new Date("2026-01-01") }),
      rule({ id: "jun", effectiveFrom: new Date("2026-06-01") }),
    ];
    expect(resolveStatutoryRule(rules, ON, SELECT)?.id).toBe("jun");
  });

  it("treats effectiveTo as exclusive", () => {
    const rules = [
      rule({
        id: "window",
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: new Date("2026-07-01"), // clock-bomb-guard: allow resolveStatutoryRule compares only against the date passed in, never the system clock
      }),
    ];
    expect(resolveStatutoryRule(rules, new Date("2026-06-30"), SELECT)?.id).toBe("window");
    expect(resolveStatutoryRule(rules, new Date("2026-07-01"), SELECT)).toBeNull();
  });
});

describe("checkStatutoryProposal", () => {
  function proposal(over: Partial<StatutoryProposalInput> = {}): StatutoryProposalInput {
    return {
      jurisdictionRefId: "jur-1",
      taxType: "social_security",
      ruleKind: "rate",
      side: "employee_withheld",
      taxYear: 2026,
      value: 0.5,
      effectiveFrom: new Date("2026-01-01"),
      sourceUrl: "https://authority.example/pub",
      retrievedAt: new Date("2026-01-02"),
      ...over,
    };
  }

  it("accepts a cited, dated, well-formed proposal", () => {
    expect(checkStatutoryProposal(proposal())).toEqual({ valid: true });
  });

  it("refuses a figure with no source URL", () => {
    // Without a citation a ratifier has nothing to check, and "the agent said
    // so" quietly becomes the authority for a filing.
    const got = checkStatutoryProposal(proposal({ sourceUrl: "  " }));
    expect(got).toMatchObject({ valid: false, refusal: "missing_source_url" });
  });

  it("refuses a citation with no retrieval date", () => {
    const got = checkStatutoryProposal(proposal({ retrievedAt: null }));
    expect(got).toMatchObject({ valid: false, refusal: "missing_retrieved_at" });
  });

  it("refuses a negative or non-finite figure", () => {
    expect(checkStatutoryProposal(proposal({ value: -1 }))).toMatchObject({
      refusal: "invalid_value",
    });
    expect(checkStatutoryProposal(proposal({ value: Number.NaN }))).toMatchObject({
      refusal: "invalid_value",
    });
  });

  it("refuses a window that closes before it opens", () => {
    const got = checkStatutoryProposal(
      // clock-bomb-guard: allow checkStatutoryProposal compares the two dates against each other, never against the system clock
      proposal({ effectiveFrom: new Date("2026-06-01"), effectiveTo: new Date("2026-01-01") }),
    );
    expect(got).toMatchObject({ valid: false, refusal: "invalid_window" });
  });
});

describe("checkStatutoryRatification", () => {
  it("lets a person ratify a cited proposal", () => {
    const got = checkStatutoryRatification(
      { status: "proposed", sourceUrl: "https://authority.example/pub" },
      { kind: "human" },
    );
    expect(got).toEqual({ valid: true });
  });

  it("REFUSES an agent, even on a perfectly good proposal", () => {
    // If an agent could ratify its own research the split would be decorative:
    // an uncited figure computing withholding, with an audit trail that made it
    // look reviewed.
    const got = checkStatutoryRatification(
      { status: "proposed", sourceUrl: "https://authority.example/pub" },
      { kind: "agent" },
    );
    expect(got).toMatchObject({ valid: false, refusal: "agent_cannot_ratify" });
  });

  it("refuses to ratify something already ratified", () => {
    const got = checkStatutoryRatification(
      { status: "ratified", sourceUrl: "https://authority.example/pub" },
      { kind: "human" },
    );
    expect(got).toMatchObject({ valid: false, refusal: "not_proposed" });
  });

  it("refuses to ratify an uncited figure", () => {
    const got = checkStatutoryRatification({ status: "proposed", sourceUrl: null }, { kind: "human" });
    expect(got).toMatchObject({ valid: false, refusal: "missing_source_url" });
  });
});

describe("rulesSupersededBy", () => {
  it("supersedes only the earlier ratified rules of the same shape", () => {
    const existing = [
      rule({ id: "earlier", effectiveFrom: new Date("2025-01-01") }),
      rule({ id: "later", effectiveFrom: new Date("2027-01-01") }),
      rule({ id: "other-side", side: "employer_contribution", effectiveFrom: new Date("2025-01-01") }),
      rule({ id: "still-proposed", status: "proposed", effectiveFrom: new Date("2025-01-01") }),
    ];
    const got = rulesSupersededBy(
      { taxType: "social_security", ruleKind: "rate", side: "employee_withheld", effectiveFrom: new Date("2026-01-01") },
      existing,
    );
    expect(got.map((r) => r.id)).toEqual(["earlier"]);
  });
});

describe("missingRatifiedRules", () => {
  it("names every figure a payroll still cannot compute", () => {
    // An absent figure has to be LOUD. Before this, no rates and fresh rates
    // both looked like silence.
    const rules = [rule({ id: "ss" })];
    const got = missingRatifiedRules(rules, ON, [
      { taxType: "social_security", ruleKind: "rate", side: "employee_withheld" },
      { taxType: "medicare", ruleKind: "rate", side: "employee_withheld" },
      { taxType: "futa", ruleKind: "wage_base" },
    ]);
    expect(got).toEqual([
      { taxType: "medicare", ruleKind: "rate", side: "employee_withheld" },
      { taxType: "futa", ruleKind: "wage_base", side: null },
    ]);
  });

  it("counts a proposed-but-unratified figure as still missing", () => {
    const rules = [rule({ id: "ss", status: "proposed" })];
    const got = missingRatifiedRules(rules, ON, [
      { taxType: "social_security", ruleKind: "rate", side: "employee_withheld" },
    ]);
    expect(got).toHaveLength(1);
  });
});
