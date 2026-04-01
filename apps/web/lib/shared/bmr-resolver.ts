// apps/web/lib/bmr-resolver.ts
//
// Governance resolution for Business Model Roles (BMR).
// Complements governance-resolver.ts (platform-level) with product-scoped
// authority lookups based on the two-tier role model.

import { prisma } from "@dpf/db";

// ─── resolveBmrAuthority ──────────────────────────────────────────────────────

export type BmrAuthorityResult = {
  found: boolean;
  hitlTier: number | null;
  roleName: string | null;
  escalatesTo: string | null;
};

/**
 * Check whether a user holds a BMR role that covers a given authority domain
 * for a specific product. Returns the HITL tier from that role, or a
 * not-found result that signals fallback to the platform HR-* hierarchy.
 */
export async function resolveBmrAuthority(
  userId: string,
  productId: string,
  authorityDomain: string,
): Promise<BmrAuthorityResult> {
  const assignment = await prisma.businessModelRoleAssignment.findFirst({
    where: {
      userId,
      productId,
      revokedAt: null,
      businessModelRole: {
        authorityDomain: { contains: authorityDomain, mode: "insensitive" },
        status: "active",
      },
    },
    select: {
      businessModelRole: {
        select: { name: true, hitlTierDefault: true, escalatesTo: true },
      },
    },
  });

  if (!assignment) {
    return { found: false, hitlTier: null, roleName: null, escalatesTo: null };
  }

  return {
    found: true,
    hitlTier: assignment.businessModelRole.hitlTierDefault,
    roleName: assignment.businessModelRole.name,
    escalatesTo: assignment.businessModelRole.escalatesTo,
  };
}

// ─── resolveProductProposalTarget ─────────────────────────────────────────────

export type ProposalTargetResult = {
  userId: string | null;
  email: string | null;
  roleName: string | null;
  hitlTier: number | null;
  escalatesTo: string | null;
  /** HR-* role to escalate to when no BMR assignment is found */
  fallbackToRole: string | null;
};

/**
 * Resolve who should receive an agent proposal for a given product and
 * authority domain. Returns the assigned BMR role holder if one exists,
 * or a fallback platform role (HR-200 by default) for unassigned domains.
 */
export async function resolveProductProposalTarget(
  productId: string,
  authorityDomain: string,
): Promise<ProposalTargetResult> {
  const assignment = await prisma.businessModelRoleAssignment.findFirst({
    where: {
      productId,
      revokedAt: null,
      businessModelRole: {
        authorityDomain: { contains: authorityDomain, mode: "insensitive" },
        status: "active",
      },
    },
    include: {
      user: { select: { id: true, email: true } },
      businessModelRole: {
        select: { name: true, hitlTierDefault: true, escalatesTo: true },
      },
    },
    orderBy: { assignedAt: "desc" },
  });

  if (!assignment) {
    return {
      userId: null,
      email: null,
      roleName: null,
      hitlTier: null,
      escalatesTo: null,
      fallbackToRole: "HR-200",
    };
  }

  return {
    userId: assignment.userId,
    email: assignment.user.email,
    roleName: assignment.businessModelRole.name,
    hitlTier: assignment.businessModelRole.hitlTierDefault,
    escalatesTo: assignment.businessModelRole.escalatesTo,
    fallbackToRole: null,
  };
}
