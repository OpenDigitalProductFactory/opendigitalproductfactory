import { describe, expect, it } from "vitest";

import { getStorefrontPresentation } from "./archetype-vocabulary";

describe("getStorefrontPresentation", () => {
  it("uses mission-shaped setup and publishing copy for nonprofits", () => {
    const presentation = getStorefrontPresentation("nonprofit-community");

    expect(presentation.entityNoun).toBe("organization");
    expect(presentation.productMix.legend).toBe("What does your organization offer?");
    expect(presentation.productMix.primaryLabel).toBe("Main programme");
    expect(presentation.productMix.help).toContain("supporters");
    expect(presentation.productMix.help).not.toMatch(/sell|customers buy/i);
    expect(presentation.publish.readyTitle).toBe("Your Supporter Hub is ready — publish it now");
    expect(presentation.publish.description).toContain("supporters can find you");
  });

  it("preserves commercial defaults for a retail storefront", () => {
    const presentation = getStorefrontPresentation("retail-goods");

    expect(presentation.entityNoun).toBe("business");
    expect(presentation.productMix.legend).toBe("What does your business sell?");
    expect(presentation.productMix.primaryLabel).toBe("Main product line");
    expect(presentation.publish.readyTitle).toBe("Your storefront is ready — publish it now");
  });
});
