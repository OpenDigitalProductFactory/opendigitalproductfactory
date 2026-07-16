import { describe, expect, it } from "vitest";

import {
  CARE_PARTICIPATION_STATUSES,
  assertAppointmentTransition,
  calculateAppointmentFootprint,
  validateCareAppointmentAcceptance,
  type CareAppointmentAcceptance,
} from "./healthcare-care-appointment";

const baseAcceptance: CareAppointmentAcceptance = {
  organizationId: "org-a",
  storefrontBookingId: "booking-a",
  patientProfileId: "patient-a",
  visitTypeId: "visit-type-a",
  locationId: "location-a",
  scheduledStart: new Date("2026-08-01T14:00:00.000Z"),
  durationMinutes: 45,
  preparationMinutes: 10,
  recoveryMinutes: 15,
  participantProviderIds: ["provider-a"],
  resourceIds: ["room-a", "xray-a"],
  overbooking: null,
};

describe("healthcare care appointment contract", () => {
  it("uses the FHIR R4 participation status vocabulary", () => {
    expect(CARE_PARTICIPATION_STATUSES).toEqual([
      "needs-action",
      "accepted",
      "declined",
      "tentative",
    ]);
  });

  it("calculates the collision footprint including preparation and recovery", () => {
    expect(
      calculateAppointmentFootprint({
        scheduledStart: baseAcceptance.scheduledStart,
        durationMinutes: 45,
        preparationMinutes: 10,
        recoveryMinutes: 15,
      }),
    ).toEqual({
      footprintStart: new Date("2026-08-01T13:50:00.000Z"),
      scheduledEnd: new Date("2026-08-01T14:45:00.000Z"),
      footprintEnd: new Date("2026-08-01T15:00:00.000Z"),
    });
  });

  it("accepts an ordinary tenant-scoped multi-resource appointment", () => {
    expect(validateCareAppointmentAcceptance(baseAcceptance)).toEqual({
      ok: true,
      value: expect.objectContaining({
        participantProviderIds: ["provider-a"],
        resourceIds: ["room-a", "xray-a"],
      }),
    });
  });

  it.each([
    ["missing organization", { organizationId: "" }],
    ["zero duration", { durationMinutes: 0 }],
    ["negative preparation", { preparationMinutes: -1 }],
    ["duplicate provider", { participantProviderIds: ["provider-a", "provider-a"] }],
    ["duplicate resource", { resourceIds: ["room-a", "room-a"] }],
  ])("rejects %s", (_label, change) => {
    expect(
      validateCareAppointmentAcceptance({
        ...baseAcceptance,
        ...change,
      }),
    ).toEqual(expect.objectContaining({ ok: false }));
  });

  it("requires a human authorizer and reason for controlled overbooking", () => {
    expect(
      validateCareAppointmentAcceptance({
        ...baseAcceptance,
        overbooking: {
          authorizedByPrincipalId: "",
          reason: "Urgent care",
        },
      }),
    ).toEqual({
      ok: false,
      errors: expect.arrayContaining(["overbooking-authorizer-required"]),
    });

    expect(
      validateCareAppointmentAcceptance({
        ...baseAcceptance,
        overbooking: {
          authorizedByPrincipalId: "principal-clinical-lead",
          reason: "Urgent post-operative review",
        },
      }),
    ).toEqual(expect.objectContaining({ ok: true }));
  });

  it.each([
    ["proposed", "pending"],
    ["pending", "booked"],
    ["booked", "arrived"],
    ["arrived", "fulfilled"],
    ["booked", "no-show"],
    ["pending", "cancelled"],
  ] as const)("allows %s → %s", (from, to) => {
    expect(() => assertAppointmentTransition(from, to)).not.toThrow();
  });

  it.each([
    ["proposed", "fulfilled"],
    ["fulfilled", "arrived"],
    ["cancelled", "booked"],
    ["entered-in-error", "pending"],
  ] as const)("rejects %s → %s", (from, to) => {
    expect(() => assertAppointmentTransition(from, to)).toThrow(
      `Invalid care appointment transition: ${from} -> ${to}`,
    );
  });
});
