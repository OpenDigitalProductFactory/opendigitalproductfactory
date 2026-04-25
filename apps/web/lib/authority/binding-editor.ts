import { prisma, type Prisma } from "@dpf/db";

type BindingGrantInput = {
  grantKey: string;
  mode: string;
  rationale?: string | null;
};

type BindingSubjectInput = {
  subjectType: string;
  subjectRef: string;
  relation: string;
};

type BindingBaseInput = {
  name?: string;
  scopeType?: string;
  status?: string;
  resourceType?: string;
  resourceRef?: string;
  policyJson?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  authorityScope?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  approvalMode?: string;
  sensitivityCeiling?: string | null;
  appliedAgentId?: string | null;
  subjects?: BindingSubjectInput[];
  grants?: BindingGrantInput[];
};

type CreateAuthorityBindingInput = BindingBaseInput & {
  bindingId: string;
  name: string;
  scopeType: string;
  resourceType: string;
  resourceRef: string;
};

type UpdateAuthorityBindingInput = BindingBaseInput;

export async function validateBindingGrant(options: {
  intrinsic: string[];
  requested: BindingGrantInput[];
}) {
  const intrinsic = new Set(options.intrinsic);

  for (const grant of options.requested) {
    if (grant.mode === "allow") {
      throw new Error(`Binding grant ${grant.grantKey} cannot widen intrinsic coworker access.`);
    }

    if (!intrinsic.has(grant.grantKey)) {
      throw new Error(`Binding grant ${grant.grantKey} cannot widen intrinsic coworker access.`);
    }
  }
}

function normalizeSubjects(subjects: BindingSubjectInput[] | undefined) {
  const seen = new Set<string>();
  const normalized: BindingSubjectInput[] = [];

  for (const subject of subjects ?? []) {
    const key = `${subject.subjectType}::${subject.subjectRef}::${subject.relation}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(subject);
  }

  return normalized;
}

function normalizeGrants(grants: BindingGrantInput[] | undefined) {
  const seen = new Set<string>();
  const normalized: Array<Required<BindingGrantInput>> = [];

  for (const grant of grants ?? []) {
    if (seen.has(grant.grantKey)) {
      continue;
    }
    seen.add(grant.grantKey);
    normalized.push({
      grantKey: grant.grantKey,
      mode: grant.mode,
      rationale: grant.rationale ?? null,
    });
  }

  return normalized;
}

async function resolveAppliedAgentRowId(agentId: string | null | undefined) {
  if (!agentId) {
    return null;
  }

  const agent = await prisma.agent.findUnique({
    where: { agentId },
    select: { id: true },
  });

  if (!agent) {
    throw new Error(`Unknown coworker: ${agentId}`);
  }

  return agent.id;
}

async function getIntrinsicGrantKeys(agentId: string | null | undefined) {
  if (!agentId) {
    return [];
  }

  const grants = await prisma.agentToolGrant.findMany({
    where: { agentId },
    select: { grantKey: true },
  });

  return grants.map((grant) => grant.grantKey);
}

async function buildNestedData(input: BindingBaseInput) {
  const normalizedSubjects = normalizeSubjects(input.subjects);
  const normalizedGrants = normalizeGrants(input.grants);
  const hasAppliedAgentInput = input.appliedAgentId !== undefined;
  const appliedAgentRowId = hasAppliedAgentInput ? await resolveAppliedAgentRowId(input.appliedAgentId) : undefined;
  const intrinsicGrantKeys =
    normalizedGrants.length > 0 ? await getIntrinsicGrantKeys((appliedAgentRowId as string | null | undefined) ?? null) : [];

  await validateBindingGrant({
    intrinsic: intrinsicGrantKeys,
    requested: normalizedGrants,
  });

  return {
    hasAppliedAgentInput,
    appliedAgentId: appliedAgentRowId,
    policyJson: input.policyJson,
    authorityScope: input.authorityScope,
    approvalMode: input.approvalMode,
    sensitivityCeiling: input.sensitivityCeiling ?? null,
    subjects: normalizedSubjects,
    grants: normalizedGrants,
  };
}

export async function createAuthorityBinding(input: CreateAuthorityBindingInput) {
  const nested = await buildNestedData(input);

  return prisma.authorityBinding.create({
    data: {
      bindingId: input.bindingId,
      name: input.name,
      scopeType: input.scopeType,
      status: input.status ?? "draft",
      resourceType: input.resourceType,
      resourceRef: input.resourceRef,
      appliedAgentId: nested.appliedAgentId,
      policyJson: nested.policyJson,
      authorityScope: nested.authorityScope,
      approvalMode: nested.approvalMode ?? "none",
      sensitivityCeiling: nested.sensitivityCeiling,
      subjects: {
        create: nested.subjects,
      },
      grants: {
        create: nested.grants,
      },
    },
  });
}

export async function updateAuthorityBinding(bindingId: string, input: UpdateAuthorityBindingInput) {
  const nested = await buildNestedData(input);

  return prisma.authorityBinding.update({
    where: { bindingId },
    data: {
      name: input.name,
      scopeType: input.scopeType,
      status: input.status,
      resourceType: input.resourceType,
      resourceRef: input.resourceRef,
      appliedAgentId: nested.hasAppliedAgentInput ? nested.appliedAgentId ?? null : undefined,
      policyJson: nested.policyJson,
      authorityScope: nested.authorityScope,
      approvalMode: nested.approvalMode,
      sensitivityCeiling: nested.sensitivityCeiling,
      subjects: input.subjects
        ? {
            deleteMany: {},
            create: nested.subjects,
          }
        : undefined,
      grants: input.grants
        ? {
            deleteMany: {},
            create: nested.grants,
          }
        : undefined,
    },
  });
}
