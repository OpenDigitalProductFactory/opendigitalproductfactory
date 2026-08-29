import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  EVENT_DISPOSITIONS,
  actuationIdempotencyKey,
  planActuation,
  type ActuationOutcome,
  type EmploymentEventInput,
} from "./employment-event-actuator";
import { LIFECYCLE_TRANSITION_MATRIX, type EmploymentEventType } from "./workforce-types";

/**
 * The 16 values, listed independently of the source union so this test is a real
 * check rather than a restatement. The parity test below proves the list matches
 * the shipped union.
 */
const ALL_EVENT_TYPES: EmploymentEventType[] = [
  "hired",
  "offer_created",
  "offer_accepted",
  "offer_withdrawn",
  "onboarding_started",
  "onboarding_completed",
  "activated",
  "manager_changed",
  "department_changed",
  "position_changed",
  "leave_started",
  "leave_ended",
  "offboarding_started",
  "offboarding_completed",
  "terminated",
  "reactivated",
];

function resolvedEvent(overrides: Partial<EmploymentEventInput> = {}): EmploymentEventInput {
  return {
    employmentEventId: "EE-1",
    eventType: "hired",
    employeeProfileId: "emp-1",
    classification: "employee",
    jurisdiction: "us",
    ...overrides,
  };
}

describe("every one of the 16 event types has an explicit disposition", () => {
  it("covers the union with no omissions", () => {
    expect(Object.keys(EVENT_DISPOSITIONS).sort()).toEqual([...ALL_EVENT_TYPES].sort());
    expect(ALL_EVENT_TYPES).toHaveLength(16);
  });

  it("stays in parity with the shipped union — a new event type fails this", () => {
    // The whole point of the actuator: an event type added to the union without
    // a disposition would silently do nothing, degrading it back into the log it
    // replaced. Read the source union rather than trusting the local list.
    const source = readFileSync(
      fileURLToPath(new URL("./workforce-types.ts", import.meta.url)),
      "utf8",
    );
    const union = /export type EmploymentEventType =([\s\S]*?);/.exec(source);
    if (!union) throw new Error("EmploymentEventType union not found");
    const declared = [...union[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

    expect(declared.sort()).toEqual([...ALL_EVENT_TYPES].sort());
    for (const value of declared) {
      expect(EVENT_DISPOSITIONS[value as EmploymentEventType]).toBeDefined();
    }
  });

  it("gives every inert and update disposition a recorded reason", () => {
    for (const eventType of ALL_EVENT_TYPES) {
      const disposition = EVENT_DISPOSITIONS[eventType];
      if (disposition.kind === "spawn") continue;
      expect(disposition.reason.trim().length).toBeGreaterThan(20);
    }
  });

  it("reaches a decision for every event type at runtime", () => {
    for (const eventType of ALL_EVENT_TYPES) {
      const outcome = planActuation(resolvedEvent({ eventType }));
      expect(["spawn", "update", "inert", "operator-work"]).toContain(outcome.kind);
    }
  });
});

describe("routing an event to its definition", () => {
  const cases: Array<[EmploymentEventType, string]> = [
    ["hired", "worker-onboarding"],
    ["offer_accepted", "worker-onboarding"],
    ["onboarding_started", "worker-onboarding"],
    ["manager_changed", "worker-change"],
    ["department_changed", "worker-change"],
    ["position_changed", "worker-change"],
    ["offboarding_started", "worker-offboarding"],
    ["terminated", "worker-offboarding"],
  ];

  for (const [eventType, definitionKey] of cases) {
    it(`${eventType} spawns ${definitionKey}`, () => {
      const outcome = planActuation(resolvedEvent({ eventType }));
      expect(outcome).toMatchObject({ kind: "spawn", definitionKey });
    });
  }

  it("updates rather than spawning for events that reach an open room", () => {
    for (const eventType of [
      "leave_started",
      "leave_ended",
      "activated",
      "reactivated",
      "onboarding_completed",
      "offboarding_completed",
    ] as const) {
      expect(planActuation(resolvedEvent({ eventType })).kind).toBe("update");
    }
  });

  it("is inert for an offer that is not yet a worker relationship", () => {
    for (const eventType of ["offer_created", "offer_withdrawn"] as const) {
      const outcome = planActuation(resolvedEvent({ eventType }));
      expect(outcome.kind).toBe("inert");
    }
  });

  it("only ever names a definition registered by BI-28EFA338", () => {
    const registry = readFileSync(
      fileURLToPath(new URL("../work-management/source-registry.ts", import.meta.url)),
      "utf8",
    );
    for (const eventType of ALL_EVENT_TYPES) {
      const disposition = EVENT_DISPOSITIONS[eventType];
      if (disposition.kind === "inert") continue;
      // No second registry, no invented key.
      expect(registry).toContain(`sourceKey: "${disposition.definitionKey}"`);
    }
  });
});

describe("idempotency", () => {
  it("derives the key from the event and the definition", () => {
    expect(actuationIdempotencyKey("EE-9", "worker-onboarding")).toBe(
      "employment-event:EE-9:worker-onboarding",
    );
  });

  it("is stable under replay — the same event yields the same key", () => {
    const first = planActuation(resolvedEvent({ employmentEventId: "EE-42" }));
    const second = planActuation(resolvedEvent({ employmentEventId: "EE-42" }));

    expect(first).toEqual(second);
    if (first.kind !== "spawn" || second.kind !== "spawn") throw new Error("expected spawn");
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
  });

  it("two concurrent writers of the same transition compute one key", () => {
    // The uniqueness is enforced by Workroom.idempotencyKey's unique constraint;
    // what this proves is that both racers present the SAME key, so the database
    // collapses them rather than admitting two rooms.
    const keys = new Set(
      Array.from({ length: 8 }, () => {
        const outcome = planActuation(resolvedEvent({ employmentEventId: "EE-race" }));
        return outcome.kind === "spawn" ? outcome.idempotencyKey : "";
      }),
    );

    expect(keys.size).toBe(1);
  });

  it("distinguishes different events and different definitions", () => {
    const a = actuationIdempotencyKey("EE-1", "worker-onboarding");
    const b = actuationIdempotencyKey("EE-2", "worker-onboarding");
    const c = actuationIdempotencyKey("EE-1", "worker-offboarding");

    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("unresolved inputs produce operator work, never a partial instance", () => {
  it("refuses on unresolved classification", () => {
    const outcome = planActuation(resolvedEvent({ classification: null }));

    expect(outcome).toMatchObject({ kind: "operator-work", reason: "classification-unresolved" });
    if (outcome.kind !== "operator-work") throw new Error("expected operator work");
    expect(outcome.message).toMatch(/determination/i);
  });

  it("refuses on unresolved jurisdiction", () => {
    const outcome = planActuation(resolvedEvent({ jurisdiction: null }));

    expect(outcome).toMatchObject({ kind: "operator-work", reason: "jurisdiction-unresolved" });
  });

  it("never emits a spawn or update when either input is unresolved", () => {
    for (const eventType of ALL_EVENT_TYPES) {
      if (EVENT_DISPOSITIONS[eventType].kind === "inert") continue;
      for (const overrides of [{ classification: null }, { jurisdiction: null }] as const) {
        const outcome = planActuation(resolvedEvent({ eventType, ...overrides }));
        expect(outcome.kind).toBe("operator-work");
      }
    }
  });

  it("stays inert for a genuinely inert event even with unresolved inputs", () => {
    // An event that will never produce work must not generate operator work
    // demanding a classification nobody needs — that trains operators to ignore
    // the queue.
    const outcome = planActuation(
      resolvedEvent({ eventType: "offer_created", classification: null, jurisdiction: null }),
    );

    expect(outcome.kind).toBe("inert");
  });
});

describe("it adds no second state machine", () => {
  it("does not re-validate the transition it was handed", () => {
    // LIFECYCLE_TRANSITION_MATRIX stays the sole authority. The actuator reads an
    // already-validated event; it takes no status arguments at all, so it cannot
    // form a second opinion about legality.
    const outcome: ActuationOutcome = planActuation(resolvedEvent({ eventType: "terminated" }));
    expect(outcome.kind).toBe("spawn");

    const inputKeys = Object.keys(resolvedEvent());
    expect(inputKeys).not.toContain("currentStatus");
    expect(inputKeys).not.toContain("nextStatus");
  });

  it("leaves the transition matrix untouched", () => {
    expect(Object.keys(LIFECYCLE_TRANSITION_MATRIX).sort()).toEqual([
      "active",
      "inactive",
      "leave",
      "offboarding",
      "offer",
      "onboarding",
      "suspended",
    ]);
  });
});
