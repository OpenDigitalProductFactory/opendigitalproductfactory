import { can } from "@/lib/permissions";

import type { AuthorityBindingRow, PortalContextDb, PortalUserRow } from "./db-types";
import type { AuthoritySummary, PortalContextEnvelope } from "./types";

type WorkProjection = PortalContextEnvelope["work"];

const PROMOTION_REVIEW_GRANT_KEYS = ["release_gate_create"] as const;
const PROMOTION_REVIEW_GRANT_KEY_SET = new Set<string>(PROMOTION_REVIEW_GRANT_KEYS);

export function resolvePortalAuthority(args: {
  user: PortalUserRow | null;
  userPrincipalId?: string | null;
  platformRole: string;
  work: WorkProjection;
  domainTools: string[];
  promotionReviewerGrantKeys?: string[];
}): AuthoritySummary {
  const userContext = {
    platformRole: args.platformRole === "none" ? null : args.platformRole,
    isSuperuser: Boolean(args.user?.isSuperuser),
  };
  const canActOnCapsule = canCurrentUserActOnCapsule({
    capsule: args.work.capsule ?? null,
    userId: args.user?.id ?? null,
    principalId: args.userPrincipalId ?? null,
  });

  return {
    canActOnCapsule,
    canActOnBuild: can(userContext, "view_platform") || canActOnCapsule,
    canReviewPromotion:
      can(userContext, "manage_platform") || hasPromotionReviewGrant(args.promotionReviewerGrantKeys ?? []),
    grantedToolKeys: args.domainTools,
    proposalModeActive: args.work.taskRun?.authorityScope === "proposal",
  };
}

export async function resolvePromotionReviewerGrantKeys(args: {
  db: PortalContextDb;
  work: WorkProjection;
  routeContext: string;
  userId: string;
  principalId: string | null;
  platformRole: string;
}): Promise<string[]> {
  if (!args.db.authorityBinding || !args.work.featureBuild) return [];

  const resourceRefs = Array.from(
    new Set(
      [
        args.work.featureBuild.buildId,
        args.work.capsule?.capsuleId,
        args.routeContext,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  if (resourceRefs.length === 0) return [];

  const bindings = await args.db.authorityBinding.findMany({
    where: {
      status: "active",
      resourceRef: { in: resourceRefs },
      grants: {
        some: {
          grantKey: { in: [...PROMOTION_REVIEW_GRANT_KEYS] },
        },
      },
    },
    select: {
      subjects: {
        select: {
          subjectType: true,
          subjectRef: true,
          relation: true,
        },
      },
      grants: {
        select: {
          grantKey: true,
          mode: true,
        },
      },
    },
  });

  return Array.from(
    new Set(
      bindings
        .filter((binding) => bindingAppliesToUser(binding, args))
        .flatMap((binding) => binding.grants ?? [])
        .filter((grant) => PROMOTION_REVIEW_GRANT_KEY_SET.has(grant.grantKey) && grant.mode !== "deny")
        .map((grant) => grant.grantKey),
    ),
  );
}

function canCurrentUserActOnCapsule(args: {
  capsule: WorkProjection["capsule"] | null;
  userId: string | null;
  principalId: string | null;
}) {
  if (!args.capsule || args.capsule.isLeaseExpired) return false;

  const actorRefs = new Set([args.userId, args.principalId].filter((value): value is string => Boolean(value)));
  if (actorRefs.size === 0) return false;

  if (args.capsule.executorRef && actorRefs.has(args.capsule.executorRef)) return true;
  if (args.capsule.leaseHolderPrincipalId && actorRefs.has(args.capsule.leaseHolderPrincipalId)) return true;
  return args.capsule.scopeClaimPrincipalIds.some((principalId) => actorRefs.has(principalId));
}

function hasPromotionReviewGrant(grantKeys: string[]) {
  return grantKeys.some((grantKey) => PROMOTION_REVIEW_GRANT_KEY_SET.has(grantKey));
}

function bindingAppliesToUser(
  binding: AuthorityBindingRow,
  user: {
    userId: string;
    principalId: string | null;
    platformRole: string;
  },
) {
  const subjects = (binding.subjects ?? []).filter((subject) =>
    subject.relation === "allowed" || subject.relation === "owner" || subject.relation === "reviewer",
  );
  if (subjects.length === 0) return true;

  return subjects.some((subject) => {
    if (subject.subjectType === "platform-role") return subject.subjectRef === user.platformRole;
    if (subject.subjectType === "user") return subject.subjectRef === user.userId;
    if (subject.subjectType === "principal") return subject.subjectRef === user.principalId;
    if (subject.subjectType === "principal-id") return subject.subjectRef === user.principalId;
    return false;
  });
}
