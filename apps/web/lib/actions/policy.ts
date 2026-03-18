"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import {
  type ComplianceActionResult,
  requireViewCompliance, requireManageCompliance,
  getSessionEmployeeId, logComplianceAction, ensureComplianceCalendarEvent,
} from "@/lib/actions/compliance-helpers";
import {
  generatePolicyId, generateRequirementId, generateCompletionId,
  validatePolicyInput, validateRequirementInput, isValidTransition,
  type PolicyInput, type RequirementInput, SELF_COMPLETABLE_TYPES,
} from "@/lib/policy-types";

// ─── Policy CRUD ────────────────────────────────────────────────────────────

export async function listPolicies(filters?: { category?: string; lifecycleStatus?: string; ownerEmployeeId?: string }) {
  await requireViewCompliance();
  return prisma.policy.findMany({
    where: {
      status: "active",
      ...(filters?.category && { category: filters.category }),
      ...(filters?.lifecycleStatus && { lifecycleStatus: filters.lifecycleStatus }),
      ...(filters?.ownerEmployeeId && { ownerEmployeeId: filters.ownerEmployeeId }),
    },
    include: {
      ownerEmployee: { select: { id: true, displayName: true } },
      obligation: { select: { id: true, title: true, obligationId: true } },
      _count: { select: { acknowledgments: true, requirements: true } },
    },
    orderBy: { title: "asc" },
  });
}

export async function getPolicy(id: string) {
  await requireViewCompliance();
  return prisma.policy.findUniqueOrThrow({
    where: { id },
    include: {
      ownerEmployee: { select: { id: true, displayName: true } },
      approvedBy: { select: { id: true, displayName: true } },
      obligation: { select: { id: true, title: true, obligationId: true } },
      requirements: {
        where: { status: "active" },
        include: {
          trainingRequirement: true,
          _count: { select: { completions: { where: { status: "active" } } } },
        },
        orderBy: { createdAt: "asc" },
      },
      acknowledgments: {
        include: { employeeProfile: { select: { id: true, displayName: true } } },
        orderBy: { acknowledgedAt: "desc" },
      },
    },
  });
}

export async function createPolicy(input: PolicyInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const error = validatePolicyInput(input);
  if (error) return { ok: false, message: error };

  const employeeId = await getSessionEmployeeId();
  const record = await prisma.policy.create({
    data: {
      policyId: generatePolicyId(),
      title: input.title.trim(),
      category: input.category,
      description: input.description ?? null,
      effectiveDate: input.effectiveDate ?? null,
      reviewDate: input.reviewDate ?? null,
      reviewFrequency: input.reviewFrequency ?? null,
      fileRef: input.fileRef ?? null,
      obligationId: input.obligationId ?? null,
      ownerEmployeeId: input.ownerEmployeeId ?? employeeId,
      notes: input.notes ?? null,
    },
  });

  await logComplianceAction("policy", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Policy created.", id: record.id };
}

export async function updatePolicy(id: string, input: Partial<PolicyInput>): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.policy.update({ where: { id }, data: {
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.category !== undefined && { category: input.category }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.effectiveDate !== undefined && { effectiveDate: input.effectiveDate }),
    ...(input.reviewDate !== undefined && { reviewDate: input.reviewDate }),
    ...(input.reviewFrequency !== undefined && { reviewFrequency: input.reviewFrequency }),
    ...(input.fileRef !== undefined && { fileRef: input.fileRef }),
    ...(input.obligationId !== undefined && { obligationId: input.obligationId }),
    ...(input.ownerEmployeeId !== undefined && { ownerEmployeeId: input.ownerEmployeeId }),
    ...(input.notes !== undefined && { notes: input.notes }),
  }});

  await logComplianceAction("policy", id, "updated", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Policy updated." };
}

// ─── Policy Lifecycle ───────────────────────────────────────────────────────

export async function transitionPolicyStatus(id: string, newStatus: string): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  const policy = await prisma.policy.findUniqueOrThrow({ where: { id }, select: { lifecycleStatus: true, version: true } });

  if (!isValidTransition(policy.lifecycleStatus, newStatus)) {
    return { ok: false, message: `Cannot transition from ${policy.lifecycleStatus} to ${newStatus}.` };
  }

  const data: Record<string, unknown> = { lifecycleStatus: newStatus };

  if (newStatus === "approved") {
    data.approvedByEmployeeId = employeeId;
    data.approvedAt = new Date();
  } else if (newStatus === "published") {
    data.publishedAt = new Date();
  } else if (newStatus === "retired") {
    data.retiredAt = new Date();
  } else if (newStatus === "draft" && policy.lifecycleStatus === "retired") {
    data.version = policy.version + 1;
    data.approvedByEmployeeId = null;
    data.approvedAt = null;
    data.publishedAt = null;
    data.retiredAt = null;
  }

  await prisma.policy.update({ where: { id }, data });

  await logComplianceAction("policy", id, "status-changed", employeeId, null, {
    field: "lifecycleStatus", oldValue: policy.lifecycleStatus, newValue: newStatus,
  });
  revalidatePath("/compliance");
  return { ok: true, message: `Policy ${newStatus}.` };
}
