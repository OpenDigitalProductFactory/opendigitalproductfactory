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
      body: input.body ?? null,
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
    ...(input.body !== undefined && { body: input.body }),
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

// ─── Policy Requirement ─────────────────────────────────────────────────────

export async function createRequirement(policyId: string, input: RequirementInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const error = validateRequirementInput(input);
  if (error) return { ok: false, message: error };

  const employeeId = await getSessionEmployeeId();
  const record = await prisma.policyRequirement.create({
    data: {
      requirementId: generateRequirementId(),
      policyId,
      title: input.title.trim(),
      requirementType: input.requirementType,
      description: input.description ?? null,
      frequency: input.frequency ?? null,
      applicability: input.applicability ?? null,
      dueDays: input.dueDays ?? null,
    },
  });

  if (input.requirementType === "training" && input.trainingTitle) {
    await prisma.trainingRequirement.create({
      data: {
        requirementId: record.id,
        trainingTitle: input.trainingTitle.trim(),
        provider: input.provider ?? null,
        deliveryMethod: input.deliveryMethod ?? null,
        durationMinutes: input.durationMinutes ?? null,
        externalUrl: input.externalUrl ?? null,
        passingScore: input.passingScore ?? null,
        certificateRequired: input.certificateRequired ?? false,
      },
    });
  }

  await logComplianceAction("requirement", record.id, "created", employeeId, null, { notes: `For policy ${policyId}` });
  revalidatePath("/compliance");
  return { ok: true, message: "Requirement created.", id: record.id };
}

export async function deleteRequirement(id: string): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();
  await prisma.policyRequirement.delete({ where: { id } });
  await logComplianceAction("requirement", id, "deleted", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Requirement deleted." };
}

// ─── Requirement Completion ─────────────────────────────────────────────────

export async function completeRequirement(requirementId: string, method: string, notes?: string): Promise<ComplianceActionResult> {
  const employeeId = await getSessionEmployeeId();
  if (!employeeId) return { ok: false, message: "Employee profile required." };

  const req = await prisma.policyRequirement.findUniqueOrThrow({
    where: { id: requirementId },
    include: { policy: { select: { lifecycleStatus: true } } },
  });

  if (req.policy.lifecycleStatus !== "published") {
    return { ok: false, message: "Policy is not published." };
  }

  if (!(SELF_COMPLETABLE_TYPES as readonly string[]).includes(req.requirementType)) {
    await requireManageCompliance();
  }

  let expiresAt: Date | null = null;
  if (req.frequency === "annual") {
    expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  } else if (req.frequency === "quarterly") {
    expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 3);
  }

  const record = await prisma.requirementCompletion.create({
    data: {
      completionId: generateCompletionId(),
      requirementId,
      employeeProfileId: employeeId,
      method,
      notes: notes ?? null,
      expiresAt,
    },
  });

  await logComplianceAction("completion", record.id, "created", employeeId, null, { notes: `Requirement ${requirementId}` });
  revalidatePath("/employee");
  revalidatePath("/compliance");
  return { ok: true, message: "Requirement completed.", id: record.id };
}

// ─── Policy Acknowledgment ──────────────────────────────────────────────────

export async function acknowledgePolicy(policyId: string): Promise<ComplianceActionResult> {
  const employeeId = await getSessionEmployeeId();
  if (!employeeId) return { ok: false, message: "Employee profile required." };

  const policy = await prisma.policy.findUniqueOrThrow({
    where: { id: policyId },
    select: { lifecycleStatus: true, version: true },
  });

  if (policy.lifecycleStatus !== "published") {
    return { ok: false, message: "Policy is not published." };
  }

  await prisma.policyAcknowledgment.create({
    data: {
      policyId,
      employeeProfileId: employeeId,
      policyVersion: policy.version,
      method: "digital-signature",
    },
  });

  await logComplianceAction("acknowledgment", policyId, "created", employeeId, null, { notes: `Version ${policy.version}` });
  revalidatePath("/employee");
  revalidatePath("/compliance");
  return { ok: true, message: "Policy acknowledged." };
}

// ─── Employee-Facing Queries ────────────────────────────────────────────────

export async function getMyPendingRequirements() {
  const employeeId = await getSessionEmployeeId();
  if (!employeeId) return { pendingAcknowledgments: [], pendingTraining: [], completedHistory: [] };

  const allPublished = await prisma.policy.findMany({
    where: { lifecycleStatus: "published", status: "active" },
    select: { id: true, title: true, version: true, category: true },
  });

  const myAcks = await prisma.policyAcknowledgment.findMany({
    where: { employeeProfileId: employeeId },
    select: { policyId: true, policyVersion: true },
  });
  const ackedSet = new Set(myAcks.map((a) => `${a.policyId}:${a.policyVersion}`));

  const pendingAcknowledgments = allPublished.filter(
    (p) => !ackedSet.has(`${p.id}:${p.version}`),
  );

  const pendingReqs = await prisma.policyRequirement.findMany({
    where: {
      status: "active",
      policy: { lifecycleStatus: "published", status: "active" },
      completions: { none: { employeeProfileId: employeeId, status: "active" } },
    },
    include: {
      policy: { select: { title: true } },
      trainingRequirement: { select: { trainingTitle: true, externalUrl: true } },
    },
  });

  const pendingTraining = pendingReqs.filter((r) => r.requirementType === "training");

  const completedHistory = await prisma.requirementCompletion.findMany({
    where: { employeeProfileId: employeeId },
    include: {
      requirement: { select: { title: true, requirementType: true, policy: { select: { title: true } } } },
    },
    orderBy: { completedAt: "desc" },
    take: 20,
  });

  return { pendingAcknowledgments, pendingTraining, completedHistory };
}

export async function getMyPolicySummary() {
  const employeeId = await getSessionEmployeeId();
  if (!employeeId) return { pendingAckCount: 0, pendingTrainingCount: 0 };

  const data = await getMyPendingRequirements();
  return {
    pendingAckCount: data.pendingAcknowledgments.length,
    pendingTrainingCount: data.pendingTraining.length,
  };
}

// ─── Dashboard Metrics ──────────────────────────────────────────────────────

export async function getPolicyDashboardMetrics() {
  await requireViewCompliance();

  const [publishedCount, totalEmployees, totalAcks, overdueTraining] = await Promise.all([
    prisma.policy.count({ where: { lifecycleStatus: "published", status: "active" } }),
    prisma.employeeProfile.count({ where: { status: "active" } }),
    prisma.policyAcknowledgment.count(),
    prisma.requirementCompletion.count({ where: { status: "expired" } }),
  ]);

  const expectedAcks = publishedCount * totalEmployees;
  const ackRate = expectedAcks > 0 ? Math.round((totalAcks / expectedAcks) * 100) : 0;

  return { publishedCount, ackRate, overdueTraining };
}

// ─── Acknowledgment Status ──────────────────────────────────────────────────

export async function getPolicyAcknowledgmentStatus(policyId: string) {
  await requireViewCompliance();

  const policy = await prisma.policy.findUniqueOrThrow({
    where: { id: policyId },
    select: { version: true },
  });

  const allEmployees = await prisma.employeeProfile.findMany({
    where: { status: "active" },
    select: { id: true, displayName: true },
  });

  const acks = await prisma.policyAcknowledgment.findMany({
    where: { policyId, policyVersion: policy.version },
    select: { employeeProfileId: true, acknowledgedAt: true },
  });

  const ackedIds = new Set(acks.map((a) => a.employeeProfileId));

  return {
    acknowledged: allEmployees
      .filter((e) => ackedIds.has(e.id))
      .map((e) => ({ ...e, acknowledgedAt: acks.find((a) => a.employeeProfileId === e.id)!.acknowledgedAt })),
    pending: allEmployees.filter((e) => !ackedIds.has(e.id)),
  };
}

// ─── Policy ↔ Obligation Linking ──────────────────────────────────────────────

export async function linkPolicyToObligation(
  policyId: string,
  obligationId: string,
  notes?: string | null,
): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  const existing = await prisma.policyObligationLink.findUnique({
    where: { policyId_obligationId: { policyId, obligationId } },
  });
  if (existing) return { ok: false, message: "Link already exists." };

  await prisma.policyObligationLink.create({
    data: { policyId, obligationId, notes: notes ?? null },
  });

  await logComplianceAction("policy", policyId, "obligation-linked", employeeId, null, {
    notes: `Linked to obligation ${obligationId}`,
  });
  revalidatePath("/compliance");
  return { ok: true, message: "Obligation linked to policy." };
}

export async function unlinkPolicyFromObligation(
  policyId: string,
  obligationId: string,
): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.policyObligationLink.delete({
    where: { policyId_obligationId: { policyId, obligationId } },
  }).catch(() => null);

  await logComplianceAction("policy", policyId, "obligation-unlinked", employeeId, null, {
    notes: `Unlinked obligation ${obligationId}`,
  });
  revalidatePath("/compliance");
  return { ok: true, message: "Obligation unlinked from policy." };
}

export async function getPolicyObligations(policyId: string) {
  await requireViewCompliance();
  return prisma.policyObligationLink.findMany({
    where: { policyId },
    include: {
      obligation: {
        include: {
          regulation: { select: { id: true, shortName: true, sourceType: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function migrateObligationIdToLinks(): Promise<{ migrated: number }> {
  const policies = await prisma.policy.findMany({
    where: { obligationId: { not: null } },
    select: { id: true, obligationId: true },
  });
  let migrated = 0;
  for (const policy of policies) {
    if (!policy.obligationId) continue;
    const exists = await prisma.policyObligationLink.findUnique({
      where: { policyId_obligationId: { policyId: policy.id, obligationId: policy.obligationId } },
    });
    if (!exists) {
      await prisma.policyObligationLink.create({
        data: { policyId: policy.id, obligationId: policy.obligationId },
      });
      migrated++;
    }
  }
  return { migrated };
}
