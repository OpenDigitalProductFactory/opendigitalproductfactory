import type { AutonomousWorkRunInput } from "@/lib/tak/autonomous-work-run";
import type {
  CapacityFinanceTracking,
  CapacityModelTierHint,
  CapacityProviderClass,
  CapacityRoutingHints,
} from "./finance-routing";

export type CapacityContinuityCandidateSource =
  | "standing-order"
  | "backlog"
  | "pull-request"
  | "qa-gap"
  | "spec-drift"
  | "capability-need"
  | "proceduralization";

export type CapacityContinuitySourceRef =
  | { kind: "standing-order"; id: string }
  | { kind: "backlog-item"; id: string }
  | { kind: "pull-request"; id: string }
  | { kind: "qa-gap"; id: string }
  | { kind: "spec"; id: string }
  | { kind: "capability-need"; id: string }
  | { kind: "proceduralization-candidate"; id: string };

export type CapacityContinuityRiskClass =
  | "read-only"
  | "review-after"
  | "approval-required";

export type CapacityContinuityState =
  | "normal"
  | "surplus"
  | "away-mode"
  | "holiday"
  | "event";

export type CapacityContinuityCandidate = {
  candidateId: string;
  dedupeKey: string;
  source: CapacityContinuityCandidateSource;
  title: string;
  objective: string;
  routeContext: string;
  agentId: string;
  ownerPrincipalId: string;
  riskClass: CapacityContinuityRiskClass;
  evidenceRequired: string[];
  capacityFit: {
    providerClassHint?: CapacityProviderClass;
    modelTierHint?: CapacityModelTierHint;
    reason?: string;
  };
  sourceRef: CapacityContinuitySourceRef;
  capacityState?: CapacityContinuityState;
  capacityWindowId?: string;
  viaStandingOrderId?: string;
  routingHints?: CapacityRoutingHints;
  financeTracking?: CapacityFinanceTracking;
};

type CapacityContinuityToolProbe = {
  name: string;
};

type CapacityContinuityMappingOptions = {
  resolvedTools?: CapacityContinuityToolProbe[];
  toolGrantMapping?: Record<string, string[]>;
  existingDedupeKeys?: Iterable<string>;
};

type CapacityContinuityRejection = {
  code:
    | "forbidden_grant"
    | "phase_gated_route"
    | "ambiguous_objective"
    | "duplicate_candidate";
  reason: string;
  details?: Record<string, string>;
};

export type CapacityContinuityMappingResult =
  | { ok: true; input: AutonomousWorkRunInput }
  | { ok: false; rejection: CapacityContinuityRejection };

const HARD_REJECTED_GRANTS = new Set([
  "deploy",
  "publish-external",
  "schema-migrate",
  "data-delete",
  "spend-money",
  "admin_write",
  "deployment_plan_create",
  "iac_execute",
  "release_gate_create",
  "release_plan_create",
]);

const PHASE_GATED_ROUTE_PATTERNS = [
  /^\/build(?:\/|$)/,
  /^\/platform\/ai\/build-studio(?:\/|$)/,
  /deliberation/i,
];

export function mapCapacityCandidateToAutonomousWorkRunInput(
  candidate: CapacityContinuityCandidate,
  options: CapacityContinuityMappingOptions = {},
): CapacityContinuityMappingResult {
  const duplicateRejection = rejectDuplicateCandidate(candidate, options);
  if (duplicateRejection) {
    return duplicateRejection;
  }

  const routeRejection = rejectPhaseGatedRoute(candidate);
  if (routeRejection) {
    return routeRejection;
  }

  const grantRejection = rejectForbiddenGrants(options);
  if (grantRejection) {
    return grantRejection;
  }

  const ambiguityRejection = rejectAmbiguousObjective(candidate);
  if (ambiguityRejection) {
    return ambiguityRejection;
  }

  const cognitiveLoad: Record<string, unknown> = {
    capacityState: candidate.capacityState ?? "normal",
    dedupeKey: candidate.dedupeKey,
    evidenceRequired: candidate.evidenceRequired,
    fundingFitHint: candidate.capacityFit,
    riskClass: candidate.riskClass,
  };

  if (candidate.capacityWindowId) {
    cognitiveLoad.capacityWindowId = candidate.capacityWindowId;
  }

  if (candidate.routingHints) {
    cognitiveLoad.routingHints = candidate.routingHints;
  }

  if (candidate.financeTracking) {
    cognitiveLoad.financeTracking = candidate.financeTracking;
  }

  if (
    candidate.viaStandingOrderId &&
    candidate.sourceRef.kind !== "standing-order"
  ) {
    cognitiveLoad.viaStandingOrderId = candidate.viaStandingOrderId;
  }

  return {
    ok: true,
    input: {
      trigger: "capacity-continuity",
      userId: candidate.ownerPrincipalId,
      agentId: candidate.agentId,
      routeContext: candidate.routeContext,
      title: candidate.title,
      objective: candidate.objective,
      prompt: candidate.objective,
      sourceRef: candidate.sourceRef,
      metadata: {
        cognitiveLoad,
      },
    },
  };
}

function rejectDuplicateCandidate(
  candidate: CapacityContinuityCandidate,
  options: CapacityContinuityMappingOptions,
): CapacityContinuityMappingResult | null {
  const existingKeys = new Set(options.existingDedupeKeys ?? []);
  if (!existingKeys.has(candidate.dedupeKey)) {
    return null;
  }

  return {
    ok: false,
    rejection: {
      code: "duplicate_candidate",
      reason:
        "Capacity continuity already has an open or recent run for this dedupe key.",
      details: {
        dedupeKey: candidate.dedupeKey,
      },
    },
  };
}

function rejectPhaseGatedRoute(
  candidate: CapacityContinuityCandidate,
): CapacityContinuityMappingResult | null {
  if (!PHASE_GATED_ROUTE_PATTERNS.some((pattern) => pattern.test(candidate.routeContext))) {
    return null;
  }

  return {
    ok: false,
    rejection: {
      code: "phase_gated_route",
      reason:
        "Capacity continuity cannot initiate work on a route with its own phase gate.",
      details: {
        routeContext: candidate.routeContext,
      },
    },
  };
}

function rejectForbiddenGrants(
  options: CapacityContinuityMappingOptions,
): CapacityContinuityMappingResult | null {
  for (const tool of options.resolvedTools ?? []) {
    const grants = options.toolGrantMapping?.[tool.name] ?? [];
    const forbiddenGrant = grants.find((grant) => HARD_REJECTED_GRANTS.has(grant));

    if (forbiddenGrant) {
      return {
        ok: false,
        rejection: {
          code: "forbidden_grant",
          reason: `Capacity continuity cannot start work that requires the ${forbiddenGrant} grant.`,
          details: {
            grant: forbiddenGrant,
            toolName: tool.name,
          },
        },
      };
    }
  }

  return null;
}

function rejectAmbiguousObjective(
  candidate: CapacityContinuityCandidate,
): CapacityContinuityMappingResult | null {
  if (hasResolvableArtifactTarget(candidate)) {
    return null;
  }

  return {
    ok: false,
    rejection: {
      code: "ambiguous_objective",
      reason:
        "Capacity continuity requires a resolvable artifact target before starting autonomous work.",
      details: {
        candidateId: candidate.candidateId,
      },
    },
  };
}

function hasResolvableArtifactTarget(candidate: CapacityContinuityCandidate) {
  if (candidate.evidenceRequired.length > 0) {
    return true;
  }

  return candidate.sourceRef.kind !== "standing-order";
}
