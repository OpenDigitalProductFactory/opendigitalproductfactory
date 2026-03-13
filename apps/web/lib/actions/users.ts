"use server";

import { prisma, type Prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getUserTeamIds, createAuthorizationDecisionLog } from "@/lib/governance-data";
import { buildPrincipalContext } from "@/lib/principal-context";
import { resolveGovernedAction } from "@/lib/governance-resolver";

export type UserActionResult = {
  ok: boolean;
  message: string;
};

type SessionUserContext = {
  id: string;
  email: string;
  platformRole: string | null;
  isSuperuser: boolean;
};

export function summarizeGovernedLifecycleAttempt(input: {
  actorIsSuperuser: boolean;
  targetIsSuperuser: boolean;
}): { decision: "allow" | "deny"; message: string } {
  if (input.targetIsSuperuser && !input.actorIsSuperuser) {
    return {
      decision: "deny",
      message: "Only a superuser can change another superuser account.",
    };
  }

  return {
    decision: "allow",
    message: "Lifecycle update permitted.",
  };
}

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function passwordPolicyErrors(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 12) errors.push("Password must be at least 12 characters.");
  if (!/[A-Z]/.test(password)) errors.push("Password must include an uppercase letter.");
  if (!/[a-z]/.test(password)) errors.push("Password must include a lowercase letter.");
  if (!/[0-9]/.test(password)) errors.push("Password must include a number.");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("Password must include a symbol.");
  return errors;
}

async function requireCapability(capability: "manage_users" | "manage_user_lifecycle"): Promise<SessionUserContext> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new Error("Unauthorized");

  const context: SessionUserContext = {
    id: user.id,
    email: user.email ?? "",
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  };

  if (!can(context, capability)) throw new Error("Unauthorized");
  return context;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function resolveRoleDbId(roleId: string): Promise<string | null> {
  const role = await prisma.platformRole.findUnique({
    where: { roleId },
    select: { id: true },
  });
  return role?.id ?? null;
}

async function withGovernedUserAction(input: {
  capability: "manage_users" | "manage_user_lifecycle";
  actionKey: string;
  riskBand: "medium" | "high";
  objectRef?: string;
  run: (actor: SessionUserContext) => Promise<UserActionResult>;
}): Promise<UserActionResult> {
  const actor = await requireCapability(input.capability);
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
    return { ok: false, message: "Governance denied this user-management action." };
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

export async function createUserAccount(input: {
  email: string;
  password: string;
  roleId: string;
  isSuperuser: boolean;
}): Promise<UserActionResult> {
  return withGovernedUserAction({
    capability: "manage_users",
    actionKey: "user.create",
    riskBand: "high",
    objectRef: input.email,
    run: async () => {
      const email = normalizeEmail(input.email);
      if (!validateEmail(email)) return { ok: false, message: "Enter a valid email address." };

      const policyErrors = passwordPolicyErrors(input.password);
      if (policyErrors.length > 0) return { ok: false, message: policyErrors[0] ?? "Password policy failed." };

      const roleDbId = await resolveRoleDbId(input.roleId);
      if (!roleDbId) return { ok: false, message: "Selected role does not exist." };

      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) return { ok: false, message: "A user with this email already exists." };

      const passwordHash = await hashPassword(input.password);
      await prisma.user.create({
        data: {
          email,
          passwordHash,
          isSuperuser: input.isSuperuser,
          isActive: true,
          groups: { create: { platformRoleId: roleDbId } },
        },
      });

      revalidatePath("/admin");
      revalidatePath("/employee");
      return { ok: true, message: `User ${email} created.` };
    },
  });
}

export async function adminResetUserPassword(input: {
  userId: string;
  newPassword: string;
}): Promise<UserActionResult> {
  return withGovernedUserAction({
    capability: "manage_users",
    actionKey: "user.password_reset",
    riskBand: "high",
    objectRef: input.userId,
    run: async () => {
      const password = input.newPassword.trim();
      const policyErrors = passwordPolicyErrors(password);
      if (policyErrors.length > 0) return { ok: false, message: policyErrors[0] ?? "Password policy failed." };

      const target = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, email: true },
      });
      if (!target) return { ok: false, message: "User not found." };

      const passwordHash = await hashPassword(password);
      await prisma.user.update({
        where: { id: target.id },
        data: { passwordHash },
      });

      revalidatePath("/admin");
      return { ok: true, message: `Password reset for ${target.email}.` };
    },
  });
}

export async function updateUserLifecycle(input: {
  userId: string;
  roleId: string;
  isActive: boolean;
}): Promise<UserActionResult> {
  return withGovernedUserAction({
    capability: "manage_user_lifecycle",
    actionKey: "user.lifecycle_update",
    riskBand: "medium",
    objectRef: input.userId,
    run: async (actor) => {
      const roleDbId = await resolveRoleDbId(input.roleId);
      if (!roleDbId) return { ok: false, message: "Selected role does not exist." };

      const target = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, email: true, isSuperuser: true },
      });
      if (!target) return { ok: false, message: "User not found." };

      const lifecycleDecision = summarizeGovernedLifecycleAttempt({
        actorIsSuperuser: actor.isSuperuser,
        targetIsSuperuser: target.isSuperuser,
      });
      if (lifecycleDecision.decision === "deny") {
        return { ok: false, message: lifecycleDecision.message };
      }

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: target.id },
          data: { isActive: input.isActive },
        });
        await tx.userGroup.deleteMany({ where: { userId: target.id } });
        await tx.userGroup.create({
          data: {
            userId: target.id,
            platformRoleId: roleDbId,
          },
        });
      });

      revalidatePath("/employee");
      revalidatePath("/admin");
      return {
        ok: true,
        message: `${target.email} updated (${input.isActive ? "active" : "inactive"}, ${input.roleId}).`,
      };
    },
  });
}
