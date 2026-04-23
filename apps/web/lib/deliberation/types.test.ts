import { describe, expect, it } from "vitest";

import {
  CLAIM_EVIDENCE_GRADES,
  CLAIM_STATUSES,
  CLAIM_TYPES,
  DELIBERATION_ADJUDICATION_MODES,
  DELIBERATION_ARTIFACT_TYPES,
  DELIBERATION_CONSENSUS_STATES,
  DELIBERATION_DIVERSITY_MODES,
  DELIBERATION_PATTERN_STATUSES,
  DELIBERATION_RISK_LEVELS,
  DELIBERATION_STRATEGY_PROFILES,
  DELIBERATION_TRIGGER_SOURCES,
  EVIDENCE_SOURCE_TYPES,
  ROLE_EVIDENCE_STRICTNESS,
} from "./types";

describe("deliberation canonical enums", () => {
  it("exports exact pattern lifecycle and run enums", () => {
    expect(DELIBERATION_PATTERN_STATUSES).toEqual([
      "active",
      "deprecated",
      "draft",
    ]);
    expect(DELIBERATION_ARTIFACT_TYPES).toEqual([
      "spec",
      "plan",
      "code-change",
      "architecture-decision",
      "policy",
      "research-question",
    ]);
    expect(DELIBERATION_TRIGGER_SOURCES).toEqual([
      "stage",
      "risk",
      "explicit",
      "combined",
    ]);
    expect(DELIBERATION_ADJUDICATION_MODES).toEqual([
      "synthesis",
      "majority-vote",
      "unanimous",
      "no-consensus-ok",
    ]);
    expect(DELIBERATION_RISK_LEVELS).toEqual([
      "low",
      "medium",
      "high",
      "critical",
    ]);
    expect(DELIBERATION_DIVERSITY_MODES).toEqual([
      "single-model-multi-persona",
      "multi-model-same-provider",
      "multi-provider-heterogeneous",
    ]);
    expect(DELIBERATION_STRATEGY_PROFILES).toEqual([
      "economy",
      "balanced",
      "high-assurance",
      "document-authority",
    ]);
    expect(DELIBERATION_CONSENSUS_STATES).toEqual([
      "consensus",
      "partial-consensus",
      "no-consensus",
      "insufficient-evidence",
      "pending",
    ]);
  });

  it("exports exact claim and evidence enums", () => {
    expect(ROLE_EVIDENCE_STRICTNESS).toEqual([
      "lenient",
      "standard",
      "strict",
    ]);
    expect(CLAIM_TYPES).toEqual([
      "assertion",
      "objection",
      "rebuttal",
      "synthesis-fact",
      "synthesis-inference",
    ]);
    expect(CLAIM_STATUSES).toEqual([
      "supported",
      "contested",
      "unresolved",
      "rejected",
    ]);
    expect(CLAIM_EVIDENCE_GRADES).toEqual(["A", "B", "C", "D"]);
    expect(EVIDENCE_SOURCE_TYPES).toEqual([
      "code",
      "spec",
      "doc",
      "paper",
      "web",
      "db-query",
      "tool-output",
      "runtime-state",
    ]);
  });
});
