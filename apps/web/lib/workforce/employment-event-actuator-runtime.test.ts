import { describe, expect, it } from "vitest";

import {
  actuateEmploymentEvent,
  resolveActuationInputs,
  type ActuatorCapsuleWriter,
  type ActuatorWorkerRow,
} from "./employment-event-actuator-runtime";
import { BUSINESS_WORK_CAPSULE_SOURCES, WORK_CAPSULE_SOURCES } from "../work-capsules";

function worker(overrides: Partial<ActuatorWorkerRow> = {}): ActuatorWorkerRow {
  return {
    id: "emp-1",
    displayName: "Dana Okafor",
    employmentType: { classification: "employee" },
    workLocation: { id: "loc-1", jurisdictionSlug: "us" },
    ...overrides,
  };
}

function writer(seed: Record<string, { id: string; capsuleId: string }> = {}) {
  const rooms = new Map(Object.entries(seed));
  const created: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];

  const impl: ActuatorCapsuleWriter = {
    async createWorkCapsule(args) {
      created.push(args.input);
      // Mirrors the real unique constraint on Workroom.idempotencyKey.
      const existing = rooms.get(args.input.idempotencyKey);
      if (existing) return existing;
      const row = { id: `row-${rooms.size + 1}`, capsuleId: `WC-${rooms.size + 1}` };
      rooms.set(args.input.idempotencyKey, row);
      return row;
    },
    async findByIdempotencyKey(key) {
      return rooms.get(key) ?? null;
    },
    async recordUpdate(args) {
      updates.push(args);
    },
  };

  return { impl, created, updates, rooms };
}

describe("resolveActuationInputs", () => {
  it("resolves both facts for a fully described worker", () => {
    expect(resolveActuationInputs(worker(), ["us"])).toEqual({
      classification: "employee",
      jurisdiction: "us",
    });
  });

  it("returns null rather than a default when either is unresolved", () => {
    expect(resolveActuationInputs(worker({ employmentType: null }), ["us"]).classification).toBeNull();
    expect(resolveActuationInputs(worker({ workLocation: null }), ["us"]).jurisdiction).toBeNull();
    expect(
      resolveActuationInputs(worker({ workLocation: { id: "l", jurisdictionSlug: "eu" } }), ["us"])
        .jurisdiction,
    ).toBeNull();
  });

  it("never yields global for an unresolved jurisdiction", () => {
    const resolved = resolveActuationInputs(worker({ workLocation: null }), ["us"]);
    expect(resolved.jurisdiction).not.toBe("global");
  });
});

describe("actuateEmploymentEvent — the edge the epic exists to build", () => {
  it("hiring a worker opens an onboarding room", async () => {
    const w = writer();
    const result = await actuateEmploymentEvent({
      employmentEventId: "EE-1",
      eventType: "hired",
      worker: worker(),
      employsIn: ["us"],
      writer: w.impl,
    });

    expect(result).toMatchObject({ kind: "spawned", definitionKey: "worker-onboarding" });
    expect(w.created).toHaveLength(1);
    expect(w.created[0]).toMatchObject({
      source: "worker-onboarding",
      idempotencyKey: "employment-event:EE-1:worker-onboarding",
      scope: { decisionScope: "wwwd", portfolioRole: "forEmployees" },
    });
    expect(String(w.created[0].title)).toContain("Dana Okafor");
  });

  it("terminating a worker opens an offboarding room", async () => {
    const w = writer();
    const result = await actuateEmploymentEvent({
      employmentEventId: "EE-2",
      eventType: "terminated",
      worker: worker(),
      employsIn: ["us"],
      writer: w.impl,
    });

    expect(result).toMatchObject({ kind: "spawned", definitionKey: "worker-offboarding" });
    expect(String(w.created[0].objective)).toMatch(/revocation/i);
  });

  it("is idempotent under replay — the same event yields one room", async () => {
    const w = writer();
    const args = {
      employmentEventId: "EE-3",
      eventType: "hired" as const,
      worker: worker(),
      employsIn: ["us"],
      writer: w.impl,
    };

    const first = await actuateEmploymentEvent(args);
    const second = await actuateEmploymentEvent(args);
    const third = await actuateEmploymentEvent(args);

    expect(first.kind).toBe("spawned");
    expect(second.kind).toBe("already-present");
    expect(third.kind).toBe("already-present");
    expect(w.rooms.size).toBe(1);
  });

  it("two concurrent writers of the same transition yield one room", async () => {
    const w = writer();
    const args = {
      employmentEventId: "EE-race",
      eventType: "hired" as const,
      worker: worker(),
      employsIn: ["us"],
      writer: w.impl,
    };

    await Promise.all([
      actuateEmploymentEvent(args),
      actuateEmploymentEvent(args),
      actuateEmploymentEvent(args),
    ]);

    // Both racers pass the pre-check, both call create, and the store collapses
    // them on the idempotency key — which is what the unique constraint does.
    expect(w.rooms.size).toBe(1);
  });

  it("an unresolved worker produces operator work, never a partial room", async () => {
    for (const broken of [
      worker({ employmentType: null }),
      worker({ employmentType: { classification: null } }),
      worker({ workLocation: null }),
      worker({ workLocation: { id: "l", jurisdictionSlug: null } }),
    ]) {
      const w = writer();
      const result = await actuateEmploymentEvent({
        employmentEventId: "EE-x",
        eventType: "hired",
        worker: broken,
        employsIn: ["us"],
        writer: w.impl,
      });

      expect(result.kind).toBe("operator-work");
      expect(w.created).toHaveLength(0);
      expect(w.rooms.size).toBe(0);
    }
  });

  it("an inert event writes nothing at all", async () => {
    const w = writer();
    const result = await actuateEmploymentEvent({
      employmentEventId: "EE-4",
      eventType: "offer_created",
      worker: worker(),
      employsIn: ["us"],
      writer: w.impl,
    });

    expect(result.kind).toBe("inert");
    expect(w.created).toHaveLength(0);
  });

  it("an update reaches the open room instead of opening a rival", async () => {
    const w = writer();
    await actuateEmploymentEvent({
      employmentEventId: "EE-5",
      eventType: "hired",
      worker: worker(),
      employsIn: ["us"],
      writer: w.impl,
    });

    const result = await actuateEmploymentEvent({
      employmentEventId: "EE-5",
      eventType: "activated",
      worker: worker(),
      employsIn: ["us"],
      writer: w.impl,
    });

    expect(result.kind).toBe("updated");
    expect(w.rooms.size).toBe(1);
    expect(w.updates).toHaveLength(1);
  });

  it("records a missing update target rather than inventing a room", async () => {
    const w = writer();
    const result = await actuateEmploymentEvent({
      employmentEventId: "EE-6",
      eventType: "leave_started",
      worker: worker(),
      employsIn: ["us"],
      writer: w.impl,
    });

    expect(result.kind).toBe("update-target-missing");
    expect(w.created).toHaveLength(0);
  });
});

describe("the spawned room is a business instance, not a development one", () => {
  it("every definition the actuator spawns is an accepted capsule source", async () => {
    // Before BI-2624B7EA these keys were in WORK_CASE_SOURCE_REGISTRY but in
    // neither closed set that admits an instance, so the definitions had no
    // carrier at all.
    for (const key of ["worker-onboarding", "worker-change", "worker-offboarding"]) {
      expect(WORK_CAPSULE_SOURCES as readonly string[]).toContain(key);
      expect(BUSINESS_WORK_CAPSULE_SOURCES.has(key)).toBe(true);
    }
  });

  it("carries no repository, worktree, PR or CI evidence (AC-ELA-006)", async () => {
    const w = writer();
    await actuateEmploymentEvent({
      employmentEventId: "EE-7",
      eventType: "hired",
      worker: worker(),
      employsIn: ["us"],
      writer: w.impl,
    });

    const input = w.created[0];
    for (const developmentField of [
      "repositoryFullName",
      "baseBranch",
      "headBranch",
      "headSha",
      "worktreePath",
      "pullRequestUrl",
      "sandboxId",
    ]) {
      expect(input).not.toHaveProperty(developmentField);
    }
  });

  it("never claims wwmd — a workforce room is the customer's decision", async () => {
    const w = writer();
    await actuateEmploymentEvent({
      employmentEventId: "EE-8",
      eventType: "manager_changed",
      worker: worker(),
      employsIn: ["us"],
      writer: w.impl,
    });

    expect(w.created[0].scope).toEqual({ decisionScope: "wwwd", portfolioRole: "forEmployees" });
  });
});
