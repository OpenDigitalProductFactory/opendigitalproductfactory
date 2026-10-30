import { createHash } from "node:crypto";
import { prisma, Prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { accountExecutionVersion } from "../provider-account-candidates";
import { accountCapacityScope, capacityCredentialRevision, isAccountCapacityState } from "./scopes";
import { isActiveDefaultSubscription } from "@/lib/inference/active-provider-account-verification";
import { buildResponsesUrl } from "../responses-contract";
import { currentExecutionProof, QUOTA_PROOF_TTL_MS, type ExecutionProofBinding, type ExecutionProof } from "./execution-proof";
import { capacityRoutingExclusionReason } from "../capacity-routing-exclude";
import { isProviderQuotaState } from "./types";

type Db = Pick<Prisma.TransactionClient, "aiProviderConnection" | "modelProfile" | "modelProvider" | "providerCapacityStatus" | "cliPoolStatus">;
/** Canonical object ordering, with Date values explicitly normalized first. */
function digest(value: unknown) {
  return createHash("sha256").update(canonicalJson(JSON.parse(JSON.stringify(value)))).digest("hex");
}

export async function captureExecutionProofBinding(connectionId: string, modelId: string, db: Db = prisma) {
  const account = await db.aiProviderConnection.findUnique({ where: { connectionId }, include: { credentialEntry: true, provider: true } });
  if (!isActiveDefaultSubscription(account) || !account.credentialEntry || account.credentialEntry.status !== "ok"
    || !["active", "degraded"].includes(account.provider.status) || ["expired", "rejected"].includes(account.evidenceStatus)) return null;
  const [model, capacities, pools, subscription] = await Promise.all([
    db.modelProfile.findFirst({ where: { providerId: account.providerId, modelId, modelStatus: "active" } }),
    db.providerCapacityStatus.findMany({ where: { OR: [{ providerId: { in: ["chatgpt", "codex"] } }, { ownedAccountId: account.id }] },
      select: { id: true, providerId: true, ownedAccountId: true, state: true, retryAt: true, lastObservedAt: true, updatedAt: true, observedCredentialRevision: true } }),
    db.cliPoolStatus.findMany({ where: { providerId: { in: ["chatgpt", "codex"] } },
      select: { id: true, adapterType: true, scopeKey: true, rateLimitedAt: true, resetAt: true, retryAfterSeconds: true, updatedAt: true } }),
    account.providerId === "codex" ? db.modelProvider.findUnique({ where: { providerId: "chatgpt" } }) : Promise.resolve(null),
  ]);
  if (!model) return null;
  // A quota check cannot remove a sign-in/billing/plan refusal on this account.
  if (capacities.some(row => (isAccountCapacityState(row.state) || !isProviderQuotaState(row.state)
    && capacityRoutingExclusionReason({ state: row.state, retryAtMs: row.retryAt?.getTime(), observedAtMs: row.lastObservedAt.getTime() }, Date.now()))
    && (row.ownedAccountId === account.id || row.providerId === account.providerId))) return null;
  const quotaRows = capacities.filter(row => row.state !== "available").sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const baseUrl = account.providerId === "codex" ? subscription?.baseUrl ?? subscription?.endpoint ?? "https://chatgpt.com/backend-api"
    : account.provider.baseUrl ?? account.provider.endpoint ?? "";
  if (!baseUrl) return null;
  const binding: ExecutionProofBinding = { providerId: account.providerId, connectionId, modelId, adapter: "responses",
    accountVersion: accountExecutionVersion(account), credentialRevision: capacityCredentialRevision(account.credentialEntry),
    modelRevision: digest(model), endpointRevision: digest({ url: buildResponsesUrl(account.providerId, baseUrl),
      adapter: "responses", providerUpdatedAt: account.provider.updatedAt, subscriptionUpdatedAt: subscription?.updatedAt ?? null }),
    quotaRevision: digest({ capacities: quotaRows, pools: pools.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }) };
  return { accountId: account.id, binding, quotaRows, resetTimes: [...quotaRows.map(row => row.retryAt), ...pools.map(row => row.resetAt)],
    hasQuota: quotaRows.some(row => isProviderQuotaState(row.state) && capacityRoutingExclusionReason({ state: row.state, retryAtMs: row.retryAt?.getTime(), observedAtMs: row.lastObservedAt.getTime() }, Date.now()))
      || pools.some(row => row.resetAt ? row.resetAt.getTime() > Date.now() : row.rateLimitedAt.getTime() + 3600_000 > Date.now()) };
}

export async function readCurrentExecutionProof(connectionId: string, modelId: string, value: unknown, now = Date.now(), db: Db = prisma): Promise<ExecutionProof | null> {
  const current = await captureExecutionProofBinding(connectionId, modelId, db);
  return current ? currentExecutionProof(value, current.binding, now) : null;
}

/** No network or broad quota mutation in this short conditional transaction. */
export async function persistExecutionProof(expected: NonNullable<Awaited<ReturnType<typeof captureExecutionProofBinding>>>, observedAt: number, execution?: { jobId: string; runCursor: string }) {
  const proof: ExecutionProof = { version: 1, ...expected.binding, observedAt, expiresAt: observedAt + QUOTA_PROOF_TTL_MS };
  return prisma.$transaction(async tx => {
    if (execution) {
      const [job] = await tx.$queryRaw<Array<{ enabled: boolean; schedule: string; runCursor: string | null }>>`SELECT enabled, schedule, "runCursor" FROM "ScheduledJob" WHERE "jobId"=${execution.jobId} FOR UPDATE`;
      if (!job?.enabled || job.schedule === "disabled" || job.runCursor !== execution.runCursor) return false;
    }
    // Same lock ordering as ordinary account health writers, before re-reading.
    await tx.$queryRaw`SELECT a.id FROM "AiProviderConnection" a JOIN "CredentialEntry" c ON c.id=a."credentialEntryId"
      WHERE a.id=${expected.accountId} FOR UPDATE OF a, c`;
    const current = await captureExecutionProofBinding(expected.binding.connectionId, expected.binding.modelId, tx);
    if (!current || current.accountId !== expected.accountId || !currentExecutionProof(proof, current.binding, Date.now())) return false;
    const scopeKey = accountCapacityScope(proof.providerId, expected.accountId);
    const data = { state: "available", action: "none", safeSummary: "The selected model completed a capacity check.", confidence: "exact",
      source: "oauth", isHumanActionRequired: false, lastObservedAt: new Date(observedAt), lastSuccessAt: new Date(observedAt),
      retryAt: null, retryAfterSeconds: null, observedCredentialRevision: proof.credentialRevision, executionProof: proof as Prisma.InputJsonValue };
    const row = await tx.providerCapacityStatus.upsert({ where: { scopeKey }, create: { scopeKey, ownedAccountId: expected.accountId, ...data }, update: data });
    await tx.aiProviderConnection.update({ where: { id: expected.accountId }, data: { capacityStatusId: row.id } });
    return true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
}

/** Any failed new observation invalidates the older exact proof, never another owner. */
export async function invalidateExecutionProof(connectionId: string, credentialRevision: string) {
  await prisma.providerCapacityStatus.updateMany({ where: { ownedAccount: { is: { connectionId } }, observedCredentialRevision: credentialRevision },
    data: { executionProof: Prisma.DbNull } });
}
