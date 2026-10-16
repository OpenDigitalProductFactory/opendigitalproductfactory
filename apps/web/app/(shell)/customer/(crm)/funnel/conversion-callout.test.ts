import { describe, expect, it } from "vitest";

import { conversionCallouts, weakestConversion } from "./conversion-callout";

const directStages = [
  { label: "Direct & Reseller Leads" },
  { label: "Engagements" },
  { label: "Opportunities" },
  { label: "Closed Won" },
];

const storefrontStages = [
  { label: "Storefront Interactions" },
  { label: "Engagements" },
  { label: "Opportunities" },
  { label: "Closed Won" },
];

describe("conversionCallouts", () => {
  it("names the drop-off with the stage the chart shows when there is no storefront", () => {
    const callouts = conversionCallouts(directStages, ["0", null, null]);

    expect(callouts).toEqual([
      { stage: "Direct & Reseller Leads to Engagements", rate: "0" },
    ]);
    expect(callouts.map((callout) => callout.stage).join(" ")).not.toContain("Interactions");
  });

  it("names the storefront stage when that is the top of the chart", () => {
    expect(conversionCallouts(storefrontStages, ["12", "40", "25"])).toEqual([
      { stage: "Storefront Interactions to Engagements", rate: "12" },
      { stage: "Engagements to Opportunities", rate: "40" },
      { stage: "Opportunities to Closed Won", rate: "25" },
    ]);
  });

  it("drops a pair that has no rate, so an empty denominator never becomes a callout", () => {
    expect(conversionCallouts(directStages, [null, "10", null])).toEqual([
      { stage: "Engagements to Opportunities", rate: "10" },
    ]);
  });
});

describe("weakestConversion", () => {
  it("picks the lowest rate among the pairs the chart can name", () => {
    const callouts = conversionCallouts(directStages, ["40", "0", "80"]);
    expect(weakestConversion(callouts)?.stage).toBe("Engagements to Opportunities");
  });

  it("is empty when every pair lacks a rate", () => {
    expect(weakestConversion(conversionCallouts(directStages, [null, null, null]))).toBeNull();
  });
});
