import { describe, expect, it } from "vitest";
import { CUSTOMER_SEGMENTS_MAX, sanitizeOfferPositioning } from "./offer-positioning";

describe("sanitizeOfferPositioning (BI-C1E83871)", () => {
  it("leaves absent fields out so a save never blanks what it did not send", () => {
    expect(sanitizeOfferPositioning({})).toEqual({ ok: true, data: {} });
  });

  it("trims the value proposition and clears it when emptied", () => {
    expect(sanitizeOfferPositioning({ valueProposition: "  Keep doing the paid work.  " })).toEqual({
      ok: true,
      data: { valueProposition: "Keep doing the paid work." },
    });
    expect(sanitizeOfferPositioning({ valueProposition: "   " })).toEqual({ ok: true, data: { valueProposition: null } });
  });

  it("trims, drops blanks and de-duplicates customer groups", () => {
    const result = sanitizeOfferPositioning({
      customerSegments: ["Owner-operated small businesses", "", "  MSP partners ", "msp partners"],
    });
    expect(result).toEqual({ ok: true, data: { customerSegments: ["Owner-operated small businesses", "MSP partners"] } });
  });

  it("refuses non-text, overlong and too many values instead of truncating", () => {
    expect(sanitizeOfferPositioning({ valueProposition: 5 }).ok).toBe(false);
    expect(sanitizeOfferPositioning({ valueProposition: "x".repeat(601) }).ok).toBe(false);
    expect(sanitizeOfferPositioning({ customerSegments: "MSPs" }).ok).toBe(false);
    expect(sanitizeOfferPositioning({ customerSegments: ["x".repeat(121)] }).ok).toBe(false);
    const many = Array.from({ length: CUSTOMER_SEGMENTS_MAX + 1 }, (_, i) => `Group ${i}`);
    expect(sanitizeOfferPositioning({ customerSegments: many }).ok).toBe(false);
  });
});
