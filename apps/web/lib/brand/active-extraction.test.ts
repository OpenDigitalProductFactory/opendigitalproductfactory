import { describe, expect, it } from "vitest";

import {
  activeBrandExtractionWhere,
  isTaskRunActivelyBlockingBrandExtraction,
} from "./active-extraction";

describe("brand active extraction helpers", () => {
  it("does not treat a submitted task with completedAt set as actively blocking", () => {
    expect(
      isTaskRunActivelyBlockingBrandExtraction({
        status: "submitted",
        completedAt: new Date("2026-04-24T01:41:57.659Z"),
        updatedAt: new Date("2026-04-24T01:41:57.662Z"),
      }),
    ).toBe(false);
  });

  it("treats an incomplete in-flight task as actively blocking", () => {
    expect(
      isTaskRunActivelyBlockingBrandExtraction({
        status: "working",
        completedAt: null,
        updatedAt: new Date(),
      }),
    ).toBe(true);
  });

  it("does not treat a stale in-flight task as actively blocking", () => {
    expect(
      isTaskRunActivelyBlockingBrandExtraction({
        status: "submitted",
        completedAt: null,
        updatedAt: new Date(Date.now() - (16 * 60 * 1000)),
      }),
    ).toBe(false);
  });

  it("requires completedAt to be null in the active extraction query", () => {
    expect(activeBrandExtractionWhere("user-123")).toMatchObject({
      userId: "user-123",
      title: "Extract brand design system",
      completedAt: null,
      status: { in: ["submitted", "working", "input-required", "auth-required"] },
      updatedAt: expect.any(Object),
    });
  });
});
