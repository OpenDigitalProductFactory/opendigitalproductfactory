import { describe, expect, it } from "vitest";

import {
  evaluateMovement,
  hashMovement,
  verifyChain,
  type HandlerGrant,
  type HashableMovement,
  type LedgerContext,
  type MovementProposal,
} from "./ledger-policy";
import { formatQuantity, parseQuantity } from "./quantity";

const T0 = new Date("2026-01-01T00:00:00Z");
const NOW = new Date("2026-09-30T15:00:00Z");

const julia = { id: "p-julia", kind: "human", status: "active" };
const theo = { id: "p-theo", kind: "human", status: "active" };
const coworker = { id: "p-ai", kind: "agent", status: "active" };

function grant(principalId: string, scope: HandlerGrant["scope"], effectiveTo: Date | null = null): HandlerGrant {
  return { principalId, scope, effectiveFrom: T0, effectiveTo };
}

const ALL_SCOPES: HandlerGrant["scope"][] = [
  "receive",
  "administer",
  "dispense",
  "waste",
  "witness",
  "transfer",
  "destroy",
  "count",
  "reconcile",
];

function context(overrides: Partial<LedgerContext> = {}): LedgerContext {
  return {
    currentBalance: parseQuantity("10"),
    productWasteWitnessRequired: true,
    grants: [...ALL_SCOPES.map((scope) => grant(julia.id, scope)), ...ALL_SCOPES.map((scope) => grant(theo.id, scope))],
    registerActive: true,
    productActive: true,
    ...overrides,
  };
}

function proposal(overrides: Partial<MovementProposal>): MovementProposal {
  return { kind: "administration", quantityDelta: parseQuantity("-1"), occurredAt: NOW, actor: julia, ...overrides };
}

function codes(result: ReturnType<typeof evaluateMovement>): string[] {
  return result.allowed ? [] : result.refusals.map((refusal) => refusal.code);
}

describe("quantities", () => {
  it("round-trips exact four-place decimals without floating point drift", () => {
    expect(formatQuantity(parseQuantity("0.1") + parseQuantity("0.2"))).toBe("0.3000");
    expect(formatQuantity(parseQuantity("-2.5"))).toBe("-2.5000");
    expect(() => parseQuantity("1.23456")).toThrow();
    expect(parseQuantity("1.23450")).toBe(parseQuantity("1.2345"));
  });
});

describe("evaluateMovement", () => {
  it("accepts an administration with a patient and reports the new balance", () => {
    const result = evaluateMovement(proposal({ patientProfileId: "pat-1" }), context());
    expect(result).toMatchObject({ allowed: true, balanceBefore: parseQuantity("10"), balanceAfter: parseQuantity("9") });
  });

  it("requires the patient on administration and dispense (21 CFR 1304.22(c))", () => {
    expect(codes(evaluateMovement(proposal({}), context()))).toContain("patient_required");
    expect(codes(evaluateMovement(proposal({ kind: "dispense", animalProfileId: "a-1" }), context()))).toEqual([]);
    expect(
      codes(evaluateMovement(proposal({ patientProfileId: "pat-1", animalProfileId: "a-1" }), context())),
    ).toContain("single_subject_only");
  });

  it("refuses a movement in the wrong direction for its kind", () => {
    expect(codes(evaluateMovement(proposal({ kind: "receipt", quantityDelta: parseQuantity("-5") }), context()))).toContain(
      "wrong_sign",
    );
    expect(codes(evaluateMovement(proposal({ quantityDelta: parseQuantity("1"), patientProfileId: "p" }), context()))).toContain(
      "wrong_sign",
    );
  });

  it("never lets a balance go negative", () => {
    const result = evaluateMovement(proposal({ quantityDelta: parseQuantity("-10.0001"), patientProfileId: "p" }), context());
    expect(codes(result)).toEqual(["insufficient_balance"]);
  });

  it("requires receipt counterparty and document", () => {
    const result = evaluateMovement(proposal({ kind: "receipt", quantityDelta: parseQuantity("100") }), context());
    expect(codes(result)).toEqual(expect.arrayContaining(["counterparty_required", "document_required"]));
  });

  it("refuses an AI coworker or inactive person as actor", () => {
    expect(codes(evaluateMovement(proposal({ actor: coworker, patientProfileId: "p" }), context()))).toContain("actor_not_human");
    expect(
      codes(evaluateMovement(proposal({ actor: { ...julia, status: "inactive" }, patientProfileId: "p" }), context())),
    ).toContain("actor_not_human");
  });

  it("refuses an actor without the scope at the time the movement occurred", () => {
    const revoked = context({ grants: [grant(julia.id, "administer", new Date("2026-06-01T00:00:00Z"))] });
    expect(codes(evaluateMovement(proposal({ patientProfileId: "p" }), revoked))).toEqual(["actor_not_authorized"]);
    const backdated = proposal({ patientProfileId: "p", occurredAt: new Date("2026-05-01T00:00:00Z") });
    expect(codes(evaluateMovement(backdated, revoked))).toEqual([]);
  });

  describe("witnessing", () => {
    it("requires a different, authorized person to witness destruction (21 CFR 1317.95)", () => {
      const destroy = proposal({ kind: "destruction", quantityDelta: parseQuantity("-2"), documentRef: "DEA-41-0001" });
      expect(codes(evaluateMovement(destroy, context()))).toEqual(["witness_required"]);
      expect(codes(evaluateMovement({ ...destroy, witness: julia }, context()))).toEqual(["witness_is_actor"]);
      expect(codes(evaluateMovement({ ...destroy, witness: coworker }, context()))).toEqual(["witness_not_human"]);
      const theoCannotWitness = context({ grants: ALL_SCOPES.map((scope) => grant(julia.id, scope)) });
      expect(codes(evaluateMovement({ ...destroy, witness: theo }, theoCannotWitness))).toEqual(["witness_not_authorized"]);
      expect(codes(evaluateMovement({ ...destroy, witness: theo }, context()))).toEqual([]);
    });

    it("applies the product's waste-witness policy", () => {
      const waste = proposal({ kind: "waste", quantityDelta: parseQuantity("-0.3") });
      expect(codes(evaluateMovement(waste, context()))).toEqual(["witness_required"]);
      expect(codes(evaluateMovement(waste, context({ productWasteWitnessRequired: false })))).toEqual([]);
    });
  });

  it("requires a count, discrepancy, witness and reason for a count adjustment", () => {
    const result = evaluateMovement(proposal({ kind: "count_adjustment", quantityDelta: parseQuantity("-1") }), context());
    expect(codes(result)).toEqual(
      expect.arrayContaining(["witness_required", "count_required", "discrepancy_required", "reason_required"]),
    );
  });

  describe("reversal", () => {
    const target = {
      id: "m-1",
      kind: "administration" as const,
      quantityDelta: parseQuantity("-1"),
      alreadyReversed: false,
      sameRegisterAndProduct: true,
    };

    it("accepts an exact negation with a reason", () => {
      const result = evaluateMovement(
        proposal({ kind: "reversal", quantityDelta: parseQuantity("1"), reverses: target, reason: "Wrong patient" }),
        context(),
      );
      expect(result.allowed).toBe(true);
    });

    it("refuses a partial, repeated, reasonless or reversal-of-reversal entry", () => {
      const base = proposal({ kind: "reversal", quantityDelta: parseQuantity("0.5"), reverses: target });
      expect(codes(evaluateMovement(base, context()))).toEqual(
        expect.arrayContaining(["reversal_not_negation", "reason_required"]),
      );
      expect(
        codes(
          evaluateMovement(
            { ...base, quantityDelta: parseQuantity("1"), reason: "x", reverses: { ...target, alreadyReversed: true } },
            context(),
          ),
        ),
      ).toEqual(["reversal_already_reversed"]);
      expect(
        codes(
          evaluateMovement(
            { ...base, quantityDelta: parseQuantity("1"), reason: "x", reverses: { ...target, kind: "reversal" } },
            context(),
          ),
        ),
      ).toEqual(["reversal_target_invalid"]);
    });
  });
});

describe("hash chain", () => {
  function chain(): Array<HashableMovement & { entryHash: string }> {
    const deltas = ["100", "-1", "-0.25", "-2"];
    let previousHash: string | null = null;
    let balance = 0n;
    return deltas.map((delta, index) => {
      const quantityDelta = parseQuantity(delta);
      const movement: HashableMovement = {
        movementRef: `CSM-${index + 1}`,
        organizationId: "org",
        registerId: "reg",
        productId: "prod",
        sequence: index + 1,
        kind: index === 0 ? "receipt" : "administration",
        quantityDelta: formatQuantity(quantityDelta),
        balanceBefore: formatQuantity(balance),
        balanceAfter: formatQuantity(balance + quantityDelta),
        lotNumber: "LOT-7",
        lotExpiresAt: null,
        occurredAt: new Date(NOW.getTime() + index * 60000),
        actorPrincipalId: julia.id,
        witnessPrincipalId: null,
        patientProfileId: index === 0 ? null : "pat-1",
        animalProfileId: null,
        counterpartyName: index === 0 ? "Supplier" : null,
        counterpartyRegistration: null,
        documentRef: index === 0 ? "INV-1" : null,
        reason: null,
        reversesMovementId: null,
        countId: null,
        discrepancyId: null,
        previousHash,
      };
      const entryHash = hashMovement(movement);
      previousHash = entryHash;
      balance += quantityDelta;
      return { ...movement, entryHash };
    });
  }

  it("verifies an intact chain whose balance is the sum of deltas", () => {
    const movements = chain();
    expect(verifyChain(movements)).toBeNull();
    expect(movements.at(-1)!.balanceAfter).toBe("96.7500");
  });

  it("detects a tampered field, a broken link, a gap and a falsified balance", () => {
    const edited = chain();
    edited[1] = { ...edited[1], patientProfileId: "someone-else" };
    expect(verifyChain(edited)).toMatchObject({ movementRef: "CSM-2", reason: "entry_hash_mismatch" });

    const relinked = chain();
    relinked[2] = { ...relinked[2], previousHash: "0".repeat(64) };
    expect(verifyChain(relinked)).toMatchObject({ movementRef: "CSM-3", reason: "previous_hash_mismatch" });

    const gapped = chain().filter((movement) => movement.sequence !== 2);
    expect(verifyChain(gapped)).toMatchObject({ reason: "sequence_gap" });

    const inflated = chain();
    inflated[3] = { ...inflated[3], balanceAfter: "99.0000" };
    expect(verifyChain(inflated)).toMatchObject({ movementRef: "CSM-4", reason: "balance_mismatch" });
  });
});
