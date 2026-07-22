import { describe, expect, it } from "vitest";
import { slotFlowExtraFields, type FormField } from "./slot-booking-fields";

// Mirrors the Restaurant archetype inquiry schema in
// packages/storefront-templates/src/archetypes/food-hospitality.ts — the schema
// the /s/<org>/book/<itemId> slot flow reuses. The calendar step already owns
// `date` and the slot step already owns `time`, so they must NOT reappear as
// blank controls in the confirmation form (BI-0E4A1228 / BI-36807E68).
const RESTAURANT_INQUIRY_SCHEMA: FormField[] = [
  { name: "covers", label: "Number of guests", type: "number", required: true },
  { name: "date", label: "Preferred date", type: "text", required: true, placeholder: "DD/MM/YYYY" },
  { name: "time", label: "Preferred time", type: "select", required: true, options: ["6:00 PM", "6:30 PM"] },
  { name: "dietaryRequirements", label: "Dietary requirements", type: "textarea", required: false },
];

describe("slotFlowExtraFields (BI-0E4A1228 / BI-36807E68)", () => {
  it("drops the scheduling fields the slot flow already captured", () => {
    const names = slotFlowExtraFields(RESTAURANT_INQUIRY_SCHEMA).map((f) => f.name);

    // No blank duplicate Preferred date/time after slot selection.
    expect(names).not.toContain("date");
    expect(names).not.toContain("time");
    // Genuinely-extra fields the customer still needs to fill are kept.
    expect(names).toContain("covers");
    expect(names).toContain("dietaryRequirements");
  });

  it("matches scheduling field names regardless of case and separators", () => {
    const schema: FormField[] = [
      { name: "Preferred Date", label: "Preferred date", type: "text", required: true },
      { name: "preferred_time", label: "Preferred time", type: "text", required: true },
      { name: "preferredDate", label: "Preferred date", type: "text", required: true },
      { name: "partySize", label: "Party size", type: "number", required: true },
    ];

    const names = slotFlowExtraFields(schema).map((f) => f.name);
    expect(names).toEqual(["partySize"]);
  });

  it("still drops the explicit contact fields FormStep renders itself", () => {
    const schema: FormField[] = [
      { name: "name", label: "Full name", type: "text", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "phone", label: "Phone", type: "tel", required: false },
      { name: "allergens", label: "Allergens", type: "textarea", required: false },
    ];

    expect(slotFlowExtraFields(schema).map((f) => f.name)).toEqual(["allergens"]);
  });

  it("returns an empty array for an undefined schema", () => {
    expect(slotFlowExtraFields(undefined)).toEqual([]);
  });
});
