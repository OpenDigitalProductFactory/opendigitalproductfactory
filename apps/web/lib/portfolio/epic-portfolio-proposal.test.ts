import { describe, expect, it } from "vitest";

import { buildPortfolioVocabulary, proposeEpicPortfolio } from "./epic-portfolio-proposal";

const vocabulary = buildPortfolioVocabulary([
  { portfolioId: "p-found", text: "Platform infrastructure, network, data platform and security" },
  { portfolioId: "p-sold", text: "Veterinary clinic appointments, storefront and customer bookings" },
]);

describe("proposeEpicPortfolio (BI-A73A7DA3)", () => {
  it("is high when one portfolio holds at least 80% of three or more attributed items", () => {
    const proposal = proposeEpicPortfolio(
      { epicId: "EP-1", title: "x", description: null, itemPortfolioIds: ["p-sold", "p-sold", "p-sold", "p-sold", "p-found", null] },
      vocabulary,
    );
    expect(proposal).toMatchObject({ portfolioId: "p-sold", confidence: "high" });
    expect(proposal.evidence).toMatchObject({ attributedItems: 5, tally: { "p-sold": 4, "p-found": 1 } });
  });

  it("is low when the items disagree, and still proposes their leading portfolio", () => {
    const proposal = proposeEpicPortfolio(
      { epicId: "EP-2", title: "x", description: null, itemPortfolioIds: ["p-sold", "p-sold", "p-found"] },
      vocabulary,
    );
    expect(proposal).toMatchObject({ portfolioId: "p-sold", confidence: "low" });
  });

  it("is low with fewer than three attributed items, however unanimous", () => {
    expect(proposeEpicPortfolio(
      { epicId: "EP-3", title: "x", description: null, itemPortfolioIds: ["p-sold", "p-sold"] },
      vocabulary,
    )).toMatchObject({ portfolioId: "p-sold", confidence: "low" });
  });

  it("falls back to a text match, always low, and names the matched terms", () => {
    const proposal = proposeEpicPortfolio(
      { epicId: "EP-4", title: "Veterinary clinic operating system", description: "Appointments for the clinic", itemPortfolioIds: [] },
      vocabulary,
    );
    expect(proposal).toMatchObject({ portfolioId: "p-sold", confidence: "low" });
    expect(proposal.evidence.textMatches["p-sold"]).toEqual(expect.arrayContaining(["veterinary", "clinic", "appointments"]));
  });

  it("proposes nothing, rather than guessing, when neither links nor text point anywhere", () => {
    expect(proposeEpicPortfolio(
      { epicId: "EP-5", title: "Misc", description: null, itemPortfolioIds: [null] },
      vocabulary,
    )).toMatchObject({ portfolioId: null, confidence: "low" });
  });
});
