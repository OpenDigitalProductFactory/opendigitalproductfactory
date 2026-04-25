export type EffectiveAuthorityBinding = {
  bindingId: string;
  resourceRef: string;
  appliedAgentId: string | null;
  approvalMode: string;
  subjects: Array<{
    subjectType: string;
    subjectRef: string;
    relation: string;
  }>;
  grants: Array<{
    grantKey: string;
    mode: string;
    rationale: string | null;
  }>;
};

export type EffectiveAuthorityExplanation = {
  decision: "allow" | "deny" | "require-approval";
  reasonCode: string;
  binding: EffectiveAuthorityBinding | null;
};

function getApplicableBinding(bindings: EffectiveAuthorityBinding[], agentId: string, resourceRef: string) {
  return (
    bindings.find((binding) => binding.appliedAgentId === agentId && binding.resourceRef === resourceRef) ?? null
  );
}

function bindingAllowsRole(binding: EffectiveAuthorityBinding, roleId: string) {
  const allowedRoleSubjects = binding.subjects.filter(
    (subject) => subject.subjectType === "platform-role" && subject.relation === "allowed",
  );

  if (allowedRoleSubjects.length === 0) {
    return true;
  }

  return allowedRoleSubjects.some((subject) => subject.subjectRef === roleId);
}

export function explainEffectiveAuthority(input: {
  roleId: string;
  agentId: string;
  resourceRef: string;
  actionKey: string;
  userAllowed: boolean;
  agentAllowed: boolean;
  bindings: EffectiveAuthorityBinding[];
  toolGrantRequirements: Record<string, string[]>;
}): EffectiveAuthorityExplanation {
  const binding = getApplicableBinding(input.bindings, input.agentId, input.resourceRef);

  if (!input.userAllowed) {
    return { decision: "deny", reasonCode: "user_capability_denied", binding };
  }

  if (!input.agentAllowed) {
    return { decision: "deny", reasonCode: "agent_grant_denied", binding };
  }

  if (!binding) {
    return { decision: "allow", reasonCode: "no_binding", binding: null };
  }

  if (!bindingAllowsRole(binding, input.roleId)) {
    return { decision: "deny", reasonCode: "binding_subject_denied", binding };
  }

  const requiredGrantKeys = input.toolGrantRequirements[input.actionKey] ?? [];
  const relevantGrantModes = binding.grants
    .filter((grant) => requiredGrantKeys.includes(grant.grantKey))
    .map((grant) => grant.mode);

  if (relevantGrantModes.includes("deny")) {
    return { decision: "deny", reasonCode: "binding_grant_denied", binding };
  }

  if (relevantGrantModes.includes("require-approval")) {
    return { decision: "require-approval", reasonCode: "binding_grant_requires_approval", binding };
  }

  if (binding.approvalMode === "proposal-required" || binding.approvalMode === "human-required") {
    return { decision: "require-approval", reasonCode: "binding_approval_mode", binding };
  }

  return { decision: "allow", reasonCode: "binding_allows", binding };
}
