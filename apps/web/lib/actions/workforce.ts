"use server";

import crypto from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

import {
  actuateForLifecycleEvent,
  describeActuation,
  type ActuationResult,
} from "@/lib/workforce/employment-event-actuator-runtime";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getUserTeamIds, createAuthorizationDecisionLog } from "@/lib/governance-data";
import { buildPrincipalContext } from "@/lib/principal-context";
import { resolveGovernedAction } from "@/lib/governance-resolver";
import { syncEmployeePrincipal } from "@/lib/identity/principal-linking";
import { validateLifecycleTransition, validateEmployeeProfileInput, type EmployeeProfileInput, type EmploymentEventType, type WorkforceStatus } from "@/lib/workforce-types";
import { wouldCreateManagerCycle } from "@/lib/workforce/org-chart-model";
import { patchOptional } from "@/lib/workforce/patch-optional";

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

// EmployeeProfileInput lives in workforce-types.ts; it is imported above for
// internal use. Do NOT re-export it from this "use server" module — turbopack
// enumerates every export of a "use server" file into the runtime
// server-reference registry, so a type re-export becomes a `ReferenceError` at
// module eval (500 at request time, invisible to the build gate). Callers
// import the type from @/lib/workforce-types directly.

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

// validateEmployeeProfileInput moved to workforce-types.ts (sync functions can't be exported from "use server" files)

// validateLifecycleTransition imported from workforce-types.ts (not a server action file)

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
    case "offer":
      return "offer_created";
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
      const employee = await prisma.$transaction(async (tx) => {
        const createdEmployee = await tx.employeeProfile.create({
          data: {
            employeeId,
            userId,
            firstName: trimRequired(input.firstName),
            middleName: trimOptional(input.middleName),
            lastName: trimRequired(input.lastName),
            displayName,
            workEmail: trimOptional(input.workEmail),
            personalEmail: trimOptional(input.personalEmail),
            phoneWork: trimOptional(input.phoneWork),
            phoneMobile: trimOptional(input.phoneMobile),
            phoneEmergency: trimOptional(input.phoneEmergency),
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

        await tx.employmentEvent.create({
          data: {
            eventId: `EEVT-${crypto.randomUUID()}`,
            employeeProfileId: createdEmployee.id,
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

        await syncEmployeePrincipal(createdEmployee.id, tx as never);
        return createdEmployee;
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

      // PATCH semantics, not replace (BI-00CB9CCC). Every optional field used to be
      // written with a blanket `trimOptional(input.x)`, so any field the caller did
      // not mention was silently wiped — including `userId`, which would unlink the
      // person's login account. That was latent while the edit form was unreachable;
      // making it reachable makes it destructive. `patchOptional` is the helper
      // BI-HCM-004 already added for exactly this failure: absent key -> keep
      // current, explicit null/"" -> clear.
      const current = await prisma.employeeProfile.findUnique({
        where: { id: employeeProfileId },
        select: {
          id: true,
          userId: true,
          middleName: true,
          workEmail: true,
          personalEmail: true,
          phoneWork: true,
          phoneMobile: true,
          phoneEmergency: true,
          employmentTypeId: true,
          departmentId: true,
          positionId: true,
          managerEmployeeId: true,
          dottedLineManagerId: true,
          workLocationId: true,
          timezone: true,
          startDate: true,
          confirmationDate: true,
          endDate: true,
        },
      });
      if (!current) return workforceDenied("Employee profile not found.");

      const userId = patchOptional(input, "userId", current.userId);
      const linkageError = await ensureUserLinkIsAvailable(userId, employeeProfileId);
      if (linkageError) return workforceDenied(linkageError);

      const middleName = patchOptional(input, "middleName", current.middleName);
      /** Dates follow the same rule: an absent key keeps what is stored. */
      function patchDate(key: "startDate" | "confirmationDate" | "endDate", stored: Date | null) {
        return key in input && input[key] !== undefined ? (input[key] ?? null) : stored;
      }

      const displayName = buildDisplayName({ ...input, middleName });
      await prisma.employeeProfile.update({
        where: { id: employeeProfileId },
        data: {
          employeeId: trimRequired(input.employeeId),
          userId,
          firstName: trimRequired(input.firstName),
          middleName,
          lastName: trimRequired(input.lastName),
          displayName,
          workEmail: patchOptional(input, "workEmail", current.workEmail),
          personalEmail: patchOptional(input, "personalEmail", current.personalEmail),
          phoneWork: patchOptional(input, "phoneWork", current.phoneWork),
          phoneMobile: patchOptional(input, "phoneMobile", current.phoneMobile),
          phoneEmergency: patchOptional(input, "phoneEmergency", current.phoneEmergency),
          status: input.status,
          employmentTypeId: patchOptional(input, "employmentTypeId", current.employmentTypeId),
          departmentId: patchOptional(input, "departmentId", current.departmentId),
          positionId: patchOptional(input, "positionId", current.positionId),
          managerEmployeeId: patchOptional(input, "managerEmployeeId", current.managerEmployeeId),
          dottedLineManagerId: patchOptional(input, "dottedLineManagerId", current.dottedLineManagerId),
          workLocationId: patchOptional(input, "workLocationId", current.workLocationId),
          timezone: patchOptional(input, "timezone", current.timezone),
          startDate: patchDate("startDate", current.startDate),
          confirmationDate: patchDate("confirmationDate", current.confirmationDate),
          endDate: patchDate("endDate", current.endDate),
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

      // PATCH semantics: an ABSENT key means "leave this field alone"; an explicit null or
      // empty string means "clear it". Previously every field was rewritten from the input,
      // and `trimOptional(undefined)` is null, so any partial caller silently wiped the four
      // fields it did not mention. That hazard is why the org chart had to route around this
      // action instead of using it (BI-HCM-004).
      const nextDepartmentId = patchOptional(input, "departmentId", existing.departmentId);
      const nextPositionId = patchOptional(input, "positionId", existing.positionId);
      const nextManagerEmployeeId = patchOptional(
        input,
        "managerEmployeeId",
        existing.managerEmployeeId,
      );

      // Self-management is rejected above, but that alone still allows a cycle: moving a
      // manager underneath one of their own reports detaches that entire branch from every
      // root, so those people disappear from the org chart and no accountable manager can be
      // resolved for approvals. Check the whole subtree, not just the one hop (BI-HCM-004).
      if (nextManagerEmployeeId && nextManagerEmployeeId !== existing.managerEmployeeId) {
        const reportingRows = await prisma.employeeProfile.findMany({
          select: { id: true, managerEmployeeId: true },
        });
        if (wouldCreateManagerCycle(reportingRows, employeeProfileId, nextManagerEmployeeId)) {
          return workforceDenied(
            "That manager reports to this employee, so the change would create a reporting loop.",
          );
        }
      }
      const nextDottedLineManagerId = patchOptional(
        input,
        "dottedLineManagerId",
        existing.dottedLineManagerId,
      );
      const nextWorkLocationId = patchOptional(input, "workLocationId", existing.workLocationId);
      const nextTimezone = patchOptional(input, "timezone", existing.timezone);
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

/**
 * Change ONLY a reporting line — the org chart's drag-to-reassign and manager picker
 * (BI-HCM-004).
 *
 * Deliberately narrower than `assignEmployeeOrg`: that action rewrites department, position,
 * work location, and timezone from its input, and `trimOptional(undefined)` is `null`, so
 * reusing it for a manager-only edit would silently clear four unrelated fields. Same
 * governance wrapper, same risk band, same `manager_changed` employment event.
 */
export async function reassignEmployeeManager(input: {
  employeeProfileId: string;
  managerEmployeeId?: string | null;
  dottedLineManagerId?: string | null;
  /** Which line is being edited. Omitting a line leaves it untouched. */
  line?: "solid" | "dotted";
  effectiveAt?: Date;
}): Promise<WorkforceActionResult> {
  const employeeProfileId = trimRequired(input.employeeProfileId);
  if (!employeeProfileId) return workforceDenied("Employee profile is required.");

  const line = input.line ?? "solid";
  const nextManagerId =
    line === "solid" ? trimOptional(input.managerEmployeeId) : trimOptional(input.dottedLineManagerId);

  if (nextManagerId === employeeProfileId) {
    return workforceDenied("Employee cannot be their own manager.");
  }

  return withGovernedWorkforceAction({
    actionKey: "employee_profile.reassign_manager",
    riskBand: "medium",
    objectRef: employeeProfileId,
    run: async (actor) => {
      const existing = await prisma.employeeProfile.findUnique({
        where: { id: employeeProfileId },
        select: {
          id: true,
          displayName: true,
          managerEmployeeId: true,
          dottedLineManagerId: true,
        },
      });
      if (!existing) return workforceDenied("Employee profile not found.");

      const currentId = line === "solid" ? existing.managerEmployeeId : existing.dottedLineManagerId;
      if (currentId === nextManagerId) {
        return { ok: true, message: `${existing.displayName} already reports there.` };
      }

      if (nextManagerId) {
        const manager = await prisma.employeeProfile.findUnique({
          where: { id: nextManagerId },
          select: { id: true, displayName: true },
        });
        if (!manager) return workforceDenied("Manager profile not found.");

        // Only the solid line forms the accountability tree, so only it can create a loop.
        if (line === "solid") {
          const reportingRows = await prisma.employeeProfile.findMany({
            select: { id: true, managerEmployeeId: true },
          });
          if (wouldCreateManagerCycle(reportingRows, employeeProfileId, nextManagerId)) {
            return workforceDenied(
              `${manager.displayName} reports to ${existing.displayName}, so this would create a reporting loop.`,
            );
          }
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.employeeProfile.update({
          where: { id: employeeProfileId },
          data:
            line === "solid"
              ? { managerEmployeeId: nextManagerId }
              : { dottedLineManagerId: nextManagerId },
        });

        // Only the solid line is an employment event — a dotted line is advisory.
        if (line === "solid") {
          await tx.employmentEvent.create({
            data: {
              eventId: `EEVT-${crypto.randomUUID()}`,
              employeeProfileId,
              eventType: "manager_changed",
              effectiveAt: input.effectiveAt ?? new Date(),
              reason: "org_chart_reassignment",
              actorUserId: actor.id,
            },
          });
        }
      });

      revalidatePath("/employee");
      revalidatePath("/admin");
      return {
        ok: true,
        message: nextManagerId
          ? `${existing.displayName} now reports to their new manager.`
          : `${existing.displayName} no longer has a ${line === "solid" ? "manager" : "dotted-line manager"}.`,
      };
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
        select: {
          id: true,
          displayName: true,
          status: true,
          // BI-2624B7EA: the two facts the actuator refuses to guess.
          employmentType: { select: { classification: true } },
          workLocation: { select: { id: true, jurisdictionSlug: true } },
        },
      });
      if (!employee) return workforceDenied("Employee profile not found.");

      const employsIn =
        (await prisma.businessContext.findFirst({ select: { employsIn: true } }))?.employsIn ?? [];
      let actuation: ActuationResult | null = null;

      await prisma.$transaction(async (tx) => {
        await tx.employeeProfile.update({
          where: { id: employee.id },
          data: {
            status: input.nextStatus,
            ...(input.eventType === "terminated" ? { endDate: input.terminationDate ?? null } : {}),
          },
        });

        const employmentEvent = await tx.employmentEvent.create({
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

        // BI-2624B7EA — THE SUBSCRIBER. Until this call existed, EmploymentEvent
        // was a log: a row was appended and nothing happened. It runs in the SAME
        // transaction as the event write, so an event never commits without the
        // room it prescribes.
        actuation = await actuateForLifecycleEvent(tx as never, {
          employmentEventId: employmentEvent.eventId,
          eventType: input.eventType,
          worker: employee,
          employsIn,
          userId: actor.id,
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
      return {
        ok: true,
        message: `${describeActuation(actuation, employee.displayName)}`,
      };
    },
  });
}

// ─── Compensation (EP-LABOR-ECONOMICS) ───────────────────────────────────────

export type SetEmployeeCompensationInput = {
  employeeProfileId: string;
  payType: "hourly" | "salary";
  /** Required when payType is "hourly". */
  hourlyRate?: number | null;
  /** Required when payType is "salary". */
  annualSalary?: number | null;
  /** Salary only; defaults to 2080 (40h × 52w) when left unset. */
  standardAnnualHours?: number | null;
};

/**
 * Set how an employee is paid. Stores the compensation columns that feed both
 * payroll earnings (lib/hr/labor-service.ts) and job costing (lib/hr/labor.ts).
 * Switching pay type keeps the other type's stored value — payType decides
 * which one is live, so a switch back never loses data.
 */
export async function setEmployeeCompensation(
  input: SetEmployeeCompensationInput,
): Promise<WorkforceActionResult> {
  const employeeProfileId = trimRequired(input.employeeProfileId);
  if (!employeeProfileId) return workforceDenied("Employee profile is required.");

  if (input.payType === "hourly") {
    if (input.hourlyRate == null || !Number.isFinite(input.hourlyRate) || input.hourlyRate <= 0) {
      return workforceDenied("Enter an hourly pay rate greater than zero.");
    }
  } else if (input.payType === "salary") {
    if (input.annualSalary == null || !Number.isFinite(input.annualSalary) || input.annualSalary <= 0) {
      return workforceDenied("Enter an annual salary greater than zero.");
    }
    if (
      input.standardAnnualHours != null &&
      (!Number.isInteger(input.standardAnnualHours) ||
        input.standardAnnualHours < 1 ||
        input.standardAnnualHours > 8760)
    ) {
      return workforceDenied("Standard hours per year must be a whole number between 1 and 8760.");
    }
  } else {
    return workforceDenied("Choose how this employee is paid.");
  }

  return withGovernedWorkforceAction({
    actionKey: "employee_profile.set_compensation",
    riskBand: "medium",
    objectRef: employeeProfileId,
    run: async () => {
      const employee = await prisma.employeeProfile.findUnique({
        where: { id: employeeProfileId },
        select: { id: true, displayName: true },
      });
      if (!employee) return workforceDenied("Employee profile not found.");

      await prisma.employeeProfile.update({
        where: { id: employeeProfileId },
        data:
          input.payType === "hourly"
            ? { payType: "hourly", hourlyRate: input.hourlyRate }
            : {
                payType: "salary",
                annualSalary: input.annualSalary,
                standardAnnualHours: input.standardAnnualHours ?? null,
              },
      });

      revalidatePath("/employee");
      return { ok: true, message: `Pay updated for ${employee.displayName}.` };
    },
  });
}

/**
 * Apply a People-grid inline cell edit (BI-00CB9CCC).
 *
 * The generic grid adapter's default write tier goes straight to Prisma. For an
 * HR record that is not acceptable: every other employee-profile write is wrapped
 * in `withGovernedWorkforceAction`, which writes an AuthorizationDecisionLog. A raw
 * adapter write would edit people's records with no audit trail at all. So the
 * People grid writes through here instead, and inherits the same capability check,
 * governance resolution, and audit entry as the form.
 *
 * Keyed by the semantic `employeeId` because that is the grid's rowId.
 */
const GRID_EDITABLE_EMPLOYEE_FIELDS = new Set([
  "displayName",
  "workEmail",
  "timezone",
  "startDate",
]);

export async function applyEmployeeProfileGridEdit(
  employeeId: string,
  changes: Record<string, unknown>,
): Promise<WorkforceActionResult> {
  const trimmedId = trimRequired(employeeId);
  if (!trimmedId) return workforceDenied("Employee is required.");

  // Re-assert the allow-list server-side. The adapter already filtered, but this
  // path must fail closed on its own — it is a governed write, not a helper.
  const entries = Object.entries(changes);
  if (entries.length === 0) return workforceDenied("No changes supplied.");
  for (const [field] of entries) {
    if (!GRID_EDITABLE_EMPLOYEE_FIELDS.has(field)) {
      return workforceDenied(`Field "${field}" cannot be edited from the grid.`);
    }
  }

  return withGovernedWorkforceAction({
    actionKey: "employee_profile.grid_edit",
    riskBand: "medium",
    objectRef: trimmedId,
    run: async () => {
      const existing = await prisma.employeeProfile.findUnique({
        where: { employeeId: trimmedId },
        select: { id: true },
      });
      if (!existing) return workforceDenied("Employee profile not found.");

      await prisma.employeeProfile.update({
        where: { employeeId: trimmedId },
        data: changes as Prisma.EmployeeProfileUpdateInput,
      });

      revalidatePath("/employee");
      return { ok: true, message: "Employee updated." };
    },
  });
}
