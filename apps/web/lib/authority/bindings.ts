import { prisma } from "@dpf/db";

export type AuthorityBindingPivot = "subject" | "coworker";

export type AuthorityBindingRecord = {
  bindingId: string;
  name: string;
  scopeType: string;
  status: string;
  resourceType: string;
  resourceRef: string;
  approvalMode: string;
  sensitivityCeiling: string | null;
  appliedAgentId: string | null;
  appliedAgentName: string | null;
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

export type AuthorityBindingRow = {
  bindingId: string;
  name: string;
  pivotKind: AuthorityBindingPivot;
  pivotLabel: string;
  status: string;
  scopeType: string;
  resourceType: string;
  resourceRef: string;
  approvalMode: string;
  sensitivityCeiling: string | null;
  appliedAgentId: string | null;
  appliedAgentName: string | null;
  subjectLabels: string[];
  subjectCount: number;
  grantModes: string[];
};

export type AuthorityBindingListFilters = {
  statuses?: string[];
  resourceRefs?: string[];
  appliedAgentIds?: string[];
  subjectRefs?: string[];
};

export function shapeAuthorityBindingRows(
  records: AuthorityBindingRecord[],
  pivot: AuthorityBindingPivot,
): AuthorityBindingRow[] {
  if (pivot === "coworker") {
    return records.map((record) => ({
      bindingId: record.bindingId,
      name: record.name,
      pivotKind: "coworker",
      pivotLabel: record.appliedAgentName ?? "Unassigned coworker",
      status: record.status,
      scopeType: record.scopeType,
      resourceType: record.resourceType,
      resourceRef: record.resourceRef,
      approvalMode: record.approvalMode,
      sensitivityCeiling: record.sensitivityCeiling,
      appliedAgentId: record.appliedAgentId,
      appliedAgentName: record.appliedAgentName,
      subjectLabels: record.subjects.map((subject) => subject.subjectRef),
      subjectCount: record.subjects.length,
      grantModes: record.grants.map((grant) => `${grant.grantKey}:${grant.mode}`),
    }));
  }

  return records.flatMap((record) =>
    record.subjects
      .filter((subject) => subject.relation === "allowed")
      .map((subject) => ({
        bindingId: record.bindingId,
        name: record.name,
        pivotKind: "subject" as const,
        pivotLabel: subject.subjectRef,
        status: record.status,
        scopeType: record.scopeType,
        resourceType: record.resourceType,
        resourceRef: record.resourceRef,
        approvalMode: record.approvalMode,
        sensitivityCeiling: record.sensitivityCeiling,
        appliedAgentId: record.appliedAgentId,
        appliedAgentName: record.appliedAgentName,
        subjectLabels: record.subjects.map((item) => item.subjectRef),
        subjectCount: record.subjects.length,
        grantModes: record.grants.map((grant) => `${grant.grantKey}:${grant.mode}`),
      })),
  );
}

export async function listAuthorityBindingRecords(filters?: AuthorityBindingListFilters) {
  const bindings = await prisma.authorityBinding.findMany({
    where: {
      status: filters?.statuses ? { in: filters.statuses } : undefined,
      resourceRef: filters?.resourceRefs ? { in: filters.resourceRefs } : undefined,
      appliedAgent: filters?.appliedAgentIds
        ? {
            agentId: { in: filters.appliedAgentIds },
          }
        : undefined,
      subjects: filters?.subjectRefs
        ? {
            some: {
              subjectRef: { in: filters.subjectRefs },
            },
          }
        : undefined,
    },
    include: {
      appliedAgent: {
        select: {
          agentId: true,
          name: true,
        },
      },
      subjects: {
        orderBy: [{ relation: "asc" }, { subjectType: "asc" }, { subjectRef: "asc" }],
      },
      grants: {
        orderBy: [{ grantKey: "asc" }],
      },
    },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
  });

  return bindings.map(
    (binding): AuthorityBindingRecord => ({
      bindingId: binding.bindingId,
      name: binding.name,
      scopeType: binding.scopeType,
      status: binding.status,
      resourceType: binding.resourceType,
      resourceRef: binding.resourceRef,
      approvalMode: binding.approvalMode,
      sensitivityCeiling: binding.sensitivityCeiling,
      appliedAgentId: binding.appliedAgent?.agentId ?? null,
      appliedAgentName: binding.appliedAgent?.name ?? null,
      subjects: binding.subjects.map((subject) => ({
        subjectType: subject.subjectType,
        subjectRef: subject.subjectRef,
        relation: subject.relation,
      })),
      grants: binding.grants.map((grant) => ({
        grantKey: grant.grantKey,
        mode: grant.mode,
        rationale: grant.rationale,
      })),
    }),
  );
}

export async function listAuthorityBindings(options?: {
  pivot?: AuthorityBindingPivot;
  filters?: AuthorityBindingListFilters;
}) {
  const pivot = options?.pivot ?? "subject";
  const records = await listAuthorityBindingRecords(options?.filters);

  return {
    pivot,
    rows: shapeAuthorityBindingRows(records, pivot),
  };
}

export async function getAuthorityBinding(bindingId: string) {
  return prisma.authorityBinding.findUnique({
    where: { bindingId },
    include: {
      appliedAgent: {
        include: {
          governanceProfile: {
            include: {
              capabilityClass: {
                select: { name: true },
              },
              directivePolicyClass: {
                select: { name: true },
              },
            },
          },
          toolGrants: {
            select: { grantKey: true },
            orderBy: { grantKey: "asc" },
          },
        },
      },
      subjects: {
        orderBy: [{ relation: "asc" }, { subjectType: "asc" }, { subjectRef: "asc" }],
      },
      grants: {
        orderBy: [{ grantKey: "asc" }],
      },
    },
  });
}

export async function getAuthorityBindingEvidence(bindingId: string) {
  const binding = await prisma.authorityBinding.findUnique({
    where: { bindingId },
    select: { id: true },
  });

  if (!binding) {
    return [];
  }

  return prisma.authorizationDecisionLog.findMany({
    where: { authorityBindingId: binding.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      decisionId: true,
      decision: true,
      actionKey: true,
      routeContext: true,
      createdAt: true,
    },
  });
}
