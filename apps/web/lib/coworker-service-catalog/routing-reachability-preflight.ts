// Scheduled routing-reachability preflight (BI-E2CCFAC1).
//
// The router could always say exactly why a coworker cannot route — but nothing
// ever asked until a human typed a message and watched it die. This preflight
// asks on a schedule: it projects route readiness for every production coworker
// (including the payload-screening escalation ceiling, see route-readiness.ts),
// raises deduplicated owner-visible health issues when any coworker has zero
// eligible endpoints, and resolves that issue when routing recovers. Read-only
// with respect to routing: it performs the same side-effect-free dry-run the
// runtime-health page and resolve_model_selection use.

import { prisma } from "@dpf/db";

import {
  loadCoworkerRoutingReadinessSnapshot,
  projectCoworkerRouteReadiness,
  type CoworkerRouteConfiguration,
} from "./route-readiness";
import {
  healthAlertIssueKey,
  resolveHealthAlertIssue,
  upsertHealthAlertIssue,
} from "@/lib/observability/health-alert-issue";
import {
  notifyAttentionLive,
  resolveOperatorRecipient,
} from "@/lib/attention/notify-live";

export type CoworkerReachabilityResult = {
  agentId: string;
  displayName: string;
  sensitivity: string;
  ready: boolean;
  reason: string;
  escalated?: { sensitivity: string; ready: boolean; reason: string };
};

const ALERT_LABELS = {
  alertname: "CoworkerRoutingUnreachable",
  service: "ai-routing",
  severity: "critical",
} as const;

const SENSITIVE_ALERT_LABELS = {
  alertname: "CoworkerSensitiveRoutingUnreachable",
  service: "ai-routing",
  severity: "warning",
} as const;

/** Reuse the health issue lifecycle and attention deduplication for both
 * declared-route failure and conditional sensitive-route failure. Resolution
 * errors must reach the scheduler so it cannot record a false healthy run. */
async function reconcileRoutingIssue(input: {
  labels: typeof ALERT_LABELS | typeof SENSITIVE_ALERT_LABELS;
  affected: CoworkerReachabilityResult[];
  summary: string;
  description: string;
  title: string;
  itemKey: string;
  riskClass: "high" | "medium";
}): Promise<void> {
  if (input.affected.length === 0) {
    await resolveHealthAlertIssue(prisma as never, healthAlertIssueKey({ ...input.labels }));
    return;
  }
  await upsertHealthAlertIssue(prisma as never, {
    labels: { ...input.labels },
    annotations: { summary: input.summary, description: input.description },
    activeAt: new Date().toISOString(),
    sourceSystem: "routing-preflight",
  });
  const ownerUserId = await resolveOperatorRecipient();
  if (ownerUserId) await notifyAttentionLive({
    source: "platform-health", itemKey: input.itemKey, userId: ownerUserId,
    title: input.title, body: input.summary,
    deepLink: "/platform/ai/runtime-health", riskClass: input.riskClass,
  });
}

/** Project route readiness for every production coworker. */
export async function computeCoworkerRoutingReachability(): Promise<
  CoworkerReachabilityResult[]
> {
  const [agents, configs] = await Promise.all([
    prisma.agent.findMany({
      where: { status: "active", archived: false, lifecycleStage: "production" },
      select: { agentId: true, displayName: true, sensitivity: true },
      orderBy: { agentId: "asc" },
    }),
    prisma.agentModelConfig.findMany({
      select: {
        agentId: true,
        minimumTier: true,
        pinnedProviderId: true,
        pinnedModelId: true,
        budgetClass: true,
        minimumCapabilities: true,
        minimumContextTokens: true,
      },
    }),
  ]);
  const configByAgent = new Map(configs.map((c) => [c.agentId, c] as const));
  const snapshot = await loadCoworkerRoutingReadinessSnapshot(
    agents.map((a) => a.agentId),
  );

  const results: CoworkerReachabilityResult[] = [];
  for (const agent of agents) {
    const config = configByAgent.get(agent.agentId);
    const routeConfig: CoworkerRouteConfiguration = {
      agentId: agent.agentId,
      sensitivity: agent.sensitivity,
      minimumTier: config?.minimumTier ?? "adequate",
      pinnedProviderId: config?.pinnedProviderId ?? null,
      pinnedModelId: config?.pinnedModelId ?? null,
      budgetClass: config?.budgetClass ?? "balanced",
      minimumCapabilities: config?.minimumCapabilities ?? null,
      minimumContextTokens: config?.minimumContextTokens ?? null,
    };
    const readiness = await projectCoworkerRouteReadiness(routeConfig, snapshot);
    results.push({
      agentId: agent.agentId,
      displayName: agent.displayName,
      sensitivity: agent.sensitivity,
      ready: readiness.ready,
      reason: readiness.reason,
      ...(readiness.escalated ? { escalated: readiness.escalated } : {}),
    });
  }
  return results;
}

/**
 * Run the preflight: compute reachability, then raise or resolve the
 * owner-visible issues. Returns a summary for the scheduled-job stamp.
 */
export async function runRoutingReachabilityPreflight(): Promise<{
  checked: number;
  blocked: CoworkerReachabilityResult[];
  escalationBlocked: CoworkerReachabilityResult[];
}> {
  const results = await computeCoworkerRoutingReachability();
  const blocked = results.filter((r) => !r.ready);
  const escalationBlocked = results.filter((r) => r.ready && r.escalated?.ready === false);
  const names = blocked.map((b) => b.displayName).join(", ");
  const summary =
    `${blocked.length} AI coworker${blocked.length === 1 ? " has" : "s have"} no eligible AI model — ` +
    `their turns will fail until routing is repaired: ${names}`;
  await reconcileRoutingIssue({
    labels: ALERT_LABELS, affected: blocked, summary,
    description: blocked.map((b) => `${b.displayName} (${b.agentId}): ${b.reason}`).join("\n"),
    title: `${blocked.length} AI coworker${blocked.length === 1 ? "" : "s"} cannot reach any AI model`,
    itemKey: "routing-preflight", riskClass: "high",
  });
  await reconcileRoutingIssue({
    labels: SENSITIVE_ALERT_LABELS, affected: escalationBlocked,
    summary: `${escalationBlocked.length} AI coworkers can route ordinary requests but have no eligible model for sensitive requests: ${escalationBlocked.map((b) => b.displayName).join(", ")}`,
    description: escalationBlocked.map((b) => `${b.displayName} (${b.agentId}) — ${b.escalated!.sensitivity}: ${b.escalated!.reason}`).join("\n"),
    title: `${escalationBlocked.length} AI coworkers cannot route sensitive requests`,
    itemKey: "routing-preflight-sensitive", riskClass: "medium",
  });
  return { checked: results.length, blocked, escalationBlocked };
}
