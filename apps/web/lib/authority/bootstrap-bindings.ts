import { prisma } from "@dpf/db";

type AuthorityBindingSubjectInput = {
  subjectType: string;
  subjectRef: string;
  relation: string;
};

type AuthorityBindingGrantInput = {
  grantKey: string;
  mode: string;
  rationale?: string | null;
};

export type AuthorityBindingInferenceInput = {
  resourceType: string;
  resourceRef: string;
  appliedAgentId: string | null;
  approvalMode: string;
  subjects: AuthorityBindingSubjectInput[];
  grants?: AuthorityBindingGrantInput[];
  scopeType?: string;
  status?: string;
  sensitivityCeiling?: string | null;
};

export type AuthorityBindingCandidate = {
  bindingId: string;
  name: string;
  scopeType: string;
  status: string;
  resourceType: string;
  resourceRef: string;
  approvalMode: string;
  appliedAgentId: string | null;
  sensitivityCeiling?: string | null;
  subjects: AuthorityBindingSubjectInput[];
  grants: AuthorityBindingGrantInput[];
};

function slugify(value: string) {
  return value
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

function dedupeSubjects(subjects: AuthorityBindingSubjectInput[]) {
  const seen = new Set<string>();
  const result: AuthorityBindingSubjectInput[] = [];

  for (const subject of subjects) {
    const key = `${subject.subjectType}:${subject.subjectRef}:${subject.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(subject);
  }

  return result;
}

function dedupeGrants(grants: AuthorityBindingGrantInput[]) {
  const seen = new Set<string>();
  const result: AuthorityBindingGrantInput[] = [];

  for (const grant of grants) {
    if (seen.has(grant.grantKey)) continue;
    seen.add(grant.grantKey);
    result.push(grant);
  }

  return result;
}

export function inferAuthorityBindings(inputs: AuthorityBindingInferenceInput[]): AuthorityBindingCandidate[] {
  const byKey = new Map<string, AuthorityBindingCandidate>();

  for (const input of inputs) {
    const resourceToken = slugify(input.resourceRef);
    const agentToken = slugify(input.appliedAgentId ?? "unassigned");
    const bindingId = `AB-${input.resourceType.toUpperCase()}-${resourceToken}-${agentToken}`;
    const key = `${input.resourceType}:${input.resourceRef}:${input.appliedAgentId ?? ""}`;
    const existing = byKey.get(key);

    if (existing) {
      existing.subjects = dedupeSubjects([...existing.subjects, ...input.subjects]);
      existing.grants = dedupeGrants([...(existing.grants ?? []), ...(input.grants ?? [])]);
      continue;
    }

    byKey.set(key, {
      bindingId,
      name: `${input.appliedAgentId ?? "Unassigned coworker"} on ${input.resourceRef}`,
      scopeType: input.scopeType ?? "route",
      status: input.status ?? "active",
      resourceType: input.resourceType,
      resourceRef: input.resourceRef,
      approvalMode: input.approvalMode,
      appliedAgentId: input.appliedAgentId,
      sensitivityCeiling: input.sensitivityCeiling ?? null,
      subjects: dedupeSubjects(input.subjects),
      grants: dedupeGrants(input.grants ?? []),
    });
  }

  return Array.from(byKey.values());
}

export async function materializeAuthorityBindings(
  candidates: AuthorityBindingCandidate[],
  options?: { dryRun?: boolean },
) {
  const existing = await prisma.authorityBinding.findMany({
    where: {
      bindingId: {
        in: candidates.map((candidate) => candidate.bindingId),
      },
    },
    select: { bindingId: true },
  });

  const existingIds = new Set(existing.map((binding) => binding.bindingId));
  let created = 0;
  let skippedExisting = 0;
  let wouldCreate = 0;

  for (const candidate of candidates) {
    if (existingIds.has(candidate.bindingId)) {
      skippedExisting += 1;
      continue;
    }

    if (options?.dryRun) {
      wouldCreate += 1;
      continue;
    }

    await prisma.authorityBinding.create({
      data: {
        bindingId: candidate.bindingId,
        name: candidate.name,
        scopeType: candidate.scopeType,
        status: candidate.status,
        resourceType: candidate.resourceType,
        resourceRef: candidate.resourceRef,
        approvalMode: candidate.approvalMode,
        sensitivityCeiling: candidate.sensitivityCeiling ?? null,
      },
    });
    created += 1;
  }

  return {
    created,
    skippedExisting,
    wouldCreate,
  };
}
