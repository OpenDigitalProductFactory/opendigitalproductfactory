
import { describe, expect, it } from "vitest";
import { readCanonicalPrismaSchema } from "./schema-source";

const schema = readCanonicalPrismaSchema();

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(match, `Prisma model ${name} must exist`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("food and hospitality resource capacity schema", () => {
  it("owns discrete resources without extending the human provider model", () => {
    const resource = model("HospitalityResource");
    const provider = model("ServiceProvider");

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
      "legacyServiceProviderId",
    ]) {
      expect(resource).toMatch(new RegExp(`\\b${field}\\b`));
    }

    expect(resource).toContain("@@unique([id, organizationId])");
    expect(resource).toContain("@@unique([storefrontId, resourceId])");
    expect(provider).not.toMatch(/\bresourceKind\b|\bcapacityUnit\b|\bblockedReason\b/);
  });

  it("models aggregate supply separately from discrete resources", () => {
    const pool = model("HospitalityCapacityPool");

    for (const field of [
      "poolId",
      "organizationId",
      "storefrontId",
      "kind",
      "label",
      "capacity",
      "capacityUnit",
      "intervalMinutes",
      "status",
      "version",
    ]) {
      expect(pool).toMatch(new RegExp(`\\b${field}\\b`));
    }

    expect(pool).toContain("@@unique([id, organizationId])");
    expect(pool).toContain("@@unique([storefrontId, poolId])");
  });

  it("owns resource availability and blocks outside the human schedule", () => {
    const availability = model("HospitalityResourceAvailability");

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

  it("persists lifecycle allocations with one typed demand reference", () => {
    const allocation = model("HospitalityCapacityAllocation");

    for (const field of [
      "allocationId",
      "organizationId",
      "storefrontId",
      "resourceId",
      "poolId",
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
      "conflictQuarantinedAt",
    ]) {
      expect(allocation).toMatch(new RegExp(`\\b${field}\\b`));
    }

    expect(allocation).toContain("@@unique([organizationId, idempotencyKey])");
    expect(allocation).toContain("@@index([resourceId, startsAt, endsAt])");
    expect(allocation).toContain("@@index([poolId, startsAt, endsAt])");
  });

  it("bridges bookings and holds to structured resources during fleet convergence", () => {
    const booking = model("StorefrontBooking");
    const hold = model("BookingHold");

    expect(booking).toMatch(/\bhospitalityResourceId\s+String\?/);
    expect(booking).toMatch(
      /@relation\([^)]*fields: \[hospitalityResourceId, organizationId\], references: \[id, organizationId\]/,
    );
    expect(hold).toMatch(/\bhospitalityResourceId\s+String\?/);
    expect(hold).toMatch(/\borganizationId\s+String\b/);
    expect(hold).toMatch(
      /@relation\([^)]*fields: \[hospitalityResourceId, organizationId\], references: \[id, organizationId\]/,
    );
  });
});
