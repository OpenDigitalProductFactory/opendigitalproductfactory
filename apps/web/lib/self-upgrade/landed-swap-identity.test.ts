import { describe, expect, it } from "vitest";
import { isLandedSwapFalseFailureReason, LANDED_SWAP_FALSE_FAILURE_REASON, resumedSwapAlreadyLanded } from "./landed-swap-identity";
describe("exact landed-swap identity", () => {
  it("recognizes only the known completed-drain replay diagnostic", () => {
    expect(isLandedSwapFalseFailureReason(LANDED_SWAP_FALSE_FAILURE_REASON)).toBe(true);
    for (const reason of [null, undefined, "", "admission-reopened-before-swap: the drain already ended (aborted)", "health-check-failed"]) expect(isLandedSwapFalseFailureReason(reason)).toBe(false);
  });
  it("requires the actual running image to exactly match the target after leaving the old image", () => {
    const target = "abc1234deadbeef";
    expect(resumedSwapAlreadyLanded({ deployedSha: target.toUpperCase(), targetSha: target, currentSha: "old" })).toBe(true);
    for (const input of [
      { deployedSha: "old", targetSha: target, currentSha: "old" },
      { deployedSha: target, targetSha: target, currentSha: target },
      { deployedSha: target.slice(0, 7), targetSha: target, currentSha: "old" },
      { deployedSha: target, targetSha: target, currentSha: null },
      { deployedSha: null, targetSha: target, currentSha: "old" },
    ]) expect(resumedSwapAlreadyLanded(input)).toBe(false);
  });
});
