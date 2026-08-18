
import { describe, expect, it } from "vitest";
import { readCanonicalPrismaSchema } from "./schema-source";

const schema = readCanonicalPrismaSchema();

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(match, `Prisma model ${name} must exist`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("beauty resource capacity schema", () => {
  it("owns fixed physical resources without broadening people or hospitality", () => {
    const resource = model("BeautyResource");
    const provider = model("ServiceProvider");
    const hospitality = model("HospitalityResource");

    for (const field of [
      "resourceId",
      "organizationId",
      "storefrontId",
      "kind",
      "label",
      "status",
      "capacity",
      "capacityUnit",
      "serviceArea",
      "blockedReason",
      "attributes",
      "version",
    ]) {
      expect(resource).toMatch(new RegExp(`\\b${field}\\b`));
    }

    expect(resource).toContain("@@unique([id, organizationId])");
    expect(resource).toContain("@@unique([storefrontId, resourceId])");
    expect(provider).not.toMatch(/\bbeautyResourceId\b|\bphysicalResourceKind\b/);
    expect(hospitality).not.toMatch(/\bbeautyKind\b|\bbeautyService\b/);
  });

  it("declares resource-to-service eligibility explicitly", () => {
    const eligibility = model("BeautyResourceService");

    expect(eligibility).toMatch(/\bresourceId\s+String\b/);
    expect(eligibility).toMatch(/\bitemId\s+String\b/);
    expect(eligibility).toContain("@@unique([resourceId, itemId])");
  });

  it("separates physical availability from provider working time", () => {
    const availability = model("BeautyResourceAvailability");

    for (const field of [
      "availabilityId",
      "organizationId",
      "resourceId",
      "kind",
      "days",
      "startTime",
      "endTime",
      "date",
      "startsAt",
      "endsAt",
      "reason",
      "version",
    ]) {
      expect(availability).toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(availability).toContain(
      "@relation(fields: [resourceId, organizationId], references: [id, organizationId]",
    );
  });

  it("persists booking and hold allocations with tenant-safe relations", () => {
    const allocation = model("BeautyCapacityAllocation");

    for (const field of [
      "allocationId",
      "organizationId",
      "storefrontId",
      "resourceId",
      "bookingId",
      "bookingHoldId",
      "demandType",
      "demandRef",
      "startsAt",
      "endsAt",
      "quantity",
      "lifecycle",
      "idempotencyKey",
      "version",
      "releasedAt",
      "releaseReason",
    ]) {
      expect(allocation).toMatch(new RegExp(`\\b${field}\\b`));
    }

    expect(allocation).toContain("@@unique([organizationId, idempotencyKey])");
    expect(allocation).toContain("@@index([resourceId, startsAt, endsAt])");
    expect(allocation).toMatch(
      /booking\s+StorefrontBooking\?[\s\S]*?fields: \[bookingId, organizationId\], references: \[id, organizationId\]/,
    );
    expect(allocation).toMatch(
      /bookingHold\s+BookingHold\?[\s\S]*?fields: \[bookingHoldId, organizationId\], references: \[id, organizationId\]/,
    );
  });
});
