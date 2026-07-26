export const COWORKER_AUTHORITY_LEVELS = [
  "cannot-act",
  "advice-only",
  "proposal-only",
  "approval-required",
  "review-required",
  "autonomous",
] as const;

export type CoworkerAuthorityLevel =
  (typeof COWORKER_AUTHORITY_LEVELS)[number];

export type CoworkerAuthoritySource =
  | "offer"
  | "service"
  | "agent"
  | "governance"
  | "grant"
  | "authority-binding"
  | "effective-authority"
  | "action-proposal";

export type CoworkerAuthorityEvidenceRole =
  | "selected-base"
  | "overridden-default"
  | "restriction";

export type CoworkerAuthorityEvidence = {
  source: CoworkerAuthoritySource;
  ref: string;
  field: string;
  role: CoworkerAuthorityEvidenceRole;
  observedValue: string;
  normalizedLevel: CoworkerAuthorityLevel | null;
  detail: string;
};

type EvaluationUnavailable = {
  state: "unavailable";
  reason: string;
};

export type CoworkerGovernanceEvaluation =
  | { state: "not-configured" }
  | {
      state: "evaluated";
      profileId: string;
      hitlPolicy: unknown;
    }
  | EvaluationUnavailable;

export type CoworkerEffectiveAuthorityEvaluation =
  | {
      state: "evaluated";
      actionKey: string;
      resourceRef: string;
      explanation: EffectiveAuthorityExplanation;
    }
  | EvaluationUnavailable;

export type CoworkerProposalEvaluation =
  | {
      state: "evaluated";
      actionKey: string;
      resourceRef: string;
      proposals: readonly {
        proposalId: string;
        actionType: string;
        status: unknown;
      }[];
    }
  | EvaluationUnavailable;

export type CoworkerAuthorityScope =
  | { kind: "default-posture" }
  | {
      kind: "effective-action";
      actionKey: string;
      resourceRef: string;
      authorityEvaluation: CoworkerEffectiveAuthorityEvaluation;
      proposalEvaluation: CoworkerProposalEvaluation;
    };

export type CoworkerAuthorityProjectionInput = {
  scope: CoworkerAuthorityScope;
  agent: {
    agentId: string;
    hitlTierDefault: unknown;
  };
  governance: CoworkerGovernanceEvaluation;
  service?: {
    serviceId: string;
    authorityBoundary: unknown;
    hitlTier?: unknown;
  };
  offer?: {
    offerId: string;
    authorityBoundary: unknown;
    requiredApprovals: unknown;
  };
};

export type ProjectionScopeEvidence =
  | { kind: "default-posture" }
  | {
      kind: "effective-action";
      actionKey: string;
      resourceRef: string;
    };

export type ResolvedEvidence = CoworkerAuthorityEvidence & {
  normalizedLevel: CoworkerAuthorityLevel;
  ownerReason: string;
  ownerAction: string | null;
  specificity: number;
};

export type ResolvedCoworkerAuthorityProjection = {
  state: "resolved";
  scope: ProjectionScopeEvidence;
  level: CoworkerAuthorityLevel;
  label: string;
  summary: string;
  ownerReason: string;
  ownerAction: string | null;
  winner: CoworkerAuthorityEvidence & {
    normalizedLevel: CoworkerAuthorityLevel;
  };
  evidence: CoworkerAuthorityEvidence[];
};

export type ReviewNeededCoworkerAuthorityProjection = {
  state: "review-needed";
  scope: ProjectionScopeEvidence;
  level: null;
  label: "Approval rules need review";
  summary: string;
  ownerReason: string;
  ownerAction: string;
  reasons: string[];
  evidence: CoworkerAuthorityEvidence[];
};

export type CoworkerAuthorityProjection =
  | ResolvedCoworkerAuthorityProjection
  | ReviewNeededCoworkerAuthorityProjection;

export const LEVEL_PRESENTATION: Record<
  CoworkerAuthorityLevel,
  { label: string; defaultSummary: string; actionSummary: string }
> = {
  "cannot-act": {
    label: "Cannot act",
    defaultSummary: "This coworker cannot take actions under the current rules.",
    actionSummary: "This coworker cannot take this action under the current rules.",
  },
  "advice-only": {
    label: "Advises only",
    defaultSummary: "This coworker can advise, but cannot prepare or take actions.",
    actionSummary: "This coworker can advise, but cannot prepare or take this action.",
  },
  "proposal-only": {
    label: "Prepares work for approval",
    defaultSummary: "This coworker prepares work for a person to decide.",
    actionSummary: "This coworker can prepare this work for a person to decide.",
  },
  "approval-required": {
    label: "Acts with approval",
    defaultSummary: "This coworker acts after a person approves.",
    actionSummary: "This coworker can act after a person approves this action.",
  },
  "review-required": {
    label: "Acts with review",
    defaultSummary: "This coworker acts within limits and a person reviews results.",
    actionSummary: "This coworker can act and a person reviews the result.",
  },
  autonomous: {
    label: "Can act within limits",
    defaultSummary: "This coworker can act within its governed tools and limits.",
    actionSummary: "This coworker can take this action within its governed limits.",
  },
};

export const LEVEL_RANK: Record<CoworkerAuthorityLevel, number> = {
  "cannot-act": 0,
  "advice-only": 1,
  "proposal-only": 2,
  "approval-required": 3,
  "review-required": 4,
  autonomous: 5,
};

export const BASE_OWNER_ACTIONS: Record<
  CoworkerAuthorityLevel,
  string | null
> = {
  "cannot-act": "Choose another coworker or change the governing rule.",
  "advice-only": "Use this coworker for guidance; another person must act.",
  "proposal-only": "Review the prepared work before anything is sent or changed.",
  "approval-required": "Approve the action before it runs.",
  "review-required": "Review the result after the action runs.",
  autonomous: null,
};

export type ProjectionWork = {
  evidence: CoworkerAuthorityEvidence[];
  candidates: ResolvedEvidence[];
  errors: string[];
};
import type { EffectiveAuthorityExplanation } from "../authority/effective-authority";
