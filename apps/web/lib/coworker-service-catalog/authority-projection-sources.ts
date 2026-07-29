import {
  isCoworkerAuthorityBoundary,
  type CoworkerAuthorityBoundary,
} from "./types";
import { isRecord } from "../shared/coerce";
import { oversightLabel } from "@/lib/workforce/oversight-copy";
import {
  BASE_OWNER_ACTIONS,
  LEVEL_RANK,
  type CoworkerAuthorityEvidence,
  type CoworkerAuthorityEvidenceRole,
  type CoworkerAuthorityLevel,
  type CoworkerAuthorityProjectionInput,
  type CoworkerAuthorityScope,
  type CoworkerAuthoritySource,
  type CoworkerEffectiveAuthorityEvaluation,
  type CoworkerGovernanceEvaluation,
  type ProjectionScopeEvidence,
  type ProjectionWork,
  type ResolvedEvidence,
} from "./authority-projection-contract";

const CATALOG_BOUNDARY_LEVELS: Record<
  CoworkerAuthorityBoundary,
  CoworkerAuthorityLevel
> = {
  "never-allowed": "cannot-act",
  "advice-only": "advice-only",
  "proposal-only": "proposal-only",
  "approval-required": "approval-required",
  "autonomous-allowed": "autonomous",
};

const GOVERNANCE_POLICIES = new Set([
  "none",
  "never",
  "always",
  "proposal_for_external_writes",
]);
const PROPOSAL_STATUSES = new Set([
  "proposed",
  "approve",
  "approved",
  "reject",
  "rejected",
  "executed",
  "failed",
]);
const EFFECTIVE_AUTHORITY_REASON_DECISIONS = {
  user_capability_denied: "deny",
  agent_grant_denied: "deny",
  binding_subject_denied: "deny",
  binding_grant_denied: "deny",
  binding_grant_requires_approval: "require-approval",
  binding_approval_mode: "require-approval",
  no_binding: "allow",
  binding_allows: "allow",
} as const;

export function createProjectionWork(): ProjectionWork {
  return { evidence: [], candidates: [], errors: [] };
}

export function collectProjectionEvidence(
  input: CoworkerAuthorityProjectionInput,
  work: ProjectionWork,
): ProjectionScopeEvidence {
  const scope = validateScope(input.scope, work);
  if (input.offer) {
    collectOffer(input.offer, "selected-base", work);
    if (input.service) {
      collectService(input.service, "overridden-default", work, false);
    }
    collectAgent(input.agent, "overridden-default", work, false);
  } else if (input.service) {
    collectService(input.service, "selected-base", work, true);
    collectAgent(input.agent, "overridden-default", work, false);
  } else {
    collectAgent(input.agent, "selected-base", work, true);
  }

  collectGovernance(input.governance, work);
  if (input.scope?.kind === "effective-action") {
    collectEffectiveAuthority(input.scope, work);
    collectProposals(input.scope, work);
  }
  return scope;
}

export function strictest(
  candidates: readonly ResolvedEvidence[],
): ResolvedEvidence {
  return candidates.reduce((winner, candidate) => {
    const rankDelta =
      LEVEL_RANK[candidate.normalizedLevel] -
      LEVEL_RANK[winner.normalizedLevel];
    if (rankDelta < 0) return candidate;
    if (rankDelta === 0 && candidate.specificity > winner.specificity) {
      return candidate;
    }
    return winner;
  });
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function validateScope(
  scope: CoworkerAuthorityProjectionInput["scope"] | undefined,
  work: ProjectionWork,
): ProjectionScopeEvidence {
  if (!scope || scope.kind === "default-posture") {
    if (!scope) work.errors.push("Authority projection scope was not provided");
    return { kind: "default-posture" };
  }

  const actionKey = cleanText(scope.actionKey);
  const resourceRef = cleanText(scope.resourceRef);
  if (!actionKey) work.errors.push("Effective action scope is missing an action key");
  if (!resourceRef) {
    work.errors.push("Effective action scope is missing a resource reference");
  }
  if (!scope.authorityEvaluation) {
    work.errors.push("Effective authority evaluation was not provided for this action");
  }
  if (!scope.proposalEvaluation) {
    work.errors.push("Action proposal evaluation was not provided for this action");
  }
  return { kind: "effective-action", actionKey, resourceRef };
}

function collectOffer(
  offer: NonNullable<CoworkerAuthorityProjectionInput["offer"]>,
  role: CoworkerAuthorityEvidenceRole,
  work: ProjectionWork,
) {
  const ref = cleanRef(offer.offerId);
  if (!ref) work.errors.push("Offer is missing a source reference");

  const boundary = normalizeCatalogBoundary(offer.authorityBoundary);
  addCandidate(
    work,
    {
      source: "offer",
      ref,
      field: "authorityBoundary",
      role,
      observedValue: safeObservedValue(offer.authorityBoundary, Boolean(boundary)),
      normalizedLevel: boundary,
      detail: boundary
        ? `Offer ${ref || "<missing>"} has catalog boundary ${String(offer.authorityBoundary)}`
        : `Offer ${ref || "<missing>"} authority boundary is unresolved`,
    },
    boundary
      ? {
          level: boundary,
          ownerReason: ownerReasonForSource("offer", boundary),
          ownerAction: BASE_OWNER_ACTIONS[boundary],
          specificity: 10,
        }
      : null,
  );
  if (!boundary) {
    work.errors.push(
      `Offer ${ref || "<missing>"} has an unsupported authorityBoundary value`,
    );
  }
  collectRequiredApprovals(offer, role, work);
}

function collectRequiredApprovals(
  offer: NonNullable<CoworkerAuthorityProjectionInput["offer"]>,
  role: CoworkerAuthorityEvidenceRole,
  work: ProjectionWork,
) {
  const ref = cleanRef(offer.offerId);
  if (!Array.isArray(offer.requiredApprovals)) {
    work.evidence.push({
      source: "offer",
      ref,
      field: "requiredApprovals",
      role,
      observedValue: safeObservedValue(offer.requiredApprovals, false),
      normalizedLevel: null,
      detail: "Offer approval declarations could not be read",
    });
    work.errors.push(
      `Offer ${ref || "<missing>"} requiredApprovals must be an array`,
    );
    return;
  }

  const requiredNames: string[] = [];
  offer.requiredApprovals.forEach((entry, index) => {
    if (!isRecord(entry)) {
      work.errors.push(
        `Offer ${ref || "<missing>"} requiredApprovals[${index}] must be an object`,
      );
      return;
    }
    if (typeof entry.required !== "boolean") {
      work.errors.push(
        `Offer ${ref || "<missing>"} requiredApprovals[${index}].required must be true or false`,
      );
      return;
    }
    if (typeof entry.type !== "string" || !entry.type.trim()) {
      work.errors.push(
        `Offer ${ref || "<missing>"} requiredApprovals[${index}].type must include a nonblank type`,
      );
      return;
    }
    if (entry.required) requiredNames.push(humanizeKey(entry.type));
  });

  const normalizedLevel =
    requiredNames.length > 0 ? "approval-required" : null;
  const ownerList = joinList(requiredNames);
  addCandidate(
    work,
    {
      source: "offer",
      ref,
      field: "requiredApprovals",
      role,
      observedValue: "[array]",
      normalizedLevel,
      detail:
        requiredNames.length > 0
          ? `Offer ${ref || "<missing>"} requires ${ownerList}`
          : `Offer ${ref || "<missing>"} declares no additional approvals`,
    },
    normalizedLevel
      ? {
          level: normalizedLevel,
          ownerReason: `${capitalize(ownerList)} are required.`,
          ownerAction: `Get ${ownerList} before this coworker acts.`,
          specificity: 30,
        }
      : null,
  );
}

function collectService(
  service: NonNullable<CoworkerAuthorityProjectionInput["service"]>,
  role: CoworkerAuthorityEvidenceRole,
  work: ProjectionWork,
  selected: boolean,
) {
  const ref = cleanRef(service.serviceId);
  if (selected && !ref) work.errors.push("Service is missing a source reference");

  if (service.hitlTier !== undefined && service.hitlTier !== null) {
    const level = normalizeHitlTier(service.hitlTier);
    addCandidate(
      work,
      {
        source: "service",
        ref,
        field: "hitlTier",
        role,
        observedValue: safeObservedValue(service.hitlTier, Boolean(level)),
        normalizedLevel: level,
        detail: level
          ? `Service ${ref || "<missing>"} oversight is ${oversightLabel(typeof service.hitlTier === "number" ? service.hitlTier : null)}`
          : `Service ${ref || "<missing>"} oversight is unresolved`,
      },
      selected && level
        ? {
            level,
            ownerReason: ownerReasonForSource("service", level),
            ownerAction: BASE_OWNER_ACTIONS[level],
            specificity: 20,
          }
        : null,
    );
    if (selected && !level) {
      work.errors.push(
        `Service ${ref || "<missing>"} has an unsupported hitlTier value`,
      );
    }
  }

  const boundary = normalizeCatalogBoundary(service.authorityBoundary);
  addCandidate(
    work,
    {
      source: "service",
      ref,
      field: "authorityBoundary",
      role,
      observedValue: safeObservedValue(
        service.authorityBoundary,
        Boolean(boundary),
      ),
      normalizedLevel: boundary,
      detail: boundary
        ? `Service ${ref || "<missing>"} has catalog boundary ${String(service.authorityBoundary)}`
        : `Service ${ref || "<missing>"} authority boundary is unresolved`,
    },
    selected && boundary
      ? {
          level: boundary,
          ownerReason: ownerReasonForSource("service", boundary),
          ownerAction: BASE_OWNER_ACTIONS[boundary],
          specificity: 10,
        }
      : null,
  );
  if (selected && !boundary) {
    work.errors.push(
      `Service ${ref || "<missing>"} has an unsupported authorityBoundary value`,
    );
  }
}

function collectAgent(
  agent: CoworkerAuthorityProjectionInput["agent"],
  role: CoworkerAuthorityEvidenceRole,
  work: ProjectionWork,
  selected: boolean,
) {
  const ref = cleanRef(agent.agentId);
  if (selected && !ref) work.errors.push("Agent is missing a source reference");
  const level = normalizeHitlTier(agent.hitlTierDefault);
  addCandidate(
    work,
    {
      source: "agent",
      ref,
      field: "hitlTierDefault",
      role,
      observedValue: safeObservedValue(agent.hitlTierDefault, Boolean(level)),
      normalizedLevel: level,
      detail: level
        ? `Agent ${ref || "<missing>"} oversight is ${oversightLabel(typeof agent.hitlTierDefault === "number" ? agent.hitlTierDefault : null)}`
        : `Agent ${ref || "<missing>"} oversight default is unresolved`,
    },
    selected && level
      ? {
          level,
          ownerReason: ownerReasonForSource("agent", level),
          ownerAction: BASE_OWNER_ACTIONS[level],
          specificity: 10,
        }
      : null,
  );
  if (selected && !level) {
    work.errors.push(
      `Agent ${ref || "<missing>"} has an unsupported hitlTierDefault value`,
    );
  }
}

function collectGovernance(
  evaluation: CoworkerGovernanceEvaluation | undefined,
  work: ProjectionWork,
) {
  if (!evaluation) {
    work.errors.push("Governance evaluation was not provided");
    return;
  }
  if (evaluation.state === "not-configured") return;
  if (evaluation.state === "unavailable") {
    work.errors.push(
      cleanText(evaluation.reason) || "Governance evaluation was unavailable",
    );
    return;
  }

  const ref = cleanRef(evaluation.profileId);
  const policy =
    typeof evaluation.hitlPolicy === "string"
      ? evaluation.hitlPolicy
      : null;
  const recognized = Boolean(policy && GOVERNANCE_POLICIES.has(policy));
  let level: CoworkerAuthorityLevel | null = null;
  if (policy === "always") level = "approval-required";
  if (policy === "proposal_for_external_writes") level = "proposal-only";

  addCandidate(
    work,
    {
      source: "governance",
      ref,
      field: "hitlPolicy",
      role: "restriction",
      observedValue: safeObservedValue(evaluation.hitlPolicy, recognized),
      normalizedLevel: level,
      detail: recognized
        ? `Governance profile ${ref || "<missing>"} uses policy ${policy}`
        : `Governance profile ${ref || "<missing>"} policy is unresolved`,
    },
    level
      ? {
          level,
          ownerReason:
            policy === "proposal_for_external_writes"
              ? "External changes are prepared for your approval."
              : "The coworker's governance policy requires your approval.",
          ownerAction:
            policy === "proposal_for_external_writes"
              ? "Review external changes before they are sent."
              : "Approve the action before it runs.",
          specificity: 35,
        }
      : null,
  );
  if (!ref) work.errors.push("Governance profile is missing a source reference");
  if (!recognized) {
    work.errors.push(
      `Governance profile ${ref || "<missing>"} has an unsupported hitlPolicy value`,
    );
  }
}

function collectEffectiveAuthority(
  scope: Extract<CoworkerAuthorityScope, { kind: "effective-action" }>,
  work: ProjectionWork,
) {
  const evaluation = scope.authorityEvaluation;
  if (!evaluation) return;
  if (evaluation.state === "unavailable") {
    work.errors.push(
      cleanText(evaluation.reason) ||
        "Effective authority evaluation was unavailable",
    );
    return;
  }

  const actionKey = cleanText(evaluation.actionKey);
  const resourceRef = cleanText(evaluation.resourceRef);
  if (actionKey !== cleanText(scope.actionKey)) {
    work.errors.push(
      `Effective authority evaluation does not match action ${cleanText(scope.actionKey) || "<missing>"}`,
    );
  }
  if (resourceRef !== cleanText(scope.resourceRef)) {
    work.errors.push(
      `Effective authority evaluation does not match resource ${cleanText(scope.resourceRef) || "<missing>"}`,
    );
  }

  const { decision, reasonCode, binding } = evaluation.explanation;
  const expectedDecision =
    EFFECTIVE_AUTHORITY_REASON_DECISIONS[
      reasonCode as keyof typeof EFFECTIVE_AUTHORITY_REASON_DECISIONS
    ];
  const recognizedDecision =
    decision === "allow" ||
    decision === "deny" ||
    decision === "require-approval";
  const recognizedReason = Boolean(expectedDecision);
  const level =
    decision === "deny"
      ? "cannot-act"
      : decision === "require-approval"
        ? "approval-required"
        : null;
  const source = effectiveAuthoritySource(reasonCode);
  const ref =
    cleanRef(binding?.bindingId) ||
    `${actionKey || "<missing>"}@${resourceRef || "<missing>"}`;

  addCandidate(
    work,
    {
      source,
      ref,
      field: "decision",
      role: "restriction",
      observedValue: safeObservedValue(decision, recognizedDecision),
      normalizedLevel: level,
      detail:
        recognizedDecision && recognizedReason
          ? `Effective authority returned ${decision} (${reasonCode})`
          : "Effective authority decision could not be normalized",
    },
    level && recognizedDecision && recognizedReason
      ? {
          level,
          ownerReason: effectiveAuthorityOwnerReason(reasonCode),
          ownerAction: effectiveAuthorityOwnerAction(reasonCode),
          specificity: 45,
        }
      : null,
  );

  if (!recognizedDecision) {
    work.errors.push("Effective authority returned an unsupported decision");
  }
  if (!recognizedReason) {
    work.errors.push(
      "Effective authority returned an unsupported reason code",
    );
  } else if (decision !== expectedDecision) {
    work.errors.push(
      `Effective authority decision ${decision} contradicts reason ${reasonCode}`,
    );
  }
}

function collectProposals(
  scope: Extract<CoworkerAuthorityScope, { kind: "effective-action" }>,
  work: ProjectionWork,
) {
  const evaluation = scope.proposalEvaluation;
  if (!evaluation) return;
  if (evaluation.state === "unavailable") {
    work.errors.push(
      cleanText(evaluation.reason) ||
        "Action proposal evaluation was unavailable",
    );
    return;
  }

  if (cleanText(evaluation.actionKey) !== cleanText(scope.actionKey)) {
    work.errors.push(
      `Action proposal evaluation does not match action ${cleanText(scope.actionKey) || "<missing>"}`,
    );
  }
  if (cleanText(evaluation.resourceRef) !== cleanText(scope.resourceRef)) {
    work.errors.push(
      `Action proposal evaluation does not match resource ${cleanText(scope.resourceRef) || "<missing>"}`,
    );
  }

  const statusesByProposal = new Map<string, Set<string>>();
  for (const proposal of evaluation.proposals) {
    const ref = cleanRef(proposal.proposalId);
    const actionType = cleanText(proposal.actionType);
    const status =
      typeof proposal.status === "string" ? proposal.status : null;
    const recognized = Boolean(status && PROPOSAL_STATUSES.has(status));
    const level =
      status === "proposed"
        ? "proposal-only"
        : status === "rejected" || status === "reject"
          ? "cannot-act"
          : null;

    addCandidate(
      work,
      {
        source: "action-proposal",
        ref,
        field: "status",
        role: "restriction",
        observedValue: safeObservedValue(proposal.status, recognized),
        normalizedLevel: level,
        detail: recognized
          ? `Action proposal ${ref || "<missing>"} has status ${status}`
          : `Action proposal ${ref || "<missing>"} status is unresolved`,
      },
      level
        ? {
            level,
            ownerReason:
              status === "proposed"
                ? "This action is waiting for your decision."
                : "This action was rejected.",
            ownerAction:
              status === "proposed"
                ? "Review this proposed action before it can run."
                : "Create a new proposal if the action should be reconsidered.",
            specificity: 50,
          }
        : null,
    );

    if (!ref) work.errors.push("Action proposal is missing a source reference");
    if (actionType !== cleanText(scope.actionKey)) {
      work.errors.push(
        `Action proposal ${ref || "<missing>"} does not match action ${cleanText(scope.actionKey) || "<missing>"}`,
      );
    }
    if (!recognized) {
      work.errors.push(
        `Action proposal ${ref || "<missing>"} has an unsupported status value`,
      );
    }
    if (ref && status) {
      const statuses = statusesByProposal.get(ref) ?? new Set<string>();
      statuses.add(status);
      statusesByProposal.set(ref, statuses);
    }
  }

  for (const [ref, statuses] of statusesByProposal) {
    if (statuses.size > 1) {
      work.errors.push(
        `Action proposal ${ref} reports contradictory statuses`,
      );
    }
  }
}

function addCandidate(
  work: ProjectionWork,
  evidence: CoworkerAuthorityEvidence,
  candidate: {
    level: CoworkerAuthorityLevel;
    ownerReason: string;
    ownerAction: string | null;
    specificity: number;
  } | null,
) {
  work.evidence.push(evidence);
  if (!candidate) return;
  work.candidates.push({
    ...evidence,
    normalizedLevel: candidate.level,
    ownerReason: candidate.ownerReason,
    ownerAction: candidate.ownerAction,
    specificity: candidate.specificity,
  });
}

function normalizeCatalogBoundary(
  value: unknown,
): CoworkerAuthorityLevel | null {
  return isCoworkerAuthorityBoundary(value)
    ? CATALOG_BOUNDARY_LEVELS[value]
    : null;
}

function normalizeHitlTier(value: unknown): CoworkerAuthorityLevel | null {
  if (value === 0) return "cannot-act";
  if (value === 1) return "approval-required";
  if (value === 2) return "review-required";
  if (value === 3) return "autonomous";
  return null;
}

function effectiveAuthoritySource(
  reasonCode: string,
): CoworkerAuthoritySource {
  if (
    reasonCode === "agent_grant_denied" ||
    reasonCode === "binding_grant_denied" ||
    reasonCode === "binding_grant_requires_approval"
  ) {
    return "grant";
  }
  if (
    reasonCode === "binding_subject_denied" ||
    reasonCode === "binding_approval_mode" ||
    reasonCode === "binding_allows"
  ) {
    return "authority-binding";
  }
  return "effective-authority";
}

function effectiveAuthorityOwnerReason(reasonCode: string): string {
  const reasons: Record<string, string> = {
    user_capability_denied:
      "Your current role does not allow this action.",
    agent_grant_denied:
      "This coworker does not have the required access.",
    binding_subject_denied:
      "The active authority binding does not allow this action.",
    binding_grant_denied:
      "The active authority grant does not allow this action.",
    binding_grant_requires_approval:
      "The active authority grant requires approval.",
    binding_approval_mode:
      "The active authority binding requires approval.",
  };
  return reasons[reasonCode] ?? "The effective authority decision applies.";
}

function effectiveAuthorityOwnerAction(reasonCode: string): string | null {
  if (reasonCode === "user_capability_denied") {
    return "Ask someone with permission to review this action.";
  }
  if (
    reasonCode === "agent_grant_denied" ||
    reasonCode === "binding_subject_denied" ||
    reasonCode === "binding_grant_denied"
  ) {
    return "Choose a coworker with access or change the governing rule.";
  }
  if (
    reasonCode === "binding_grant_requires_approval" ||
    reasonCode === "binding_approval_mode"
  ) {
    return "Approve the action before it runs.";
  }
  return null;
}

function ownerReasonForSource(
  source: "offer" | "service" | "agent",
  level: CoworkerAuthorityLevel,
): string {
  const subject =
    source === "offer"
      ? "This offer"
      : source === "service"
        ? "This service"
        : "This coworker's default oversight setting";
  const ending: Record<CoworkerAuthorityLevel, string> = {
    "cannot-act": "does not allow action.",
    "advice-only": "allows advice only.",
    "proposal-only": "allows proposed work for a person to decide.",
    "approval-required": "requires approval before action.",
    "review-required": "requires a person to review completed action.",
    autonomous: "allows action within configured limits.",
  };
  return `${subject} ${ending[level]}`;
}

function safeObservedValue(value: unknown, recognized: boolean): string {
  if (Array.isArray(value)) return "[array]";
  if (value !== null && typeof value === "object") return "[object]";
  if (value === undefined) return "[undefined]";
  if (value === null) return "[null]";
  if (typeof value === "string") {
    return recognized
      ? value
      : `[unrecognized-string:length=${value.length}]`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return recognized
      ? String(value)
      : `[unrecognized-${typeof value}]`;
  }
  return `[${typeof value}]`;
}

function humanizeKey(value: string): string {
  return value.trim().replace(/[_-]+/g, " ").toLowerCase();
}

function joinList(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function capitalize(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function cleanRef(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
