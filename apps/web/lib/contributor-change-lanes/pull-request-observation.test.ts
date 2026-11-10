import { describe, expect, it } from "vitest";

import {
  createPullRequestObservation,
  parseVerifiedPullRequestObservation,
  selectLatestExactPullRequestObservation,
} from "./pull-request-observation";

const REPO = "OpenDigitalProductFactory/opendigitalproductfactory";

function observation(
  overrides: Partial<Parameters<typeof createPullRequestObservation>[0]> = {},
) {
  return createPullRequestObservation({
    repositoryFullName: REPO,
    number: 5090,
    url: `https://github.com/${REPO}/pull/5090`,
    title: "Delivery observation",
    headBranch: "fix/delivery-observation",
    headSha: "a".repeat(40),
    state: "open",
    isDraft: false,
    mergeStateStatus: "CLEAN",
    mergeCommitSha: null,
    mergedAt: null,
    providerUpdatedAt: "2026-09-06T04:00:00.000Z",
    observedAt: "2026-09-06T04:01:00.000Z",
    ...overrides,
  });
}

describe("verified pull-request observations", () => {
  it("round-trips an authenticated repository/PR/head observation", () => {
    const value = observation({ providerUpdatedAt: "2026-09-06T04:00:00Z" });

    expect(parseVerifiedPullRequestObservation(value)).toEqual(value);
    expect(value.observationFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(value.providerApiVersion).toBe("github-rest/2022-11-28");
  });

  it("rejects tampered, legacy, or incomplete payloads", () => {
    const value = observation();
    expect(
      parseVerifiedPullRequestObservation({ ...value, headSha: "b".repeat(40) }),
    ).toBeNull();
    expect(
      parseVerifiedPullRequestObservation({
        number: 5090,
        state: "merged",
        headBranch: "fix/delivery-observation",
      }),
    ).toBeNull();
    expect(
      parseVerifiedPullRequestObservation(
        observation({ url: `https://github.com/${REPO}/pull/5091` }),
      ),
    ).toBeNull();
  });

  it("binds repository, PR and authored head exactly", () => {
    const value = observation({
      state: "merged",
      mergeCommitSha: "c".repeat(40),
      mergedAt: "2026-09-06T04:00:00Z",
    });

    expect(
      selectLatestExactPullRequestObservation([value], {
        repositoryFullName: REPO,
        pullRequestNumber: 5090,
        headSha: "a".repeat(40),
      }),
    ).toEqual(value);
    expect(
      selectLatestExactPullRequestObservation([value], {
        repositoryFullName: REPO,
        pullRequestNumber: 5090,
        headSha: "d".repeat(40),
      }),
    ).toBeNull();
  });

  it("keeps a matching merge monotonic across duplicate or out-of-order rows", () => {
    const merged = observation({
      state: "merged",
      mergeCommitSha: "c".repeat(40),
      mergedAt: "2026-09-06T04:00:00.000Z",
      providerUpdatedAt: "2026-09-06T04:00:00.000Z",
    });
    const outOfOrderOpen = observation({
      state: "open",
      providerUpdatedAt: "2026-09-06T04:02:00.000Z",
      observedAt: "2026-09-06T04:03:00.000Z",
    });

    expect(
      selectLatestExactPullRequestObservation([outOfOrderOpen, merged], {
        repositoryFullName: REPO,
        pullRequestNumber: 5090,
        headSha: "a".repeat(40),
      }),
    ).toEqual(merged);
  });
});
