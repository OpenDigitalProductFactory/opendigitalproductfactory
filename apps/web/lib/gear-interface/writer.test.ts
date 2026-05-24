// apps/web/lib/gear-interface/writer.test.ts
//
// Tests for the GearInterface writer service: idempotency key derivation,
// invariant validation (spec §3.1), and upsert/replay safety.

import { describe, it, expect, vi, beforeEach } from "vitest";

const gearRows = new Map<string, Record<string, unknown>>();
let nextId = 1;

vi.mock("@dpf/db", () => ({
  prisma: {
    gearInterface: {
      findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => {
        const row = gearRows.get(where.idempotencyKey);
        return row ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `gear-${nextId++}`,
          recordedAt: new Date(),
          schemaVersion: 1,
          slipDetected: false,
          capabilityVocabularyVersion: "raw-v0",
          transmissionDirection: "outward",
          ...data,
        };
        gearRows.set(String(data.idempotencyKey), row);
        return row;
      }),
    },
  },
  Prisma: {},
}));

import {
  emitGearInterface,
  deriveIdempotencyKey,
  validateGearInterfaceInput,
  GearInterfaceValidationError,
} from "./writer";
import type { GearInterfaceInput } from "./types";

beforeEach(() => {
  gearRows.clear();
  nextId = 1;
  vi.clearAllMocks();
});

function ring12Input(overrides: Partial<GearInterfaceInput> = {}): GearInterfaceInput {
  return {
    interfaceClass: "internal-adjacent",
    transmissionDirection: "outward",
    innerRing: 1,
    outerRing: 2,
    shaftSourceType: "phase-run",
    shaftSourceId: "phase-run-abc",
    actorType: "agent",
    actorId: "agent-build-specialist",
    intent: "complete-phase",
    capabilityName: "complete-phase",
    agentIdForTriple: "agent-build-specialist",
    torqueTechnical: 1.0,
    torqueConfidence: 0.8,
    ratioConsumed: 7,
    outcomeType: "transmission",
    graderType: "automated",
    ...overrides,
  };
}

describe("deriveIdempotencyKey", () => {
  it("produces the documented format", () => {
    const key = deriveIdempotencyKey(ring12Input());
    expect(key).toBe("internal-adjacent:1:2:outward:phase-run:phase-run-abc:transmission");
  });

  it("renders missing rings as 'null'", () => {
    const key = deriveIdempotencyKey({
      ...ring12Input(),
      interfaceClass: "external-federated",
      transmissionDirection: "lateral",
      innerRing: null,
      outerRing: null,
      externalCounterpartyType: "peer-install",
    });
    expect(key).toBe(
      "external-federated:null:null:lateral:phase-run:phase-run-abc:transmission",
    );
  });

  it("appends suffix when provided", () => {
    const key = deriveIdempotencyKey({
      ...ring12Input(),
      idempotencyKeySuffix: "graduation",
    });
    expect(key.endsWith(":graduation")).toBe(true);
  });

  it("defaults to outward direction when omitted", () => {
    const { transmissionDirection: _, ...rest } = ring12Input();
    void _;
    const key = deriveIdempotencyKey(rest as GearInterfaceInput);
    expect(key).toContain(":outward:");
  });
});

describe("validateGearInterfaceInput", () => {
  it("accepts a valid Ring 1→2 outward record", () => {
    expect(() => validateGearInterfaceInput(ring12Input())).not.toThrow();
  });

  it("rejects internal-adjacent without rings", () => {
    expect(() =>
      validateGearInterfaceInput({ ...ring12Input(), innerRing: null, outerRing: null }),
    ).toThrow(GearInterfaceValidationError);
  });

  it("rejects internal-adjacent with non-adjacent rings", () => {
    expect(() =>
      validateGearInterfaceInput({ ...ring12Input(), innerRing: 1, outerRing: 3 }),
    ).toThrow(/outerRing = innerRing \+ 1/);
  });

  it("rejects out-of-range rings", () => {
    expect(() =>
      validateGearInterfaceInput({ ...ring12Input(), innerRing: 0, outerRing: 1 }),
    ).toThrow(/1\.\.5/);
  });

  it("rejects lateral direction on internal-adjacent", () => {
    expect(() =>
      validateGearInterfaceInput({ ...ring12Input(), transmissionDirection: "lateral" }),
    ).toThrow(/lateral/);
  });

  it("requires externalCounterpartyType on external-* classes", () => {
    expect(() =>
      validateGearInterfaceInput({
        ...ring12Input(),
        interfaceClass: "external-federated",
        transmissionDirection: "lateral",
        innerRing: null,
        outerRing: null,
      }),
    ).toThrow(/externalCounterpartyType/);
  });

  it("requires graduation fields when outcomeType=graduation", () => {
    expect(() =>
      validateGearInterfaceInput({ ...ring12Input(), outcomeType: "graduation" }),
    ).toThrow(/graduation/);
  });

  it("accepts a complete graduation record", () => {
    expect(() =>
      validateGearInterfaceInput({
        ...ring12Input(),
        outcomeType: "graduation",
        graduationFromAutonomy: "hitl-required",
        graduationToAutonomy: "hitl-fallback",
        graduationGovernorRef: "di-123",
      }),
    ).not.toThrow();
  });

  it("rejects torque values outside [0,1]", () => {
    expect(() => validateGearInterfaceInput({ ...ring12Input(), torqueTechnical: 1.5 })).toThrow();
    expect(() => validateGearInterfaceInput({ ...ring12Input(), torqueConfidence: -0.1 })).toThrow();
    expect(() => validateGearInterfaceInput({ ...ring12Input(), torqueValue: 2 })).toThrow();
  });

  it("requires archetypeContext at Ring 2→3 and beyond", () => {
    expect(() =>
      validateGearInterfaceInput({
        ...ring12Input(),
        innerRing: 2,
        outerRing: 3,
      }),
    ).toThrow(/archetypeContext/);
  });

  it("allows missing Ring 2→3 archetypeContext only for archetype-unresolved slip rows", () => {
    expect(() =>
      validateGearInterfaceInput({
        ...ring12Input(),
        innerRing: 2,
        outerRing: 3,
        outcomeType: "slip",
        slipDetected: true,
        slipReason: "archetype-unresolved",
        archetypeContext: null,
      }),
    ).not.toThrow();

    expect(() =>
      validateGearInterfaceInput({
        ...ring12Input(),
        innerRing: 2,
        outerRing: 3,
        outcomeType: "slip",
        slipDetected: true,
        slipReason: "failed-outcome",
        archetypeContext: null,
      }),
    ).toThrow(/archetypeContext/);
  });

  it("allows null archetypeContext at Ring 1→2", () => {
    expect(() => validateGearInterfaceInput(ring12Input())).not.toThrow();
  });
});

describe("emitGearInterface", () => {
  it("creates a row on first call", async () => {
    const result = await emitGearInterface(ring12Input());
    expect(result).not.toBeNull();
    expect(result!.isNew).toBe(true);
    expect(gearRows.size).toBe(1);
  });

  it("is idempotent — second emit with same derived key returns the existing row", async () => {
    const first = await emitGearInterface(ring12Input());
    const second = await emitGearInterface(ring12Input());
    expect(first!.id).toBe(second!.id);
    expect(second!.isNew).toBe(false);
    expect(gearRows.size).toBe(1);
  });

  it("differentiates rows by idempotencyKeySuffix when one source emits multiple records", async () => {
    const a = await emitGearInterface(ring12Input({ idempotencyKeySuffix: "primary" }));
    const b = await emitGearInterface(ring12Input({ idempotencyKeySuffix: "graduation" }));
    expect(a!.id).not.toBe(b!.id);
    expect(gearRows.size).toBe(2);
  });

  it("returns null on validation failure rather than throwing", async () => {
    const result = await emitGearInterface(
      ring12Input({ torqueTechnical: 99, innerRing: 0, outerRing: 1 }),
    );
    expect(result).toBeNull();
    expect(gearRows.size).toBe(0);
  });

  it("derives idempotencyKey deterministically across calls", async () => {
    const a = await emitGearInterface(ring12Input());
    const b = await emitGearInterface(ring12Input());
    expect(a!.idempotencyKey).toBe(b!.idempotencyKey);
  });
});
