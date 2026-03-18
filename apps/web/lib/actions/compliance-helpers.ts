"use server";

import * as crypto from "crypto";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

export type ComplianceActionResult = { ok: boolean; message: string; id?: string | undefined };

export async function requireViewCompliance() {
  const session = await auth();
  if (!session?.user || !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "view_compliance")) {
    throw new Error("Unauthorized");
  }
  return session.user;
}

export async function requireManageCompliance() {
  const session = await auth();
  if (!session?.user || !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_compliance")) {
    throw new Error("Unauthorized");
  }
  return session.user;
}

export async function getSessionEmployeeId(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const profile = await prisma.employeeProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  return profile?.id ?? null;
}

export async function logComplianceAction(
  entityType: string, entityId: string, action: string,
  performedByEmployeeId: string | null, agentId: string | null,
  details?: { field?: string; oldValue?: string; newValue?: string; notes?: string },
) {
  await prisma.complianceAuditLog.create({
    data: {
      entityType, entityId, action,
      performedByEmployeeId, agentId,
      field: details?.field ?? null,
      oldValue: details?.oldValue ?? null,
      newValue: details?.newValue ?? null,
      notes: details?.notes ?? null,
    },
  });
}

export async function ensureComplianceCalendarEvent(
  entityType: string, entityId: string, title: string,
  dueDate: Date, ownerEmployeeId: string, recurrence?: string,
) {
  const eventId = `CE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await prisma.calendarEvent.create({
    data: {
      eventId,
      title,
      startAt: dueDate,
      allDay: true,
      eventType: "deadline",
      category: "compliance",
      ownerEmployeeId,
      visibility: "team",
      recurrence: recurrence ?? null,
      complianceEntityType: entityType,
      complianceEntityId: entityId,
    },
  });
}
