import { describe, expect, it } from "vitest";

import {
  evaluateConstitutionalAlignment,
  extractAlignmentCriteria,
} from "./alignment-criteria";

const arcamanusCorpora = {
  wwwd: [{ ref: "wiki:org-who-we-serve", text: "We serve software teams and MSP partners. We decline selling toasters to fishermen in Alaska." }],
  portfolio: [{ ref: "product:dpf", text: "Digital Product Factory self-hosted software platform and support subscription" }],
  gtm: [{ ref: "wiki:org-how-we-decide", text: "Open-source software with assurance subscriptions through an MSP partner channel" }],
};

describe("constitutional alignment criteria", () => {
  it("extracts the toaster action into evidence-bearing criteria", () => {
    const result = extractAlignmentCriteria("Sell toasters to Alaskan fishermen from dock kiosks");
    expect(result.status).toBe("complete");
    expect(result.criteria).toMatchObject({
      geography: "alaska",
      customerType: "fishermen",
      product: "toasters",
      motion: "kiosk retail",
      segment: "consumer physical retail",
    });
  });

  it("vetoes an explicit hard boundary before aggregate positives can average it away", () => {
    const result = evaluateConstitutionalAlignment({
      statement: "Sell toasters to Alaskan fishermen from dock kiosks",
      corpora: arcamanusCorpora,
    });
    expect(result.verdict).toBe("decline");
    expect(result.veto).toMatchObject({ corpus: "wwwd", criterion: "market" });
    expect(result.veto?.evidenceRefs).toContain("wiki:org-who-we-serve");
  });

  it("declines a novel physical-retail coffee-shop chain against a software corpus", () => {
    expect(evaluateConstitutionalAlignment({
      statement: "Launch a consumer coffee-shop chain in shopping malls",
      corpora: arcamanusCorpora,
    }).verdict).toBe("decline");
  });

  it.each([
    "Sell an MSP partner subscription",
    "Offer a self-hosted software support subscription",
  ])("approves an on-direction offer: %s", (statement) => {
    const result = evaluateConstitutionalAlignment({ statement, corpora: arcamanusCorpora });
    expect(result.verdict).toBe("approve");
    expect(result.checks.every((check) => check.verdict === "aligned")).toBe(true);
  });

  it("fails closed to escalation when salient criteria cannot be extracted", () => {
    const result = evaluateConstitutionalAlignment({
      statement: "Do the thing we discussed",
      corpora: arcamanusCorpora,
    });
    expect(result.verdict).toBe("escalate");
    expect(result.criteria.status).toBe("ambiguous");
  });
});
