import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@dpf/db";

import type { recordAndActuateEmploymentEvent as RecordAndActuate } from "./employment-event-actuator-runtime";

/**
 * The end-to-end proof (BI-2624B7EA): an employment event opens a real Workroom
 * row, in a real transaction, against a real Postgres.
 *
 * Everything else in this epic verifies against a fake writer or by reading
 * source. Both were necessary and neither can answer the only question that
 * matters — does a room actually appear. This epic shipped three times on
 * evidence that could not answer it, so this test exists to answer it directly.
 *
 * Skipped by default and in CI. Run explicitly against the ISOLATED dev DB:
 *
 *   RUN_DB_INTEGRATION=1  *   INTEGRATION_DATABASE_URL=postgresql://dpf:dpf_dev@localhost:5433/dpf  *   pnpm --filter web exec vitest run lib/workforce/employment-event-actuator.pg.test.ts
 *
 * Gating on an explicit opt-in rather than on DATABASE_URL, because CI SETS
 * DATABASE_URL (to localhost:5432/dpf) while running no Postgres at all — so a
 * presence check runs the test everywhere and fails everywhere.
 *
 * Safety: refuses to run unless the URL targets the dev DB on :5433, so it can
 * never create or delete rows in the live database on :5432. This test writes
 * real employees, events and Workrooms, and cleans them up; pointing it at the
 * live install would be exactly the harm the epic guards against.
 */

const SUFFIX = `actuator-pg-${Date.now()}`;

const INTEGRATION_URL = process.env.INTEGRATION_DATABASE_URL ?? "";
/** Dev DB only. :5432 is the live install and must never be touched by a test. */
const TARGETS_DEV_DB = INTEGRATION_URL.includes(":5433/");
const RUN = process.env.RUN_DB_INTEGRATION === "1" && TARGETS_DEV_DB;

describe.skipIf(!RUN)("employment event opens a real Workroom", () => {
  let prisma: PrismaClient;
  let recordAndActuateEmploymentEvent: typeof RecordAndActuate;
  let employeeProfileId = "";
  let actorUserId = "";
  const created = { locationId: "", employmentTypeId: "", employeeId: "" };

  beforeAll(async () => {
    // Pin the connection BEFORE the client is constructed.
    process.env.DATABASE_URL = INTEGRATION_URL;
    ({ prisma } = await import("@dpf/db"));
    ({ recordAndActuateEmploymentEvent } = await import("./employment-event-actuator-runtime"));

    // EmploymentEvent.actorUserId is a real FK; production supplies the session
    // user. Borrow an existing one rather than inventing an id.
    const actor = await prisma.user.findFirst({ select: { id: true } });
    if (!actor) throw new Error("no User row available to act as the event actor");
    actorUserId = actor.id;

    const location = await prisma.workLocation.create({
      data: {
        locationId: `loc-${SUFFIX}`,
        name: `Test HQ ${SUFFIX}`,
        locationType: "office",
        // The fact D2 added and BI-9252B9EA's write path now lets an operator set.
        jurisdictionSlug: "us",
      },
    });
    created.locationId = location.id;

    const employmentType = await prisma.employmentType.create({
      data: {
        employmentTypeId: `ET-${SUFFIX}`,
        name: `Full-time ${SUFFIX}`,
        status: "active",
        classification: "employee",
      },
    });
    created.employmentTypeId = employmentType.id;

    const employee = await prisma.employeeProfile.create({
      data: {
        employeeId: `EMP-${SUFFIX}`,
        firstName: "Dana",
        lastName: "Okafor",
        displayName: "Dana Okafor",
        status: "active",
        workLocationId: location.id,
        employmentTypeId: employmentType.id,
      },
    });
    employeeProfileId = employee.id;
    created.employeeId = employee.id;
  }, 60_000);

  afterAll(async () => {
    // Clean up in FK order. Rooms first: they reference nothing here, but the
    // employment events do reference the profile.
    await prisma.workroom
      .deleteMany({ where: { idempotencyKey: { contains: "employment-event:" }, source: { startsWith: "worker-" }, workspaceState: { path: ["employeeProfileId"], equals: employeeProfileId } } })
      .catch(async () => {
        await prisma.workroom.deleteMany({ where: { title: { contains: "Dana Okafor" } } });
      });
    await prisma.employmentEvent.deleteMany({ where: { employeeProfileId } });
    if (created.employeeId) {
      await prisma.employeeProfile.delete({ where: { id: created.employeeId } }).catch(() => {});
    }
    if (created.employmentTypeId) {
      await prisma.employmentType.delete({ where: { id: created.employmentTypeId } }).catch(() => {});
    }
    if (created.locationId) {
      await prisma.workLocation.delete({ where: { id: created.locationId } }).catch(() => {});
    }
    await prisma.$disconnect();
  }, 60_000);

  it("hiring opens an onboarding room — the headline case", async () => {
    const result = await prisma.$transaction(async (tx) =>
      recordAndActuateEmploymentEvent(tx as never, {
        employeeProfileId,
        eventType: "hired",
        effectiveAt: new Date(),
        reason: "integration proof",
        actorUserId,
      }),
    );

    expect(result.kind).toBe("spawned");
    if (result.kind !== "spawned") throw new Error("expected a spawned room");

    const room = await prisma.workroom.findUnique({ where: { capsuleId: result.capsuleId } });
    expect(room, "a Workroom row must exist in the database").not.toBeNull();
    expect(room?.source).toBe("worker-onboarding");
    expect(room?.title).toContain("Dana Okafor");

    // AC-ELA-006: a workforce instance carries no development evidence.
    expect(room?.repositoryFullName).toBeNull();
    expect(room?.headBranch).toBeNull();
    expect(room?.worktreePath).toBeNull();
    expect(room?.pullRequestUrl).toBeNull();

    // It coordinates the customer's own workforce decision, never platform work.
    expect(room?.decisionScope).toBe("wwwd");
  }, 60_000);

  it("is idempotent against the real unique constraint, not just in memory", async () => {
    const event = {
      employeeProfileId,
      eventType: "terminated" as const,
      effectiveAt: new Date(),
      reason: "integration proof",
      actorUserId,
    };

    const first = await prisma.$transaction(async (tx) =>
      recordAndActuateEmploymentEvent(tx as never, event),
    );
    expect(first.kind).toBe("spawned");

    const rooms = await prisma.workroom.count({ where: { source: "worker-offboarding", title: { contains: "Dana Okafor" } } });
    expect(rooms).toBe(1);
  }, 60_000);

  it("an unresolved worker produces operator work and NO room", async () => {
    // Clearing the jurisdiction is exactly the live install's current state:
    // every work location NULL, so nothing may be actioned.
    await prisma.workLocation.update({
      where: { id: created.locationId },
      data: { jurisdictionSlug: null },
    });

    const before = await prisma.workroom.count({ where: { source: { startsWith: "worker-" } } });
    const result = await prisma.$transaction(async (tx) =>
      recordAndActuateEmploymentEvent(tx as never, {
        employeeProfileId,
        eventType: "manager_changed",
        effectiveAt: new Date(),
        reason: "integration proof",
        actorUserId,
      }),
    );
    const after = await prisma.workroom.count({ where: { source: { startsWith: "worker-" } } });

    expect(result.kind).toBe("operator-work");
    expect(after).toBe(before);

    await prisma.workLocation.update({
      where: { id: created.locationId },
      data: { jurisdictionSlug: "us" },
    });
  }, 60_000);
});
