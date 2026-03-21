import { describe, expect, it } from "vitest";
import {
  createRecurringScheduleSchema,
  updateScheduleStatusSchema,
  createDunningSequenceSchema,
  FREQUENCIES,
  SEVERITIES,
} from "./recurring-validation";

// ─── createRecurringScheduleSchema ────────────────────────────────────────────

describe("createRecurringScheduleSchema", () => {
  const validInput = {
    accountId: "acc-1",
    name: "Monthly retainer",
    frequency: "monthly" as const,
    startDate: "2026-04-01",
    autoSend: true,
    currency: "GBP",
    lineItems: [
      {
        description: "Retainer services",
        quantity: 1,
        unitPrice: 2000,
        taxRate: 20,
      },
    ],
  };

  it("accepts a valid recurring schedule input", () => {
    const result = createRecurringScheduleSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects empty lineItems array", () => {
    const result = createRecurringScheduleSchema.safeParse({
      ...validInput,
      lineItems: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("lineItems"));
      expect(issue).toBeDefined();
    }
  });

  it("rejects invalid frequency", () => {
    const result = createRecurringScheduleSchema.safeParse({
      ...validInput,
      frequency: "daily",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid frequencies", () => {
    for (const frequency of FREQUENCIES) {
      const result = createRecurringScheduleSchema.safeParse({ ...validInput, frequency });
      expect(result.success, `frequency '${frequency}' should be valid`).toBe(true);
    }
  });

  it("rejects missing accountId", () => {
    const { accountId: _a, ...rest } = validInput;
    const result = createRecurringScheduleSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const result = createRecurringScheduleSchema.safeParse({ ...validInput, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects line item with non-positive quantity", () => {
    const result = createRecurringScheduleSchema.safeParse({
      ...validInput,
      lineItems: [{ description: "Test", quantity: 0, unitPrice: 100, taxRate: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects line item with negative unitPrice", () => {
    const result = createRecurringScheduleSchema.safeParse({
      ...validInput,
      lineItems: [{ description: "Test", quantity: 1, unitPrice: -10, taxRate: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional endDate", () => {
    const result = createRecurringScheduleSchema.safeParse({
      ...validInput,
      endDate: "2027-04-01",
    });
    expect(result.success).toBe(true);
  });

  it("defaults currency to GBP when not provided", () => {
    const { currency: _c, ...rest } = validInput;
    const result = createRecurringScheduleSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe("GBP");
    }
  });
});

// ─── updateScheduleStatusSchema ───────────────────────────────────────────────

describe("updateScheduleStatusSchema", () => {
  it("accepts all valid statuses", () => {
    for (const status of ["active", "paused", "cancelled", "completed"] as const) {
      const result = updateScheduleStatusSchema.safeParse({ status });
      expect(result.success, `status '${status}' should be valid`).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    const result = updateScheduleStatusSchema.safeParse({ status: "deleted" });
    expect(result.success).toBe(false);
  });
});

// ─── createDunningSequenceSchema ──────────────────────────────────────────────

describe("createDunningSequenceSchema", () => {
  const validInput = {
    name: "Standard dunning",
    isDefault: false,
    steps: [
      {
        dayOffset: 7,
        subject: "Payment reminder",
        emailTemplate: "first_overdue",
        severity: "friendly" as const,
      },
    ],
  };

  it("accepts a valid dunning sequence input", () => {
    const result = createDunningSequenceSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects empty steps array", () => {
    const result = createDunningSequenceSchema.safeParse({ ...validInput, steps: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("steps"));
      expect(issue).toBeDefined();
    }
  });

  it("accepts all valid severities", () => {
    for (const severity of SEVERITIES) {
      const result = createDunningSequenceSchema.safeParse({
        ...validInput,
        steps: [{ ...validInput.steps[0]!, severity }],
      });
      expect(result.success, `severity '${severity}' should be valid`).toBe(true);
    }
  });

  it("rejects invalid severity", () => {
    const result = createDunningSequenceSchema.safeParse({
      ...validInput,
      steps: [{ ...validInput.steps[0]!, severity: "aggressive" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const result = createDunningSequenceSchema.safeParse({ ...validInput, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects step with empty subject", () => {
    const result = createDunningSequenceSchema.safeParse({
      ...validInput,
      steps: [{ ...validInput.steps[0]!, subject: "" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts negative dayOffset (pre-due reminder)", () => {
    const result = createDunningSequenceSchema.safeParse({
      ...validInput,
      steps: [{ ...validInput.steps[0]!, dayOffset: -3 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-integer dayOffset", () => {
    const result = createDunningSequenceSchema.safeParse({
      ...validInput,
      steps: [{ ...validInput.steps[0]!, dayOffset: 1.5 }],
    });
    expect(result.success).toBe(false);
  });
});
