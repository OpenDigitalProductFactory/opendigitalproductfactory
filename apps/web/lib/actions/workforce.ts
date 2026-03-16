"use server";

import crypto from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getUserTeamIds, createAuthorizationDecisionLog } from "@/lib/governance-data";
import { buildPrincipalContext } from "@/lib/principal-context";
import { resolveGovernedAction } from "@/lib/governance-resolver";
import type { EmploymentEventType, WorkforceStatus } from "@/lib/workforce-types";

export type WorkforceActionResult = {
  ok: boolean;
  message: string;
};

type SessionUserContext = {
  id: string;
  email: string;
  platformRole: string | null;
  isSuperuser: boolean;
};

export type EmployeeProfileInput = {
  employeeProfileId?: string;
  employeeId: string;
  userId?: string | null;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  displayName?: string | null;
  workEmail?: string | null;
  personalEmail?: string | null;
  phoneNumber?: string | null;
  status: WorkforceStatus;
  employmentTypeId?: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  managerEmployeeId?: string | null;
  dottedLineManagerId?: string | null;
  workLocationId?: string | null;
  timezone?: string | null;
  startDate?: Date | null;
  confirmationDate?: Date | null;
  endDate?: Date | null;
};

export type AssignEmployeeOrgInput = {
  employeeProfileId: string;
  departmentId?: string | null;
  positionId?: string | null;
  managerEmployeeId?: string | null;
  dottedLineManagerId?: string | null;
  workLocationId?: string | null;
  timezone?: string | null;
  effectiveAt?: Date;
};

export type RecordEmploymentLifecycleEventInput = {
  employeeProfileId: string;
  currentStatus: WorkforceStatus;
  nextStatus: WorkforceStatus;
  eventType: EmploymentEventType;
  effectiveAt: Date;
  reason?: string | null;
  terminationDate?: Date | null;
  terminationReason?: string | null;
  terminationNotes?: string | null;
  exitInterviewDone?: boolean;
  metadata?: Prisma.InputJsonValue;
};

function workforceDenied(message: string): WorkforceActionResult {
  return { ok: false, message };
}

function trimRequired(value: string): string {
  return value.trim();
}

function trimOptional(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildDisplayName(input: {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  displayName?: string | null;
}): string {
  const displayName = trimOptional(input.displayName);
  if (displayName) return displayName;
  return [trimRequired(input.firstName), trimOptional(input.middleName), trimRequired(input.lastName)]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

async function requireAnyCapability(
  capabilities: Array<"manage_users" | "manage_user_lifecycle">,
): Promise<SessionUserContext> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new Error("Unauthorized");

  const context: SessionUserContext = {
    id: user.id,
    email: user.email ?? "",
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  };

  if (!capabilities.some((capability) => can(context, capability))) {
    throw new Error("Unauthorized");
  }

  return context;
}

async function withGovernedWorkforceAction(input: {
  actionKey: string;
  riskBand: "medium" | "high";
  objectRef?: string;
  run: (actor: SessionUserContext) => Promise<WorkforceActionResult>;
}): Promise<WorkforceActionResult> {
  const actor = await requireAnyCapability(["manage_user_lifecycle", "manage_users"]);
  const teamIds = await getUserTeamIds(actor.id);
  const principalContext = buildPrincipalContext({
    sessionUser: actor,
    teamIds,
    actingAgentId: null,
    delegationGrantIds: [],
  });

  const decision = resolveGovernedAction({
    humanAllowed: principalContext.platformRoleIds.length > 0 || actor.isSuperuser,
    agentPolicyAllowed: true,
    riskBand: input.riskBand,
    agentMaxRiskBand: "critical",
    activeGrant: null,
  });

  if (decision.decision !== "allow") {
    await createAuthorizationDecisionLog({
      actorType: "user",
      actorRef: actor.id,
      humanContextRef: actor.id,
      actionKey: input.actionKey,
      objectRef: input.objectRef ?? null,
      decision: decision.decision,
      rationale: { code: decision.rationaleCode } satisfies Prisma.InputJsonValue,
    });
    return workforceDenied("Governance denied this workforce action.");
  }

  const result = await input.run(actor);

  await createAuthorizationDecisionLog({
    actorType: "user",
    actorRef: actor.id,
    humanContextRef: actor.id,
    actionKey: input.actionKey,
    objectRef: input.objectRef ?? null,
    decision: result.ok ? "allow" : "deny",
    rationale: { result: result.ok ? "success" : "application_error" } satisfies Prisma.InputJsonValue,
  });

  return result;
}

export function validateEmployeeProfileInput(input: EmployeeProfileInput): string | null {
  if (!trimRequired(input.firstName)) return "Enter a first name.";
  if (!trimRequired(input.lastName)) return "Enter a last name.";

  const selfRefs = [input.employeeProfileId, input.employeeId].filter((value): value is string => Boolean(value?.trim()));
  if (input.managerEmployeeId && selfRefs.includes(input.managerEmployeeId)) {
    return "Employee cannot be their own manager.";
  }
  if (input.dottedLineManagerId && selfRefs.includes(input.dottedLineManagerId)) {
    return "Employee cannot be their own manager.";
  }

  if (input.startDate && input.endDate && input.startDate > input.endDate) {
    return "Start date must be on or before the end date.";
  }
  if (input.startDate && input.confirmationDate && input.confirmationDate < input.startDate) {
    return "Confirmation date cannot be before the start date.";
  }

  return null;
}

export function validateLifecycleTransition(input: {
  currentStatus: WorkforceStatus;
  nextStatus: WorkforceStatus;
  eventType: EmploymentEventType;
  terminationDate?: Date | null;
}): string | null {
  if (input.eventType === "terminated" && !input.terminationDate) {
    return "Termination date is required for termination events.";
  }

  if (input.currentStatus === "inactive" && input.nextStatus === "onboarding") {
    return "Inactive employees cannot return to onboarding.";
  }

  return null;
}

async function ensureUserLinkIsAvailable(userId: string | null, employeeProfileId?: string): Promise<string | null> {
  if (!userId) return null;

  const existing = await prisma.employeeProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (existing && existing.id !== employeeProfileId) {
    return "Selected user is already linked to another employee profile.";
  }

  return null;
}

function buildLifecycleCreateEvent(status: WorkforceStatus): EmploymentEventType {
  switch (status) {
    case "active":
      return "activated";
    case "leave":
      return "leave_started";
    case "offboarding":
    case "inactive":
      return "offboarding_started";
    default:
      return "onboarding_started";
  }
}

export async function createEmployeeProfile(input: EmployeeProfileInput): Promise<WorkforceActionResult> {
  const validationError = validateEmployeeProfileInput(input);
  if (validationError) return workforceDenied(validationError);

  return withGovernedWorkforceAction({
    actionKey: "employee_profile.create",
    riskBand: "medium",
    objectRef: input.employeeId,
    run: async (actor) => {
      const employeeId = trimRequired(input.employeeId);
      const userId = trimOptional(input.userId);
      const linkageError = await ensureUserLinkIsAvailable(userId);
      if (linkageError) return workforceDenied(linkageError);

      const existing = await prisma.employeeProfile.findUnique({
        where: { employeeId },
        select: { id: true },
      });
      if (existing) return workforceDenied("Employee ID already exists.");

      const displayName = buildDisplayName(input);
      const employee = await prisma.employeeProfile.create({
        data: {
          employeeId,
          userId,
          firstName: trimRequired(input.firstName),
          middleName: trimOptional(input.middleName),
          lastName: trimRequired(input.lastName),
          displayName,
          workEmail: trimOptional(input.workEmail),
          personalEmail: trimOptional(input.personalEmail),
          phoneNumber: trimOptional(input.phoneNumber),
          status: input.status,
          employmentTypeId: trimOptional(input.employmentTypeId),
          departmentId: trimOptional(input.departmentId),
          positionId: trimOptional(input.positionId),
          managerEmployeeId: trimOptional(input.managerEmployeeId),
          dottedLineManagerId: trimOptional(input.dottedLineManagerId),
          workLocationId: trimOptional(input.workLocationId),
          timezone: trimOptional(input.timezone),
          startDate: input.startDate ?? null,
          confirmationDate: input.confirmationDate ?? null,
          endDate: input.endDate ?? null,
        },
        select: { id: true, displayName: true },
      });

      await prisma.employmentEvent.create({
        data: {
          eventId: `EEVT-${crypto.randomUUID()}`,
          employeeProfileId: employee.id,
          eventType: buildLifecycleCreateEvent(input.status),
          effectiveAt: input.startDate ?? new Date(),
          reason: "employee_profile_created",
          actorUserId: actor.id,
          metadata: {
            source: "employee_profile.create",
            initialStatus: input.status,
          } satisfies Prisma.InputJsonValue,
        },
      });

      revalidatePath("/employee");
      revalidatePath("/admin");
      return { ok: true, message: `Employee ${employee.displayName} created.` };
    },
  });
}

export async function updateEmployeeProfile(input: EmployeeProfileInput): Promise<WorkforceActionResult> {
  if (!trimOptional(input.employeeProfileId)) return workforceDenied("Employee profile is required.");

  const validationError = validateEmployeeProfileInput(input);
  if (validationError) return workforceDenied(validationError);

  return withGovernedWorkforceAction({
    actionKey: "employee_profile.update",
    riskBand: "medium",
    ...(input.employeeProfileId ? { objectRef: input.employeeProfileId } : {}),
    run: async () => {
      const employeeProfileId = trimRequired(input.employeeProfileId ?? "");
      const userId = trimOptional(input.userId);
      const linkageError = await ensureUserLinkIsAvailable(userId, employeeProfileId);
      if (linkageError) return workforceDenied(linkageError);

      const existing = await prisma.employeeProfile.findUnique({
        where: { id: employeeProfileId },
        select: { id: true },
      });
      if (!existing) return workforceDenied("Employee profile not found.");

      const displayName = buildDisplayName(input);
      await prisma.employeeProfile.update({
        where: { id: employeeProfileId },
        data: {
          employeeId: trimRequired(input.employeeId),
          userId,
          firstName: trimRequired(input.firstName),
          middleName: trimOptional(input.middleName),
          lastName: trimRequired(input.lastName),
          displayName,
          workEmail: trimOptional(input.workEmail),
          personalEmail: trimOptional(input.personalEmail),
          phoneNumber: trimOptional(input.phoneNumber),
          status: input.status,
          employmentTypeId: trimOptional(input.employmentTypeId),
          departmentId: trimOptional(input.departmentId),
          positionId: trimOptional(input.positionId),
          managerEmployeeId: trimOptional(input.managerEmployeeId),
          dottedLineManagerId: trimOptional(input.dottedLineManagerId),
          workLocationId: trimOptional(input.workLocationId),
          timezone: trimOptional(input.timezone),
          startDate: input.startDate ?? null,
          confirmationDate: input.confirmationDate ?? null,
          endDate: input.endDate ?? null,
        },
      });

      revalidatePath("/employee");
      revalidatePath("/admin");
      return { ok: true, message: `Employee ${displayName} updated.` };
    },
  });
}

export async function assignEmployeeOrg(input: AssignEmployeeOrgInput): Promise<WorkforceActionResult> {
  const employeeProfileId = trimRequired(input.employeeProfileId);
  if (!employeeProfileId) return workforceDenied("Employee profile is required.");
  if (input.managerEmployeeId && input.managerEmployeeId === employeeProfileId) {
    return workforceDenied("Employee cannot be their own manager.");
  }

  return withGovernedWorkforceAction({
    actionKey: "employee_profile.assign_org",
    riskBand: "medium",
    objectRef: employeeProfileId,
    run: async (actor) => {
      const existing = await prisma.employeeProfile.findUnique({
        where: { id: employeeProfileId },
        select: {
          id: true,
          displayName: true,
          departmentId: true,
          positionId: true,
          managerEmployeeId: true,
          dottedLineManagerId: true,
          workLocationId: true,
          timezone: true,
        },
      });
      if (!existing) return workforceDenied("Employee profile not found.");

      const nextDepartmentId = trimOptional(input.departmentId);
      const nextPositionId = trimOptional(input.positionId);
      const nextManagerEmployeeId = trimOptional(input.managerEmployeeId);
      const nextDottedLineManagerId = trimOptional(input.dottedLineManagerId);
      const nextWorkLocationId = trimOptional(input.workLocationId);
      const nextTimezone = trimOptional(input.timezone);
      const effectiveAt = input.effectiveAt ?? new Date();

      await prisma.$transaction(async (tx) => {
        await tx.employeeProfile.update({
          where: { id: employeeProfileId },
          data: {
            departmentId: nextDepartmentId,
            positionId: nextPositionId,
            managerEmployeeId: nextManagerEmployeeId,
            dottedLineManagerId: nextDottedLineManagerId,
            workLocationId: nextWorkLocationId,
            timezone: nextTimezone,
          },
        });

        const eventTypes: EmploymentEventType[] = [];
        if (existing.departmentId !== nextDepartmentId) eventTypes.push("department_changed");
        if (existing.positionId !== nextPositionId) eventTypes.push("position_changed");
        if (existing.managerEmployeeId !== nextManagerEmployeeId) eventTypes.push("manager_changed");

        await Promise.all(
          eventTypes.map((eventType) =>
            tx.employmentEvent.create({
              data: {
                eventId: `EEVT-${crypto.randomUUID()}`,
                employeeProfileId,
                eventType,
                effectiveAt,
                reason: "org_assignment_updated",
                actorUserId: actor.id,
              },
            }),
          ),
        );
      });

      revalidatePath("/employee");
      revalidatePath("/admin");
      return { ok: true, message: `Organization assignment updated for ${existing.displayName}.` };
    },
  });
}

export async function recordEmploymentLifecycleEvent(
  input: RecordEmploymentLifecycleEventInput,
): Promise<WorkforceActionResult> {
  const validationError = validateLifecycleTransition(input);
  if (validationError) return workforceDenied(validationError);

  return withGovernedWorkforceAction({
    actionKey: "employee_profile.lifecycle_event",
    riskBand: input.eventType === "terminated" ? "high" : "medium",
    objectRef: input.employeeProfileId,
    run: async (actor) => {
      const employee = await prisma.employeeProfile.findUnique({
        where: { id: input.employeeProfileId },
        select: { id: true, displayName: true, status: true },
      });
      if (!employee) return workforceDenied("Employee profile not found.");

      await prisma.$transaction(async (tx) => {
        await tx.employeeProfile.update({
          where: { id: employee.id },
          data: {
            status: input.nextStatus,
            ...(input.eventType === "terminated" ? { endDate: input.terminationDate ?? null } : {}),
          },
        });

        await tx.employmentEvent.create({
          data: {
            eventId: `EEVT-${crypto.randomUUID()}`,
            employeeProfileId: employee.id,
            eventType: input.eventType,
            effectiveAt: input.effectiveAt,
            reason: trimOptional(input.reason),
            actorUserId: actor.id,
            ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
          },
        });

        if (input.eventType === "terminated" && input.terminationDate) {
          await tx.terminationRecord.upsert({
            where: { employeeProfileId: employee.id },
            update: {
              terminationDate: input.terminationDate,
              terminationReason: trimOptional(input.terminationReason),
              notes: trimOptional(input.terminationNotes),
              exitInterviewDone: input.exitInterviewDone ?? false,
            },
            create: {
              terminationId: `TERM-${crypto.randomUUID()}`,
              employeeProfileId: employee.id,
              terminationDate: input.terminationDate,
              terminationReason: trimOptional(input.terminationReason),
              notes: trimOptional(input.terminationNotes),
              exitInterviewDone: input.exitInterviewDone ?? false,
            },
          });
        }
      });

      revalidatePath("/employee");
      revalidatePath("/admin");
      return { ok: true, message: `Lifecycle event recorded for ${employee.displayName}.` };
    },
  });
}
