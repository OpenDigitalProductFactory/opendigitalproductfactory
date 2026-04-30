import { resolveAIDocForAgent } from "@/lib/identity/aidoc-resolver";
import type { GaidAuthorizationClass } from "@/lib/identity/authorization-classes";
import {
  formatFactsAsContext,
  formatFactsCompressed,
  loadGovernedUserFacts,
} from "@/lib/tak/user-facts";
import { recallGovernedContext } from "@/lib/semantic-memory";

const CONSEQUENTIAL_AUTHORIZATION_CLASSES = new Set<GaidAuthorizationClass>([
  "create",
  "update",
  "approve",
  "execute",
  "delegate",
  "administer",
  "cross-boundary",
]);

function classifyMemoryActionRisk(classes: GaidAuthorizationClass[]) {
  return classes.some((authClass) => CONSEQUENTIAL_AUTHORIZATION_CLASSES.has(authClass))
    ? "consequential"
    : "advisory";
}

export async function buildGovernedMemoryContext(params: {
  userId: string;
  agentId: string;
  routeContext?: string;
  query: string;
  currentThreadId?: string;
  limit?: number;
  excludeMessageIds?: Set<string>;
}): Promise<{
  actionRisk: "advisory" | "consequential";
  authorizationClasses: GaidAuthorizationClass[];
  operatingProfileFingerprint: string | null;
  factsContext: string | null;
  factsCompressed: string | null;
  recalledContext: string | null;
  compressedRecall: string | null;
  userFacts: Awaited<ReturnType<typeof loadGovernedUserFacts>>;
  recall: Awaited<ReturnType<typeof recallGovernedContext>>;
}> {
  const aidoc = await resolveAIDocForAgent(params.agentId).catch(() => null);
  const authorizationClasses = aidoc?.authorization_classes ?? [];
  const actionRisk = classifyMemoryActionRisk(authorizationClasses);
  const operatingProfileFingerprint = aidoc?.operating_profile_fingerprint ?? null;
  const routeDomain = params.routeContext?.replace(/^\//, "").split("/")[0] || undefined;

  const userFacts = await loadGovernedUserFacts({
    userId: params.userId,
    routeDomain,
    currentOperatingProfileFingerprint: operatingProfileFingerprint,
    actionRisk,
  }).catch(() => ({
    facts: [],
    includedFacts: [],
    excludedFacts: [],
    counts: {
      total: 0,
      current: 0,
      pendingRevalidation: 0,
      legacyUntracked: 0,
    },
  }));

  const recall = await recallGovernedContext({
    query: params.query,
    userId: params.userId,
    currentThreadId: params.currentThreadId,
    routeContext: params.routeContext,
    limit: params.limit,
    excludeMessageIds: params.excludeMessageIds,
    currentOperatingProfileFingerprint: operatingProfileFingerprint,
    actionRisk,
  }).catch(() => ({
    context: null,
    compressedContext: null,
    counts: {
      included: 0,
      withheld: 0,
      current: 0,
      legacy: 0,
    },
  }));

  return {
    actionRisk,
    authorizationClasses,
    operatingProfileFingerprint,
    factsContext: formatFactsAsContext(userFacts.includedFacts),
    factsCompressed: formatFactsCompressed(userFacts.includedFacts),
    recalledContext: recall.context,
    compressedRecall: recall.compressedContext,
    userFacts,
    recall,
  };
}
