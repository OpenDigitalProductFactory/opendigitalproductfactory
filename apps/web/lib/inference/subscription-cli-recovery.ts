import { prisma, Prisma } from "@dpf/db";
import { resolveCodexCatalogAuth } from "./codex-cli-catalog-auth";
import { readCodexCliCapacity } from "@/lib/routing/codex-cli-capacity";
import { captureExecutionProofBinding } from "@/lib/routing/provider-capacity/execution-proof.server";
import { currentExecutionProof, QUOTA_PROOF_TTL_MS } from "@/lib/routing/provider-capacity/execution-proof";
import { isRecord } from "@/lib/shared/coerce";

/** Reconcile only captured CLI generations, after a current matching account-wide observation. */
export async function reconcileSubscriptionCliQuota(connectionId: string, modelId: string, beforeDispatch: () => Promise<void>,
  execution: { jobId: string; runCursor: string; scheduled: boolean }) {
  const captured = await captureExecutionProofBinding(connectionId, modelId);
  if (!captured) return false;
  const login = await resolveCodexCatalogAuth(captured.binding.providerId, connectionId);
  if (login.type !== "chatgptAuthTokens") return false;
  // These are the two default identities the legacy CLI writer shares a hold across.
  // Require the sibling's actual account identity before reconciling its forecast.
  const siblingProvider = captured.binding.providerId === "chatgpt" ? "codex" : "chatgpt";
  const siblingBefore = await prisma.aiProviderConnection.findUnique({ where: { connectionId: `provider-default-${siblingProvider}` },
    select: { id: true, status: true, updatedAt: true, credentialEntryId: true, credentialEntry: { select: { updatedAt: true } } } });
  let siblingMatches = false;
  try {
    const sibling = await resolveCodexCatalogAuth(siblingProvider, `provider-default-${siblingProvider}`);
    siblingMatches = !!siblingBefore && sibling.type === "chatgptAuthTokens" && sibling.chatgptAccountId === login.chatgptAccountId;
  } catch { /* Unavailable sibling retains its own hold. */ }
  if (siblingBefore && !siblingMatches) return false;
  const targets = siblingMatches ? ["chatgpt", "codex"] : [captured.binding.providerId];
  // Existing pool writers conservatively share provider scope. With additional
  // accounts we cannot attribute that old hold to the selected upstream account.
  const accounts = await prisma.aiProviderConnection.findMany({ where: { providerId: { in: ["chatgpt", "codex"] } }, select: { connectionId: true } });
  if (accounts.some(account => !["provider-default-chatgpt", "provider-default-codex"].includes(account.connectionId))) return false;
  const pools = await prisma.cliPoolStatus.findMany({ where: { providerId: { in: targets } } });
  const capacities = await prisma.providerCapacityStatus.findMany({ where: { providerId: { in: targets }, ownedAccountId: null, source: "cli" } });
  const inScope = (capacity: typeof capacities[number]) => targets.includes(capacity.providerId ?? "")
    && capacity.ownedAccountId === null && capacity.scopeKey === null && capacity.source === "cli";
  const quotaForecasts = capacities.filter(capacity => inScope(capacity) && capacity.state === "quota_resets_at" && capacity.retryAt);
  // Account allocation does not prove that an independent request-throttle
  // Retry-After ended. Unknown pool deadlines remain authoritative as well.
  if (!quotaForecasts.length || capacities.some(capacity => inScope(capacity)
    && ["rate_limited", "cooling_down"].includes(capacity.state) && capacity.retryAt && capacity.retryAt.getTime() > Date.now())) return false;
  const poolInScope = (pool: typeof pools[number]) => targets.includes(pool.providerId)
    && (pool.adapterType === "codex-cli" || pool.adapterKind === "codex")
    && (pool.scopeKey === null || pool.scopeKey === "cli:codex-cli:provider:codex");
  const matchingPools = pools.filter(pool => poolInScope(pool) && pool.resetAt
    && quotaForecasts.some(capacity => capacity.retryAt!.getTime() === pool.resetAt!.getTime()));
  if (pools.some(pool => poolInScope(pool) && pool.resetAt && pool.resetAt.getTime() > Date.now()
    && !matchingPools.some(matching => matching.id === pool.id))) return false;
  await beforeDispatch();
  if (!await readCodexCliCapacity(login)) return false;
  await beforeDispatch();
  const observedAt = Date.now();
  return prisma.$transaction(async tx => {
    const [job] = await tx.$queryRaw<Array<{ enabled: boolean; schedule: string; runCursor: string | null; metadata: unknown }>>`
      SELECT enabled, schedule, "runCursor", metadata FROM "ScheduledJob" WHERE "jobId"=${execution.jobId} FOR UPDATE`;
    if (!job?.enabled || job.schedule === "disabled" || job.runCursor !== execution.runCursor
      || execution.scheduled && (!isRecord(job.metadata) || job.metadata.hourly !== true)) return false;
    await tx.$queryRaw`SELECT a.id FROM "AiProviderConnection" a JOIN "CredentialEntry" c ON c.id=a."credentialEntryId"
      WHERE a."providerId" IN ('codex','chatgpt') FOR UPDATE OF a, c`;
    const currentAccounts = await tx.aiProviderConnection.findMany({ where: { providerId: { in: ["chatgpt", "codex"] } }, select: { connectionId: true } });
    if (currentAccounts.some(account => !["provider-default-chatgpt", "provider-default-codex"].includes(account.connectionId))) return false;
    const current = await captureExecutionProofBinding(connectionId, modelId, tx);
    if (!current || !currentExecutionProof({ version: 1, ...captured.binding, observedAt, expiresAt: observedAt + QUOTA_PROOF_TTL_MS }, current.binding, observedAt)) return false;
    if (siblingMatches) {
      const siblingCurrent = await tx.aiProviderConnection.findUnique({ where: { id: siblingBefore!.id },
        select: { status: true, updatedAt: true, credentialEntryId: true, credentialEntry: { select: { updatedAt: true } } } });
      if (!siblingCurrent || siblingCurrent.status !== "active"
        || siblingCurrent.updatedAt.getTime() !== siblingBefore!.updatedAt.getTime()
        || siblingCurrent.credentialEntryId !== siblingBefore!.credentialEntryId
        || siblingCurrent.credentialEntry?.updatedAt.getTime() !== siblingBefore!.credentialEntry?.updatedAt.getTime()) return false;
    }
    for (const pool of matchingPools) {
      const result = await tx.cliPoolStatus.updateMany({ where: { id: pool.id, updatedAt: pool.updatedAt },
        data: { resetAt: null, retryAfterSeconds: null, errorSnippet: null } });
      if (result.count !== 1) throw new Error("CLI capacity changed during observation");
    }
    for (const capacity of quotaForecasts) {
      const result = await tx.providerCapacityStatus.updateMany({ where: { id: capacity.id, updatedAt: capacity.updatedAt, source: "cli", state: capacity.state },
        data: { state: "available", action: "none", retryAt: null, retryAfterSeconds: null, lastObservedAt: new Date(observedAt),
          safeSummary: "A current coding-tool usage check reports capacity available.", confidence: "exact", isHumanActionRequired: false } });
      if (result.count !== 1) throw new Error("Provider capacity changed during observation");
    }
    return true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
}
