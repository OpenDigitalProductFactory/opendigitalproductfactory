import { prisma } from "@dpf/db";

import { PERMISSIONS } from "@/lib/govern/permissions";
import { ROUTE_AGENT_MAP_ENTRIES } from "@/lib/tak/agent-routing";

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

export type BootstrapAuthorityBindingWarning = {
  resourceRef: string;
  agentId: string | null;
  reason: "ungated-route" | "missing-agent" | "missing-subjects";
};

export type BootstrapAuthorityBindingsReport = {
  created: number;
  skippedExisting: number;
  wouldCreate: number;
  candidates: AuthorityBindingCandidate[];
  lowConfidence: BootstrapAuthorityBindingWarning[];
};

function slugify(value: string) {
  return value
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

export function buildAuthorityBindingId(resourceType: string, resourceRef: string, agentToken: string) {
  return `AB-${resourceType.toUpperCase()}-${slugify(resourceRef)}-${slugify(agentToken)}`;
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
    const bindingId = buildAuthorityBindingId(input.resourceType, input.resourceRef, input.appliedAgentId ?? "unassigned");
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

type DraftBindingCandidate = {
  bindingId: string;
  name: string;
  scopeType: string;
  status: string;
  resourceType: string;
  resourceRef: string;
  approvalMode: string;
  appliedAgentId: string | null;
  subjects: AuthorityBindingSubjectInput[];
  grants: AuthorityBindingGrantInput[];
  authorityScope: {
    bootstrapWarning: {
      reason: BootstrapAuthorityBindingWarning["reason"];
      requestedAgentId: string | null;
      source: "authority-bootstrap";
    };
  };
};

async function getDraftSubjectContext(resourceRef: string, requestedAgentId: string | null) {
  const routeEntry = ROUTE_AGENT_MAP_ENTRIES.find(([routeRef]) => routeRef === resourceRef)?.[1] ?? null;
  const agentRows = requestedAgentId
    ? await prisma.agent.findMany({
        where: {
          agentId: {
            in: [requestedAgentId],
          },
        },
        select: {
          agentId: true,
          ownerships: {
            select: {
              team: {
                select: {
                  teamId: true,
                },
              },
            },
          },
        },
      })
    : [];
  const agent = requestedAgentId ? agentRows.find((row) => row.agentId === requestedAgentId) ?? null : null;
  const allowedRoles = routeEntry?.capability ? PERMISSIONS[routeEntry.capability]?.roles ?? [] : [];
  const ownerTeams = agent?.ownerships.map((ownership) => ownership.team) ?? [];

  return {
    resolvedAgentId: agent?.agentId ?? null,
    subjects: dedupeSubjects([
      ...allowedRoles.map((roleId) => ({
        subjectType: "platform-role",
        subjectRef: roleId,
        relation: "allowed",
      })),
      ...ownerTeams.map((team) => ({
        subjectType: "team",
        subjectRef: team.teamId,
        relation: "owner",
      })),
    ]),
  };
}

export async function buildDraftAuthorityBindingFromWarning(
  warning: BootstrapAuthorityBindingWarning,
): Promise<DraftBindingCandidate> {
  const subjectContext = await getDraftSubjectContext(warning.resourceRef, warning.agentId);
  const bindingId = buildAuthorityBindingId("route", warning.resourceRef, warning.agentId ?? "unassigned");

  return {
    bindingId,
    name: `Review ${warning.resourceRef} authority binding`,
    scopeType: "route",
    status: "draft",
    resourceType: "route",
    resourceRef: warning.resourceRef,
    approvalMode: "none",
    appliedAgentId: subjectContext.resolvedAgentId,
    subjects: subjectContext.subjects,
    grants: [],
    authorityScope: {
      bootstrapWarning: {
        reason: warning.reason,
        requestedAgentId: warning.agentId,
        source: "authority-bootstrap",
      },
    },
  };
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
  const agentIds = Array.from(
    new Set(candidates.map((candidate) => candidate.appliedAgentId).filter((value): value is string => !!value)),
  );
  const agents = await prisma.agent.findMany({
    where: {
      agentId: {
        in: agentIds,
      },
    },
    select: {
      id: true,
      agentId: true,
    },
  });
  const agentRowIds = new Map(agents.map((agent) => [agent.agentId, agent.id]));

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
        appliedAgentId: candidate.appliedAgentId ? (agentRowIds.get(candidate.appliedAgentId) ?? null) : null,
        subjects: {
          create: candidate.subjects,
        },
        grants: {
          create: candidate.grants,
        },
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

export async function bootstrapAuthorityBindings(options?: {
  writeMode?: "dry-run" | "commit";
}): Promise<BootstrapAuthorityBindingsReport> {
  const routeEntries = ROUTE_AGENT_MAP_ENTRIES;
  const routeAgentIds = Array.from(new Set(routeEntries.map(([, entry]) => entry.agentId)));
  const agents = await prisma.agent.findMany({
    where: {
      agentId: {
        in: routeAgentIds,
      },
    },
    select: {
      id: true,
      agentId: true,
      name: true,
      ownerships: {
        select: {
          team: {
            select: {
              teamId: true,
              slug: true,
              name: true,
            },
          },
        },
      },
    },
  });

  const agentMap = new Map(agents.map((agent) => [agent.agentId, agent]));
  const lowConfidence: BootstrapAuthorityBindingWarning[] = [];
  const inferenceInputs: AuthorityBindingInferenceInput[] = [];

  for (const [resourceRef, entry] of routeEntries) {
    if (!entry.capability) {
      lowConfidence.push({
        resourceRef,
        agentId: entry.agentId,
        reason: "ungated-route",
      });
      continue;
    }

    const agent = agentMap.get(entry.agentId);
    if (!agent) {
      lowConfidence.push({
        resourceRef,
        agentId: entry.agentId,
        reason: "missing-agent",
      });
      continue;
    }

    const allowedRoles = PERMISSIONS[entry.capability]?.roles ?? [];
    const ownerTeams = agent.ownerships.map((ownership) => ownership.team);
    const subjects = dedupeSubjects([
      ...allowedRoles.map((roleId) => ({
        subjectType: "platform-role",
        subjectRef: roleId,
        relation: "allowed",
      })),
      ...ownerTeams.map((team) => ({
        subjectType: "team",
        subjectRef: team.teamId,
        relation: "owner",
      })),
    ]);

    if (subjects.length === 0) {
      lowConfidence.push({
        resourceRef,
        agentId: entry.agentId,
        reason: "missing-subjects",
      });
      continue;
    }

    inferenceInputs.push({
      resourceType: "route",
      resourceRef,
      appliedAgentId: entry.agentId,
      approvalMode: "none",
      scopeType: "route",
      status: "active",
      subjects,
      grants: [],
    });
  }

  const candidates = inferAuthorityBindings(inferenceInputs);
  const materialized = await materializeAuthorityBindings(candidates, {
    dryRun: options?.writeMode !== "commit",
  });

  return {
    ...materialized,
    candidates,
    lowConfidence,
  };
}
