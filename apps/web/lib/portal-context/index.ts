import { unstable_cache } from "next/cache";
import { prisma } from "@dpf/db";
import { getRouteDataContext as getDefaultRouteDataContext } from "@/lib/route-context";

import {
  bucketPortalContextTimestamp,
  createPortalContextEnvelopeId,
  portalContextCacheTags,
} from "./cache";
import type { OrganizationRow, PortalContextDb, PortalUserRow } from "./db-types";
import { resolvePortalAuthority } from "./authority-resolver";
import { resolvePortalEvidence } from "./evidence-resolver";
import { resolveHiveMindCandidates } from "./hive-mind-resolver";
import { createPortalContextPromptDigest } from "./prompt-digest";
import { resolvePortalRoute } from "./route-resolver";
import { resolvePortalWork } from "./work-resolver";
import type { AttentionSignal, PortalContextEnvelope, PortalContextInput } from "./types";

type ResolverDeps = {
  db?: PortalContextDb;
  now?: () => Date;
  getRouteDataContext?: (routeContext: string, userId: string) => Promise<string | null>;
};

export async function resolvePortalContextEnvelope(
  input: PortalContextInput,
  userId: string,
): Promise<PortalContextEnvelope> {
  const bucket = bucketPortalContextTimestamp();
  const cached = unstable_cache(
    () =>
      resolvePortalContextEnvelopeUncached(input, userId, {
        now: () => bucket,
      }),
    ["portal-context", createPortalContextEnvelopeId(input, userId, bucket)],
    {
      revalidate: 30,
      tags: portalContextCacheTags(input, userId),
    },
  );

  return cached();
}

export async function resolvePortalContextEnvelopeUncached(
  input: PortalContextInput,
  userId: string,
  deps: ResolverDeps = {},
): Promise<PortalContextEnvelope> {
  const db = deps.db ?? (prisma as unknown as PortalContextDb);
  const now = deps.now?.() ?? new Date();
  const bucket = bucketPortalContextTimestamp(now);
  const routeProjection = resolvePortalRoute(input);
  const attention: AttentionSignal[] = [...routeProjection.attention];

  const [user, principalAlias, organization] = await Promise.all([
    resolveUser(db, userId),
    resolvePrincipalAlias(db, userId),
    resolveOrganization(db),
    (deps.getRouteDataContext ?? getDefaultRouteDataContext)(input.routeContext, userId).catch(() => null),
  ]);

  const workProjection = await resolvePortalWork(input, db, now);
  attention.push(...workProjection.attention);

  const evidence = await resolvePortalEvidence(workProjection.work, db);
  if (evidence.some((item) => item.isGap)) {
    attention.push({
      kind: "missing_evidence",
      severity: "warning",
      message: "Evidence gaps exist for this work context.",
    });
  }

  const platformRole = platformRoleForUser(user);
  const authority = resolvePortalAuthority({
    user,
    platformRole,
    work: workProjection.work,
    domainTools: routeProjection.domainTools,
  });
  const coworkers = await resolveHiveMindCandidates({
    routeDomain: routeProjection.route.domain,
    work: workProjection.work,
    attention,
    db,
  });

  const baseEnvelope: Omit<PortalContextEnvelope, "promptDigest"> = {
    envelopeId: createPortalContextEnvelopeId(input, userId, bucket),
    resolvedAt: bucket.toISOString(),
    route: routeProjection.route,
    organization: {
      organizationId: organization?.orgId ?? null,
      name: organization?.name ?? null,
      archetypeId: organization?.storefrontConfig?.archetypeId ?? null,
    },
    user: {
      userId,
      principalId: principalAlias?.principal?.principalId ?? null,
      platformRole,
    },
    anchors: [...routeProjection.anchors, ...workProjection.anchors],
    work: workProjection.work,
    evidence,
    authority,
    coworkers,
    attention,
  };

  return {
    ...baseEnvelope,
    promptDigest: createPortalContextPromptDigest(baseEnvelope),
  };
}

async function resolveUser(db: PortalContextDb, userId: string): Promise<PortalUserRow | null> {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isSuperuser: true,
      groups: {
        select: {
          platformRole: {
            select: { roleId: true },
          },
        },
        take: 1,
      },
    },
  });
}

async function resolvePrincipalAlias(db: PortalContextDb, userId: string) {
  return db.principalAlias.findFirst({
    where: {
      aliasType: "user",
      aliasValue: userId,
    },
    select: {
      principal: {
        select: { principalId: true },
      },
    },
  });
}

async function resolveOrganization(db: PortalContextDb): Promise<OrganizationRow | null> {
  return db.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: {
      orgId: true,
      name: true,
      storefrontConfig: {
        select: {
          archetypeId: true,
        },
      },
    },
  });
}

function platformRoleForUser(user: PortalUserRow | null): string {
  return user?.groups?.[0]?.platformRole?.roleId ?? "none";
}

export type {
  AttentionSignal,
  AuthoritySummary,
  EvidenceSummary,
  FeatureBuildAnchor,
  GitBranchAnchor,
  HiveMindCandidate,
  PortalContextEnvelope,
  PortalContextInput,
  PortalObjectAnchor,
  TaskRunAnchor,
  WorkBacklogAnchor,
  WorkCapsuleAnchor,
  WorkEpicAnchor,
} from "./types";
export { revalidatePortalContext } from "./invalidation";
