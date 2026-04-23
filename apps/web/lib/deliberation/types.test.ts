import { describe, it, expect } from "vitest";
import {
  DELIBERATION_PATTERN_STATUSES,
  DELIBERATION_ARTIFACT_TYPES,
  DELIBERATION_TRIGGER_SOURCES,
  DELIBERATION_ADJUDICATION_MODES,
  DELIBERATION_ACTIVATED_RISK_LEVELS,
  DELIBERATION_DIVERSITY_MODES,
  DELIBERATION_STRATEGY_PROFILES,
  DELIBERATION_CONSENSUS_STATES,
  DELIBERATION_EVIDENCE_STRICTNESS,
  CLAIM_TYPES,
  CLAIM_STATUSES,
  CLAIM_EVIDENCE_GRADES,
  EVIDENCE_SOURCE_TYPES,
  isDeliberationPatternStatus,
  isDeliberationArtifactType,
  isDeliberationTriggerSource,
  isDeliberationAdjudicationMode,
  isDeliberationActivatedRiskLevel,
  isDeliberationDiversityMode,
  isDeliberationStrategyProfile,
  isDeliberationConsensusState,
  isDeliberationEvidenceStrictness,
  isClaimType,
  isClaimStatus,
  isClaimEvidenceGrade,
  isEvidenceSourceType,
} from "./types";

describe("DELIBERATION_PATTERN_STATUSES", () => {
  it("matches the canonical list byte-for-byte", () => {
    expect(DELIBERATION_PATTERN_STATUSES).toEqual(["active", "deprecated", "draft"]);
  });

  it("guard accepts all canonical values and rejects synonyms", () => {
    for (const v of DELIBERATION_PATTERN_STATUSES) {
      expect(isDeliberationPatternStatus(v)).toBe(true);
    }
    for (const bad of ["", "INVALID", "archived", "done", undefined, null, 42, {}]) {
      expect(isDeliberationPatternStatus(bad)).toBe(false);
    }
  });
});

describe("DELIBERATION_ARTIFACT_TYPES", () => {
  it("matches the canonical list byte-for-byte", () => {
    expect(DELIBERATION_ARTIFACT_TYPES).toEqual([
      "spec",
      "plan",
      "code-change",
      "architecture-decision",
      "policy",
      "research-question",
    ]);
  });

  it("guard accepts all canonical values and rejects synonyms", () => {
    for (const v of DELIBERATION_ARTIFACT_TYPES) {
      expect(isDeliberationArtifactType(v)).toBe(true);
    }
    for (const bad of [
      "",
      "INVALID",
      "code_change",
      "architecture_decision",
      "research_question",
      "task",
      undefined,
      null,
      42,
      {},
    ]) {
      expect(isDeliberationArtifactType(bad)).toBe(false);
    }
  });
});

describe("DELIBERATION_TRIGGER_SOURCES", () => {
  it("matches the canonical list byte-for-byte", () => {
    expect(DELIBERATION_TRIGGER_SOURCES).toEqual(["stage", "risk", "explicit", "combined"]);
  });

  it("guard accepts all canonical values and rejects synonyms", () => {
    for (const v of DELIBERATION_TRIGGER_SOURCES) {
      expect(isDeliberationTriggerSource(v)).toBe(true);
    }
    for (const bad of ["", "INVALID", "manual", "auto", undefined, null, 42, {}]) {
      expect(isDeliberationTriggerSource(bad)).toBe(false);
    }
  });
});

describe("DELIBERATION_ADJUDICATION_MODES", () => {
  it("matches the canonical list byte-for-byte", () => {
    expect(DELIBERATION_ADJUDICATION_MODES).toEqual([
      "synthesis",
      "majority-vote",
      "unanimous",
      "no-consensus-ok",
    ]);
  });

  it("guard accepts all canonical values and rejects synonyms", () => {
    for (const v of DELIBERATION_ADJUDICATION_MODES) {
      expect(isDeliberationAdjudicationMode(v)).toBe(true);
    }
    for (const bad of [
      "",
      "INVALID",
      "majority_vote",
      "no_consensus_ok",
      "vote",
      undefined,
      null,
      42,
      {},
    ]) {
      expect(isDeliberationAdjudicationMode(bad)).toBe(false);
    }
  });
});

describe("DELIBERATION_ACTIVATED_RISK_LEVELS", () => {
  it("matches the canonical list byte-for-byte", () => {
    expect(DELIBERATION_ACTIVATED_RISK_LEVELS).toEqual(["low", "medium", "high", "critical"]);
  });

  it("guard accepts all canonical values and rejects synonyms", () => {
    for (const v of DELIBERATION_ACTIVATED_RISK_LEVELS) {
      expect(isDeliberationActivatedRiskLevel(v)).toBe(true);
    }
    for (const bad of ["", "INVALID", "none", "severe", undefined, null, 42, {}]) {
      expect(isDeliberationActivatedRiskLevel(bad)).toBe(false);
    }
  });
});

describe("DELIBERATION_DIVERSITY_MODES", () => {
  it("matches the canonical list byte-for-byte", () => {
    expect(DELIBERATION_DIVERSITY_MODES).toEqual([
      "single-model-multi-persona",
      "multi-model-same-provider",
      "multi-provider-heterogeneous",
    ]);
  });

  it("guard accepts all canonical values and rejects synonyms", () => {
    for (const v of DELIBERATION_DIVERSITY_MODES) {
      expect(isDeliberationDiversityMode(v)).toBe(true);
    }
    for (const bad of [
      "",
      "INVALID",
      "multi_provider",
      "single_model_multi_persona",
      "multi_model_same_provider",
      undefined,
      null,
      42,
      {},
    ]) {
      expect(isDeliberationDiversityMode(bad)).toBe(false);
    }
  });
});

describe("DELIBERATION_STRATEGY_PROFILES", () => {
  it("matches the canonical list byte-for-byte", () => {
    expect(DELIBERATION_STRATEGY_PROFILES).toEqual([
      "economy",
      "balanced",
      "high-assurance",
      "document-authority",
    ]);
  });

  it("guard accepts all canonical values and rejects synonyms", () => {
    for (const v of DELIBERATION_STRATEGY_PROFILES) {
      expect(isDeliberationStrategyProfile(v)).toBe(true);
    }
    for (const bad of [
      "",
      "INVALID",
      "high_assurance",
      "document_authority",
      "default",
      undefined,
      null,
      42,
      {},
    ]) {
      expect(isDeliberationStrategyProfile(bad)).toBe(false);
    }
  });
});

describe("DELIBERATION_CONSENSUS_STATES", () => {
  it("matches the canonical list byte-for-byte", () => {
    expect(DELIBERATION_CONSENSUS_STATES).toEqual([
      "consensus",
      "partial-consensus",
      "no-consensus",
      "insufficient-evidence",
      "pending",
    ]);
  });

  it("guard accepts all canonical values and rejects synonyms", () => {
    for (const v of DELIBERATION_CONSENSUS_STATES) {
      expect(isDeliberationConsensusState(v)).toBe(true);
    }
    for (const bad of [
      "",
      "INVALID",
      "partial_consensus",
      "no_consensus",
      "in_progress",
      "completed",
      "reviewed",
      undefined,
      null,
      42,
      {},
    ]) {
      expect(isDeliberationConsensusState(bad)).toBe(false);
    }
  });
});

describe("DELIBERATION_EVIDENCE_STRICTNESS", () => {
  it("matches the canonical list byte-for-byte", () => {
    expect(DELIBERATION_EVIDENCE_STRICTNESS).toEqual(["lenient", "standard", "strict"]);
  });

  it("guard accepts all canonical values and rejects synonyms", () => {
    for (const v of DELIBERATION_EVIDENCE_STRICTNESS) {
      expect(isDeliberationEvidenceStrictness(v)).toBe(true);
    }
    for (const bad of ["", "INVALID", "loose", "STRICT", undefined, null, 42, {}]) {
      expect(isDeliberationEvidenceStrictness(bad)).toBe(false);
    }
  });
});

describe("CLAIM_TYPES", () => {
  it("matches the canonical list byte-for-byte", () => {
    expect(CLAIM_TYPES).toEqual([
      "assertion",
      "objection",
      "rebuttal",
      "synthesis-fact",
      "synthesis-inference",
    ]);
  });

  it("guard accepts all canonical values and rejects synonyms", () => {
    for (const v of CLAIM_TYPES) {
      expect(isClaimType(v)).toBe(true);
    }
    for (const bad of [
      "",
      "INVALID",
      "synthesis_fact",
      "synthesis_inference",
      "claim",
      undefined,
      null,
      42,
      {},
    ]) {
      expect(isClaimType(bad)).toBe(false);
    }
  });
});

describe("CLAIM_STATUSES", () => {
  it("matches the canonical list byte-for-byte", () => {
    expect(CLAIM_STATUSES).toEqual(["supported", "contested", "unresolved", "rejected"]);
  });

  it("guard accepts all canonical values and rejects synonyms", () => {
    for (const v of CLAIM_STATUSES) {
      expect(isClaimStatus(v)).toBe(true);
    }
    for (const bad of [
      "",
      "INVALID",
      "done",
      "completed",
      "reviewed",
      "in_progress",
      undefined,
      null,
      42,
      {},
    ]) {
      expect(isClaimStatus(bad)).toBe(false);
    }
  });
});

describe("CLAIM_EVIDENCE_GRADES", () => {
  it("matches the canonical list byte-for-byte", () => {
    expect(CLAIM_EVIDENCE_GRADES).toEqual(["A", "B", "C", "D"]);
  });

  it("guard accepts all canonical values and rejects synonyms", () => {
    for (const v of CLAIM_EVIDENCE_GRADES) {
      expect(isClaimEvidenceGrade(v)).toBe(true);
    }
    for (const bad of ["", "INVALID", "a", "b", "E", "F", undefined, null, 42, {}]) {
      expect(isClaimEvidenceGrade(bad)).toBe(false);
    }
  });
});

describe("EVIDENCE_SOURCE_TYPES", () => {
  it("matches the canonical list byte-for-byte", () => {
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

  it("guard accepts all canonical values and rejects synonyms", () => {
    for (const v of EVIDENCE_SOURCE_TYPES) {
      expect(isEvidenceSourceType(v)).toBe(true);
    }
    for (const bad of [
      "",
      "INVALID",
      "db_query",
      "tool_output",
      "runtime_state",
      "database",
      undefined,
      null,
      42,
      {},
    ]) {
      expect(isEvidenceSourceType(bad)).toBe(false);
    }
  });
});
