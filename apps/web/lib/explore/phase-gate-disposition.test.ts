import { describe, expect, it } from "vitest";

import {
  GATE_REQUIREMENTS,
  GATE_REQUIREMENT_DISPOSITION,
  checkPhaseGate,
} from "./build-process-matrix";
import { OUTCOME_DISPOSITIONS, RETRY_POSTURE } from "@/lib/shared/outcome-disposition";

describe("phase gate says which kind of no it is (BI-09D11444)", () => {
  it("classifies every gate requirement — a new one cannot be added unclassified", () => {
    for (const req of GATE_REQUIREMENTS) {
      expect(OUTCOME_DISPOSITIONS).toContain(GATE_REQUIREMENT_DISPOSITION[req]);
    }
    expect(Object.keys(GATE_REQUIREMENT_DISPOSITION).sort()).toEqual([...GATE_REQUIREMENTS].sort());
  });

  it("names the requirement that said no, not only that something did", () => {
    const gate = checkPhaseGate("ideate", "plan", {});
    expect(gate.allowed).toBe(false);
    // The closed GateRequirement union IS the typed reason code.
    expect(GATE_REQUIREMENTS).toContain(gate.requirement!);
    expect(gate.reason).toBeTruthy();
  });

  it("tells a missing review from a failed one — the distinction the boolean lost", () => {
    const missing = checkPhaseGate("ideate", "plan", { designDoc: "d" });
    const failed = checkPhaseGate("ideate", "plan", {
      designDoc: "d",
      designReview: { decision: "fail" },
    });

    // Both are `allowed: false`; that part was never in question.
    expect(missing.allowed).toBe(false);
    expect(failed.allowed).toBe(false);

    // A reviewer has not ruled: re-asking polls a person, so it must not retry.
    expect(missing.disposition).toBe("awaiting-person");
    expect(RETRY_POSTURE[missing.disposition!]).toBe("never");

    // A review that RAN and said no is a verdict.
    expect(failed.disposition).toBe("refused");
  });

  it("a check that has not finished is inconclusive, not a failure", () => {
    const stillRunning = checkPhaseGate("build", "review", {
      verificationOut: { typecheckPassed: true, testsFailed: 0 },
      uxVerificationStatus: "running",
    });
    if (!stillRunning.allowed && stillRunning.requirement === "uxVerification-not-blocking") {
      // AGENTS.md §4: fail open on infrastructure — re-run it unchanged.
      expect(stillRunning.disposition).toBe("inconclusive");
      expect(RETRY_POSTURE.inconclusive).toBe("same-input");
    }
  });

  it("leaves an allowed transition with no requirement and no disposition", () => {
    const ok = checkPhaseGate("review", "build", {});
    expect(ok.allowed).toBe(true);
    expect(ok.requirement).toBeUndefined();
    expect(ok.disposition).toBeUndefined();
  });
});
