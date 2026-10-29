import { describe, expect, it } from "vitest";
import { decideFundedAuthor, type FundedAuthorInput } from "./funded-author.js";

const facts: FundedAuthorInput = { applicable: true, role: "author", agentRef: "agent:synthetic-author",
  preauthorisation: { state: "in-force" }, funding: { funded: true, portfolioId: "synthetic-portfolio", summary: "Supplied current budget facts" } };

describe("resolved author/funding conjunction", () => {
  it("preserves a non-applicable result without interpreting authority or funding", () => {
    expect(decideFundedAuthor({ ...facts, applicable: false, preauthorisation: { state: "not-in-force", because: "revoked" } }))
      .toEqual({ roleBindings: {}, withheldBecause: null });
  });
  it("keeps host exclusions ahead of both supplied conditions", () => {
    expect(decideFundedAuthor({ ...facts, excludedBecause: "Host excludes this shape", preauthorisation: { state: "not-in-force", because: "revoked" } }))
      .toEqual({ roleBindings: {}, withheldBecause: "Host excludes this shape" });
  });
  it("withholds a candidate when current authority is absent or revoked, even with funding", () => {
    for (const because of ["authority absent", "authority revoked"]) expect(decideFundedAuthor({ ...facts,
      preauthorisation: { state: "not-in-force", because } })).toEqual({ roleBindings: {}, withheldBecause: because });
  });
  it("withholds when the funding owner supplies an unfunded result", () => {
    expect(decideFundedAuthor({ ...facts, funding: { funded: false, because: "No current budget is set" } }))
      .toEqual({ roleBindings: {}, withheldBecause: "No current budget is set" });
  });
  it("returns only the supplied candidate when both conditions hold", () => {
    expect(decideFundedAuthor(facts)).toEqual({ roleBindings: { author: "agent:synthetic-author" }, withheldBecause: null });
    expect(facts.funding).toEqual({ funded: true, portfolioId: "synthetic-portfolio", summary: "Supplied current budget facts" });
  });
});
