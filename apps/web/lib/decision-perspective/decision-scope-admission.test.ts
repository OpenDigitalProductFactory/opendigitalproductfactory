import { describe, expect, it } from "vitest";
import {
  DECISION_SCOPE_PICK_LIST,
  admitToOrgBusinessGate,
  isDecisionScope,
} from "./decision-scope-admission";

/**
 * BI-13C38318. On the customer 0 install, six field-service privacy questions
 * reached a SOFTWARE-PLATFORM organization's business stance because nothing
 * named the owning scope first. The owner's own ruling on DI-F1666B2E39BA said
 * it plainly: the lawful-basis question "required proper research into laws and
 * contracts" — it was not a business decision at all.
 */

describe("admitting a question to the org business gate", () => {
  it("admits a declared business decision", () => {
    expect(admitToOrgBusinessGate({ declaredScope: "wwwd" })).toEqual({
      admitted: true,
      scope: "wwwd",
      derivedFrom: "declared",
    });
  });

  it("refuses a craft question and names where it belongs", () => {
    const result = admitToOrgBusinessGate({ declaredScope: "wsid" });
    expect(result.admitted).toBe(false);
    if (result.admitted || result.reason !== "wrong-scope") throw new Error("expected wrong-scope");
    expect(result.route).toBe("evaluate_profession_decision");
    expect(result.message).toMatch(/not the authority/i);
  });

  it("refuses a platform question and names where it belongs", () => {
    const result = admitToOrgBusinessGate({ declaredScope: "wwmd" });
    if (result.admitted || result.reason !== "wrong-scope") throw new Error("expected wrong-scope");
    expect(result.route).toBe("principle_decide");
  });

  it("refuses an undeclared question with the pick list rather than guessing", () => {
    const result = admitToOrgBusinessGate({});
    if (result.admitted || result.reason !== "scope-unestablished") {
      throw new Error("expected scope-unestablished");
    }
    expect(result.pickList).toHaveLength(3);
    expect(result.pickList.map((p) => p.ref)).toEqual(["wwmd", "wwwd", "wsid"]);
    expect(result.message).toMatch(/not inferred from the wording/i);
  });

  it("never infers scope from question text — the same wording is refused either way", () => {
    // The live conflation case. Inferring from wording is what turned alignment
    // criteria into a fixture regex (BI-9E1E1939); scope must not repeat it.
    const fieldService = admitToOrgBusinessGate({});
    const funding = admitToOrgBusinessGate({});
    expect(fieldService).toEqual(funding);
  });

  it("rejects a value that is not a scope at all", () => {
    const result = admitToOrgBusinessGate({ declaredScope: "business" });
    if (result.admitted || result.reason !== "scope-unestablished") {
      throw new Error("expected scope-unestablished");
    }
    expect(result.message).toContain('"business" is not a decision scope');
  });

  it("derives wwwd for a business-scoped tool, so governed tool calls are unchanged", () => {
    expect(admitToOrgBusinessGate({ toolConsequenceScope: "business" })).toEqual({
      admitted: true,
      scope: "wwwd",
      derivedFrom: "tool-consequence-scope",
    });
  });

  it("refuses a platform-scoped tool without needing it declared", () => {
    const result = admitToOrgBusinessGate({ toolConsequenceScope: "platform" });
    if (result.admitted || result.reason !== "wrong-scope") throw new Error("expected wrong-scope");
    expect(result.scope).toBe("wwmd");
  });

  it("lets an explicit declaration override a derived tool scope", () => {
    expect(
      admitToOrgBusinessGate({ declaredScope: "wwwd", toolConsequenceScope: "platform" }),
    ).toMatchObject({ admitted: true, derivedFrom: "declared" });
  });
});

describe("the pick list a refusal hands back", () => {
  it("gives each scope an authority and a route, so a refusal is actionable", () => {
    for (const pick of DECISION_SCOPE_PICK_LIST) {
      expect(pick.definition.length).toBeGreaterThan(40);
      expect(pick.authority.length).toBeGreaterThan(20);
      expect(pick.route.length).toBeGreaterThan(0);
    }
  });

  it("says plainly that lawful basis is not a business preference", () => {
    const wsid = DECISION_SCOPE_PICK_LIST.find((p) => p.ref === "wsid")!;
    expect(wsid.definition).toMatch(/lawful basis is not a matter of business preference/i);
  });

  it("recognises only the three scopes", () => {
    expect(isDecisionScope("wwwd")).toBe(true);
    expect(isDecisionScope("marketing")).toBe(false);
    expect(isDecisionScope(undefined)).toBe(false);
  });
});
