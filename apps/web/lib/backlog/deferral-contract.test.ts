import { describe, expect, it } from "vitest";

import { normalizeDeferralInput } from "./deferral-contract";

const NOW = new Date("2026-08-15T12:00:00.000Z");

describe("normalizeDeferralInput", () => {
  it("normalizes a complete attributable deferral", () => {
    const result = normalizeDeferralInput(
      {
        reason: "Waiting for the predecessor rollout evidence.",
        trigger: "EP-PREDECESSOR reaches done with production evidence.",
        reviewAt: "2026-11-15T12:00:00.000Z",
        ownerPrincipalId: "principal-1",
      },
      NOW,
    );

    expect(result).toEqual({
      ok: true,
      value: {
        deferReason: "Waiting for the predecessor rollout evidence.",
        deferTrigger: "EP-PREDECESSOR reaches done with production evidence.",
        deferReviewAt: new Date("2026-11-15T12:00:00.000Z"),
        deferOwnerPrincipalId: "principal-1",
      },
    });
  });

  it.each([
    [undefined, "missing_deferral"],
    [{}, "missing_defer_reason"],
    [{ reason: "why" }, "missing_defer_trigger"],
    [{ reason: "why", trigger: "when" }, "missing_defer_review_at"],
    [{ reason: "why", trigger: "when", reviewAt: "not-a-date" }, "invalid_defer_review_at"],
    [{ reason: "why", trigger: "when", reviewAt: "2026-08-14T12:00:00Z" }, "defer_review_at_not_future"],
    [
      { reason: "why", trigger: "when", reviewAt: "2026-11-15T12:00:00Z" },
      "missing_defer_owner",
    ],
  ])("rejects incomplete or horizonless deferrals", (input, error) => {
    expect(normalizeDeferralInput(input, NOW)).toMatchObject({ ok: false, error });
  });
});
