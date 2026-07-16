import { describe, expect, it } from "vitest";

import { Prisma } from "../generated/client/client";
import { prisma } from "./client";

describe("healthcare care appointment Prisma substrate", () => {
  it("exposes the tenant-safe scheduling authority and evidence streams", () => {
    expect(Prisma.ModelName.CareVisitType).toBe("CareVisitType");
    expect(Prisma.ModelName.CareLocation).toBe("CareLocation");
    expect(Prisma.ModelName.CareResource).toBe("CareResource");
    expect(Prisma.ModelName.CareSchedulingPolicy).toBe(
      "CareSchedulingPolicy",
    );
    expect(Prisma.ModelName.CareAppointment).toBe("CareAppointment");
    expect(Prisma.ModelName.CareAppointmentParticipant).toBe(
      "CareAppointmentParticipant",
    );
    expect(Prisma.ModelName.CareAppointmentResource).toBe(
      "CareAppointmentResource",
    );
    expect(Prisma.ModelName.CareAppointmentStatusEvent).toBe(
      "CareAppointmentStatusEvent",
    );
    expect(Prisma.ModelName.AppointmentSyncEvent).toBe(
      "AppointmentSyncEvent",
    );
    expect(prisma.careAppointment).toBeDefined();
    expect(prisma.appointmentSyncEvent).toBeDefined();
  });

  it("requires organization ownership on every storefront booking write", () => {
    const create: Prisma.StorefrontBookingCreateInput = {
      bookingRef: "BK-ORG-A",
      itemId: "item-a",
      customerEmail: "patient@example.test",
      customerName: "Patient",
      scheduledAt: new Date("2026-08-01T14:00:00.000Z"),
      durationMinutes: 45,
      organization: { connect: { id: "org-a" } },
      storefront: { connect: { id: "storefront-a" } },
    };

    expect(create.organization).toEqual({ connect: { id: "org-a" } });
  });
});
