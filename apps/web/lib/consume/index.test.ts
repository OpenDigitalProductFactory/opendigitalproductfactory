import { describe, expect, it } from "vitest";
import * as Consume from "./index";

describe("consume barrel export", () => {
  it("exports all public symbols", () => {
    expect(Object.keys(Consume).sort()).toMatchSnapshot();
  });

  it("includes key functions", () => {
    expect(Consume).toHaveProperty("getChecklists");
    expect(Consume).toHaveProperty("buildOnboardingPrompt");
  });
});
