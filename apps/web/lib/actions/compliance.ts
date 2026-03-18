"use server";

import * as crypto from "crypto";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import {
  generateRegulationId, generateObligationId, generateControlId,
  validateRegulationInput, validateObligationInput, validateControlInput,
  type RegulationInput, type ObligationInput, type ControlInput,
} from "@/lib/compliance-types";

export type ComplianceActionResult = { ok: boolean; message: string; id?: string };

async function requireViewCompliance() {
  const session = await auth();
  if (!session?.user || !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "view_compliance")) {
    throw new Error("Unauthorized");
  }
  return session.user;
}

async function requireManageCompliance() {
  const session = await auth();
  if (!session?.user || !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_compliance")) {
    throw new Error("Unauthorized");
  }
  return session.user;
}

async function getSessionEmployeeId(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const profile = await prisma.employeeProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  return profile?.id ?? null;
}

async function logComplianceAction(
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

// ─── Regulation ─────────────────────────────────────────────────────────────

export async function listRegulations(filters?: { status?: string; jurisdiction?: string; sourceType?: string }) {
  await requireViewCompliance();
  return prisma.regulation.findMany({
    where: {
      ...(filters?.status && { status: filters.status }),
      ...(filters?.jurisdiction && { jurisdiction: filters.jurisdiction }),
      ...(filters?.sourceType && { sourceType: filters.sourceType }),
    },
    orderBy: { shortName: "asc" },
  });
}

export async function getRegulation(id: string) {
  await requireViewCompliance();
  return prisma.regulation.findUniqueOrThrow({
    where: { id },
    include: { obligations: { orderBy: { title: "asc" } } },
  });
}

export async function createRegulation(input: RegulationInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const error = validateRegulationInput(input);
  if (error) return { ok: false, message: error };

  const employeeId = await getSessionEmployeeId();
  const regulationId = generateRegulationId();

  const record = await prisma.regulation.create({
    data: {
      regulationId,
      name: input.name.trim(),
      shortName: input.shortName.trim(),
      jurisdiction: input.jurisdiction.trim(),
      industry: input.industry ?? null,
      sourceType: input.sourceType ?? "external",
      effectiveDate: input.effectiveDate ?? null,
      reviewDate: input.reviewDate ?? null,
      sourceUrl: input.sourceUrl ?? null,
      notes: input.notes ?? null,
    },
  });

  await logComplianceAction("regulation", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: `Regulation ${input.shortName} created.`, id: record.id };
}

export async function updateRegulation(id: string, input: Partial<RegulationInput>): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.regulation.update({ where: { id }, data: {
    ...(input.name !== undefined && { name: input.name.trim() }),
    ...(input.shortName !== undefined && { shortName: input.shortName.trim() }),
    ...(input.jurisdiction !== undefined && { jurisdiction: input.jurisdiction.trim() }),
    ...(input.industry !== undefined && { industry: input.industry }),
    ...(input.sourceType !== undefined && { sourceType: input.sourceType }),
    ...(input.effectiveDate !== undefined && { effectiveDate: input.effectiveDate }),
    ...(input.reviewDate !== undefined && { reviewDate: input.reviewDate }),
    ...(input.sourceUrl !== undefined && { sourceUrl: input.sourceUrl }),
    ...(input.notes !== undefined && { notes: input.notes }),
  }});

  await logComplianceAction("regulation", id, "updated", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Regulation updated." };
}

export async function deactivateRegulation(id: string): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.regulation.update({ where: { id }, data: { status: "inactive" } });
  await logComplianceAction("regulation", id, "status-changed", employeeId, null, { field: "status", newValue: "inactive" });
  revalidatePath("/compliance");
  return { ok: true, message: "Regulation deactivated." };
}

// ─── Obligation ─────────────────────────────────────────────────────────────

export async function listObligations(filters?: { regulationId?: string; category?: string; ownerEmployeeId?: string; status?: string }) {
  await requireViewCompliance();
  return prisma.obligation.findMany({
    where: {
      ...(filters?.regulationId && { regulationId: filters.regulationId }),
      ...(filters?.category && { category: filters.category }),
      ...(filters?.ownerEmployeeId && { ownerEmployeeId: filters.ownerEmployeeId }),
      ...(filters?.status ? { status: filters.status } : { status: "active" }),
    },
    include: {
      regulation: { select: { shortName: true, jurisdiction: true } },
      ownerEmployee: { select: { id: true, displayName: true } },
    },
    orderBy: { title: "asc" },
  });
}

export async function getObligation(id: string) {
  await requireViewCompliance();
  return prisma.obligation.findUniqueOrThrow({
    where: { id },
    include: {
      regulation: true,
      ownerEmployee: { select: { id: true, displayName: true } },
      controls: { include: { control: true } },
      evidence: { where: { status: "active" }, orderBy: { collectedAt: "desc" } },
    },
  });
}

export async function createObligation(input: ObligationInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const error = validateObligationInput(input);
  if (error) return { ok: false, message: error };

  const employeeId = await getSessionEmployeeId();
  const record = await prisma.obligation.create({
    data: {
      obligationId: generateObligationId(),
      regulationId: input.regulationId,
      title: input.title.trim(),
      description: input.description ?? null,
      reference: input.reference ?? null,
      category: input.category ?? null,
      frequency: input.frequency ?? null,
      applicability: input.applicability ?? null,
      penaltySummary: input.penaltySummary ?? null,
      ownerEmployeeId: input.ownerEmployeeId ?? null,
      reviewDate: input.reviewDate ?? null,
    },
  });

  await logComplianceAction("obligation", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Obligation created.", id: record.id };
}

export async function updateObligation(id: string, input: Partial<ObligationInput>): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.obligation.update({ where: { id }, data: {
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.reference !== undefined && { reference: input.reference }),
    ...(input.category !== undefined && { category: input.category }),
    ...(input.frequency !== undefined && { frequency: input.frequency }),
    ...(input.applicability !== undefined && { applicability: input.applicability }),
    ...(input.penaltySummary !== undefined && { penaltySummary: input.penaltySummary }),
    ...(input.ownerEmployeeId !== undefined && { ownerEmployeeId: input.ownerEmployeeId }),
    ...(input.reviewDate !== undefined && { reviewDate: input.reviewDate }),
  }});

  await logComplianceAction("obligation", id, "updated", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Obligation updated." };
}

// ─── Control ────────────────────────────────────────────────────────────────

export async function listControls(filters?: { controlType?: string; implementationStatus?: string; effectiveness?: string; ownerEmployeeId?: string }) {
  await requireViewCompliance();
  return prisma.control.findMany({
    where: {
      status: "active",
      ...(filters?.controlType && { controlType: filters.controlType }),
      ...(filters?.implementationStatus && { implementationStatus: filters.implementationStatus }),
      ...(filters?.effectiveness && { effectiveness: filters.effectiveness }),
      ...(filters?.ownerEmployeeId && { ownerEmployeeId: filters.ownerEmployeeId }),
    },
    include: {
      ownerEmployee: { select: { id: true, displayName: true } },
      _count: { select: { obligations: true } },
    },
    orderBy: { title: "asc" },
  });
}

export async function getControl(id: string) {
  await requireViewCompliance();
  return prisma.control.findUniqueOrThrow({
    where: { id },
    include: {
      ownerEmployee: { select: { id: true, displayName: true } },
      obligations: { include: { obligation: { select: { id: true, title: true, obligationId: true } } } },
      evidence: { where: { status: "active" }, orderBy: { collectedAt: "desc" } },
      riskAssessments: { include: { riskAssessment: { select: { id: true, title: true, assessmentId: true } } } },
    },
  });
}

export async function createControl(input: ControlInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const error = validateControlInput(input);
  if (error) return { ok: false, message: error };

  const employeeId = await getSessionEmployeeId();
  const record = await prisma.control.create({
    data: {
      controlId: generateControlId(),
      title: input.title.trim(),
      controlType: input.controlType,
      description: input.description ?? null,
      implementationStatus: input.implementationStatus ?? "planned",
      ownerEmployeeId: input.ownerEmployeeId ?? null,
      reviewFrequency: input.reviewFrequency ?? null,
      nextReviewDate: input.nextReviewDate ?? null,
      effectiveness: input.effectiveness ?? null,
    },
  });

  await logComplianceAction("control", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Control created.", id: record.id };
}

export async function updateControl(id: string, input: Partial<ControlInput>): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.control.update({ where: { id }, data: {
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.controlType !== undefined && { controlType: input.controlType }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.implementationStatus !== undefined && { implementationStatus: input.implementationStatus }),
    ...(input.ownerEmployeeId !== undefined && { ownerEmployeeId: input.ownerEmployeeId }),
    ...(input.reviewFrequency !== undefined && { reviewFrequency: input.reviewFrequency }),
    ...(input.nextReviewDate !== undefined && { nextReviewDate: input.nextReviewDate }),
    ...(input.effectiveness !== undefined && { effectiveness: input.effectiveness }),
  }});

  await logComplianceAction("control", id, "updated", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Control updated." };
}

// ─── Control ↔ Obligation Linking ───────────────────────────────────────────

export async function linkControlToObligation(controlId: string, obligationId: string, notes?: string): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  const existing = await prisma.controlObligationLink.findUnique({
    where: { controlId_obligationId: { controlId, obligationId } },
  });
  if (existing) return { ok: false, message: "Link already exists." };

  await prisma.controlObligationLink.create({ data: { controlId, obligationId, notes: notes ?? null } });
  await logComplianceAction("control", controlId, "linked", employeeId, null, { notes: `Linked to obligation ${obligationId}` });
  revalidatePath("/compliance");
  return { ok: true, message: "Control linked to obligation." };
}

export async function unlinkControlFromObligation(controlId: string, obligationId: string): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.controlObligationLink.delete({
    where: { controlId_obligationId: { controlId, obligationId } },
  });
  await logComplianceAction("control", controlId, "unlinked", employeeId, null, { notes: `Unlinked from obligation ${obligationId}` });
  revalidatePath("/compliance");
  return { ok: true, message: "Link removed." };
}
