import { describe, expect, it } from "vitest";
import {
  parseRentalPhysicalProfile,
  serializeRentalPhysicalProfile,
  readRentalPoolCapacity,
  serializeRentalPoolCapacity,
} from "./rental-physical-profile";

describe("rental physical profile", () => {
  it("normalizes an equipment unit without trusting malformed values", () => {
    expect(parseRentalPhysicalProfile({
      rentalPhysical: {
        version: 1,
        kind: "equipment",
        location: { site: " North Yard ", zone: " Ready line ", position: " Bay 4 " },
        readiness: "ready",
        pickupWindowMinutes: 30,
        returnWindowMinutes: -5,
        capabilityKeys: ["mini-excavator", "mini-excavator", 42],
        maintenanceHold: {
          severity: "hard",
          reason: " Annual inspection ",
          startAt: "2026-08-03T08:00:00.000Z",
          endAt: "2026-08-03T12:00:00.000Z",
        },
      },
    })).toEqual({
      version: 1,
      kind: "equipment",
      location: { site: "North Yard", zone: "Ready line", position: "Bay 4" },
      readiness: "ready",
      pickupWindowMinutes: 30,
      returnWindowMinutes: 0,
      capabilityKeys: ["mini-excavator"],
      maintenanceHold: {
        severity: "hard",
        reason: "Annual inspection",
        startAt: "2026-08-03T08:00:00.000Z",
        endAt: "2026-08-03T12:00:00.000Z",
      },
    });
  });

  it("supports production-kit completeness and self-storage occupancy vocabulary", () => {
    expect(parseRentalPhysicalProfile({ rentalPhysical: {
      version: 1,
      kind: "production-kit",
      readiness: "incomplete",
      requiredItemCount: 8,
      readyItemCount: 6,
    } })).toMatchObject({ kind: "production-kit", requiredItemCount: 8, readyItemCount: 6 });

    expect(parseRentalPhysicalProfile({ rentalPhysical: {
      version: 1,
      kind: "self-storage",
      readiness: "ready",
      sizeLabel: "10 x 10",
      occupancy: "occupied",
      accessState: "overlocked",
      waitlistCount: 3,
      moveInAt: "2026-08-01T14:00:00.000Z",
    } })).toMatchObject({
      kind: "self-storage",
      sizeLabel: "10 x 10",
      occupancy: "occupied",
      accessState: "overlocked",
      waitlistCount: 3,
    });
  });

  it("returns a safe default for legacy or malformed JSON", () => {
    expect(parseRentalPhysicalProfile(null)).toMatchObject({
      version: 1,
      kind: "equipment",
      readiness: "unknown",
      capabilityKeys: [],
    });
    expect(parseRentalPhysicalProfile({ rentalPhysical: "bad" })).toMatchObject({
      kind: "equipment",
      readiness: "unknown",
    });
  });

  it("preserves unknown top-level and rental keys when editing known fields", () => {
    const current = {
      integrationOwned: { trackerId: "gps-1" },
      rentalPhysical: {
        version: 1,
        kind: "equipment",
        readiness: "charging",
        futureField: "preserve-me",
      },
    };

    expect(serializeRentalPhysicalProfile(current, {
      ...parseRentalPhysicalProfile(current),
      readiness: "ready",
    })).toEqual({
      integrationOwned: { trackerId: "gps-1" },
      rentalPhysical: expect.objectContaining({
        version: 1,
        kind: "equipment",
        readiness: "ready",
        futureField: "preserve-me",
      }),
    });
  });

  it("reads and updates quantity-pool capacity without erasing booking config", () => {
    expect(readRentalPoolCapacity({ rentalStockQuantity: 7.4 })).toBe(7);
    expect(serializeRentalPoolCapacity({ integrationKey: "keep" }, 12)).toEqual({
      integrationKey: "keep",
      rentalStockQuantity: 12,
    });
  });
});
