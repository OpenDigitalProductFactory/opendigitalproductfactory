import { prisma } from "@dpf/db";

import {
  parsePersistedWorkroomParticipantAssignment,
  type PersistedWorkroomParticipantAssignment,
} from "./room-participant-assignment";
import type { WorkroomParticipantRole } from "./room-types";

type AssignmentDb = {
  principal: {
    findFirst: (args: {
      where: { principalId: string; status?: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
  workroomParticipant: {
    upsert: (args: unknown) => Promise<unknown>;
  };
};

function roleKind(kind: string): "person" | "agent" | "system" | "external" {
  if (kind === "agent") return "agent";
  if (kind === "system" || kind === "service") return "system";
  if (kind === "external") return "external";
  return "person";
}

export function mapPersistedParticipantRow(row: {
  assignmentSource: "explicit" | "legacy";
  roles: WorkroomParticipantRole[];
  enteredReason: string | null;
  currentWorkSummary: string | null;
  principal: {
    principalId: string;
    displayName: string;
    kind: string;
    authorityMode: string | null;
    sponsorPrincipal: { principalId: string; displayName: string } | null;
  };
}): {
  principalRef: string;
  displayName: string;
  kind: "person" | "agent" | "system" | "external";
  roles: WorkroomParticipantRole[];
  assignmentSource: "explicit" | "legacy";
  enteredReason: string | null;
  currentWorkSummary: string | null;
  sponsorPrincipalRef: string | null;
  sponsorDisplayName: string | null;
  authoritySummary: string;
} {
  const mode = row.principal.authorityMode?.trim();
  const kind = roleKind(row.principal.kind);
  return {
    principalRef: row.principal.principalId,
    displayName: row.principal.displayName,
    kind,
    roles: [...row.roles],
    assignmentSource: row.assignmentSource,
    enteredReason: row.enteredReason,
    currentWorkSummary: row.currentWorkSummary,
    sponsorPrincipalRef: row.principal.sponsorPrincipal?.principalId ?? null,
    sponsorDisplayName: row.principal.sponsorPrincipal?.displayName ?? null,
    authoritySummary: kind === "agent"
      ? (mode
        ? `Acts ${mode}; consequential work remains governed`
        : "May contribute within the room; consequential work remains governed")
      : (mode ? `Participates with ${mode} authority` : "Participates within assigned room authority"),
  };
}

export async function persistWorkroomParticipantAssignment(
  input: PersistedWorkroomParticipantAssignment,
  db: AssignmentDb = prisma as unknown as AssignmentDb,
): Promise<{ workroomId: string; principalId: string } | null> {
  const parsed = parsePersistedWorkroomParticipantAssignment(input);
  const principal = await db.principal.findFirst({
    where: { principalId: parsed.principalRef, status: "active" },
    select: { id: true },
  });
  if (!principal) return null;
  await db.workroomParticipant.upsert({
    where: {
      workroomId_principalId: {
        workroomId: parsed.workroomId,
        principalId: principal.id,
      },
    },
    create: {
      workroomId: parsed.workroomId,
      principalId: principal.id,
      roles: parsed.roles,
      assignmentSource: parsed.assignmentSource,
      enteredReason: parsed.enteredReason,
      currentWorkSummary: parsed.currentWorkSummary,
      lifecycle: "active",
    },
    update: {
      roles: parsed.roles,
      assignmentSource: parsed.assignmentSource,
      enteredReason: parsed.enteredReason,
      currentWorkSummary: parsed.currentWorkSummary,
      lifecycle: "active",
      lifecycleAt: null,
      lifecycleReason: null,
    },
  });
  return { workroomId: parsed.workroomId, principalId: principal.id };
}

export async function persistExplicitWorkroomAssignmentsForWorkItem(input: {
  workItemId: string;
  principalRef: string;
  roles: WorkroomParticipantRole[];
  enteredReason: string | null;
}): Promise<void> {
  const rooms = await prisma.workroom.findMany({
    where: { workItemId: input.workItemId },
    select: { id: true },
  });
  for (const room of rooms) {
    await persistWorkroomParticipantAssignment({
      workroomId: room.id,
      principalRef: input.principalRef,
      roles: input.roles,
      assignmentSource: "explicit",
      enteredReason: input.enteredReason,
      currentWorkSummary: null,
    });
  }
}
