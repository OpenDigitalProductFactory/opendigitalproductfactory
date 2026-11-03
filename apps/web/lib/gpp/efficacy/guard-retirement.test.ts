import { describe, expect, it } from "vitest";

import {
  evaluateGuardRetirement,
  isoWeekKey,
  readDeclaration,
  undeclaredGuard,
  windowStartFor,
  type GuardEvidence,
} from "./guard-retirement";

const NOW = new Date("2026-12-31T00:00:00Z");

function evidence(guardId: string, overrides: Partial<GuardEvidence> = {}): GuardEvidence {
  return {
    guardId,
    currentDigestFirstSeenAt: new Date("2026-06-01T00:00:00Z"),
    runs: 100,
    refusals: 0,
    caught: 0,
    falseRefusals: 0,
    overridden: 0,
    unresolved: 0,
    totalDurationMs: 100_000,
    medianDurationMs: 1_000,
    ...overrides,
  };
}

function guard(e: GuardEvidence, extra: { reviewOpen?: boolean; windowCovered?: boolean; keepExpiry?: string } = {}) {
  const declaration = undeclaredGuard();
  if (extra.keepExpiry) declaration.keep = { owner: "platform", expiry: extra.keepExpiry, reason: "deterrent", decisionRef: null };
  return { evidence: e, declaration, windowCovered: extra.windowCovered ?? true, reviewOpen: extra.reviewOpen ?? false };
}

describe("evaluateGuardRetirement", () => {
  it("AC-GOE-05: a fixture guard with zero catches and a false-refusal rate above 0.25 yields exactly one per-guard finding", () => {
    const fixture = evidence("loop:check-no-fixture", { refusals: 6, caught: 0, falseRefusals: 4, overridden: 1, unresolved: 1 });
    const result = evaluateGuardRetirement({ now: NOW, guards: [guard(fixture)] });
    expect(result.perGuard).toHaveLength(1);
    expect(result.perGuard[0]).toMatchObject({ guardId: "loop:check-no-fixture", rule: "R-2" });
    expect(result.perGuard[0].measure).toBe("false refusals 4 of 4 decided refusals (100%)");
    expect(result.digest).toEqual([]);
  });

  it("R-1b: refused, never caught, at the floor of four classified refusals", () => {
    const atFloor = evidence("loop:a", { refusals: 4, overridden: 2, unresolved: 2 });
    const belowFloor = evidence("loop:b", { refusals: 3, overridden: 2, unresolved: 1 });
    const result = evaluateGuardRetirement({ now: NOW, guards: [guard(atFloor), guard(belowFloor)] });
    expect(result.perGuard.map((f) => [f.guardId, f.rule])).toEqual([["loop:a", "R-1b"]]);
  });

  it("R-2 needs four decided refusals and a rate strictly above 25%", () => {
    const oneInFour = evidence("loop:a", { refusals: 4, caught: 3, falseRefusals: 1 });
    const twoInFive = evidence("loop:b", { refusals: 5, caught: 3, falseRefusals: 2 });
    const thin = evidence("loop:c", { refusals: 2, caught: 0, falseRefusals: 2 });
    const result = evaluateGuardRetirement({ now: NOW, guards: [guard(oneInFour), guard(twoInFive), guard(thin)] });
    expect(result.perGuard.map((f) => f.guardId)).toEqual(["loop:b"]);
  });

  it("R-1a: never refused goes to the weekly digest, only when the window is covered and runs reach 30", () => {
    const result = evaluateGuardRetirement({
      now: NOW,
      guards: [
        guard(evidence("loop:deterrent")),
        guard(evidence("loop:new"), { windowCovered: false }),
        guard(evidence("loop:rare", { runs: 29 })),
      ],
    });
    expect(result.digest.map((f) => f.guardId)).toEqual(["loop:deterrent"]);
    expect(result.perGuard).toEqual([]);
  });

  it("an unexpired keep silences every rule; an expired keep does not", () => {
    const noisy = evidence("loop:noisy", { refusals: 4, falseRefusals: 4 });
    const kept = evaluateGuardRetirement({ now: NOW, guards: [guard(noisy, { keepExpiry: "2027-01-31" })] });
    expect(kept.perGuard).toEqual([]);
    expect(kept.silencedByKeep).toEqual(["loop:noisy"]);
    const expired = evaluateGuardRetirement({ now: NOW, guards: [guard(noisy, { keepExpiry: "2026-12-01" })] });
    expect(expired.perGuard).toHaveLength(1);
  });

  it("caps new per-guard items at three; an open item's recurrence takes no slot", () => {
    const noisy = (id: string) => evidence(id, { refusals: 4, falseRefusals: 4 });
    const result = evaluateGuardRetirement({
      now: NOW,
      guards: [
        guard(noisy("loop:a")),
        guard(noisy("loop:b")),
        guard(noisy("loop:c"), { reviewOpen: true }),
        guard(noisy("loop:d")),
        guard(noisy("loop:e")),
      ],
    });
    expect(result.perGuard.map((f) => f.guardId)).toEqual(["loop:a", "loop:b", "loop:c", "loop:d"]);
    expect(result.deferred.map((f) => f.guardId)).toEqual(["loop:e"]);
  });

  it("lists undeclared guards", () => {
    const result = evaluateGuardRetirement({ now: NOW, guards: [guard(evidence("loop:x", { runs: 1 }))] });
    expect(result.undeclared).toEqual(["loop:x"]);
  });
});

describe("window and declarations", () => {
  it("the window restarts at a new digest or a closed review", () => {
    const digestDate = new Date("2026-12-01T00:00:00Z");
    expect(windowStartFor(90, NOW, digestDate, null)).toEqual(digestDate);
    const closed = new Date("2026-12-15T00:00:00Z");
    expect(windowStartFor(90, NOW, digestDate, closed)).toEqual(closed);
    expect(windowStartFor(90, NOW, new Date("2020-01-01T00:00:00Z"), null)).toEqual(new Date("2026-10-02T00:00:00Z"));
  });

  it("reads a complete declaration and ignores a keep without an expiry", () => {
    const declared = readDeclaration("loop:x", {
      "loop:x": { owner: "platform", purpose: "no raw errors", catchClass: "error-handling", reviewWindowDays: 30, keep: { owner: "p", reason: "r" } },
    });
    expect(declared).toMatchObject({ declared: true, reviewWindowDays: 30, keep: null });
    expect(readDeclaration("loop:y", null)).toEqual(undeclaredGuard());
  });

  it("names the ISO week", () => {
    expect(isoWeekKey(new Date("2026-10-14T12:00:00Z"))).toBe("2026-W42");
    expect(isoWeekKey(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
  });
});
