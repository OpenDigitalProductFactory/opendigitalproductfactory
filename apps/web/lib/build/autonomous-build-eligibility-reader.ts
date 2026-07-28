import type { CapabilityInstallScope } from "@dpf/db/capability-maturity";

import {
  listWorkPatternBindingsForAgent,
  type WorkPatternBindingRecord,
} from "@/lib/tak/work-pattern-binding-reader";

import {
  AUTONOMOUS_RECOVERY_POLICY_VERSION,
} from "./autonomous-recovery-policy";
import {
  evaluateAutonomousBuildEligibility,
  type AutonomousBuildAttribution,
  type AutonomousBuildEligibility,
  type AutonomousBuildEligibilityInput,
} from "./autonomous-build-eligibility";

export type AutonomousBuildBindingScope = {
  activityKey: string;
  installScope: CapabilityInstallScope;
  organizationId?: string | null;
  taskCorpusKey: string;
  modelProfileId: string;
  now?: Date;
  freshnessWindowMs: number;
};

export type AutonomousBuildExecutionProfileRefV1 = {
  schemaVersion: 1;
  bindingId: string;
  patternKey: string;
  patternVersion: number;
  activityKey: string;
  riskClass: WorkPatternBindingRecord["authorityScope"]["riskClass"];
  modelProfileId: string;
  providerId: string;
  modelId: string | null;
  promotionPolicyKey: string;
  promotionPolicyVersion: number;
  sourceExperimentTaskRunId: string;
  recoveryPolicyVersion: typeof AUTONOMOUS_RECOVERY_POLICY_VERSION;
};

function containsOrUnscoped(
  declared: readonly string[],
  requested: string | null | undefined,
): boolean {
  if (declared.length === 0) return requested == null;
  return requested != null && declared.includes(requested);
}

const NON_BLOCKING_SCOPE_NOTES = new Set([
  "broader_scope_requires_portable_corpus_or_customer_corroboration",
]);

function hasAuthorityBlocker(blockers: readonly string[]): boolean {
  return blockers.some((blocker) => !NON_BLOCKING_SCOPE_NOTES.has(blocker));
}

function bindingMatchesScope(
  binding: WorkPatternBindingRecord,
  scope: AutonomousBuildBindingScope,
): boolean {
  const authority = binding.authorityScope;
  return (
    authority.activityKey === scope.activityKey
    && authority.installScopes.includes(scope.installScope)
    && containsOrUnscoped(authority.organizationIds, scope.organizationId)
    && authority.taskCorpusKeys.includes(scope.taskCorpusKey)
    && authority.modelProfileIds.includes(scope.modelProfileId)
    && !hasAuthorityBlocker(authority.blockers)
  );
}

export function selectActiveWorkPatternAttribution(
  bindings: readonly WorkPatternBindingRecord[],
  scope: AutonomousBuildBindingScope,
): AutonomousBuildAttribution | null {
  return selectActiveWorkPatternBinding(bindings, scope)?.attribution ?? null;
}

export function selectActiveWorkPatternBinding(
  bindings: readonly WorkPatternBindingRecord[],
  scope: AutonomousBuildBindingScope,
): {
  binding: WorkPatternBindingRecord;
  attribution: AutonomousBuildAttribution;
} | null {
  const activeBindings = bindings.filter((binding) => binding.status === "active");
  const active =
    activeBindings.find((binding) => bindingMatchesScope(binding, scope))
    ?? activeBindings[0];
  if (!active) return null;

  const authority = active.authorityScope;
  const scopeMatches = bindingMatchesScope(active, scope);
  const nowMs = (scope.now ?? new Date()).getTime();
  const evidenceMs = Date.parse(authority.evidenceFreshnessAt);
  const evidenceFresh =
    Number.isFinite(evidenceMs)
    && evidenceMs <= nowMs + 5 * 60_000
    && evidenceMs >= nowMs - scope.freshnessWindowMs;

  return {
    binding: active,
    attribution: {
      bindingStatus: active.status,
      patternVersion: authority.patternVersion,
      scopeMatches,
      evidenceFresh,
    },
  };
}

export function createAutonomousBuildExecutionProfileRef(input: {
  binding: WorkPatternBindingRecord;
  modelProfileId: string;
  providerId: string;
  modelId: string | null;
}): AutonomousBuildExecutionProfileRefV1 {
  const authority = input.binding.authorityScope;
  return {
    schemaVersion: 1,
    bindingId: input.binding.bindingId,
    patternKey: authority.patternKey,
    patternVersion: authority.patternVersion,
    activityKey: authority.activityKey,
    riskClass: authority.riskClass,
    modelProfileId: input.modelProfileId,
    providerId: input.providerId,
    modelId: input.modelId,
    promotionPolicyKey: authority.promotionPolicyKey,
    promotionPolicyVersion: authority.promotionPolicyVersion,
    sourceExperimentTaskRunId: authority.sourceExperimentTaskRunId,
    recoveryPolicyVersion: AUTONOMOUS_RECOVERY_POLICY_VERSION,
  };
}

export async function readAutonomousBuildEligibilitySnapshot(
  input: {
    agentId: string;
    bindingScope: AutonomousBuildBindingScope;
    eligibility: Omit<AutonomousBuildEligibilityInput, "attribution">;
  },
  deps?: {
    listBindings?: (
      agentId: string,
    ) => Promise<WorkPatternBindingRecord[]>;
  },
): Promise<{
  eligibility: AutonomousBuildEligibility;
  binding: WorkPatternBindingRecord | null;
}> {
  const bindings = await (
    deps?.listBindings ?? listWorkPatternBindingsForAgent
  )(input.agentId);
  const selected = selectActiveWorkPatternBinding(
    bindings,
    input.bindingScope,
  );
  return {
    eligibility: evaluateAutonomousBuildEligibility({
      ...input.eligibility,
      attribution: selected?.attribution ?? null,
    }),
    binding: selected?.binding ?? null,
  };
}

export async function readAutonomousBuildEligibility(
  input: {
    agentId: string;
    bindingScope: AutonomousBuildBindingScope;
    eligibility: Omit<AutonomousBuildEligibilityInput, "attribution">;
  },
  deps?: {
    listBindings?: (
      agentId: string,
    ) => Promise<WorkPatternBindingRecord[]>;
  },
): Promise<AutonomousBuildEligibility> {
  return (
    await readAutonomousBuildEligibilitySnapshot(input, deps)
  ).eligibility;
}
