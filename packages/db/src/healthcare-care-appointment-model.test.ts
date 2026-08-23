import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Prisma } from "../generated/client/client";
import { prisma } from "./client";

describe("healthcare care appointment Prisma substrate", () => {
  it("models one typed subject while retaining conditional clinical relations", () => {
    const schema = readFileSync(
      resolve(__dirname, "../prisma/schema/verticals-care.prisma"),
      "utf8",
    );
    const appointment = schema.slice(
      schema.indexOf("model CareAppointment {"),
      schema.indexOf("model CareAppointmentParticipant {"),
    );

    expect(appointment).toContain("subjectKindSlug");
    expect(appointment).toContain("subjectRef");
    expect(appointment).toMatch(/patientProfileId\s+String\?/);
    expect(appointment).toMatch(/visitTypeId\s+String\?/);
    expect(appointment).toMatch(/locationId\s+String\?/);
    expect(appointment).toContain(
      '@@index([organizationId, subjectKindSlug, subjectRef, scheduledStart], map: "CareAppointment_organizationId_subjectKindSlug_subjectRef_idx")',
    );
    expect(appointment).toContain("recallAt");
    expect(appointment).toContain("overbookAuthorizedByPrincipalId");
    expect(appointment).toContain("preparationMinutes");
    expect(appointment).toContain("recoveryMinutes");
    expect(appointment).toContain("footprintStart");
    expect(appointment).toContain("footprintEnd");
  });

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
