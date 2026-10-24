import { describe, expect, it } from "vitest";

import {
  OUTCOME_DISPOSITIONS,
  RETRY_POSTURE,
  countsAsFailure,
  isNonVerdict,
  isOutcomeDisposition,
  isVerdict,
  type OutcomeDisposition,
} from "./outcome-disposition";
import { GOVERNED_REJECTION_DISPOSITION } from "@/lib/govern/authority/governed-rejection-disposition";

describe("outcome dispositions", () => {
  it("classifies exactly two of five as verdicts", () => {
    const verdicts = OUTCOME_DISPOSITIONS.filter(isVerdict);
    expect(verdicts).toEqual(["proceed", "refused"]);
    expect(OUTCOME_DISPOSITIONS.filter(isNonVerdict)).toEqual([
      "awaiting-person",
      "awaiting-input",
      "inconclusive",
    ]);
  });

  it("gives every disposition a retry posture", () => {
    // The Record is total by type, so this asserts the runtime object matches —
    // a stray key or a missing one would pass typecheck under `as`.
    expect(Object.keys(RETRY_POSTURE).sort()).toEqual([...OUTCOME_DISPOSITIONS].sort());
  });

  it("never retries a wait on a person, and re-runs an inconclusive unchanged", () => {
    // The two postures the platform has paid for getting wrong: 55 copies of one
    // proposal came from retrying a human, and AGENTS.md §4 requires an
    // inconclusive check to re-run on the same input rather than fail the diff.
    expect(RETRY_POSTURE["awaiting-person"]).toBe("never");
    expect(RETRY_POSTURE["awaiting-input"]).toBe("bounded");
    expect(RETRY_POSTURE.inconclusive).toBe("same-input");
  });

  it("counts only a settled no against the caller", () => {
    expect(countsAsFailure("refused")).toBe(true);
    for (const disposition of OUTCOME_DISPOSITIONS.filter((d) => d !== "refused")) {
      expect(countsAsFailure(disposition)).toBe(false);
    }
  });

  it("rejects values outside the closed set", () => {
    expect(isOutcomeDisposition("awaiting-person")).toBe(true);
    expect(isOutcomeDisposition("pending")).toBe(false);
    expect(isOutcomeDisposition(undefined)).toBe(false);
  });
});

describe("governed rejection classification", () => {
  it("does not call a pending approval or an escalation a refusal", () => {
    // The defect this exists to prevent: all thirteen rejections rendered
    // identically, so a coworker could not tell a wait from a denied grant and
    // filed work to build tools that already existed.
    expect(GOVERNED_REJECTION_DISPOSITION.approval_required).toBe("awaiting-person");
    expect(GOVERNED_REJECTION_DISPOSITION.alignment_escalation_required).toBe(
      "awaiting-person",
    );
    expect(GOVERNED_REJECTION_DISPOSITION.precondition_escalation_required).toBe(
      "awaiting-person",
    );
  });

  it("does not call an unavailable check a refusal", () => {
    // AGENTS.md §4: a gate that could not run is not a verdict. The MCP route
    // already answers 503 rather than 4xx for this one.
    expect(GOVERNED_REJECTION_DISPOSITION.authority_evidence_unavailable).toBe(
      "inconclusive",
    );
    expect(GOVERNED_REJECTION_DISPOSITION.receipt_reservation_failed).toBe("inconclusive");
  });

  it("keeps settled denials settled", () => {
    for (const rejection of [
      "unknown_tool",
      "forbidden_capability",
      "forbidden_grant",
      "hook_denied",
      "authority_denied",
      "alignment_denied",
      "alignment_bypass_forbidden",
      "precondition_denied",
    ] as const) {
      expect(GOVERNED_REJECTION_DISPOSITION[rejection]).toBe("refused");
    }
  });

  it("classifies every rejection as a known disposition", () => {
    const values: OutcomeDisposition[] = Object.values(GOVERNED_REJECTION_DISPOSITION);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(isOutcomeDisposition(value)).toBe(true);
    // No rejection may be `proceed` — reaching rejectionResult means the call
    // did not go through.
    expect(values).not.toContain("proceed");
  });
});
