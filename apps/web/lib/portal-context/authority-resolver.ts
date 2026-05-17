import { can } from "@/lib/permissions";

import type { PortalUserRow } from "./db-types";
import type { AuthoritySummary, PortalContextEnvelope } from "./types";

type WorkProjection = PortalContextEnvelope["work"];

export function resolvePortalAuthority(args: {
  user: PortalUserRow | null;
  platformRole: string;
  work: WorkProjection;
  domainTools: string[];
}): AuthoritySummary {
  const userContext = {
    platformRole: args.platformRole === "none" ? null : args.platformRole,
    isSuperuser: Boolean(args.user?.isSuperuser),
  };

  return {
    canActOnCapsule: can(userContext, "view_platform") || can(userContext, "manage_backlog"),
    canActOnBuild: can(userContext, "view_platform"),
    canReviewPromotion: can(userContext, "manage_platform") || can(userContext, "manage_backlog"),
    grantedToolKeys: args.domainTools,
    proposalModeActive: Boolean(args.work.capsule || args.work.featureBuild),
  };
}
