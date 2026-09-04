import { createHash } from "node:crypto";

import type { PrincipalSensitivity } from "@dpf/db/principal-sensitivity";

import type { EffectiveAuthContext } from "@/lib/identity/effective-auth-context";

import {
  canAccessAuthoritySubject,
  type AuthoritySubject,
} from "./authority-subject";

export const COWORKER_AUTHORITY_OUTCOMES = [
  "allow",
  "deny",
  "require-approval",
] as const;

export type CoworkerAuthorityOutcome =
  (typeof COWORKER_AUTHORITY_OUTCOMES)[number];

export type CoworkerAuthoritySubject = AuthoritySubject;

export type CoworkerApprovalPolicy = "none" | "side-effects" | "all";

export type CoworkerAuthorityReasonCode =
  | "authorized"
  | "human-identity-missing"
  | "agent-identity-missing"
  | "human-capability-denied"
  | "agent-grant-denied"
  | "delegation-inactive"
  | "delegation-origin-mismatch"
  | "delegation-agent-mismatch"
  | "delegation-scope-denied"
  | "delegation-chain-required"
  | "route-scope-denied"
  | "subject-scope-denied"
  | "integration-unavailable"
  | "sensitivity-clearance-denied"
  | "masking-obligation-unmet"
  | "policy-version-stale"
  | "policy-declined"
  | "policy-authorization-invalid"
  | "dual-control-required"
  | "approval-required"
  | "approval-expired"
  | "approval-binding-mismatch"
  | "approval-not-active";

export type CoworkerApprovalBinding = {
  actingHumanUserId: string;
  actingAgentId: string;
  chainId: string | null;
  taskRunId: string | null;
  toolName: string;
  subject: CoworkerAuthoritySubject | null;
  routeContext: string | null;
  inputFingerprint: string;
  sensitivity: PrincipalSensitivity;
  decisionVersionFingerprint: string;
};

export type CoworkerAuthorityInput = {
  authContext: EffectiveAuthContext;
  /** Server-resolved organization for the governed subject. */
  organizationId?: string | null;
  action: {
    toolName: string;
    requiredCapability: string | null;
    agentGrantAllowed: boolean;
    sideEffect: boolean;
    executionMode: "proposal" | "immediate";
    routeContext: string | null;
    allowedRouteContexts?: readonly string[];
    approvalPolicy: CoworkerApprovalPolicy;
    requiresDelegationChain?: boolean;
  };
  subject?: CoworkerAuthoritySubject | null;
  delegation?: {
    chainId: string;
    status: string;
    originUserId: string;
    currentAgentId: string;
    authorityScope: readonly string[];
  } | null;
  integration: {
    required: boolean;
    state: "connected" | "disconnected" | "unknown" | "not-required";
  };
  dataPolicy: {
    sensitivity: PrincipalSensitivity;
    maskingRequired: boolean;
    maskingSatisfied: boolean;
    decisionVersionsCurrent: boolean;
    decisionVersionIds?: readonly string[];
  };
  task?: {
    taskRunId: string;
    parentTaskRunId?: string | null;
  } | null;
  rawParams: Record<string, unknown>;
  approval?: {
    envelopeId?: string;
    status:
      | "proposed"
      | "approved"
      | "declined"
      | "executed"
      | "failed"
      | "cancelled";
    expiresAt: Date;
    binding: CoworkerApprovalBinding;
  } | null;
  now?: Date;
  /**
   * Untrusted model/caller claims are deliberately not consulted by the
   * evaluator. Carrying them makes that non-authority boundary explicit and
   * lets regression tests prove prompt/fallback text cannot widen access.
   */
  untrustedClaims?: {
    promptRequestedApprovalBypass?: boolean;
    providerFallbackRequested?: boolean;
    callerSensitivity?: PrincipalSensitivity;
  };
};

type CoworkerAuthorityAllowDecision = {
  outcome: "allow";
  reasonCode: "authorized";
  explanation: string;
  nextAction: "execute";
};

type CoworkerAuthorityDenyDecision = {
  outcome: "deny";
  reasonCode: Exclude<
    CoworkerAuthorityReasonCode,
    "authorized" | "approval-required"
  >;
  explanation: string;
  nextAction: "request-authority" | "correct-context";
};

type CoworkerAuthorityApprovalDecision = {
  outcome: "require-approval";
  reasonCode: "approval-required";
  explanation: string;
  nextAction: "request-approval";
  approvalBinding: CoworkerApprovalBinding;
};

export type CoworkerAuthorityDecision =
  | CoworkerAuthorityAllowDecision
  | CoworkerAuthorityDenyDecision
  | CoworkerAuthorityApprovalDecision;

const EXPLANATIONS: Record<CoworkerAuthorityReasonCode, string> = {
  authorized: "Your authority and the coworker's permit this action.",
  "human-identity-missing":
    "A verified employee authority root is required before this coworker can act.",
  "agent-identity-missing":
    "The executing coworker identity could not be verified.",
  "human-capability-denied":
    "You do not have authority for this action.",
  "agent-grant-denied":
    "This coworker is not assigned the tool authority required for this action.",
  "delegation-inactive": "The delegated authority chain is no longer active.",
  "delegation-origin-mismatch":
    "The delegated action is not rooted in your authority.",
  "delegation-agent-mismatch":
    "The delegated action belongs to a different coworker.",
  "delegation-scope-denied":
    "The delegated authority was narrowed before reaching this action.",
  "delegation-chain-required":
    "This delegated action has no verifiable chain back to an employee.",
  "route-scope-denied":
    "This action is not authorized from the current workspace.",
  "subject-scope-denied":
    "You cannot act on the selected record.",
  "integration-unavailable":
    "The required connection is not currently authorized and available.",
  "sensitivity-clearance-denied":
    "The current authority does not permit this data sensitivity.",
  "masking-obligation-unmet":
    "Required data protection was not completed before this action.",
  "policy-version-stale":
    "The governing policy changed; the action must be evaluated again.",
  "policy-declined":
    "The owning policy judgment explicitly declined this action.",
  "policy-authorization-invalid":
    "The owning policy judgment cannot authorize this exact action.",
  "dual-control-required":
    "This action requires a fresh distinct-human approval bound to the exact call.",
  "approval-required":
    "This action is authorized to proceed only after employee approval.",
  "approval-expired": "The prior approval expired; request a new decision.",
  "approval-binding-mismatch":
    "The prior approval belongs to different work or action details.",
  "approval-not-active":
    "The prior approval is not active and cannot authorize execution.",
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function normalize(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

export function buildCoworkerApprovalBinding(
  input: CoworkerAuthorityInput,
): CoworkerApprovalBinding {
  const humanId = normalize(input.authContext.actingHumanUserId);
  const agentId = normalize(input.authContext.actingAgentId);
  if (!humanId || !agentId) {
    throw new Error(
      "Cannot bind coworker approval without employee and agent identities.",
    );
  }

  return {
    actingHumanUserId: humanId,
    actingAgentId: agentId,
    chainId: normalize(input.delegation?.chainId),
    taskRunId: normalize(input.task?.taskRunId),
    toolName: input.action.toolName.trim(),
    subject: input.subject ?? null,
    routeContext: normalize(input.action.routeContext),
    inputFingerprint: fingerprint(input.rawParams),
    sensitivity: input.dataPolicy.sensitivity,
    decisionVersionFingerprint: fingerprint(
      [...(input.dataPolicy.decisionVersionIds ?? [])].sort(),
    ),
  };
}

function deny(
  reasonCode: CoworkerAuthorityDenyDecision["reasonCode"],
  nextAction: CoworkerAuthorityDenyDecision["nextAction"] = "correct-context",
): CoworkerAuthorityDenyDecision {
  return {
    outcome: "deny",
    reasonCode,
    explanation: EXPLANATIONS[reasonCode],
    nextAction,
  };
}

function requiresApproval(input: CoworkerAuthorityInput): boolean {
  if (input.action.executionMode === "proposal") return true;
  if (!input.action.sideEffect) return false;
  return input.action.approvalPolicy === "all"
    || input.action.approvalPolicy === "side-effects";
}

function sameBinding(
  left: CoworkerApprovalBinding,
  right: CoworkerApprovalBinding,
): boolean {
  return (
    fingerprintCoworkerApprovalBinding(left)
    === fingerprintCoworkerApprovalBinding(right)
  );
}

export function fingerprintCoworkerApprovalBinding(
  binding: CoworkerApprovalBinding,
): string {
  return fingerprint(binding);
}

export function evaluateCoworkerAuthority(
  input: CoworkerAuthorityInput,
): CoworkerAuthorityDecision {
  const humanId = normalize(input.authContext.actingHumanUserId);
  if (!humanId) return deny("human-identity-missing", "request-authority");

  const agentId = normalize(input.authContext.actingAgentId);
  if (!agentId) return deny("agent-identity-missing", "request-authority");

  const capability = normalize(input.action.requiredCapability);
  if (
    capability &&
    !input.authContext.grantedCapabilities.includes(capability)
  ) {
    return deny("human-capability-denied", "request-authority");
  }

  if (!input.action.agentGrantAllowed) {
    return deny("agent-grant-denied", "request-authority");
  }

  const delegation = input.delegation;
  if (input.action.requiresDelegationChain && !delegation) {
    return deny("delegation-chain-required", "request-authority");
  }
  if (delegation) {
    if (delegation.status !== "active") return deny("delegation-inactive");
    if (delegation.originUserId !== humanId) {
      return deny("delegation-origin-mismatch");
    }
    if (delegation.currentAgentId !== agentId) {
      return deny("delegation-agent-mismatch");
    }
    if (
      capability &&
      !delegation.authorityScope.includes(capability)
    ) {
      return deny("delegation-scope-denied", "request-authority");
    }
  }

  const allowedRoutes = input.action.allowedRouteContexts;
  if (
    allowedRoutes?.length &&
    !allowedRoutes.includes(input.action.routeContext ?? "")
  ) {
    return deny("route-scope-denied");
  }

  if (!canAccessAuthoritySubject(input.authContext, input.subject, input.organizationId)) {
    return deny("subject-scope-denied", "request-authority");
  }

  if (
    input.integration.required &&
    input.integration.state !== "connected"
  ) {
    return deny("integration-unavailable");
  }

  if (
    !input.authContext.sensitivityClearance.includes(
      input.dataPolicy.sensitivity,
    )
  ) {
    return deny("sensitivity-clearance-denied", "request-authority");
  }
  if (
    input.dataPolicy.maskingRequired &&
    !input.dataPolicy.maskingSatisfied
  ) {
    return deny("masking-obligation-unmet");
  }
  if (!input.dataPolicy.decisionVersionsCurrent) {
    return deny("policy-version-stale");
  }

  if (!requiresApproval(input)) {
    return {
      outcome: "allow",
      reasonCode: "authorized",
      explanation: EXPLANATIONS.authorized,
      nextAction: "execute",
    };
  }

  const currentBinding = buildCoworkerApprovalBinding(input);
  if (!input.approval) {
    return {
      outcome: "require-approval",
      reasonCode: "approval-required",
      explanation: EXPLANATIONS["approval-required"],
      nextAction: "request-approval",
      approvalBinding: currentBinding,
    };
  }
  if (input.approval.status !== "approved") {
    return deny("approval-not-active");
  }
  if (input.approval.expiresAt.getTime() <= (input.now ?? new Date()).getTime()) {
    return deny("approval-expired");
  }
  if (!sameBinding(input.approval.binding, currentBinding)) {
    return deny("approval-binding-mismatch");
  }

  return {
    outcome: "allow",
    reasonCode: "authorized",
    explanation: EXPLANATIONS.authorized,
    nextAction: "execute",
  };
}
