import type { PrismaClient } from "../../../packages/db/generated/client/client";
import { createServer } from "node:http";
import { isDeepStrictEqual } from "node:util";

/** This fixture may mutate only the disposable services declared by the UX job. */
export function assertProviderQuotaFixtureRuntime(env: Readonly<Record<string, string | undefined>>) {
  const sourceSha = env.GITHUB_SHA ?? "", runId = env.GITHUB_RUN_ID ?? "", attempt = env.GITHUB_RUN_ATTEMPT ?? "1";
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" || env.DPF_PROVIDER_QUOTA_SCENARIO_CI !== "1"
    || !/^[a-f0-9]{40}$/.test(sourceSha) || !/^\d+$/.test(runId) || !/^\d+$/.test(attempt))
    throw new Error("Provider recovery fixtures require the explicitly opted-in GitHub UX runtime");
  const db = new URL(env.DATABASE_URL ?? ""), target = new URL(env.UX_SWEEP_BASE_URL ?? "");
  if (db.protocol !== "postgresql:" || db.hostname !== "localhost" || db.port !== "5432" || db.pathname !== "/dpf"
    || db.username !== "dpf" || db.password !== "ci_test_password" || db.search || db.hash
    || target.origin !== "http://localhost:3000" || target.pathname !== "/" || target.search || target.hash || target.username || target.password)
    throw new Error("Provider recovery fixtures refuse targets outside the isolated CI services");
  return { sourceSha, origin: target.origin, runKey: `ux-provider-quota-${runId}-${attempt}` };
}

/** Synthetic transport only: no upstream account, tool, business prompt or spend. */
export async function startQuotaFixtureTransport(modelId: string) {
  assertProviderQuotaFixtureRuntime(process.env);
  let completed = false, requests = 0, rejected = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 4096) { rejected++; response.writeHead(413).end(); return; }
      chunks.push(Buffer.from(chunk));
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { rejected++; response.writeHead(400).end(); return; }
    const expected = { model: modelId, instructions: "Reply with OK only.", input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }],
      store: false, stream: true, reasoning: { effort: "low" } };
    if (request.method !== "POST" || request.url !== "/codex/responses" || !isDeepStrictEqual(body, expected)) {
      rejected++; response.writeHead(400).end(); return;
    }
    requests++;
    if (!completed) { response.writeHead(429, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "Synthetic fixture limit" } })); return; }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end('data: {"type":"response.completed","response":{"status":"completed"}}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Synthetic transport has no loopback listener");
  return { baseUrl: `http://127.0.0.1:${address.port}`, succeed: (value: boolean) => { completed = value; },
    counts: () => ({ requests, rejected }), close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

export async function prepareProviderQuotaFixtures(db: PrismaClient, baseUrl: string) {
  const runtime = assertProviderQuotaFixtureRuntime(process.env);
  const endpoint = new URL(baseUrl);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port || endpoint.pathname !== "/" || endpoint.search || endpoint.hash)
    throw new Error("Synthetic transport must be loopback only");
  const prefix = runtime.runKey + "-", connectionId = "provider-default-chatgpt", modelId = prefix + "model";
  const credentialId = prefix + "credential", healthId = prefix + "health", quotaId = prefix + "quota";
  const jobId = "subscription-quota-recovery:" + connectionId;
  const prior = await db.$transaction(async tx => {
    const provider = await tx.modelProvider.findUniqueOrThrow({ where: { providerId: "chatgpt" }, select: { status: true, baseUrl: true, updatedAt: true } });
    const account = await tx.aiProviderConnection.findUnique({ where: { connectionId }, select: { id: true, organizationId: true, label: true, status: true,
      authMethod: true, executionChannel: true, credentialEntryId: true, capacityStatusId: true, quotaStatusId: true, updatedAt: true } });
    const credentialCount = await tx.credentialEntry.count({ where: { providerId: { in: ["chatgpt", "codex"] },
      OR: [{ cachedToken: { not: null } }, { refreshToken: { not: null } }, { secretRef: { not: null } }, { clientSecret: { not: null } }] } });
    if (["active", "degraded"].includes(provider.status) || credentialCount
      || await tx.credentialEntry.count({ where: { providerId: "chatgpt" } })
      || account && (account.organizationId !== null || account.credentialEntryId
      || account.capacityStatusId || account.quotaStatusId || account.status !== "unconfigured")
      || account && await tx.providerCapacityStatus.count({ where: { ownedAccountId: account.id } })
      || await tx.scheduledJob.count({ where: { jobId } }) || await tx.providerCapacityStatus.count({ where: { providerId: "codex" } })
      || await tx.providerCapacityStatus.count({ where: { id: { in: [healthId, quotaId] } } })
      || await tx.modelProfile.count({ where: { modelId } }) || await tx.credentialEntry.count({ where: { id: credentialId } }))
      throw new Error("Provider fixture refuses configured state or an identity collision");
    const maintenance = await tx.scheduledJob.findMany({ where: { jobId: { in: ["provider-registry-sync", "provider-catalog-reconciliation"] } }, select: { jobId: true, schedule: true, updatedAt: true } });
    for (const row of maintenance) await tx.scheduledJob.update({ where: { jobId: row.jobId }, data: { schedule: "disabled" } });
    // The page may create the catalog job on first render. Ensure it cannot discover remotely.
    if (!maintenance.some(row => row.jobId === "provider-catalog-reconciliation")) await tx.scheduledJob.create({
      data: { jobId: "provider-catalog-reconciliation", name: "CI catalog fixture", schedule: "disabled" } });
    await tx.credentialEntry.create({ data: { id: credentialId, providerId: "chatgpt", status: "ok", cachedToken: "synthetic-ui-token", tokenExpiresAt: new Date(Date.now() + 86400_000) } });
    const data = { label: "Recovery verification account", status: "active", authMethod: "oauth", executionChannel: "direct-api", credentialEntryId: credentialId };
    const owned = account ? await tx.aiProviderConnection.update({ where: { connectionId }, data })
      : await tx.aiProviderConnection.create({ data: { connectionId, providerId: "chatgpt", ...data } });
    await tx.modelProvider.update({ where: { providerId: "chatgpt" }, data: { status: "active", baseUrl } });
    await tx.modelProfile.create({ data: { providerId: "chatgpt", modelId, friendlyName: "Recovery verification model", summary: "Synthetic CI model", capabilityCategory: "general",
      modelClass: "chat", modelStatus: "active", costTier: "subscription", generatedBy: prefix, bestFor: [], avoidFor: [] } });
    await tx.providerCapacityStatus.create({ data: { id: quotaId, providerId: "codex", state: "quota_resets_at", action: "retry_at", source: "cli", confidence: "exact",
      safeSummary: "Synthetic weekly subscription forecast", retryAt: new Date(Date.now() + 7 * 86400_000) } });
    await tx.scheduledJob.create({ data: { jobId, name: "Subscription capacity recheck", schedule: "once", nextRunAt: new Date(Date.now() + 3600_000),
      lastRunAt: new Date(Date.now() - 120_000), metadata: { kind: "subscription-quota-recovery", version: 1, modelId, hourly: true } } });
    return { provider, account, accountId: owned.id, maintenance };
  });
  return { ...runtime, prefix, connectionId, modelId, credentialId, healthId, quotaId, jobId, prior };
}
export type ProviderQuotaFixture = Awaited<ReturnType<typeof prepareProviderQuotaFixtures>>;

export async function resetProviderQuotaFixture(db: PrismaClient, fixture: ProviderQuotaFixture, status: "active" | "paused" | "reauth_required") {
  const { Prisma } = await import("@dpf/db");
  const { accountCapacityScope, capacityCredentialRevision } = await import("../lib/routing/provider-capacity/scopes");
  await db.aiProviderConnection.update({ where: { connectionId: fixture.connectionId, credentialEntryId: fixture.credentialId }, data: { status: status === "paused" ? "paused" : "active" } });
  const credential = await db.credentialEntry.findUniqueOrThrow({ where: { id: fixture.credentialId } });
  const data = { state: status === "reauth_required" ? "reauth_required" : "available", action: status === "reauth_required" ? "reconnect" : "none",
    safeSummary: status === "reauth_required" ? "Synthetic sign-in restriction" : "Synthetic account health", source: "oauth", confidence: "exact",
    observedCredentialRevision: capacityCredentialRevision(credential), executionProof: Prisma.DbNull };
  await db.providerCapacityStatus.upsert({ where: { id: fixture.healthId }, update: data,
    create: { id: fixture.healthId, scopeKey: accountCapacityScope("chatgpt", fixture.prior.accountId), ownedAccountId: fixture.prior.accountId, ...data } });
  await db.aiProviderConnection.update({ where: { connectionId: fixture.connectionId, credentialEntryId: fixture.credentialId }, data: { capacityStatusId: fixture.healthId } });
  await db.scheduledJob.update({ where: { jobId: fixture.jobId }, data: { lastStatus: "unconfirmed", lastRunAt: new Date(Date.now() - 120_000),
    nextRunAt: new Date(Date.now() + 3600_000), lastRunSummary: "Synthetic prior check did not confirm capacity.",
    metadata: { kind: "subscription-quota-recovery", version: 1, modelId: fixture.modelId, hourly: true } } });
}

export async function cleanupProviderQuotaFixtures(db: PrismaClient, fixture: ProviderQuotaFixture) {
  assertProviderQuotaFixtureRuntime(process.env);
  await db.$transaction(async tx => {
    const owned = await tx.aiProviderConnection.findUnique({ where: { connectionId: fixture.connectionId } });
    if (!owned || owned.id !== fixture.prior.accountId || owned.credentialEntryId !== fixture.credentialId) throw new Error("Provider fixture ownership changed; cleanup refused");
    if (fixture.prior.account) {
      const { id: _id, organizationId: _organizationId, ...data } = fixture.prior.account;
      await tx.aiProviderConnection.update({ where: { connectionId: fixture.connectionId }, data });
    } else await tx.aiProviderConnection.delete({ where: { connectionId: fixture.connectionId } });
    await tx.providerCapacityStatus.deleteMany({ where: { id: { in: [fixture.healthId, fixture.quotaId] } } });
    await tx.modelProfile.deleteMany({ where: { providerId: "chatgpt", modelId: fixture.modelId, generatedBy: fixture.prefix } });
    await tx.credentialEntry.deleteMany({ where: { id: fixture.credentialId } });
    await tx.scheduledJob.deleteMany({ where: { jobId: fixture.jobId } });
    await tx.modelProvider.update({ where: { providerId: "chatgpt" }, data: fixture.prior.provider });
    for (const row of fixture.prior.maintenance) { const { jobId, ...data } = row; await tx.scheduledJob.update({ where: { jobId }, data }); }
    if (!fixture.prior.maintenance.some(row => row.jobId === "provider-catalog-reconciliation"))
      await tx.scheduledJob.deleteMany({ where: { jobId: "provider-catalog-reconciliation", name: "CI catalog fixture", schedule: "disabled" } });
  });
}
