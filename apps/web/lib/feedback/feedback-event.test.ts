import { describe, expect, it } from "vitest";

import {
  type FeedbackEventDetail,
  FEEDBACK_TRIGGER_KINDS,
  createManualFeedbackEventDetail,
  isFeedbackEventDetail,
  normalizeFeedbackRoute,
} from "./feedback-event";

const validFeedbackEventDetail: FeedbackEventDetail = {
  routeContext: "/build",
  triggerKind: "manual",
  supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
  autoFilePolicy: "ask",
};

describe("feedback event contract", () => {
  it("publishes the supported feedback trigger vocabulary", () => {
    expect(FEEDBACK_TRIGGER_KINDS).toEqual([
      "manual",
      "runtime-error",
      "grant-denied",
      "structural-verification-fail",
      "coworker-stall",
      "issue-spike",
    ]);
  });

  it("builds a manual support event detail for the build route", () => {
    expect(createManualFeedbackEventDetail("/build")).toMatchObject({
      routeContext: "/build",
      triggerKind: "manual",
      autoFilePolicy: "ask",
    });
  });

  it("generates a dpf support session id", () => {
    const detail = createManualFeedbackEventDetail("/build");

    expect(detail.supportSessionId).toMatch(/^dpf_support_[a-f0-9]{32}$/);
  });

  it("normalizes route context to a stable path without query, hash, origin, or trailing slash", () => {
    expect(normalizeFeedbackRoute("https://app.example.com/build/?tab=tasks#top")).toBe("/build");
    expect(normalizeFeedbackRoute("/build/")).toBe("/build");
    expect(normalizeFeedbackRoute("build")).toBe("/build");
  });

  it("accepts optional trigger metadata from the phase 1 contract", () => {
    expect(
      isFeedbackEventDetail({
        ...validFeedbackEventDetail,
        title: "Build blocked",
        description: "The coworker stopped.",
        errorStack: "Error: stopped",
        userAgent: "Vitest",
        featureBuildId: "FB-9E4FA6DE",
        threadId: "thread-1",
        taskRunId: "task-run-1",
        sourceId: "feedback-button",
        autoFilePolicy: "auto-hard-failure",
      }),
    ).toBe(true);
  });

  it("rejects malformed event payloads", () => {
    expect(isFeedbackEventDetail(null)).toBe(false);
    expect(isFeedbackEventDetail({ ...validFeedbackEventDetail, autoFilePolicy: "auto" })).toBe(false);
    expect(
      isFeedbackEventDetail({
        ...validFeedbackEventDetail,
        triggerKind: "unexpected",
      }),
    ).toBe(false);
    expect(
      isFeedbackEventDetail({
        ...validFeedbackEventDetail,
        triggerKind: "feedback-button",
      }),
    ).toBe(false);
    expect(
      isFeedbackEventDetail({
        ...validFeedbackEventDetail,
        triggerKind: "header-feedback",
      }),
    ).toBe(false);
    expect(
      isFeedbackEventDetail({
        ...validFeedbackEventDetail,
        routeContext: "javascript:alert(1)",
      }),
    ).toBe(false);
    expect(
      isFeedbackEventDetail({
        ...validFeedbackEventDetail,
        supportSessionId: "support_test",
      }),
    ).toBe(false);
  });
});
