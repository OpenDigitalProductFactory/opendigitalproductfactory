import type { PrismaClient } from "../../../packages/db/generated/client/client";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isRecord } from "../lib/shared/coerce";
import { readWorkroomPostureClaim } from "../lib/work-management/workroom-posture-claim";
import { TERMINAL_TASK_STATE_LIST } from "../lib/tak/task-states";
import { FOREGROUND_WORK_EVENT } from "../lib/agent/foreground-work-contract";

/** Explicit opt-in to the existing disposable GitHub runtime, before any I/O. */
export function assertForegroundFixtureRuntime(env: Readonly<Record<string, string | undefined>>) {
  const sourceSha = env.GITHUB_SHA ?? "", runId = env.GITHUB_RUN_ID ?? "", attempt = env.GITHUB_RUN_ATTEMPT ?? "1";
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" || env.DPF_FOREGROUND_RECOVERY_SCENARIO_CI !== "1"
    || !/^[a-f0-9]{40}$/.test(sourceSha) || !/^\d+$/.test(runId) || !/^\d+$/.test(attempt))
    throw new Error("Foreground fixtures require the explicitly selected GitHub CI runtime");
  const db = new URL(env.DATABASE_URL ?? ""), target = new URL(env.UX_SWEEP_BASE_URL ?? "");
  if (db.protocol !== "postgresql:" || db.hostname !== "localhost" || db.port !== "5432" || db.pathname !== "/dpf"
    || db.username !== "dpf" || db.password !== "ci_test_password" || db.search || db.hash
    || target.origin !== "http://localhost:3000" || target.pathname !== "/" || target.search || target.hash || target.username || target.password)
    throw new Error("Foreground fixtures refuse targets outside isolated CI services");
  return { sourceSha, origin: target.origin, runKey: `foreground-recovery-${runId}-${attempt}` };
}

/** Emit stable codes only; database errors may contain private connection data. */
export function foregroundIsolationFailure(error: unknown): { reason: string; databaseCode?: string } {
  const reasons = new Map(Object.entries({
    "Foreground fixtures require the explicitly selected GitHub CI runtime": "runtime-not-admitted",
    "Foreground fixtures refuse targets outside isolated CI services": "target-not-isolated",
    "Foreground fixture refuses unrelated runnable tasks or retained work": "existing-runnable-work",
    "Foreground fixture refuses unreadable proactivity intent": "unreadable-proactivity",
    "Foreground fixture refuses latent proactive work": "latent-proactive-work",
    "Foreground fixture refuses live room cadences": "live-room-cadence",
    "Existing queue work prevents isolated startup": "existing-queue-work",
    "Foreground fixture refuses seed configuration or execution history": "seed-state-not-pristine",
  }));
  const reason = error instanceof Error ? reasons.get(error.message) : undefined;
  const code = isRecord(error) && typeof error.code === "string" && /^P\d{4}$/.test(error.code) ? error.code : undefined;
  return { reason: reason ?? "unexpected-isolation-error", ...(code ? { databaseCode: code } : {}) };
}

/** A completed cron run can still contain an unavailable reconciliation step. */
export function hasSuccessfulForegroundReconciliation(runs: ReadonlyArray<{ steps: ReadonlyArray<{ output: unknown }> }>) {
  return runs.some(run => run.steps.some(step => isRecord(step.output)
    && step.output.outcome !== "unavailable" && typeof step.output.inspected === "number" && step.output.inspected >= 1));
}

type ScopeDb = Pick<PrismaClient, "scheduledAgentTask" | "taskRun" | "userFact" | "workroomParticipant">;
export async function assertForegroundBackgroundQuiet(db: ScopeDb, allowedTaskRunIds: string[] = []) {
  assertForegroundFixtureRuntime(process.env);
  if (await db.scheduledAgentTask.count({ where: { isActive: true } })
    || await db.taskRun.count({ where: { archivedAt: null, taskRunId: { notIn: allowedTaskRunIds }, status: { notIn: [...TERMINAL_TASK_STATE_LIST] } } }))
    throw new Error("Foreground fixture refuses unrelated runnable tasks or retained work");
  await assertForegroundLatentQuiet(db);
}

async function assertForegroundLatentQuiet(db: ScopeDb) {
  const { PROACTIVITY_FACT_CATEGORY, PROACTIVITY_OVERRIDE_FACT_PREFIX } = await import("../lib/proactivity/proactivity-override-preferences");
  const facts = await db.userFact.findMany({ where: { category: PROACTIVITY_FACT_CATEGORY,
    key: { startsWith: `${PROACTIVITY_OVERRIDE_FACT_PREFIX}:agent:` }, supersededAt: null }, select: { value: true } });
  for (const fact of facts) {
    let value: unknown;
    try { value = JSON.parse(fact.value); } catch { throw new Error("Foreground fixture refuses unreadable proactivity intent"); }
    if (!isRecord(value) || value.level !== "quiet") throw new Error("Foreground fixture refuses latent proactive work");
  }
  const memberships = await db.workroomParticipant.findMany({ where: { lifecycle: "active",
    principal: { aliases: { some: { aliasType: "agent" } } }, workroom: { status: { notIn: ["complete", "abandoned", "archived"] } } },
    select: { workroom: { select: { scopeClaims: true } } } });
  if (memberships.some(member => {
    const level = readWorkroomPostureClaim(member.workroom.scopeClaims)?.proactivityLevel;
    return level !== undefined && level !== "quiet";
  })) throw new Error("Foreground fixture refuses live room cadences");
}

type SeedScheduleDefinition = {
  taskId: string; agentId: string; title: string; prompt: string; routeContext: string; schedule: string;
  timezone: string; ownerUserId: string; taskKind: string | null; taskConfig: unknown;
  organizationId: null; productLineId: null; businessProductId: null;
};

/** Reuse the definitions invoked by the standard seed, rather than duplicating task IDs/prompts. */
export async function foregroundSeedScheduleDefinitions(ownerUserId: string): Promise<SeedScheduleDefinition[]> {
  assertForegroundFixtureRuntime(process.env);
  const definitions: Array<Record<string, unknown>> = await Promise.all([
    import("../../../packages/db/src/discovery-triage-config"), import("../../../packages/db/src/data-model-mirror-config"),
    import("../../../packages/db/src/bookkeeping-cycle-config"), import("../../../packages/db/src/decision-engine-review-config"),
    import("../../../packages/db/src/acceptance-sweep-config"), import("../../../packages/db/src/demand-scoring-steward-config"),
    import("../../../packages/db/src/client-capability-reverify-config"), import("../../../packages/db/src/harness-evolution-loop-config"),
    import("../../../packages/db/src/sysml-projection-config"), import("../../../packages/db/src/self-optimization-sweep-config"),
    import("../../../packages/db/src/hive-scout-config"),
  ]);
  return definitions.map(definition => {
    const idKeys = Object.keys(definition).filter(key => key.endsWith("_TASK_ID"));
    if (idKeys.length !== 1) throw new Error("Foreground fixture refuses seed configuration or execution history");
    const prefix = idKeys[0]!.slice(0, -"_TASK_ID".length);
    const value = (suffix: string) => {
      const result = definition[`${prefix}_${suffix}`];
      if (typeof result !== "string") throw new Error("Foreground fixture refuses seed configuration or execution history");
      return result;
    };
    const builder = definition.buildDiscoveryTriageScheduledPrompt ?? definition.buildHiveScoutScheduledPrompt;
    const prompt = typeof builder === "function" ? builder() as unknown : value("PROMPT");
    if (typeof prompt !== "string") throw new Error("Foreground fixture refuses seed configuration or execution history");
    return { taskId: value("TASK_ID"), agentId: value("AGENT_ID"), title: value("TASK_TITLE"), prompt,
      routeContext: value("ROUTE_CONTEXT"), schedule: value("SCHEDULE"),
      timezone: process.env.INSTALL_TIMEZONE ?? value("DEFAULT_TIMEZONE"), ownerUserId,
      taskKind: typeof definition[`${prefix}_TASK_KIND`] === "string" ? definition[`${prefix}_TASK_KIND`] as string : null,
      taskConfig: definition[`${prefix}_DEFAULT_CONFIG`] ?? null,
      organizationId: null, productLineId: null, businessProductId: null };
  });
}

/** Only this disposable CI seed is suspended; production seed behavior is untouched. */
export async function prepareForegroundTarget(db: PrismaClient) {
  assertForegroundFixtureRuntime(process.env);
  const { findTaskOwnerUserId } = await import("../../../packages/db/src/install-work-owner");
  return db.$transaction(async tx => {
    await assertForegroundLatentQuiet(tx);
    if (await tx.taskRun.count() || await tx.jobRun.count() || await tx.jobEvent.count()
      || await tx.credentialEntry.count({ where: { OR: [{ cachedToken: { not: null } }, { refreshToken: { not: null } },
        { secretRef: { not: null } }, { clientSecret: { not: null } }] } }))
      throw new Error("Foreground fixture refuses seed configuration or execution history");
    const owner = await findTaskOwnerUserId(tx);
    if (!owner) throw new Error("Foreground fixture refuses seed configuration or execution history");
    const expected = new Map((await foregroundSeedScheduleDefinitions(owner)).map(row => [row.taskId, row]));
    const rows = await tx.scheduledAgentTask.findMany({ where: { isActive: true } });
    for (const row of rows) {
      const definition = expected.get(row.taskId);
      if (!definition || Object.entries(definition).some(([key, value]) => !isDeepStrictEqual(row[key as keyof typeof row], value))
        || row.lastRunAt !== null || row.lastStatus !== null || row.lastError !== null || row.lastThreadId !== null || row.taskRunId !== null || row.attempts !== 0)
        throw new Error("Foreground fixture refuses seed configuration or execution history");
    }
    const original = rows.map(row => ({ id: row.id, taskId: row.taskId, isActive: row.isActive }));
    for (const row of rows) {
      const changed = await tx.scheduledAgentTask.updateMany({ where: { id: row.id, taskId: row.taskId,
        ownerUserId: owner, updatedAt: row.updatedAt, isActive: true, lastRunAt: null, lastStatus: null,
        lastError: null, lastThreadId: null, taskRunId: null, attempts: 0 }, data: { isActive: false } });
      if (changed.count !== 1) throw new Error("Foreground fixture refuses seed configuration or execution history");
    }
    await assertForegroundBackgroundQuiet(tx);
    return original;
  }, { isolationLevel: "Serializable", timeout: 30_000 });
}

/** Read actual fanout and run settlement, rather than sleeping past an assumed delay. */
export async function waitForForegroundDelivery(db: Pick<PrismaClient, "jobEvent" | "jobRun">, input: {
  taskRunId: string; beforeEventIds?: string[]; timeoutMs?: number; intervalMs?: number; requireSuccess?: boolean;
}) {
  assertForegroundFixtureRuntime(process.env);
  const before = new Set(input.beforeEventIds ?? []), deadline = Date.now() + (input.timeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    const events = await db.jobEvent.findMany({ where: { name: FOREGROUND_WORK_EVENT, data: { path: ["taskRunId"], equals: input.taskRunId } },
      select: { id: true, fannedOutAt: true } });
    const selected = events.filter(event => !before.has(event.id));
    const runs = await db.jobRun.findMany({ where: { functionKey: "agent/foreground-work-run", eventId: { in: selected.map(event => event.id) } },
      select: { id: true, eventId: true, status: true, output: true } });
    if (input.requireSuccess === false && events.length === 0) return { eventIds: [], runs: [] };
    if (input.requireSuccess !== false && runs.some(run => run.status === "failed" || run.status === "cancelled")) throw new Error("The owned queue delivery did not complete successfully");
    if (selected.length && selected.every(event => event.fannedOutAt && runs.some(run => run.eventId === event.id
      && (input.requireSuccess === false ? ["completed", "failed", "cancelled"].includes(run.status) : run.status === "completed"))))
      return { eventIds: selected.map(event => event.id), runs };
    await new Promise(resolveWait => setTimeout(resolveWait, input.intervalMs ?? 1000));
  }
  throw new Error("Owned queue delivery remains unsettled; fixture state must be preserved");
}

/** Only the external provider is simulated; no upstream, training or charges. */
export async function startForegroundFixtureTransport(input: { modelId: string; marker: string; answer: string }) {
  assertForegroundFixtureRuntime(process.env);
  let available = false, requests = 0, rejected = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 1_048_576) { rejected++; response.writeHead(413).end(); return; }
      chunks.push(Buffer.from(chunk));
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { rejected++; response.writeHead(400).end(); return; }
    if (request.method !== "POST" || request.headers.authorization !== "Bearer synthetic-foreground-api-key"
      || !["/v1/chat/completions", "/chat/completions"].includes(request.url ?? "")
      || !isRecord(body) || body.model !== input.modelId || !JSON.stringify(body.messages ?? null).includes(input.marker)
      || requests >= 50) {
      rejected++; response.writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ error: { message: "Synthetic fixture refuses unrelated inference" } })); return;
    }
    requests++;
    if (!available) {
      response.writeHead(429, { "content-type": "application/json", "retry-after": "1" })
        .end(JSON.stringify({ error: { message: "Synthetic temporary provider capacity limit", code: "rate_limit_exceeded" } })); return;
    }
    const base = { id: "chatcmpl-foreground-fixture", created: Math.floor(Date.now() / 1000), model: input.modelId };
    if (body.stream === true) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: input.answer }, finish_reason: null }] })}\n\n`
        + `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    } else response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ...base, object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: input.answer }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Synthetic provider has no loopback listener");
  return { baseUrl: `http://127.0.0.1:${address.port}`, recover: () => { available = true; },
    counts: () => ({ requests, rejected }), close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

export async function prepareForegroundFixtures(db: PrismaClient, baseUrl: string) {
  const runtime = assertForegroundFixtureRuntime(process.env);
  const target = new URL(baseUrl);
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || !target.port || target.pathname !== "/" || target.search || target.hash)
    throw new Error("Synthetic provider must be loopback only");
  const prefix = runtime.runKey + "-", providerId = "openai", connectionId = "provider-default-openai";
  const modelId = prefix + "model", credentialId = prefix + "credential";
  const prior = await db.$transaction(async tx => {
    await assertForegroundBackgroundQuiet(tx);
    const provider = await tx.modelProvider.findUniqueOrThrow({ where: { providerId }, select: {
      status: true, baseUrl: true, endpoint: true, authHeader: true, authMethod: true, endpointType: true,
      sensitivityClearance: true, supportsToolUse: true, supportsStreaming: true, updatedAt: true,
    } });
    const account = await tx.aiProviderConnection.findUniqueOrThrow({ where: { connectionId }, select: {
      id: true, organizationId: true, status: true, label: true, credentialEntryId: true, executionChannel: true, authMethod: true,
      accountClass: true, commercialBasis: true, entitlements: true, evidenceStatus: true, lastReviewedAt: true,
      accessibleModelIds: true, modelsVerifiedAt: true, capacityStatusId: true, quotaStatusId: true, updatedAt: true,
    } });
    if (["active", "degraded"].includes(provider.status) || account.organizationId || account.credentialEntryId || account.capacityStatusId || account.quotaStatusId || account.status !== "unconfigured"
      || await tx.credentialEntry.count({ where: { providerId } })
      || await tx.credentialEntry.count({ where: { OR: [{ cachedToken: { not: null } }, { refreshToken: { not: null } }, { secretRef: { not: null } }, { clientSecret: { not: null } }] } })
      || await tx.modelProfile.count({ where: { modelId } })
      || await tx.providerCapacityStatus.count({ where: { OR: [{ ownedAccountId: account.id }, { providerId }] } })
      || await tx.scheduledAgentTask.count({ where: { isActive: true } })
      || await tx.taskRun.count({ where: { source: "coworker", archivedAt: null, a2aMetadata: { path: ["foregroundRequest", "schemaVersion"], equals: 1 } } }))
      throw new Error("Foreground fixture refuses configured credentials, retained work or identity collisions");
    const models = await tx.modelProfile.findMany({ where: { providerId }, select: { id: true, modelStatus: true } });
    await tx.modelProfile.updateMany({ where: { providerId }, data: { modelStatus: "inactive" } });
    await tx.credentialEntry.create({ data: { id: credentialId, providerId, status: "ok", secretRef: "synthetic-foreground-api-key" } });
    await tx.modelProvider.update({ where: { providerId }, data: { status: "active", baseUrl, endpoint: baseUrl,
      authHeader: "Authorization", authMethod: "api_key", endpointType: "llm",
      sensitivityClearance: ["public", "development", "internal"], supportsToolUse: true, supportsStreaming: true } });
    await tx.aiProviderConnection.update({ where: { connectionId }, data: {
      status: "active", label: "Synthetic retained-work fixture", credentialEntryId: credentialId, executionChannel: "direct-api", authMethod: "api-key",
      accountClass: "business-team", commercialBasis: "usage-metered", entitlements: { noTraining: true },
      evidenceStatus: "operator-attested", lastReviewedAt: new Date(), accessibleModelIds: [modelId], modelsVerifiedAt: new Date(),
    } });
    // Manual routing inputs for a deterministic fixture, not measured model quality.
    await tx.modelProfile.create({ data: { providerId, modelId, friendlyName: "Synthetic retained-work model", summary: "Loopback CI transport only",
      capabilityCategory: "general", costTier: "free", bestFor: [], avoidFor: [], generatedBy: prefix, modelClass: "chat", modelStatus: "active",
      profileSource: "manual", profileConfidence: "high", qualityTier: "frontier", qualityTierSource: "admin", supportsToolUse: true,
      maxContextTokens: 131072, maxOutputTokens: 4096, inputPricePerMToken: 0, outputPricePerMToken: 0,
      reasoning: 99, codegen: 99, toolFidelity: 99, instructionFollowingScore: 99, structuredOutputScore: 99, conversational: 99, contextRetention: 99,
      capabilities: { toolUse: true, streaming: true, structuredOutput: true },
    } });
    return { provider, account, models };
  });
  return { ...runtime, prefix, providerId, connectionId, modelId, credentialId, prior };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
  && (process.argv.includes("--check-target") || process.argv.includes("--prepare-target"))) {
  void (async () => {
    assertForegroundFixtureRuntime(process.env);
    const { prisma } = await import("@dpf/db");
    try {
      if (process.argv.includes("--prepare-target")) {
        const original = await prepareForegroundTarget(prisma);
        const out = resolve("test-results/foreground-work-recovery");
        mkdirSync(out, { recursive: true });
        writeFileSync(resolve(out, "seed-schedule-fixture.json"), JSON.stringify({ ...assertForegroundFixtureRuntime(process.env),
          original, cleanup: "Discard with the owned disposable CI database; never restore schedules while the worker lives." }, null, 2));
      }
      await assertForegroundBackgroundQuiet(prisma);
      if (await prisma.jobRun.count({ where: { status: { notIn: ["completed", "failed", "cancelled"] } } })
        || await prisma.jobEvent.count({ where: { fannedOutAt: null } })) throw new Error("Existing queue work prevents isolated startup");
      const out = resolve("test-results/foreground-work-recovery");
      mkdirSync(out, { recursive: true });
      writeFileSync(resolve(out, "target-admission.json"), JSON.stringify({ ...assertForegroundFixtureRuntime(process.env), admittedAt: new Date().toISOString() }, null, 2));
    }
    finally { await prisma.$disconnect(); }
  })().catch(error => {
    console.error("Foreground CI target preparation/admission failed.", foregroundIsolationFailure(error));
    process.exitCode = 1;
  });
}
export type ForegroundFixture = Awaited<ReturnType<typeof prepareForegroundFixtures>>;

export async function cleanupForegroundFixtures(db: PrismaClient, fixture: ForegroundFixture, settlement: {
  taskRunIds: string[]; clientSubmissionsSettled: boolean;
}) {
  assertForegroundFixtureRuntime(process.env);
  if (!settlement.clientSubmissionsSettled) throw new Error("Uncertain client submission: preserve the fixture");
  await assertForegroundBackgroundQuiet(db, settlement.taskRunIds);
  if (await db.taskRun.count({ where: { taskRunId: { in: settlement.taskRunIds }, status: { notIn: [...TERMINAL_TASK_STATE_LIST] } } })
    || await db.jobRun.count({ where: { functionKey: "agent/foreground-work-run",
      OR: settlement.taskRunIds.map(taskRunId => ({ event: { path: ["data", "taskRunId"], equals: taskRunId } })),
      status: { notIn: ["completed", "failed", "cancelled"] } } })
    || await db.jobEvent.count({ where: { name: FOREGROUND_WORK_EVENT, fannedOutAt: null,
      OR: settlement.taskRunIds.map(taskRunId => ({ data: { path: ["taskRunId"], equals: taskRunId } })) } }))
    throw new Error("Execution is unsettled: preserve the fixture before restoring provider state");
  const { Prisma } = await import("@dpf/db");
  await db.$transaction(async tx => {
    const account = await tx.aiProviderConnection.findUniqueOrThrow({ where: { connectionId: fixture.connectionId } });
    if (account.id !== fixture.prior.account.id || account.credentialEntryId !== fixture.credentialId)
      throw new Error("Foreground fixture ownership changed; cleanup refused");
    const { id: _id, organizationId: _org, entitlements, ...priorAccount } = fixture.prior.account;
    await tx.aiProviderConnection.update({ where: { connectionId: fixture.connectionId },
      data: { ...priorAccount, entitlements: entitlements === null ? Prisma.JsonNull : entitlements as import("@dpf/db").Prisma.InputJsonValue } });
    await tx.modelProfile.deleteMany({ where: { providerId: fixture.providerId, modelId: fixture.modelId, generatedBy: fixture.prefix } });
    for (const model of fixture.prior.models) await tx.modelProfile.update({ where: { id: model.id }, data: { modelStatus: model.modelStatus } });
    await tx.credentialEntry.deleteMany({ where: { id: fixture.credentialId } });
    await tx.providerCapacityStatus.deleteMany({ where: { ownedAccountId: account.id } });
    await tx.modelProvider.update({ where: { providerId: fixture.providerId }, data: fixture.prior.provider });
  });
}
