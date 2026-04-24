import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isContributionModelEnabled } from "./contribution-model";

describe("CONTRIBUTION_MODEL_ENABLED", () => {
  const orig = process.env.CONTRIBUTION_MODEL_ENABLED;

  beforeEach(() => {
    delete process.env.CONTRIBUTION_MODEL_ENABLED;
  });

  afterEach(() => {
    if (orig === undefined) {
      delete process.env.CONTRIBUTION_MODEL_ENABLED;
    } else {
      process.env.CONTRIBUTION_MODEL_ENABLED = orig;
    }
  });

  it("defaults to false when unset", () => {
    expect(isContributionModelEnabled()).toBe(false);
  });

  it("is false for any value other than exactly 'true'", () => {
    process.env.CONTRIBUTION_MODEL_ENABLED = "1";
    expect(isContributionModelEnabled()).toBe(false);

    process.env.CONTRIBUTION_MODEL_ENABLED = "yes";
    expect(isContributionModelEnabled()).toBe(false);

    process.env.CONTRIBUTION_MODEL_ENABLED = "TRUE";
    expect(isContributionModelEnabled()).toBe(false);

    process.env.CONTRIBUTION_MODEL_ENABLED = "";
    expect(isContributionModelEnabled()).toBe(false);
  });

  it("is true only when exactly 'true'", () => {
    process.env.CONTRIBUTION_MODEL_ENABLED = "true";
    expect(isContributionModelEnabled()).toBe(true);
  });
});
