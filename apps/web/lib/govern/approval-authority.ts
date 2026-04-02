/**
 * Approval Authority Resolution — EP-BUILD-HANDOFF-002 Phase 2b
 *
 * Resolves WHO needs to approve a change. The platform targets small businesses
 * where the highest authority is easily identifiable (CEO/Owner).
 *
 * Resolution order:
 *   1. Domain-specific authority if assigned (e.g., HR-500 for deploy)
 *   2. Highest platform authority: HR-000 (CEO/Owner)
 *   3. Fallback: the currently logged-in user (self-approval)
 */

import { prisma } from "@dpf/db";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ApprovalAuthority {
  employeeId: string;
  employeeName: string;
  userId: string | null;
  authorityDomain: string;
  reachability: {
    onPlatform: boolean;
    workEmail: string | null;
    personalEmail: string | null;
    phoneNumber: string | null;
  };
  urgencyLevel: "standard" | "urgent" | "emergency";
}

// Role IDs from the platform's HR taxonomy
const CEO_ROLE_ID = "HR-000";
const DEPLOY_ROLE_ID = "HR-500";

// ─── Authority Resolution ───────────────────────────────────────────────────

interface ResolvedEmployee {
  employee: {
    employeeId: string;
    displayName: string;
    workEmail: string | null;
    personalEmail: string | null;
    phoneMobile: string | null;
  };
  userId: string;
  onPlatform: boolean;
}

/**
 * Check if a user has been active on the platform recently (within 30 min)
 * by looking at their latest AI Coworker thread activity.
 */
async function isUserRecentlyActive(userId: string): Promise<boolean> {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
  const recentThread = await prisma.agentThread.findFirst({
    where: {
      userId,
      updatedAt: { gt: thirtyMinAgo },
    },
    select: { id: true },
  });
  return recentThread !== null;
}

/**
 * Find the employee who holds a specific platform role (e.g., HR-000, HR-500).
 * Returns null if no employee is linked to a user with that role.
 */
async function findEmployeeByPlatformRole(roleId: string): Promise<ResolvedEmployee | null> {
  // PlatformRole -> UserGroup -> User -> EmployeeProfile
  const userGroup = await prisma.userGroup.findFirst({
    where: {
      platformRole: { roleId },
      user: { employeeProfile: { isNot: null } },
    },
    include: {
      user: {
        include: {
          employeeProfile: true,
        },
      },
    },
  });

  if (!userGroup?.user?.employeeProfile) return null;

  const employee = userGroup.user.employeeProfile;
  const onPlatform = await isUserRecentlyActive(userGroup.user.id);

  return {
    employee,
    userId: userGroup.user.id,
    onPlatform,
  };
}

/**
 * Find the first admin user who set up the platform (fallback when no HR-000 is assigned).
 */
async function findFirstAdmin(): Promise<ResolvedEmployee | null> {
  const admin = await prisma.user.findFirst({
    where: {
      isSuperuser: true,
      employeeProfile: { isNot: null },
    },
    orderBy: { createdAt: "asc" },
    include: {
      employeeProfile: true,
    },
  });

  if (!admin?.employeeProfile) return null;

  const onPlatform = await isUserRecentlyActive(admin.id);

  return {
    employee: admin.employeeProfile,
    userId: admin.id,
    onPlatform,
  };
}

/**
 * Resolve the approval authority for a given action.
 *
 * @param actionType - What action needs approval (e.g., "deployment", "finance")
 * @param changeType - RFC change type: "normal" or "emergency"
 * @param riskLevel  - Assessed risk level of the change
 * @param currentUserId - The currently logged-in user (fallback for self-approval)
 */
export async function resolveApprovalAuthority(
  actionType: string,
  changeType: "standard" | "normal" | "emergency",
  riskLevel: "low" | "medium" | "high" | "critical",
  currentUserId?: string,
): Promise<ApprovalAuthority> {
  const urgencyLevel = changeType === "emergency" ? "emergency" :
    (riskLevel === "high" || riskLevel === "critical") ? "urgent" : "standard";

  // 1. For emergencies, go straight to CEO/Owner
  if (changeType === "emergency") {
    const ceo = await findEmployeeByPlatformRole(CEO_ROLE_ID);
    if (ceo) {
      return buildAuthority(ceo, "CEO/Owner (emergency escalation)", urgencyLevel);
    }
  }

  // 2. For deployment actions, prefer domain-specific authority (HR-500)
  if (actionType === "deployment") {
    const deployAuth = await findEmployeeByPlatformRole(DEPLOY_ROLE_ID);
    if (deployAuth) {
      return buildAuthority(deployAuth, "Deployment authority (HR-500)", urgencyLevel);
    }
  }

  // 3. Default: highest platform authority (HR-000 / CEO/Owner)
  const ceo = await findEmployeeByPlatformRole(CEO_ROLE_ID);
  if (ceo) {
    return buildAuthority(ceo, "CEO/Owner (highest platform authority)", urgencyLevel);
  }

  // 4. Fallback: first admin who set up the platform
  const admin = await findFirstAdmin();
  if (admin) {
    return buildAuthority(admin, "Platform administrator (first admin)", urgencyLevel);
  }

  // 5. Last resort: self-approval by the current user
  if (currentUserId) {
    const currentUser = await prisma.user.findUnique({
      where: { id: currentUserId },
      include: { employeeProfile: true },
    });
    if (currentUser?.employeeProfile) {
      return {
        employeeId: currentUser.employeeProfile.employeeId,
        employeeName: currentUser.employeeProfile.displayName,
        userId: currentUser.id,
        authorityDomain: "Self-approval (no authority configured)",
        reachability: {
          onPlatform: true,
          workEmail: currentUser.employeeProfile.workEmail,
          personalEmail: currentUser.employeeProfile.personalEmail,
          phoneNumber: currentUser.employeeProfile.phoneMobile,
        },
        urgencyLevel,
      };
    }
  }

  // No authority found at all — return a stub that will be presented in chat
  return {
    employeeId: "UNRESOLVED",
    employeeName: "No authority configured",
    userId: null,
    authorityDomain: "No approval authority found on the platform",
    reachability: {
      onPlatform: false,
      workEmail: null,
      personalEmail: null,
      phoneNumber: null,
    },
    urgencyLevel,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildAuthority(
  resolved: ResolvedEmployee,
  domain: string,
  urgencyLevel: "standard" | "urgent" | "emergency",
): ApprovalAuthority {
  return {
    employeeId: resolved.employee.employeeId,
    employeeName: resolved.employee.displayName,
    userId: resolved.userId,
    authorityDomain: domain,
    reachability: {
      onPlatform: resolved.onPlatform,
      workEmail: resolved.employee.workEmail,
      personalEmail: resolved.employee.personalEmail,
      phoneNumber: resolved.employee.phoneMobile,
    },
    urgencyLevel,
  };
}

/**
 * Check whether the resolved authority is the same as the current user.
 * When true, the approval can be presented directly in the current chat.
 */
export function isCurrentUserTheAuthority(
  authority: ApprovalAuthority,
  currentUserId: string,
): boolean {
  return authority.userId === currentUserId;
}

/**
 * Format authority info for AI Coworker chat display.
 */
export function formatAuthorityForChat(authority: ApprovalAuthority, isCurrentUser: boolean): string {
  if (authority.employeeId === "UNRESOLVED") {
    return "No approval authority is configured on the platform. Please configure an employee with the CEO/Owner role (HR-000) to enable change approvals.";
  }

  if (isCurrentUser) {
    return `This needs your approval as **${authority.authorityDomain}**.`;
  }

  const reachLines: string[] = [];
  if (authority.reachability.onPlatform) {
    reachLines.push("They are currently on the platform.");
  } else {
    reachLines.push("They are not currently on the platform.");
    if (authority.reachability.workEmail) {
      reachLines.push(`Work email: ${authority.reachability.workEmail}`);
    }
    if (authority.reachability.phoneNumber) {
      reachLines.push(`Phone: ${authority.reachability.phoneNumber}`);
    }
  }

  return `This needs approval from **${authority.employeeName}** (${authority.authorityDomain}).\n${reachLines.join(" ")}`;
}
