import { describe, it, expect } from "vitest";
import {
  inquiryFieldsForItem,
  isDonationOnlyField,
  DONATION_ONLY_FIELD_NAMES,
} from "./inquiry-fields";

// The schema five nonprofit archetypes were seeded with, verbatim (BI-7F851119).
const SEEDED_DONATION_SCHEMA = [
  { name: "name", label: "Full name", type: "text", required: true },
  { name: "email", label: "Email", type: "email", required: true },
  { name: "donationAmount", label: "Donation amount", type: "select", required: true, options: ["£5", "Other"] },
  { name: "customAmount", label: "Custom amount (£)", type: "text", required: false },
  { name: "campaignId", label: "Campaign", type: "text", required: false },
  { name: "isAnonymous", label: "Make donation anonymous?", type: "select", required: false },
  { name: "notes", label: "Message", type: "textarea", required: false },
];

const names = (fields: { name: string }[]) => fields.map((f) => f.name);

describe("isDonationOnlyField", () => {
  it("matches the donation fields regardless of case and separators", () => {
    for (const spelling of ["donationAmount", "donation_amount", "Donation Amount", "DONATION-AMOUNT"]) {
      expect(isDonationOnlyField(spelling)).toBe(true);
    }
  });

  it("leaves contact fields alone", () => {
    for (const field of ["name", "email", "phone", "notes", "message", "reason"]) {
      expect(isDonationOnlyField(field)).toBe(false);
    }
  });
});

describe("inquiryFieldsForItem", () => {
  it("drops the donation fields from the site-wide contact form", () => {
    expect(names(inquiryFieldsForItem(SEEDED_DONATION_SCHEMA))).toEqual([
      "name",
      "email",
      "notes",
    ]);
  });

  it("leaves no required field a stranger cannot answer without giving money", () => {
    const required = inquiryFieldsForItem(SEEDED_DONATION_SCHEMA).filter((f) => f.required);
    expect(names(required)).toEqual(["name", "email"]);
    expect(required.some((f) => DONATION_ONLY_FIELD_NAMES.has(f.name.toLowerCase()))).toBe(false);
  });

  it("drops them for an enquiry about a non-donation item — adopting an animal is not a donation", () => {
    const fields = inquiryFieldsForItem(SEEDED_DONATION_SCHEMA, { itemCtaType: "inquiry" });
    expect(names(fields)).not.toContain("donationAmount");
  });

  it("keeps them for an enquiry about a donation item", () => {
    const fields = inquiryFieldsForItem(SEEDED_DONATION_SCHEMA, { itemCtaType: "donation" });
    expect(names(fields)).toEqual(names(SEEDED_DONATION_SCHEMA));
  });

  it("does not mutate the schema it was given", () => {
    const before = names(SEEDED_DONATION_SCHEMA);
    inquiryFieldsForItem(SEEDED_DONATION_SCHEMA);
    expect(names(SEEDED_DONATION_SCHEMA)).toEqual(before);
  });
});
