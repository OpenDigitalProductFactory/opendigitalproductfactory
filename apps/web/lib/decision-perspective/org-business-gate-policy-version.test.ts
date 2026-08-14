import { describe, expect, it } from "vitest";

import { alignmentPolicyVersion } from "./org-business-gate";
import { evaluateConstitutionalAlignment } from "./alignment-criteria";

describe("WWWD alignment policy version", () => {
  it("is stable for ordering and changes only after a deliberate stance amendment", () => {
    const first = alignmentPolicyVersion({
      wwwd: [{ ref: "wiki:stance", text: "We do not sell consumer appliances." }],
      portfolio: [{ ref: "product:support", text: "Self-host support subscription" }],
      gtm: [{ ref: "wiki:gtm", text: "Serve MSP partners." }],
    });
    const reordered = alignmentPolicyVersion({
      gtm: [{ ref: "wiki:gtm", text: "Serve MSP partners." }],
      portfolio: [{ ref: "product:support", text: "Self-host support subscription" }],
      wwwd: [{ ref: "wiki:stance", text: "We do not sell consumer appliances." }],
    });
    const amended = alignmentPolicyVersion({
      wwwd: [{ ref: "wiki:stance", text: "We deliberately serve remote fishermen with durable appliances." }],
      portfolio: [{ ref: "product:support", text: "Self-host support subscription" }],
      gtm: [{ ref: "wiki:gtm", text: "Serve MSP partners." }],
    });
    expect(reordered).toBe(first);
    expect(amended).not.toBe(first);
  });

  it("permits a previously rejected action only after amended corpora are freshly evaluated", () => {
    const statement = "Sell toasters to Alaskan fishermen from dock kiosks";
    const original = {
      wwwd: [{ ref: "wiki:stance@v1", text: "We decline selling toasters to fishermen in Alaska." }],
      portfolio: [{ ref: "product:dpf", text: "Self-hosted software support subscriptions." }],
      gtm: [{ ref: "wiki:gtm@v1", text: "MSP partner subscriptions." }],
    };
    const amended = {
      wwwd: [{ ref: "wiki:stance@v2", text: "We serve Alaskan fishermen with durable toasters." }],
      portfolio: [{ ref: "product:toaster", text: "Durable toasters for Alaskan fishermen." }],
      gtm: [{ ref: "wiki:gtm@v2", text: "Dock kiosk retail for fishermen in Alaska." }],
    };
    expect(evaluateConstitutionalAlignment({ statement, corpora: original }).verdict).toBe("decline");
    expect(alignmentPolicyVersion(amended)).not.toBe(alignmentPolicyVersion(original));
    expect(evaluateConstitutionalAlignment({ statement, corpora: amended }).verdict).toBe("approve");
  });
});
