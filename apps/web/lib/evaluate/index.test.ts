import { describe, expect, it } from "vitest";

describe("evaluate barrel export", () => {
  it("exports portfolio utilities", async () => {
    const mod = await import("./portfolio");
    expect(mod).toHaveProperty("buildPortfolioTree");
    expect(mod).toHaveProperty("PORTFOLIO_COLOURS");
    expect(mod).toHaveProperty("computeHealth");
  });

  it("exports matching engine", async () => {
    const mod = await import("./matching-engine");
    expect(mod).toHaveProperty("findMatches");
    expect(mod).toHaveProperty("applyBankRules");
  });

  it("exports portfolio search", async () => {
    const mod = await import("./portfolio-search");
    expect(mod).toHaveProperty("rankMatches");
  });
});
