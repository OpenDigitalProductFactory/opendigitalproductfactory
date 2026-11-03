/** Canonical pure posture/verification contracts; host policy and authorization retain their owners. */
export type QualityTier = "frontier" | "strong" | "adequate" | "basic";

export type GoldenTrianglePreset = "fast" | "frugal" | "assured" | "balanced" | "custom";

export interface GoldenTrianglePreference {
  costWeight: number;
  qualityWeight: number;
  timeWeight: number;
  preset: GoldenTrianglePreset;
}

export type VerificationDepth = "none" | "shallow" | "deep";

export interface PolicyAdjustment {
  field: string;
  from: unknown;
  to: unknown;
  /** Stable machine-readable code (for receipts/learning). */
  reasonCode: string;
  /** Human-readable reason (for the decode panel). */
  reason: string;
}

export type RiskClass =
  | "read-only"
  | "internal-reversible"
  | "internal-irreversible"
  | "outbound-or-floor";

export type WorkCaseAutonomyDecisionMode =
  | "shadow-only"
  | "propose-for-approval"
  | "supervised-action"
  | "autonomous-action";
