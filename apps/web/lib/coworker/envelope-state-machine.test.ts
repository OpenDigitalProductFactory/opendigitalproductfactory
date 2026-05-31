// Tests for the envelope state machine (spec §6.4). Pure functions, no
// DB I/O — every legal and illegal transition is exercised here so the
// API routes and dispatcher logic can rely on canTransition /
// checkTransition / the named-transition helpers without re-verifying.
//
// BI-0F9C291C / EP-COWORKER-INTERACTIVITY.

import { describe, expect, it } from "vitest";

import {
  ENVELOPE_STATUSES,
  TERMINAL_STATUSES,
  canTransition,
  checkTransition,
  describeTransitionError,
  isEnvelopeStatus,
  isTerminal,
  transitionOnApprove,
  transitionOnCancel,
  transitionOnDeny,
  transitionOnExecutionFailure,
  transitionOnExecutionSuccess,
  type EnvelopeStatus,
} from "./envelope-state-machine";

describe("ENVELOPE_STATUSES + TERMINAL_STATUSES", () => {
  it("exposes the six lifecycle statuses", () => {
    expect(ENVELOPE_STATUSES).toEqual([
      "proposed",
      "approved",
      "declined",
      "executed",
      "failed",
      "cancelled",
    ]);
  });

  it("terminal statuses are exactly the four end-of-life states", () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(
      ["cancelled", "declined", "executed", "failed"].sort(),
    );
  });
});

describe("isEnvelopeStatus", () => {
  it("accepts every declared status", () => {
    for (const s of ENVELOPE_STATUSES) expect(isEnvelopeStatus(s)).toBe(true);
  });

  it("rejects non-statuses (typos, neighbouring strings, non-strings)", () => {
    expect(isEnvelopeStatus("approve")).toBe(false); // verb, not status
    expect(isEnvelopeStatus("Approved")).toBe(false); // case-sensitive
    expect(isEnvelopeStatus("")).toBe(false);
    expect(isEnvelopeStatus(null)).toBe(false);
    expect(isEnvelopeStatus(undefined)).toBe(false);
    expect(isEnvelopeStatus(123)).toBe(false);
    expect(isEnvelopeStatus({})).toBe(false);
  });
});

describe("isTerminal", () => {
  it("marks declined / executed / failed / cancelled terminal", () => {
    expect(isTerminal("declined")).toBe(true);
    expect(isTerminal("executed")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
  });

  it("marks proposed / approved non-terminal", () => {
    expect(isTerminal("proposed")).toBe(false);
    expect(isTerminal("approved")).toBe(false);
  });
});

describe("canTransition — legal transitions", () => {
  it("proposed → approved | declined | cancelled", () => {
    expect(canTransition("proposed", "approved")).toBe(true);
    expect(canTransition("proposed", "declined")).toBe(true);
    expect(canTransition("proposed", "cancelled")).toBe(true);
  });

  it("approved → executed | failed | cancelled", () => {
    expect(canTransition("approved", "executed")).toBe(true);
    expect(canTransition("approved", "failed")).toBe(true);
    expect(canTransition("approved", "cancelled")).toBe(true);
  });
});

describe("canTransition — illegal transitions", () => {
  it("proposed cannot skip approval to execution", () => {
    expect(canTransition("proposed", "executed")).toBe(false);
    expect(canTransition("proposed", "failed")).toBe(false);
  });

  it("approved cannot regress to proposed", () => {
    expect(canTransition("approved", "proposed")).toBe(false);
  });

  it("declined cannot reopen", () => {
    expect(canTransition("declined", "approved")).toBe(false);
    expect(canTransition("declined", "executed")).toBe(false);
  });

  it("executed / failed / cancelled are dead ends", () => {
    for (const terminal of TERMINAL_STATUSES) {
      for (const target of ENVELOPE_STATUSES) {
        expect(canTransition(terminal, target)).toBe(false);
      }
    }
  });

  it("no transition lands on the same status (no self-loops)", () => {
    for (const s of ENVELOPE_STATUSES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });
});

describe("checkTransition — structured results", () => {
  it("returns ok: true on a legal transition", () => {
    const r = checkTransition("proposed", "approved");
    expect(r).toEqual({ ok: true, from: "proposed", to: "approved" });
  });

  it("returns reason: already_terminal when starting from a terminal status", () => {
    const r = checkTransition("declined", "approved");
    expect(r).toEqual({ ok: false, reason: "already_terminal", from: "declined", attemptedTo: "approved" });
  });

  it("returns reason: illegal_transition when starting from a valid non-terminal status with an unreachable target", () => {
    const r = checkTransition("proposed", "executed");
    expect(r).toEqual({ ok: false, reason: "illegal_transition", from: "proposed", attemptedTo: "executed" });
  });

  it("returns reason: unknown_status when the input is not a valid EnvelopeStatus", () => {
    const r = checkTransition("not-a-real-status" as EnvelopeStatus, "approved");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_status");
  });
});

describe("Named transition helpers", () => {
  it("transitionOnApprove resolves the proposed → approved transition", () => {
    expect(transitionOnApprove("proposed")).toEqual({ ok: true, from: "proposed", to: "approved" });
    expect(transitionOnApprove("approved").ok).toBe(false);
    expect(transitionOnApprove("declined").ok).toBe(false);
  });

  it("transitionOnDeny works from proposed only", () => {
    expect(transitionOnDeny("proposed")).toEqual({ ok: true, from: "proposed", to: "declined" });
    expect(transitionOnDeny("approved").ok).toBe(false);
  });

  it("transitionOnCancel works from proposed and approved (not from terminal)", () => {
    expect(transitionOnCancel("proposed").ok).toBe(true);
    expect(transitionOnCancel("approved").ok).toBe(true);
    expect(transitionOnCancel("declined").ok).toBe(false);
    expect(transitionOnCancel("executed").ok).toBe(false);
  });

  it("transitionOnExecutionSuccess requires approved (not proposed)", () => {
    expect(transitionOnExecutionSuccess("approved").ok).toBe(true);
    expect(transitionOnExecutionSuccess("proposed").ok).toBe(false);
  });

  it("transitionOnExecutionFailure requires approved (not proposed)", () => {
    expect(transitionOnExecutionFailure("approved").ok).toBe(true);
    expect(transitionOnExecutionFailure("proposed").ok).toBe(false);
  });
});

describe("describeTransitionError", () => {
  it("returns null on success", () => {
    expect(describeTransitionError({ ok: true, from: "proposed", to: "approved" })).toBeNull();
  });

  it("renders already_terminal with the specific status", () => {
    const msg = describeTransitionError({
      ok: false,
      reason: "already_terminal",
      from: "declined",
      attemptedTo: "approved",
    });
    expect(msg).toMatch(/terminal/);
    expect(msg).toMatch(/declined/);
  });

  it("renders illegal_transition with the legal alternatives listed", () => {
    const msg = describeTransitionError({
      ok: false,
      reason: "illegal_transition",
      from: "proposed",
      attemptedTo: "executed",
    });
    // Must mention the from-state, the bad target, and the legal targets.
    expect(msg).toMatch(/proposed/);
    expect(msg).toMatch(/executed/);
    expect(msg).toMatch(/approved/);
  });

  it("renders unknown_status with the bad input quoted", () => {
    const msg = describeTransitionError({
      ok: false,
      reason: "unknown_status",
      from: "garbage" as EnvelopeStatus,
      attemptedTo: "approved",
    });
    expect(msg).toMatch(/garbage/);
  });
});

// Adversarial cross-check: walk the full reachability graph and confirm
// the table is consistent (every legal transition is bidirectional with
// checkTransition's positive path; every illegal one fails).
describe("exhaustive consistency", () => {
  it("checkTransition agrees with canTransition for every status pair", () => {
    for (const from of ENVELOPE_STATUSES) {
      for (const to of ENVELOPE_STATUSES) {
        const canT = canTransition(from, to);
        const checkResult = checkTransition(from, to);
        expect(checkResult.ok).toBe(canT);
      }
    }
  });

  it("every non-terminal status has at least one legal outgoing transition", () => {
    for (const s of ENVELOPE_STATUSES) {
      if (isTerminal(s)) continue;
      const hasOutgoing = ENVELOPE_STATUSES.some((t) => canTransition(s, t));
      expect(hasOutgoing).toBe(true);
    }
  });

  it("every terminal status has zero legal outgoing transitions", () => {
    for (const s of TERMINAL_STATUSES) {
      const outgoing = ENVELOPE_STATUSES.filter((t) => canTransition(s, t));
      expect(outgoing).toEqual([]);
    }
  });
});
