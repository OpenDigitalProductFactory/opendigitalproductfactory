import { describe, expect, it } from "vitest";
import type { ResourceCapacityProfile } from "@dpf/storefront-templates";
import {
  createBeautyCapacityAdapter,
  projectBeautyCapacityFacts,
  type BeautyCapacityFacts,
} from "./capacity-adapter";

const profile: ResourceCapacityProfile = {
  archetypeId: "hair-salon",
  category: "beauty-personal-care",
  enabled: true,
  patterns: ["appointment"],
  authorities: ["provider-calendar", "beauty", "staffing"],
  resourceNoun: { singular: "chair", plural: "chairs" },
  physical: true,
  forwardHorizon: false,
  supportsBuffers: true,
  supportsTravel: false,
};
const input = {
  profile,
  organizationId: "org-1",
  window: { startAt: "2026-08-01T13:00:00.000Z", endAt: "2026-08-01T18:00:00.000Z" },
};

function facts(): BeautyCapacityFacts {
  return {
    observedAt: new Date("2026-08-01T15:30:00.000Z"),
    sourceVersion: "12",
    resources: [
      {
        id: "chair-1",
        organizationId: "org-1",
        kind: "chair",
        label: "Chair 1",
        status: "active",
        capacity: 1,
        capacityUnit: "appointments",
        serviceArea: "main-salon",
        version: 3,
        serviceItemIds: ["cut", "color"],
      },
      {
        id: "room-1",
        organizationId: "org-1",
        kind: "room",
        label: "Treatment Room 1",
        status: "blocked",
        capacity: 1,
        capacityUnit: "appointments",
        blockedReason: "Deep cleaning",
        version: 2,
        serviceItemIds: ["facial"],
      },
    ],
    availability: [{
      availabilityId: "available-1",
      resourceId: "chair-1",
      kind: "available",
      startsAt: new Date("2026-08-01T13:00:00.000Z"),
      endsAt: new Date("2026-08-01T18:00:00.000Z"),
    }],
    allocations: [
      {
        allocationId: "allocation-1",
        resourceId: "chair-1",
        demandRef: "BK-1",
        startsAt: new Date("2026-08-01T15:00:00.000Z"),
        endsAt: new Date("2026-08-01T16:15:00.000Z"),
        quantity: 1,
        lifecycle: "confirmed",
        version: 1,
      },
      {
        allocationId: "allocation-2",
        resourceId: "room-1",
        demandRef: "BK-2",
        startsAt: new Date("2026-08-01T16:00:00.000Z"),
        endsAt: new Date("2026-08-01T17:00:00.000Z"),
        quantity: 1,
        lifecycle: "confirmed",
        version: 1,
      },
    ],
    bookings: [
      {
        id: "booking-1",
        bookingRef: "BK-1",
        itemId: "color",
        providerId: "maya",
        providerName: "Maya",
        customerName: "Jo",
        scheduledAt: new Date("2026-08-01T15:00:00.000Z"),
        durationMinutes: 75,
        preparationMinutes: 10,
        cleanupMinutes: 15,
        status: "confirmed",
        requiredResourceCount: 1,
      },
      {
        id: "booking-2",
        bookingRef: "BK-2",
        itemId: "massage",
        providerId: "maya",
        providerName: "Maya",
        customerName: "Rae",
        scheduledAt: new Date("2026-08-01T16:00:00.000Z"),
        durationMinutes: 60,
        preparationMinutes: 0,
        cleanupMinutes: 10,
        status: "no-show-risk",
        requiredResourceCount: 2,
      },
      {
        id: "booking-3",
        bookingRef: "BK-3",
        itemId: "cut",
        providerId: null,
        providerName: null,
        customerName: "Bridal party",
        scheduledAt: new Date("2026-08-01T17:00:00.000Z"),
        durationMinutes: 60,
        preparationMinutes: 0,
        cleanupMinutes: 10,
        status: "confirmed",
        requiredResourceCount: 3,
      },
    ],
  };
}

describe("beauty capacity adapter", () => {
  it("projects chairs and rooms through the shared typed mirror", () => {
    const result = projectBeautyCapacityFacts(input, facts());

    expect(result.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Chair 1",
        status: "available",
        capabilityKeys: ["cut", "color"],
        ref: { authority: "beauty", resourceType: "chair", resourceId: "chair-1" },
      }),
      expect.objectContaining({ label: "Treatment Room 1", status: "blocked" }),
    ]));
    expect(result.allocations).toHaveLength(2);
    expect(result.watermark).toEqual({
      source: "beauty",
      observedAt: "2026-08-01T15:30:00.000Z",
      sourceVersion: "12",
    });
  });

  it("emits data-backed owner-language exceptions and idle gaps", () => {
    const result = projectBeautyCapacityFacts(input, facts());
    const kinds = result.attentionSignals.map((signal) => signal.kind);

    expect(kinds).toEqual(expect.arrayContaining([
      "blocked-resource",
      "unassigned-demand",
      "provider-overlap",
      "capability-mismatch",
      "unavailable",
      "no-show-risk",
      "group-incomplete",
      "idle-capacity",
    ]));
    expect(result.attentionSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ detail: expect.stringMatching(/Chair 1 is open for 120 min/) }),
      expect.objectContaining({ detail: "Maya is double-booked at 16:00." }),
      expect.objectContaining({ detail: "17:00 Bridal party appointment is not fully assigned." }),
    ]));
  });

  it("reports completely idle resources and the usable tail after the last appointment", () => {
    const completelyIdle = facts();
    completelyIdle.allocations = [];
    completelyIdle.bookings = [];
    completelyIdle.resources = completelyIdle.resources.filter((resource) => resource.id === "chair-1");

    expect(projectBeautyCapacityFacts(input, completelyIdle).attentionSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signalId: "beauty:idle:chair-1:1785589200000",
          detail: "Chair 1 is open for 300 min.",
        }),
      ]),
    );

    expect(projectBeautyCapacityFacts(input, facts()).attentionSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signalId: "beauty:idle:chair-1:1785600900000",
          detail: "Chair 1 is open for 105 min after the last appointment.",
        }),
      ]),
    );
  });

  it("degrades explicitly when its bounded source cannot load", async () => {
    const adapter = createBeautyCapacityAdapter(async () => {
      throw new Error("beauty store unavailable");
    });

    await expect(adapter.load(input)).resolves.toMatchObject({
      authority: "beauty",
      state: "degraded",
      diagnostic: "beauty store unavailable",
      resources: [],
    });
  });
});
