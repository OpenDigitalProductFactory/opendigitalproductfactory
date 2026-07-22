import { describe, it, expect } from "vitest";
import {
  formatReservationWhen,
  nextActionForReservation,
  parseCovers,
  reservationActionLabel,
  structuredBookingFieldRole,
} from "./booking-summary";

describe("structuredBookingFieldRole", () => {
  it("maps covers + dietary field names to their structured roles", () => {
    expect(structuredBookingFieldRole("covers")).toBe("covers");
    expect(structuredBookingFieldRole("partySize")).toBe("covers");
    expect(structuredBookingFieldRole("dietaryRequirements")).toBe("dietary");
    expect(structuredBookingFieldRole("allergies")).toBe("dietary");
    // Genuinely-extra fields carry no structured role — they fall through to notes.
    expect(structuredBookingFieldRole("notes")).toBeNull();
    expect(structuredBookingFieldRole("eventType")).toBeNull();
  });
});

describe("parseCovers", () => {
  it("parses a plain count and the '10+' bucket", () => {
    expect(parseCovers("2")).toBe(2);
    expect(parseCovers("10+")).toBe(10);
  });
  it("returns null for empty / non-numeric values", () => {
    expect(parseCovers("")).toBeNull();
    expect(parseCovers(null)).toBeNull();
    expect(parseCovers(undefined)).toBeNull();
    expect(parseCovers("none")).toBeNull();
  });
});

describe("formatReservationWhen", () => {
  it("surfaces the guest-local slot time in the storefront timezone", () => {
    // 22:30 UTC is 6:30 PM in America/New_York (EDT).
    const when = formatReservationWhen(new Date("2026-07-22T22:30:00.000Z"), "America/New_York");
    expect(when.timeLabel).toBe("6:30 PM");
    expect(when.dateLabel).toContain("22");
    expect(when.dateLabel).toContain("Jul");
    expect(when.whenLabel).toContain("6:30 PM");
  });
});

describe("nextActionForReservation", () => {
  it("gives a plain next action per status", () => {
    expect(nextActionForReservation("pending")).toMatch(/confirm/i);
    expect(nextActionForReservation("needs-reschedule")).toMatch(/new time/i);
    expect(nextActionForReservation("confirmed")).toMatch(/ready/i);
    expect(nextActionForReservation("cancelled")).toMatch(/no action/i);
  });
});

describe("reservationActionLabel", () => {
  it("builds the row-specific accessible label from intake state", () => {
    expect(
      reservationActionLabel("Confirm", {
        guestName: "Jane Smith",
        itemName: "Table for 2",
        timeLabel: "6:30 PM",
      }),
    ).toBe("Confirm Jane Smith, Table for 2 at 6:30 PM");
  });

  it("degrades gracefully when facts are missing", () => {
    expect(reservationActionLabel("Cancel", { guestName: "Jane Smith" })).toBe("Cancel Jane Smith");
    expect(reservationActionLabel("Confirm", {})).toBe("Confirm");
  });
});
