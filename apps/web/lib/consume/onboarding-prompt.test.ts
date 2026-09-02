import { describe, expect, it } from "vitest";

import { describeCloudReadinessForSetup } from "./onboarding-prompt";

// BI-575F0046 Slice 2. Setup guidance used to ask "has cloud provider: yes/no".
// That called a connected-but-uncleared provider "yes" — and since a new
// connection is cleared for `public` while no route is ever public, the owner
// was told cloud AI was available while every coworker ran on the local model.
// The field driving it (`hasCloudProvider`) was also never written by anything,
// so the answer was always "no".
describe("describeCloudReadinessForSetup", () => {
  it("distinguishes connected-but-uncleared from working", () => {
    const publicOnly = describeCloudReadinessForSetup("public-only");
    const ready = describeCloudReadinessForSetup("ready");

    expect(publicOnly).not.toBe(ready);
    expect(publicOnly).toMatch(/not yet cleared/);
    expect(ready).toMatch(/cleared for everyday work/);
  });

  it("names the action and its cost for the uncleared state", () => {
    const text = describeCloudReadinessForSetup("public-only");

    expect(text).toMatch(/about a minute/);
    expect(text).toMatch(/Platform > AI > Providers/);
    // The consequence is what makes it worth doing, and it was the invisible part.
    expect(text).toMatch(/every coworker runs on the local model/);
  });

  it("tells the coworker not to move on as if cloud AI were available", () => {
    expect(describeCloudReadinessForSetup("public-only")).toMatch(/do not move on/);
  });

  it("treats local-only as a valid choice rather than a defect", () => {
    expect(describeCloudReadinessForSetup("none")).toMatch(/valid choice/);
  });

  it("says so when it does not know, rather than guessing", () => {
    expect(describeCloudReadinessForSetup(undefined)).toMatch(/not known/);
  });

  // Zero-Click Provider Setup scores AGAINST adding friction here
  // (DI-5C13155815D2), so the guidance points at one action and stays short.
  it("keeps the guidance to one action", () => {
    const text = describeCloudReadinessForSetup("public-only");

    expect(text.split(".").filter((s) => s.trim()).length).toBeLessThanOrEqual(4);
  });
});
