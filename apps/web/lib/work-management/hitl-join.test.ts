import { describe, expect, it } from "vitest";

import {
  boundaryCeiling,
  decisionModeRank,
  hasPassingVerificationEvidence,
  joinAutonomy,
  resolveVerificationRequirement,
} from "./hitl-join";
import type { WorkCaseAutonomyDecisionMode } from "./autonomy-envelope";
import type { ProactivityActionBoundary } from "@/lib/proactivity/proactivity-types";
import type { RiskClass } from "@/lib/autonomy/trust-graduation";
import type { VerificationDepth } from "@/lib/golden-triangle";

const MODES: WorkCaseAutonomyDecisionMode[] = [
  "shadow-only",
  "propose-for-approval",
  "supervised-action",
  "autonomous-action",
];
const BOUNDARIES: ProactivityActionBoundary[] = ["preauthorized", "propose", "advise"];

describe("joinAutonomy — stricter always wins", () => {
  // The load-bearing property, asserted exhaustively rather than by example:
  // across EVERY pair, the joined mode is never more autonomous than either
  // input. Neither ladder can purchase autonomy the other withholds.
  it("never exceeds the envelope, for any pair", () => {
    for (const mode of MODES) {
      for (const boundary of BOUNDARIES) {
        const joined = joinAutonomy(mode, boundary);
        expect(
          decisionModeRank(joined.decisionMode),
          `${boundary} widened ${mode} to ${joined.decisionMode}`,
        ).toBeLessThanOrEqual(decisionModeRank(mode));
      }
    }
  });

  it("never exceeds the boundary's ceiling, for any pair", () => {
    for (const mode of MODES) {
      for (const boundary of BOUNDARIES) {
        const joined = joinAutonomy(mode, boundary);
        expect(decisionModeRank(joined.decisionMode)).toBeLessThanOrEqual(
          decisionModeRank(boundaryCeiling(boundary)),
        );
      }
    }
  });

  it("returns exactly the stricter of the two", () => {
    for (const mode of MODES) {
      for (const boundary of BOUNDARIES) {
        const expected = Math.min(
          decisionModeRank(mode),
          decisionModeRank(boundaryCeiling(boundary)),
        );
        expect(decisionModeRank(joinAutonomy(mode, boundary).decisionMode)).toBe(expected);
      }
    }
  });

  it("a preauthorized posture cannot make a shadow envelope act", () => {
    const joined = joinAutonomy("shadow-only", "preauthorized");
    expect(joined.decisionMode).toBe("shadow-only");
    expect(joined.constrainedBy).toBe("envelope");
  });

  it("an autonomous envelope cannot act on work the room says is advise-only", () => {
    const joined = joinAutonomy("autonomous-action", "advise");
    expect(joined.decisionMode).toBe("shadow-only");
    expect(joined.constrainedBy).toBe("posture");
  });

  it("an autonomous envelope is capped to propose when the room says propose", () => {
    expect(joinAutonomy("autonomous-action", "propose").decisionMode).toBe(
      "propose-for-approval",
    );
  });

  it("advise maps to shadow, not propose", () => {
    // Mapping advise to propose-for-approval would let an advisory posture
    // surface a one-click action — a different and larger permission.
    expect(boundaryCeiling("advise")).toBe("shadow-only");
  });

  it("is inert when no room posture applies", () => {
    for (const mode of MODES) {
      for (const absent of [null, undefined] as const) {
        const joined = joinAutonomy(mode, absent);
        expect(joined.decisionMode).toBe(mode);
        expect(joined.constrainedBy).toBe("envelope");
      }
    }
  });

  it("reports agreement when neither ladder is stricter", () => {
    expect(joinAutonomy("autonomous-action", "preauthorized").constrainedBy).toBe("both-agree");
    expect(joinAutonomy("propose-for-approval", "propose").constrainedBy).toBe("both-agree");
  });
});

describe("resolveVerificationRequirement", () => {
  it("requires verification at the kernel floor, whatever the posture says", () => {
    const depths: Array<VerificationDepth | null | undefined> = [
      "none",
      "shallow",
      "deep",
      null,
      undefined,
    ];
    for (const verificationDepth of depths) {
      const req = resolveVerificationRequirement({
        risk: "outbound-or-floor",
        verificationDepth,
      });
      expect(req.required, `depth ${String(verificationDepth)} removed the floor`).toBe(true);
      expect(req.reasonCode).toBe("verification_required_by_risk");
    }
  });

  it("lets a posture ADD a requirement to work that would not otherwise carry one", () => {
    expect(
      resolveVerificationRequirement({ risk: "internal-reversible", verificationDepth: "deep" })
        .required,
    ).toBe(true);
    expect(
      resolveVerificationRequirement({ risk: "internal-reversible", verificationDepth: "shallow" })
        .required,
    ).toBe(true);
  });

  it("does not require verification for ordinary reversible work with no posture ask", () => {
    const risks: RiskClass[] = ["read-only", "internal-reversible", "internal-irreversible"];
    for (const risk of risks) {
      expect(resolveVerificationRequirement({ risk, verificationDepth: "none" }).required).toBe(
        false,
      );
      expect(resolveVerificationRequirement({ risk }).required).toBe(false);
    }
  });

  it("carries a stable reason code and a readable reason in every case", () => {
    const cases = [
      { risk: "outbound-or-floor" as const },
      { risk: "internal-reversible" as const, verificationDepth: "deep" as const },
      { risk: "read-only" as const },
    ];
    for (const c of cases) {
      const req = resolveVerificationRequirement(c);
      expect(req.reasonCode).toMatch(/^[a-z0-9_]+$/);
      expect(req.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("hasPassingVerificationEvidence", () => {
  it("accepts both case evidence and canonical passed runtime verification receipts", () => {
    expect(hasPassingVerificationEvidence([{ verifiedAt: "2026-08-30T12:00:00.000Z" }])).toBe(true);
    expect(
      hasPassingVerificationEvidence([
        { status: "passed", completedAt: "2026-08-30T12:00:00.000Z" },
      ]),
    ).toBe(true);
  });

  it("rejects absent, unfinished, and failed evidence", () => {
    expect(hasPassingVerificationEvidence()).toBe(false);
    expect(hasPassingVerificationEvidence([{ status: "running", completedAt: null }])).toBe(false);
    expect(
      hasPassingVerificationEvidence([
        { status: "failed", completedAt: "2026-08-30T12:00:00.000Z" },
      ]),
    ).toBe(false);
  });
});
