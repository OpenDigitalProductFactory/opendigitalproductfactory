import { unstable_cache } from "next/cache";
import { prisma } from "@dpf/db";
import { getRouteDataContext as getDefaultRouteDataContext } from "@/lib/route-context";

import {
  bucketPortalContextTimestamp,
  createPortalContextEnvelopeId,
  portalContextCacheTags,
} from "./cache";
import type { OrganizationRow, PortalContextDb, PortalUserRow } from "./db-types";
import { resolvePortalAuthority, resolvePromotionReviewerGrantKeys } from "./authority-resolver";
import { resolveCoworkerCapability } from "./capability-resolver";
import { resolvePortalEvidence } from "./evidence-resolver";
import { resolveHiveMindCandidates } from "./hive-mind-resolver";
import { createPortalContextPromptDigest } from "./prompt-digest";
import { resolvePortalRoute } from "./route-resolver";
import { resolvePortalWork, type WorkResolution } from "./work-resolver";
import type { AttentionSignal, PortalContextEnvelope, PortalContextInput } from "./types";

type ResolverDeps = {
  db?: PortalContextDb;
  now?: () => Date;
  getRouteDataContext?: (routeContext: string, userId: string) => Promise<string | null>;
  resolverTimeoutMs?: number;
};

const DEFAULT_RESOLVER_TIMEOUT_MS = 3_000;

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
  const resolverTimeoutMs = deps.resolverTimeoutMs ?? DEFAULT_RESOLVER_TIMEOUT_MS;
  const routeProjection = resolvePortalRoute(input);
  const attention: AttentionSignal[] = [...routeProjection.attention];

  const [userResult, principalAliasResult, organizationResult, routeDataResult] = await Promise.all([
    resolveSource("user", resolveUser(db, userId), null, resolverTimeoutMs),
    resolveSource("principal", resolvePrincipalAlias(db, userId), null, resolverTimeoutMs),
    resolveSource("organization", resolveOrganization(db), null, resolverTimeoutMs),
    resolveSource(
      "route-data",
      (deps.getRouteDataContext ?? getDefaultRouteDataContext)(input.routeContext, userId),
      null,
      resolverTimeoutMs,
    ),
  ]);
  attention.push(
    ...userResult.attention,
    ...principalAliasResult.attention,
    ...organizationResult.attention,
    ...routeDataResult.attention,
  );
  const user = userResult.value;
  const principalAlias = principalAliasResult.value;
  const organization = organizationResult.value;
  const principalId = principalAlias?.principal?.principalId ?? null;

  const workProjectionResult = await resolveSource(
    "work",
    resolvePortalWork(input, db, now),
    emptyWorkResolution(),
    resolverTimeoutMs,
  );
  const workProjection = workProjectionResult.value;
  attention.push(...workProjectionResult.attention);
  attention.push(...workProjection.attention);

  const evidenceResult = await resolveSource(
    "evidence",
    resolvePortalEvidence(workProjection.work, db),
    [],
    resolverTimeoutMs,
  );
  const evidence = evidenceResult.value;
  attention.push(...evidenceResult.attention);
  // D14 (2026-05-23): only flag "missing evidence" once a phase has actually
  // had a chance to produce evidence. Before, this fired at t=0 the moment a
  // build was created — every evidence slot is a "gap" until something fills
  // it, so a brand-new FB-* always showed an alarming yellow warning before
  // the user had done anything. The gate now only triggers after the
  // build has moved past Ideate (Ideate is conversational / scoping; real
  // evidence production starts at Plan and beyond).
  const featureBuildPhase = workProjection.work.featureBuild?.phase ?? null;
  const phaseHasAttemptedEvidence = featureBuildPhase !== null
    && featureBuildPhase !== "ideate";
  if (phaseHasAttemptedEvidence && evidence.some((item) => item.isGap)) {
    attention.push({
      kind: "missing_evidence",
      severity: "warning",
      message: "Evidence gaps exist for this work context.",
    });
  }

  const platformRole = platformRoleForUser(user);
  const promotionReviewerGrantKeysResult = await resolveSource(
    "authority",
    resolvePromotionReviewerGrantKeys({
      db,
      work: workProjection.work,
      routeContext: input.routeContext,
      userId,
      principalId,
      platformRole,
    }),
    [],
    resolverTimeoutMs,
  );
  attention.push(...promotionReviewerGrantKeysResult.attention);
  const authority = resolvePortalAuthority({
    user,
    userPrincipalId: principalId,
    platformRole,
    work: workProjection.work,
    domainTools: routeProjection.domainTools,
    promotionReviewerGrantKeys: promotionReviewerGrantKeysResult.value,
  });
  const coworkersResult = await resolveSource(
    "hive-mind",
    resolveHiveMindCandidates({
      routeDomain: routeProjection.route.domain,
      work: workProjection.work,
      attention,
      db,
    }),
    [],
    resolverTimeoutMs,
  );
  const coworkers = coworkersResult.value;
  attention.push(...coworkersResult.attention);

  // D29: capability snapshot for configuration-page coworker guidance.
  // Soft-fail on its own clock so an outage here can't block the envelope.
  const capabilityResult = await resolveSource(
    "capability",
    resolveCoworkerCapability({
      routeContext: input.routeContext,
      platformRole,
    }),
    null,
    resolverTimeoutMs,
  );
  attention.push(...capabilityResult.attention);

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
      principalId,
      platformRole,
    },
    anchors: [...routeProjection.anchors, ...workProjection.anchors],
    work: workProjection.work,
    evidence,
    authority,
    coworkers,
    attention,
    capability: capabilityResult.value,
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

class PortalContextResolverTimeoutError extends Error {
  constructor(source: string) {
    super(`${source} resolver timed out`);
    this.name = "PortalContextResolverTimeoutError";
  }
}

async function resolveSource<T>(
  source: string,
  promise: Promise<T>,
  fallback: T,
  timeoutMs: number,
): Promise<{ value: T; attention: AttentionSignal[] }> {
  try {
    return {
      value: await withTimeout(source, promise, timeoutMs),
      attention: [],
    };
  } catch (error) {
    const timedOut = error instanceof PortalContextResolverTimeoutError;
    const attention: AttentionSignal[] = [
      {
        kind: "source_unavailable",
        severity: "warning",
        message: `Portal context ${source} source is unavailable.`,
      },
    ];
    if (timedOut) {
      attention.push({
        kind: "envelope_timeout",
        severity: "warning",
        message: `Portal context ${source} source exceeded the soft timeout.`,
      });
    }
    return { value: fallback, attention };
  }
}

async function withTimeout<T>(source: string, promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PortalContextResolverTimeoutError(source)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function emptyWorkResolution(): WorkResolution {
  return {
    work: {
      backlogItem: null,
      epic: null,
      capsule: null,
      featureBuild: null,
      taskRun: null,
      agentThread: null,
      branch: null,
    },
    anchors: [],
    attention: [],
  };
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
