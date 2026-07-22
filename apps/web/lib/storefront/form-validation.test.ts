import { describe, expect, it } from "vitest";
import {
  isLikelyEmail,
  validateRequiredFields,
  errorId,
  type ValidatableField,
} from "./form-validation";

// The generic inquiry schema (name/email required, phone/message optional).
const INQUIRY_FIELDS: ValidatableField[] = [
  { name: "name", label: "Your name", type: "text", required: true },
  { name: "email", label: "Email address", type: "email", required: true },
  { name: "phone", label: "Phone number", type: "tel", required: false },
  { name: "message", label: "Message", type: "textarea", required: false },
];

// Public auth field contract (BI-F20763F5 item: public auth validation).
const AUTH_FIELDS: ValidatableField[] = [
  { name: "email", label: "Email", type: "email", required: true },
  { name: "password", label: "Password", type: "text", required: true },
];

// Booking final-form contract — deterministic, no payment/network.
const BOOKING_FIELDS: ValidatableField[] = [
  { name: "name", label: "Your name", type: "text", required: true },
  { name: "email", label: "Email", type: "email", required: true },
  { name: "phone", label: "Phone", type: "tel", required: false },
];

describe("isLikelyEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isLikelyEmail("guest@example.com")).toBe(true);
    expect(isLikelyEmail("  guest@example.co.uk  ")).toBe(true);
  });
  it("rejects obvious mistakes", () => {
    expect(isLikelyEmail("guest")).toBe(false);
    expect(isLikelyEmail("guest@")).toBe(false);
    expect(isLikelyEmail("guest@example")).toBe(false);
    expect(isLikelyEmail("")).toBe(false);
  });
});

describe("validateRequiredFields — empty validation", () => {
  it("flags every empty required field, keeps optional fields clean", () => {
    const result = validateRequiredFields(INQUIRY_FIELDS, {});
    expect(result.valid).toBe(false);
    expect(result.order).toEqual(["name", "email"]);
    expect(result.errors.name).toBe("Your name is required");
    expect(result.errors.email).toBe("Email address is required");
    expect(result.errors.phone).toBeUndefined();
    expect(result.errors.message).toBeUndefined();
  });

  it("treats whitespace-only values as empty", () => {
    const result = validateRequiredFields(INQUIRY_FIELDS, { name: "   ", email: "   " });
    expect(result.valid).toBe(false);
    expect(result.order).toEqual(["name", "email"]);
  });
});

describe("validateRequiredFields — email format", () => {
  it("rejects a malformed required email even when non-empty", () => {
    const result = validateRequiredFields(INQUIRY_FIELDS, { name: "Guest", email: "nope" });
    expect(result.valid).toBe(false);
    expect(result.order).toEqual(["email"]);
    expect(result.errors.email).toBe("Enter a valid email address");
  });

  it("passes a fully valid submission", () => {
    const result = validateRequiredFields(INQUIRY_FIELDS, {
      name: "Guest",
      email: "guest@example.com",
    });
    expect(result.valid).toBe(true);
    expect(result.order).toEqual([]);
    expect(result.errors).toEqual({});
  });
});

describe("validateRequiredFields — public auth contract", () => {
  it("requires email and password on empty submit", () => {
    const result = validateRequiredFields(AUTH_FIELDS, {});
    expect(result.valid).toBe(false);
    expect(result.order).toEqual(["email", "password"]);
  });

  it("accepts a valid credential pair", () => {
    const result = validateRequiredFields(AUTH_FIELDS, {
      email: "guest@example.com",
      password: "hunter2",
    });
    expect(result.valid).toBe(true);
  });
});

describe("validateRequiredFields — deterministic booking final form", () => {
  it("blocks an empty booking form with no side effects (pure)", () => {
    const result = validateRequiredFields(BOOKING_FIELDS, { phone: "" });
    expect(result.valid).toBe(false);
    expect(result.order).toEqual(["name", "email"]);
  });

  it("passes when name + email are present (phone optional)", () => {
    const result = validateRequiredFields(BOOKING_FIELDS, {
      name: "Jane Guest",
      email: "jane@example.com",
    });
    expect(result.valid).toBe(true);
  });
});

describe("errorId", () => {
  it("builds a stable, unique id per form + field", () => {
    expect(errorId("inquiry", "email")).toBe("inquiry-email-error");
  });
});
