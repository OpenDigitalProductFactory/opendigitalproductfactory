import { describe, expect, it } from "vitest";
import {
  validateRequiredFields,
  isFormValid,
  orderedErrors,
  requiredMessage,
  INVALID_EMAIL_MESSAGE,
  type ValidatableField,
} from "./inquiry-validation";

// Representative field sets for the three public-form journeys this contract
// covers. The auth and booking sets are exercised here as pure data so the
// deterministic validation is proven without importing (or depending on the
// merge order of) the sibling auth/booking components.
const INQUIRY_FIELDS: ValidatableField[] = [
  { name: "name", label: "Your name", type: "text", required: true },
  { name: "email", label: "Email address", type: "email", required: true },
  { name: "phone", label: "Phone number", type: "tel", required: false },
  { name: "message", label: "Message", type: "textarea", required: false },
];

const AUTH_FIELDS: ValidatableField[] = [
  { name: "email", label: "Email", type: "email", required: true },
  { name: "password", label: "Password", type: "password", required: true },
];

const BOOKING_FINAL_FIELDS: ValidatableField[] = [
  { name: "name", label: "Full name", type: "text", required: true },
  { name: "email", label: "Email address", type: "email", required: true },
  { name: "date", label: "Preferred date", type: "date", required: true },
  { name: "time", label: "Preferred time", type: "time", required: true },
  { name: "notes", label: "Notes", type: "textarea", required: false },
];

describe("validateRequiredFields — empty submit", () => {
  it("flags every required inquiry field and leaves optional ones alone", () => {
    const errors = validateRequiredFields(INQUIRY_FIELDS, {});
    expect(errors.name).toBe(requiredMessage("Your name"));
    expect(errors.email).toBe(requiredMessage("Email address"));
    expect(errors.phone).toBeUndefined();
    expect(errors.message).toBeUndefined();
  });

  it("treats whitespace-only values as blank", () => {
    const errors = validateRequiredFields(INQUIRY_FIELDS, { name: "   ", email: "\t" });
    expect(errors.name).toBe(requiredMessage("Your name"));
    expect(errors.email).toBe(requiredMessage("Email address"));
  });

  it("flags both required public-auth fields on an empty submit", () => {
    const errors = validateRequiredFields(AUTH_FIELDS, {});
    expect(errors.email).toBe(requiredMessage("Email"));
    expect(errors.password).toBe(requiredMessage("Password"));
    expect(isFormValid(AUTH_FIELDS, {})).toBe(false);
  });

  it("flags all required booking final-form fields deterministically (no side effects)", () => {
    const errors = validateRequiredFields(BOOKING_FINAL_FIELDS, {});
    expect(Object.keys(errors).sort()).toEqual(["date", "email", "name", "time"]);
    expect(errors.date).toBe(requiredMessage("Preferred date"));
    expect(errors.time).toBe(requiredMessage("Preferred time"));
  });
});

describe("validateRequiredFields — email format", () => {
  it("rejects a malformed email even when non-blank", () => {
    const errors = validateRequiredFields(INQUIRY_FIELDS, { name: "Ada", email: "not-an-email" });
    expect(errors.email).toBe(INVALID_EMAIL_MESSAGE);
  });

  it("accepts a well-formed email", () => {
    const errors = validateRequiredFields(INQUIRY_FIELDS, { name: "Ada", email: "ada@example.com" });
    expect(errors.email).toBeUndefined();
  });

  it("does not flag a blank optional email", () => {
    const optional: ValidatableField[] = [{ name: "email", label: "Email", type: "email", required: false }];
    expect(validateRequiredFields(optional, {})).toEqual({});
  });
});

describe("validateRequiredFields — valid submit", () => {
  it("returns no errors when all required fields are filled", () => {
    const values = { name: "Ada", email: "ada@example.com", phone: "", message: "" };
    expect(validateRequiredFields(INQUIRY_FIELDS, values)).toEqual({});
    expect(isFormValid(INQUIRY_FIELDS, values)).toBe(true);
  });

  it("validates a complete booking final form", () => {
    const values = { name: "Ada", email: "ada@example.com", date: "2026-07-23", time: "18:30" };
    expect(isFormValid(BOOKING_FINAL_FIELDS, values)).toBe(true);
  });
});

describe("orderedErrors", () => {
  it("returns errors in field order, not object-key order", () => {
    const errors = validateRequiredFields(INQUIRY_FIELDS, {});
    const ordered = orderedErrors(INQUIRY_FIELDS, errors);
    expect(ordered.map((e) => e.name)).toEqual(["name", "email"]);
  });
});
