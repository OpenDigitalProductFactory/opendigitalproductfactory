import { prisma } from "@dpf/db";

import { projectParticipants } from "@/lib/tak/conversation-participants";

import { filterActivePresence, type PresenceRow } from "./work-item-presence";
import {
  projectWorkroomParticipants,
  type WorkroomConversationParticipant,
  type WorkroomParticipantAssignment,
} from "./room-participation";
import { mapPersistedParticipantRow } from "./room-participant-assignment.server";
import type { WorkspaceRoomParticipantLoader } from "./workspace-case-loader";

type ResolvedPrincipal = {
  principalId: string;
  displayName: string;
  kind: string;
  authorityMode: string | null;
  sponsorPrincipal: { principalId: string; displayName: string } | null;
};

function authoritySummary(principal: ResolvedPrincipal): string {
  const mode = principal.authorityMode?.trim();
  if (principal.kind === "agent") {
    return mode
      ? `Acts ${mode}; consequential work remains governed`
      : "May contribute within the room; consequential work remains governed";
  }
  return mode ? `Participates with ${mode} authority` : "Participates within assigned room authority";
}

function toWorkState(state: string): "working" | "waiting" | "idle" | "unknown" {
  if (["working", "submitted", "accepted"].includes(state)) return "working";
  if (["input-required", "waiting", "blocked"].includes(state)) return "waiting";
  if (["completed", "canceled", "failed"].includes(state)) return "idle";
  return "unknown";
}

export const loadPrismaWorkroomParticipants: WorkspaceRoomParticipantLoader = async (input) => {
  const lineage = input.assignedThreadId
    ? await projectParticipants(input.assignedThreadId, { ownerAgentId: input.assignedToAgentId })
    : [];
  const aliasValues = [
    input.assignedToUserId,
    input.assignedToAgentId,
    ...lineage.map((participant) => participant.agentId),
  ].filter((value): value is string => Boolean(value));

  const policyPrincipalRefs = input.policyParticipants.map((participant) => participant.principalRef);
  const [aliases, policyPrincipals, presenceRows] = await Promise.all([
    aliasValues.length > 0
      ? prisma.principalAlias.findMany({
          where: {
            OR: [
              { aliasType: "user", aliasValue: { in: aliasValues } },
              { aliasType: "agent", aliasValue: { in: aliasValues } },
            ],
            issuer: "",
          },
          select: {
            aliasType: true,
            aliasValue: true,
            principal: {
              select: {
                principalId: true,
                displayName: true,
                kind: true,
                authorityMode: true,
                sponsorPrincipal: { select: { principalId: true, displayName: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    policyPrincipalRefs.length > 0
      ? prisma.principal.findMany({
          where: { principalId: { in: policyPrincipalRefs }, status: "active" },
          select: {
            principalId: true,
            displayName: true,
            kind: true,
            authorityMode: true,
            sponsorPrincipal: { select: { principalId: true, displayName: true } },
          },
        })
      : Promise.resolve([]),
    prisma.workItemPresence.findMany({
      where: { workItemId: input.workItemId },
      select: {
        principalType: true,
        principalId: true,
        displayLabel: true,
        lastSeenAt: true,
      },
    }),
  ]);

  const principalByAlias = new Map<string, ResolvedPrincipal>(
    aliases.map((alias) => [`${alias.aliasType}:${alias.aliasValue}`, alias.principal]),
  );
  const canonicalByRaw = new Map<string, string>(
    aliases.map((alias) => [alias.aliasValue, alias.principal.principalId]),
  );
  const presence = filterActivePresence(
    (presenceRows as PresenceRow[]).map((row) => ({
      ...row,
      principalId: canonicalByRaw.get(row.principalId) ?? row.principalId,
    })),
    input.now.getTime(),
  );
  const assignments: WorkroomParticipantAssignment[] = [];

  if (input.workroomIds.length > 0 && typeof prisma.workroomParticipant?.findMany === "function") {
    const persisted = await prisma.workroomParticipant.findMany({
      where: { workroomId: { in: [...input.workroomIds] }, lifecycle: "active" },
      include: {
        principal: {
          select: {
            principalId: true,
            displayName: true,
            kind: true,
            authorityMode: true,
            sponsorPrincipal: { select: { principalId: true, displayName: true } },
          },
        },
      },
    });
    for (const row of persisted) {
      assignments.push(mapPersistedParticipantRow(row));
    }
  }

  const policyPrincipalByRef = new Map(
    policyPrincipals.map((principal) => [principal.principalId, principal]),
  );
  if (assignments.length === 0) {
    for (const participant of input.policyParticipants) {
      const principal = policyPrincipalByRef.get(participant.principalRef);
      if (!principal) continue;
      assignments.push({
        principalRef: principal.principalId,
        displayName: principal.displayName,
        kind: principal.kind === "agent"
          ? "agent"
          : principal.kind === "system" || principal.kind === "service"
            ? "system"
            : "person",
        roles: [...participant.roles],
        currentWorkSummary: participant.currentWorkSummary,
        enteredReason: participant.enteredReason ?? "Named in this room's participation policy",
        sponsorPrincipalRef: principal.sponsorPrincipal?.principalId ?? null,
        sponsorDisplayName: principal.sponsorPrincipal?.displayName ?? null,
        authoritySummary: authoritySummary(principal),
        assignmentSource: "explicit",
      });
    }

    const assignedPerson = input.assignedToUserId
      ? principalByAlias.get(`user:${input.assignedToUserId}`)
      : null;
    if (assignedPerson) {
      assignments.push({
        principalRef: assignedPerson.principalId,
        displayName: assignedPerson.displayName,
        kind: "person",
        roles: ["accountable"],
        currentWorkSummary: input.title,
        enteredReason: "Assigned to this room's work",
        sponsorPrincipalRef: null,
        sponsorDisplayName: null,
        authoritySummary: authoritySummary(assignedPerson),
        assignmentSource: "legacy",
      });
    }

    const assignedAgent = input.assignedToAgentId
      ? principalByAlias.get(`agent:${input.assignedToAgentId}`)
      : null;
    if (assignedAgent) {
      assignments.push({
        principalRef: assignedAgent.principalId,
        displayName: assignedAgent.displayName,
        kind: "agent",
        roles: [assignedPerson ? "contributor" : "accountable"],
        currentWorkSummary: input.title,
        enteredReason: "Assigned to this room's work",
        sponsorPrincipalRef: assignedAgent.sponsorPrincipal?.principalId ?? null,
        sponsorDisplayName: assignedAgent.sponsorPrincipal?.displayName ?? null,
        authoritySummary: authoritySummary(assignedAgent),
        assignmentSource: "legacy",
      });
    }
  }

  const conversationParticipants: WorkroomConversationParticipant[] = lineage.flatMap((participant) => {
    if (!participant.principalResolved) return [];
    const principal = principalByAlias.get(`agent:${participant.agentId}`);
    if (!principal) return [];
    return [{
      principalRef: principal.principalId,
      displayName: participant.label,
      roles: ["contributor"],
      workState: toWorkState(participant.state),
      currentWorkSummary: input.title,
      enteredReason: participant.role === "owner"
        ? "Routed into this room's active work"
        : `Joined automatically through ${participant.enteredVia} lineage`,
      sponsorPrincipalRef: principal.sponsorPrincipal?.principalId ?? null,
      sponsorDisplayName: principal.sponsorPrincipal?.displayName ?? null,
      authoritySummary: authoritySummary(principal),
      sourceRef: {
        kind: "evidence",
        id: participant.taskRunId ?? participant.threadId,
        sourceType: participant.taskRunId ? "task-run" : "agent-thread",
      },
    }];
  });

  return projectWorkroomParticipants({ assignments, conversationParticipants, presence });
};
