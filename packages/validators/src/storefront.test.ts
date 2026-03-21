import { describe, it, expect } from "vitest";
import { bookingConfigSchema } from "./storefront";

describe("bookingConfigSchema", () => {
  it("accepts valid slot config", () => {
    const result = bookingConfigSchema.safeParse({
      durationMinutes: 45,
      schedulingPattern: "slot",
      assignmentMode: "next-available",
    });
    expect(result.success).toBe(true);
  });

  it("rejects durationMinutes < 5", () => {
    const result = bookingConfigSchema.safeParse({
      durationMinutes: 3,
      schedulingPattern: "slot",
      assignmentMode: "next-available",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid schedulingPattern", () => {
    const result = bookingConfigSchema.safeParse({
      durationMinutes: 30,
      schedulingPattern: "invalid",
      assignmentMode: "next-available",
    });
    expect(result.success).toBe(false);
  });

  it("accepts full config with all optional fields", () => {
    const result = bookingConfigSchema.safeParse({
      durationMinutes: 60,
      beforeBufferMinutes: 10,
      afterBufferMinutes: 15,
      minimumNoticeHours: 24,
      maxAdvanceDays: 90,
      slotIntervalMinutes: 30,
      schedulingPattern: "class",
      assignmentMode: "customer-choice",
      capacity: 20,
      bookingLimits: { day: 8, week: 30 },
    });
    expect(result.success).toBe(true);
  });
});
