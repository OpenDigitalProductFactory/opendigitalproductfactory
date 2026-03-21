"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import * as crypto from "crypto";

// ─── Auth Guard ──────────────────────────────────────────────────────────────

async function requireOpsAccess(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "view_operations"
    )
  ) {
    throw new Error("Unauthorized");
  }
  return user.id!;
}

// ─── RFC ID Generation ──────────────────────────────────────────────────────

export function generateRfcId(): string {
  const year = new Date().getFullYear();
  const hex = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `RFC-${year}-${hex}`;
}

// ─── Status Transition Map ──────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["assessed", "rejected"],
  assessed: ["approved", "rejected"],
  approved: ["scheduled", "cancelled"],
  scheduled: ["in-progress", "cancelled"],
  "in-progress": ["completed", "rolled-back"],
  completed: ["closed"],
  "rolled-back": ["closed"],
  rejected: ["closed"],
  cancelled: ["closed"],
};

function assertValidTransition(currentStatus: string, targetStatus: string): void {
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(targetStatus)) {
    throw new Error(
      `Invalid transition: cannot move from "${currentStatus}" to "${targetStatus}". ` +
        `Allowed transitions from "${currentStatus}": ${allowed?.join(", ") ?? "none"}`
    );
  }
}

// ─── Timestamp field for each status ────────────────────────────────────────

function timestampFieldForStatus(status: string): string | null {
  const map: Record<string, string> = {
    submitted: "submittedAt",
    assessed: "assessedAt",
    approved: "approvedAt",
    scheduled: "scheduledAt",
    "in-progress": "startedAt",
    completed: "completedAt",
    closed: "closedAt",
  };
  return map[status] ?? null;
}

// ─── Create RFC ─────────────────────────────────────────────────────────────

export async function createRFC(input: {
  title: string;
  description: string;
  type?: string;
  scope?: string;
  riskLevel?: string;
}): Promise<{ rfcId: string }> {
  const userId = await requireOpsAccess();

  if (!input.title.trim()) throw new Error("Title is required");
  if (!input.description.trim()) throw new Error("Description is required");

  const rfcId = generateRfcId();
  const type = input.type ?? "normal";
  const isEmergency = type === "emergency";

  const data: Record<string, unknown> = {
    rfcId,
    title: input.title.trim(),
    description: input.description.trim(),
    type,
    scope: input.scope ?? "platform",
    riskLevel: input.riskLevel ?? "low",
    status: isEmergency ? "in-progress" : "draft",
    requestedById: userId,
  };

  if (isEmergency) {
    data.startedAt = new Date();
  }

  await prisma.changeRequest.create({ data: data as never });

  revalidatePath("/ops");
  return { rfcId };
}

// ─── Transition RFC ─────────────────────────────────────────────────────────

export async function transitionRFC(
  rfcId: string,
  targetStatus: string,
  data?: Record<string, unknown>
): Promise<void> {
  await requireOpsAccess();

  const rfc = await prisma.changeRequest.findUnique({ where: { rfcId } });
  if (!rfc) throw new Error(`RFC not found: ${rfcId}`);

  assertValidTransition(rfc.status, targetStatus);

  const updateData: Record<string, unknown> = {
    status: targetStatus,
    ...(data ?? {}),
  };

  const tsField = timestampFieldForStatus(targetStatus);
  if (tsField && !updateData[tsField]) {
    updateData[tsField] = new Date();
  }

  await prisma.changeRequest.update({
    where: { rfcId },
    data: updateData as never,
  });

  revalidatePath("/ops");
}

// ─── Convenience Transition Functions ───────────────────────────────────────

export async function submitRFC(rfcId: string): Promise<void> {
  await transitionRFC(rfcId, "submitted");
}

export async function assessRFC(
  rfcId: string,
  impactReport: Record<string, unknown>
): Promise<void> {
  const userId = await requireOpsAccess();
  // Re-fetch to validate transition before building update
  const rfc = await prisma.changeRequest.findUnique({ where: { rfcId } });
  if (!rfc) throw new Error(`RFC not found: ${rfcId}`);
  assertValidTransition(rfc.status, "assessed");

  await prisma.changeRequest.update({
    where: { rfcId },
    data: {
      status: "assessed",
      assessedAt: new Date(),
      assessedById: userId,
      impactReport: impactReport as never,
    },
  });

  revalidatePath("/ops");
}

export async function approveRFC(
  rfcId: string,
  rationale?: string
): Promise<void> {
  const userId = await requireOpsAccess();
  const rfc = await prisma.changeRequest.findUnique({ where: { rfcId } });
  if (!rfc) throw new Error(`RFC not found: ${rfcId}`);
  assertValidTransition(rfc.status, "approved");

  await prisma.changeRequest.update({
    where: { rfcId },
    data: {
      status: "approved",
      approvedAt: new Date(),
      approvedById: userId,
      ...(rationale ? { outcome: rationale } : {}),
    },
  });

  revalidatePath("/ops");
}

export async function scheduleRFC(
  rfcId: string,
  plannedStartAt: Date,
  plannedEndAt?: Date,
  deploymentWindowId?: string
): Promise<void> {
  if (!plannedStartAt) throw new Error("plannedStartAt is required for scheduling");

  await transitionRFC(rfcId, "scheduled", {
    plannedStartAt,
    ...(plannedEndAt ? { plannedEndAt } : {}),
    ...(deploymentWindowId ? { deploymentWindowId } : {}),
  });
}

export async function cancelRFC(
  rfcId: string,
  reason: string
): Promise<void> {
  if (!reason?.trim()) throw new Error("Cancellation reason is required");

  await transitionRFC(rfcId, "cancelled", {
    outcomeNotes: reason.trim(),
  });
}

// ─── Query Functions ────────────────────────────────────────────────────────

export async function getRFC(rfcId: string) {
  await requireOpsAccess();

  const rfc = await prisma.changeRequest.findUnique({
    where: { rfcId },
    include: {
      changeItems: true,
      requestedBy: true,
      assessedBy: true,
      approvedBy: true,
      executedBy: true,
      deploymentWindow: true,
    },
  });

  if (!rfc) throw new Error(`RFC not found: ${rfcId}`);
  return rfc;
}

export async function listRFCs(filters?: {
  status?: string;
  type?: string;
  scope?: string;
}) {
  await requireOpsAccess();

  const where: Record<string, unknown> = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.type) where.type = filters.type;
  if (filters?.scope) where.scope = filters.scope;

  return prisma.changeRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      changeItems: true,
      requestedBy: { select: { id: true } },
    },
  });
}
