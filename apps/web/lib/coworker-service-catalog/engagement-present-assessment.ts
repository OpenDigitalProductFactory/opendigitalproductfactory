import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { ToolExecutionContext } from "../mcp-tool-types";
import type { RemoteTaskSubmitAuth } from "../mcp-task-submit-types";
import type { RemoteTaskSubmitParams } from "../mcp-task-submit-params";
import type { ReassessmentBudgetConfiguration } from "../shared/reassessment-budget-contract";
import { captureTaskExecutionFence, sameTaskExecutionFence } from "../shared/task-execution-fence";
import { capturedJsonValue, appendCapturedTaskArtifact } from "../shared/captured-effect-store";
import { ENGAGEMENT_NATIVE_COMPOSITION, engagementNativeCatalogDigest } from "../shared/engagement-native-composition";
import { parseEngagementTaskBinding, type EngagementTaskBinding } from "./engagement-task-binding";
import { issueEngagementPresentPolicy, engagementPresentPolicyDigest, type EngagementPresentPolicy } from "./engagement-present-policy";
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const equal = (a: unknown,b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
const digest = (v: unknown) => createHash("sha256").update(canonicalJson(v)).digest("hex");
const refuse = (code: string): never => { throw new Error(`engagement-present-${code}`); };
type Original = { taskRunId: string; userId: string; status: string; progressPayload: unknown; a2aMetadata: unknown };
type Engagement = { status: string; metadata: unknown };
/** This validates a distinct assessment's historical subject; it neither clears
 * UNKNOWN nor changes/settles/replays the old task. Every source association stays exact. */
export function assertEngagementPresentOriginal(policy: EngagementPresentPolicy, state: { original: Original | null; engagement: Engagement }) {
  const { original, engagement } = state, association = record(record(engagement.metadata).fulfillment), old = record(original?.a2aMetadata);
  if (!original || !["unavailable", "unknown"].includes(engagement.status) || record(engagement.metadata).result != null
    || !["input-required", "completed"].includes(original.status) || original.userId !== policy.originalBinding.userId
    || original.taskRunId !== policy.originalTaskRunId || association.taskRunId !== original.taskRunId
    || !equal(association.binding, policy.originalBinding) || !equal(old.engagementBinding, policy.originalBinding)
    || old.requestDigest !== policy.originalRequestDigest
    || !sameTaskExecutionFence(policy.originalFence, captureTaskExecutionFence(original.progressPayload, old.requestDigest))) refuse("original-changed");
}
export type EngagementPresentConfiguration = { configurationDigest: string; apiRoot: string; modelId: string;
  budget: ReassessmentBudgetConfiguration; routingConfigDigest: string; maxOutputTokens: number;
  minimumContextTokens: number; minimumCapabilities: import("../routing/agent-capability-types").AgentMinimumCapabilities | null };
type LiveAssessment = {
  policy: EngagementPresentPolicy; policyDigest: string; binding: EngagementTaskBinding;
  token: RemoteTaskSubmitAuth; context: ToolExecutionContext; rawParams: Record<string, unknown>;
  configuration: EngagementPresentConfiguration; closed: boolean; taskRunId?: string; taskRunRecordId?: string;
  requestDigest?: string; deadlineAt?: string; admitted: boolean;
  assertNativeAuthority(): Promise<void>;
};
const live = new AsyncLocalStorage<LiveAssessment>();
export function currentEngagementPresentAssessment(): LiveAssessment | null {
  const scope = live.getStore(); return scope && !scope.closed ? scope : null;
}

/** Only the original governed handler calls this, with its server-created
 * context. No serialized tool/task packet can construct the AsyncLocal scope. */
export async function withEngagementPresentRequest<T>(input: { engagementId: string; userId: string;
  context: ToolExecutionContext; token: RemoteTaskSubmitAuth; rawParams: Record<string, unknown> }, execute: (binding: EngagementTaskBinding) => Promise<T>): Promise<T> {
  const { prisma } = await import("@dpf/db"), context = input.context;
  if (!context.authorityDecisionId || !context.agentId || !context.userContext || input.token.capability !== "write"
    || !["oauth", "pat"].includes(input.token.source)) return refuse("live-authority-required");
  const engagement = await prisma.coworkerEngagement.findUnique({ where: { engagementId: input.engagementId } });
  const association = record(record(engagement?.metadata).fulfillment), originalBinding = parseEngagementTaskBinding(association.binding);
  if (!engagement || engagement.requestedByUserId !== input.userId || engagement.requestedByAgentId !== context.agentId
    || !originalBinding || originalBinding.presentAssessment || originalBinding.serviceId !== "svc-ux-design-critique"
    || !originalBinding.visualEvidenceRef || typeof association.taskRunId !== "string") return refuse("original-required");
  if (record(engagement.metadata).presentAssessment !== undefined) return refuse("already-allocated");
  const original = await prisma.taskRun.findUnique({ where: { taskRunId: association.taskRunId } });
  if (!original) return refuse("original-required");
  const originalRequestDigest = record(original.a2aMetadata).requestDigest;
  const originalFence = captureTaskExecutionFence(original.progressPayload, originalRequestDigest);
  if (!originalFence || typeof originalRequestDigest !== "string") return refuse("original-required");
  const configuration = await readEngagementPresentConfiguration(originalBinding.providerAgentId);
  const policy = issueEngagementPresentPolicy({ binding: originalBinding, originalTaskRunId: original.taskRunId,
    originalRequestDigest, originalFence, issuedAt: new Date().toISOString(),
    budgetConfigurationDigest: configuration.budget.configurationDigest, providerConfigurationDigest: configuration.configurationDigest,
    compositionDigest: engagementNativeCatalogDigest(), limits: { perTaskTokens: configuration.budget.configuredPerTaskLimit,
      maxOutputTokens: configuration.maxOutputTokens, timeoutMs: Math.min(180_000, configuration.budget.configuredTimeoutMs),
      maxProviderStarts: 12, maxToolCalls: 40, maxSourceBytes: 250_000, maxImageBytes: 4_000_000, maxImagePixels: 40_000_000 } });
  assertEngagementPresentOriginal(policy, { original, engagement });
  const policyDigest = engagementPresentPolicyDigest(policy);
  const binding = parseEngagementTaskBinding({ ...originalBinding, presentAssessment: { schemaVersion: 1,
    policyArtifactId: `ta-engagement-present-policy-${digest({ engagementId: engagement.engagementId })}`,
    policyDigest, originalTaskRunId: original.taskRunId, originalRequestDigest } });
  if (!binding) return refuse("policy-unproven");
  // Capture the actual reservation identity; an envelope completed by another
  // call cannot be borrowed. Absence remains absence, never a synthetic approval.
  const envelope = context.approvedAuthorityEnvelopeId ? await prisma.coworkerActionEnvelope.findUnique({
    where: { id: context.approvedAuthorityEnvelopeId }, select: { resolvedAt: true } }) : null;
  const reservedAt = envelope?.resolvedAt?.toISOString() ?? null;
  const scope: LiveAssessment = { policy, policyDigest, binding, configuration, token: { ...input.token },
    context, rawParams: input.rawParams, closed: false, admitted: false,
    assertNativeAuthority: async () => {
      if (scope.closed || Date.now() >= Date.parse(policy.expiresAt)) return refuse("live-authority-expired");
      const [{ currentUserContext }, { can }, { resolveCoworkerToolAuthorityInput }, { evaluateCoworkerAuthority }, { coworkerServiceCatalogPack }] = await Promise.all([
        import("../govern/current-user-context"), import("../permissions"), import("../govern/authority/resolve-coworker-tool-authority"),
        import("../govern/authority/coworker-authority-decision"), import("../mcp/packs/coworker-service-catalog-pack")]);
      const human = await currentUserContext(input.userId);
      if (!human || !can(human, "view_platform")) return refuse("current-human-refused");
      const decision = await prisma.authorizationDecisionLog.findUnique({ where: { decisionId: context.authorityDecisionId! } });
      if (!decision || decision.actionKey !== "request_coworker_engagement" || decision.humanContextRef !== input.userId
        || decision.agentContextRef !== context.agentId || !["allow", "require-approval"].includes(decision.decision)) return refuse("native-decision-refused");
      const credential = await prisma.mcpApiToken.findUnique({ where: { id: input.token.tokenId }, select: { authorityBindingId: true } });
      if (!credential || (input.token.source === "oauth" && !credential.authorityBindingId) || credential.authorityBindingId !== decision.authorityBindingId) return refuse("native-binding-changed");
      const tool = coworkerServiceCatalogPack.definitions.find(t => t.name === "request_coworker_engagement")!;
      const { coworkerAuthorityAgentId } = await import("../coworker-identity");
      const { expandGrants, persistedAgentToolGrants, isToolAllowedByGrants } = await import("../tak/agent-grants");
      const actor = await prisma.agent.findUnique({ where: { agentId: coworkerAuthorityAgentId(context.agentId!) },
        include: { toolGrants: true, toolGrantRevocations: true } });
      if (!actor || actor.status !== "active" || actor.archived) return refuse("current-actor-refused");
      const agentGrantAllowed = isToolAllowedByGrants(tool.name, expandGrants(persistedAgentToolGrants(actor)));
      const authority = await resolveCoworkerToolAuthorityInput({ tool, agentGrantAllowed, execution: {
        toolName: tool.name, rawParams: input.rawParams, userId: input.userId, userContext: human,
        source: "external-jsonrpc", context } });
      const currentDecision = evaluateCoworkerAuthority(authority);
      if (currentDecision.outcome !== "allow") return refuse("current-native-authority-refused");
      if (context.approvedAuthorityEnvelopeId) {
        const current = await prisma.coworkerActionEnvelope.findUnique({ where: { id: context.approvedAuthorityEnvelopeId } });
        if (!reservedAt || !current || current.status !== "approved" || current.resolvedAt?.toISOString() !== reservedAt
          || !current.expiresAt || current.expiresAt <= new Date() || current.delegatingUserId !== input.userId
          || current.coworkerAgentId !== context.agentId || current.manifestActionId !== tool.name
          || authority.approval?.envelopeId !== current.id) return refuse("native-reservation-changed");
      } else if (authority.approval) return refuse("native-reservation-changed");
    } };
  await scope.assertNativeAuthority();
  try { return await live.run(scope, () => execute(binding)); }
  finally { scope.closed = true; }
}

/** Static current configuration, not runtime qualification. Only this audited
 * native wire is implemented; incompatible pins and explicit negative capability
 * policy refuse, with no provider fallback or global profile mutation. */
export async function readEngagementPresentConfiguration(agentId: string, db?: Prisma.TransactionClient): Promise<EngagementPresentConfiguration> {
  const { prisma } = await import("@dpf/db"), database = db ?? prisma;
  const { readReassessmentBudgetConfiguration, checkReassessmentBudget } = await import("../inference/budget-gate");
  const { canonicalLocalModelKey } = await import("../inference/local-model-management");
  const { engagementProviderIdentityRefs } = await import("./engagement-task-binding");
  const refs = engagementProviderIdentityRefs(agentId);
  const configs = await database.agentModelConfig.findMany({ where: { agentId: { in: refs } } });
  const config = configs.find(c => c.agentId === agentId) ?? configs.find(c => c.agentId === "ux-design-critic");
  const budget = await readReassessmentBudgetConfiguration(agentId, undefined, database);
  await checkReassessmentBudget(budget, database);
  const provider = await database.modelProvider.findUnique({ where: { providerId: "local" } });
  const account = await database.aiProviderConnection.findUnique({ where: { connectionId: "provider-default-local" } });
  const models = await database.modelProfile.findMany({ where: { providerId: "local", modelStatus: { in: ["active", "degraded"] }, retiredAt: null } });
  const matches = models.filter(m => canonicalLocalModelKey(m.modelId) === canonicalLocalModelKey(ENGAGEMENT_NATIVE_COMPOSITION.logicalModelRef));
  const model = matches.length === 1 ? matches[0] : null;
  const imageCapability = record(model?.capabilities).imageInput, overrides = record(model?.capabilityOverrides);
  if (!config || !["basic", "adequate", "strong"].includes(config.minimumTier) || config.pinnedProviderId && config.pinnedProviderId !== "local"
    || config.pinnedModelId && canonicalLocalModelKey(config.pinnedModelId) !== canonicalLocalModelKey(model?.modelId ?? "")
    || config.residencyPolicy && !["local_only", "any_enabled", "approved_cloud"].includes(config.residencyPolicy)
    || !provider || !["active", "degraded"].includes(provider.status) || provider.retiredAt || !provider.supportsToolUse
    || !account || account.status !== "active" || account.providerId !== "local" || account.executionChannel !== "local-runtime"
    || account.authMethod !== "none" || account.credentialEntryId != null || !model || !["strong", "frontier"].includes(model.qualityTier ?? "")
    || imageCapability === false || record(imageCapability).support === false || overrides.imageInput === false || record(overrides.imageInput).support === false
    || !model.supportsToolUse || budget.configuredPerTaskLimit <= 2048) return refuse("native-configuration-unavailable");
  const endpoint = provider.baseUrl ?? provider.endpoint;
  let url: URL; try { url = new URL(endpoint!); } catch { return refuse("native-endpoint-unproven"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || !["/v1", "/engines/v1", "/engines/llama.cpp/v1"].includes(url.pathname.replace(/\/$/, ""))) return refuse("native-endpoint-unproven");
  const apiRoot = url.origin;
  const maxOutputTokens = Math.min(2048, budget.configuredMaxOutputTokens, model.maxOutputTokens ?? 2048);
  if (maxOutputTokens <= 0) return refuse("output-bound-unproven");
  const normalized = JSON.parse(JSON.stringify({ provider, account, model, config, budgetDigest: budget.configurationDigest, apiRoot, maxOutputTokens }));
  return { apiRoot, modelId: model.modelId, budget, maxOutputTokens,
    minimumContextTokens: config.minimumContextTokens ?? (await import("../routing/agent-capability-types")).DEFAULT_MINIMUM_CONTEXT_TOKENS,
    minimumCapabilities: config.minimumCapabilities as import("../routing/agent-capability-types").AgentMinimumCapabilities | null,
    routingConfigDigest: digest(JSON.parse(JSON.stringify(config))), configurationDigest: digest(normalized) };
}

/** Every ordinary CE grant, current credential, source and room check still runs
 * in validateEngagementTask. This supplies only this adapter's distinct lineage. */
export async function assertEngagementPresentAssociation(input: { binding: EngagementTaskBinding; taskRunId: string;
  db: Prisma.TransactionClient; requireAssociation?: boolean }) {
  const scope = currentEngagementPresentAssessment();
  if (!scope || !equal(scope.binding, input.binding) || scope.admitted && scope.taskRunId !== input.taskRunId) return refuse("live-context-required");
  const [original, engagement] = await Promise.all([
    input.db.taskRun.findUnique({ where: { taskRunId: scope.policy.originalTaskRunId } }),
    input.db.coworkerEngagement.findUnique({ where: { engagementId: input.binding.engagementId } })]);
  if (!engagement) return refuse("original-required");
  assertEngagementPresentOriginal(scope.policy, { original, engagement });
  const present = record(record(engagement.metadata).presentAssessment);
  if (scope.admitted || input.requireAssociation) {
    if (present.taskRunId !== input.taskRunId || present.policyDigest !== scope.policyDigest
      || !equal(present.binding, input.binding)) return refuse("association-changed");
  } else if (record(engagement.metadata).presentAssessment !== undefined) return refuse("already-allocated");
}

type AdmissionInput = { taskRunId: string; requestDigest: string; threadId: string; parsed: RemoteTaskSubmitParams; token: RemoteTaskSubmitAuth };
export async function prepareEngagementPresentAdmission(input: AdmissionInput) {
  const scope = currentEngagementPresentAssessment();
  if (!scope || !equal(input.parsed.engagementBinding, scope.binding) || !equal(scope.token, input.token)
    || input.parsed.recipeId || input.parsed.initiativeReviewBinding || input.parsed.reviewRecovery || input.parsed.riskClass !== "read") return refuse("live-context-required");
  await scope.assertNativeAuthority();
  const { validateEngagementTask } = await import("./engagement-fulfillment");
  return createEngagementPresentAdmission(scope, input, { validateTask: validateEngagementTask,
    readConfiguration: readEngagementPresentConfiguration });
}
/** Atomic SQL owner, with explicit server ports for isolated database tests.
 * This builder creates no live execution context and cannot activate a worker. */
export function createEngagementPresentAdmission(scope: Pick<LiveAssessment, "policy" | "policyDigest" | "binding" |
  "configuration" | "context" | "assertNativeAuthority" | "taskRunId" | "taskRunRecordId" | "requestDigest" | "deadlineAt">,
  input: AdmissionInput, ports: {
    validateTask: typeof import("./engagement-fulfillment").validateEngagementTask;
    readConfiguration: typeof readEngagementPresentConfiguration;
  }) {
  return { admissionGuard: async (tx: Prisma.TransactionClient) => {
    // Existing TaskRun -> CE is the canonical lock order. The CE lock serializes
    // every credential family/key and consumes the allowance in every outcome.
    await tx.$queryRaw`SELECT "id" FROM "TaskRun" WHERE "taskRunId" = ${scope.policy.originalTaskRunId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "CoworkerEngagement" WHERE "engagementId" = ${scope.binding.engagementId} FOR UPDATE`;
    const original = await tx.taskRun.findUnique({ where: { taskRunId: scope.policy.originalTaskRunId } });
    const engagement = await tx.coworkerEngagement.findUnique({ where: { engagementId: scope.binding.engagementId } });
    if (!engagement) return refuse("original-required");
    assertEngagementPresentOriginal(scope.policy, { original, engagement });
    if (record(engagement.metadata).presentAssessment !== undefined) return refuse("already-allocated");
    await ports.validateTask({ binding: scope.binding, token: input.token, taskRunId: input.taskRunId,
      authorityScope: input.parsed.authorityScope ?? [], request: input.parsed, db: tx });
    await scope.assertNativeAuthority();
    const current = await ports.readConfiguration(scope.binding.providerAgentId, tx);
    if (current.configurationDigest !== scope.configuration.configurationDigest) return refuse("configuration-changed");
  }, afterTaskCreated: async (tx: Prisma.TransactionClient, run: { id: string; taskRunId: string; contextId: string | null }) => {
    const engagement = await tx.coworkerEngagement.findUnique({ where: { engagementId: scope.binding.engagementId } });
    if (!engagement || record(engagement.metadata).presentAssessment !== undefined) return refuse("already-allocated");
    const deadlineAt = new Date(Math.min(Date.now() + scope.policy.limits.timeoutMs, Date.parse(scope.policy.expiresAt))).toISOString();
    await tx.taskArtifact.create({ data: { id: randomUUID(), artifactId: scope.binding.presentAssessment!.policyArtifactId,
      taskRunId: run.id, name: "engagement-present-policy", producerAgentId: scope.binding.providerAgentId,
      parts: capturedJsonValue([{ type: "engagement-present-policy", mimeType: "application/json", data: scope.policy }]),
      metadata: capturedJsonValue({ policyDigest: scope.policyDigest, originalTaskRunId: scope.policy.originalTaskRunId }) } });
    await appendCapturedTaskArtifact(tx, { namespace: "engagement-present", taskRunId: run.taskRunId, taskRunRecordId: run.id,
      manifestDigest: scope.policyDigest, kind: "start-admission", key: "one-candidate", agentId: scope.binding.providerAgentId,
      data: { policyDigest: scope.policyDigest, requestDigest: input.requestDigest, binding: scope.binding,
        authorityDecisionId: scope.context.authorityDecisionId!, envelopeId: scope.context.approvedAuthorityEnvelopeId ?? null,
        deadlineAt, mode: "same-governed-call", oldReplay: false, originalConsumption: "UNKNOWN" }, metadata: { resumable: false } });
    await tx.taskMessage.create({ data: { id: randomUUID(), messageId: `tm_${randomUUID()}`, taskRunId: run.id,
      contextId: run.contextId, role: "user", parts: [{ type: "message", text: input.parsed.prompt }], referenceTaskIds: [],
      metadata: { source: "engagement-present-admission", policyDigest: scope.policyDigest } } });
    const present = { schemaVersion: 1, taskRunId: run.taskRunId, binding: scope.binding, policyDigest: scope.policyDigest,
      originalTaskRunId: scope.policy.originalTaskRunId, state: "working", deadlineAt, resumable: false,
      historicalConsumption: "UNKNOWN", nextAction: "Observe this engagement. This finite assessment cannot be replayed or replaced." };
    await tx.coworkerEngagement.update({ where: { id: engagement.id }, data: {
      metadata: { ...record(engagement.metadata), presentAssessment: present } as Prisma.InputJsonValue } });
    await tx.taskRun.update({ where: { id: run.id }, data: { progressPayload: { engagementPresent: {
      schemaVersion: 1, mode: "same-governed-call", policyDigest: scope.policyDigest, deadlineAt, resumable: false } } } });
    scope.taskRunId = run.taskRunId; scope.taskRunRecordId = run.id; scope.requestDigest = input.requestDigest; scope.deadlineAt = deadlineAt;
  } };
}
/** Called only after the transaction committed; failed admission cannot activate a worker. */
export function activateEngagementPresentAdmission(taskRunId: string) {
  const scope = currentEngagementPresentAssessment();
  if (!scope || scope.taskRunId !== taskRunId || !scope.taskRunRecordId || !scope.deadlineAt) return refuse("admission-unproven");
  scope.admitted = true;
}

/** Unresolved upper bounds belong to the canonical coworker budget owner,
 * across aliases and UTC days. An incomplete/oversized ledger is inconclusive. */
export async function readOutstandingEngagementReservations(db: Pick<Prisma.TransactionClient, "toolExecution">,
  budgetOwnerAgentId: string): Promise<{ reservedTokens: number; reservationCount: number }> {
  const { engagementProviderIdentityRefs } = await import("./engagement-task-binding");
  const refs = engagementProviderIdentityRefs(budgetOwnerAgentId);
  const rows = await db.toolExecution.findMany({ where: { toolName: "engagement_present_capture", success: false,
    AND: [{ parameters: { path: ["operation"], equals: "generation" } },
      { OR: [{ agentId: { in: refs } }, { parameters: { path: ["budgetOwnerAgentId"], equals: budgetOwnerAgentId } }] }] },
    orderBy: { id: "asc" }, take: 1001, select: { id: true, agentId: true, parameters: true } });
  if (rows.length > 1000) return refuse("outstanding-ledger-overflow");
  let reservedTokens = 0;
  for (const row of rows) {
    const p = record(row.parameters), amount = record(p.tokenReservation).reservedTokens;
    if (p.operation !== "generation" || p.budgetOwnerAgentId !== undefined && p.budgetOwnerAgentId !== budgetOwnerAgentId
      || !Number.isSafeInteger(amount) || Number(amount) <= 0 || !Number.isSafeInteger(reservedTokens + Number(amount))) {
      return refuse("outstanding-consumption-unproven");
    }
    reservedTokens += Number(amount);
  }
  return { reservedTokens, reservationCount: rows.length };
}

/** Observation may hold an expired unacknowledged assessment, never dispatch or
 * resume it. A late response remains audit evidence and cannot extend its window. */
export async function reconcileEngagementPresentObservation(engagementId: string,
  database?: typeof import("@dpf/db").prisma): Promise<void> {
  const prisma = database ?? (await import("@dpf/db")).prisma;
  const observed = await prisma.coworkerEngagement.findUnique({ where: { engagementId } });
  const association = record(record(observed?.metadata).presentAssessment);
  const binding = parseEngagementTaskBinding(association.binding);
  if (!binding?.presentAssessment || association.state !== "working" || typeof association.taskRunId !== "string"
    || typeof association.deadlineAt !== "string" || !Number.isFinite(Date.parse(association.deadlineAt))) return;
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "TaskRun" WHERE "taskRunId" = ${association.taskRunId as string} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "CoworkerEngagement" WHERE "engagementId" = ${engagementId} FOR UPDATE`;
    const [task, ce] = await Promise.all([
      tx.taskRun.findUnique({ where: { taskRunId: association.taskRunId as string } }),
      tx.coworkerEngagement.findUnique({ where: { engagementId } })]);
    const latest = record(record(ce?.metadata).presentAssessment);
    if (!task || !ce || task.userId !== binding.userId || latest.state !== "working"
      || !equal(latest, association) || !equal(record(task.a2aMetadata).engagementBinding, binding)
      || record(ce.metadata).result != null || task.status === "completed"
      || record(record(task.progressPayload).engagementPresent).deadlineAt !== association.deadlineAt) return;
    if (task.status === "working" && Date.parse(association.deadlineAt as string) > Date.now()) return;
    const reason = task.status === "working" ? "engagement-present-window-ended-without-verified-result"
      : `engagement-present-task-${task.status}`;
    if (task.status === "working") await tx.taskRun.update({ where: { id: task.id }, data: { status: "input-required", completedAt: null,
      progressPayload: capturedJsonValue({ ...record(task.progressPayload), summary: reason, engagementPresentHold: {
        reason, resumable: false, candidateConsumed: true, consumption: "UNKNOWN", replay: false } }) } });
    await tx.coworkerEngagement.update({ where: { id: ce.id }, data: { metadata: capturedJsonValue({ ...record(ce.metadata),
      presentAssessment: { ...latest, state: task.status === "canceled" ? "cancelled" : "held", taskStatus: task.status === "working" ? "input-required" : task.status, reason, resumable: false,
        nextAction: "Inspect this assessment's retained evidence. No complete result was verified before its window ended; do not replay or replace it." } }) } });
  });
}

/** Caller must append its reservation in this SAME transaction before sending.
 * All candidate/settlement owners use the canonical Agent lock after TaskRun/CE.
 * Recorded totals plus unresolved upper bounds are conservative bookkeeping,
 * not proof of total daily spend while the historical original is UNKNOWN. */
export async function checkEngagementPresentGenerationBudget(tx: Prisma.TransactionClient, input: {
  budget: ReassessmentBudgetConfiguration; reservation: {
    bodySha256: string; inputTokens: number; maxOutputTokens: number; reservedTokens: number;
  };
}) {
  const { budget, reservation: r } = input;
  if (!/^[a-f0-9]{64}$/.test(r.bodySha256) || ![r.inputTokens,r.maxOutputTokens,r.reservedTokens].every(n => Number.isSafeInteger(n) && n > 0)
    || r.inputTokens + r.maxOutputTokens !== r.reservedTokens || budget.configuredPerTaskLimit <= 0
    || r.reservedTokens > budget.configuredPerTaskLimit || r.maxOutputTokens > budget.configuredMaxOutputTokens) return refuse("token-reservation-invalid");
  await tx.$queryRaw`SELECT "id" FROM "Agent" WHERE "id" = ${budget.executionAgentRowId} FOR UPDATE`;
  const { checkReassessmentBudget } = await import("../inference/budget-gate");
  const daily = await checkReassessmentBudget(budget, tx);
  const outstanding = await readOutstandingEngagementReservations(tx, budget.registryAgentId);
  const upperBound = daily.actualTokens + outstanding.reservedTokens + r.reservedTokens;
  if (!Number.isSafeInteger(upperBound) || budget.configuredDailyLimit !== 0 && upperBound > budget.configuredDailyLimit) return refuse("daily-reservation-exhausted");
  return { budgetOwnerAgentId: budget.registryAgentId, configuredDailyLimit: budget.configuredDailyLimit,
    recordedTodayTokens: daily.actualTokens, unresolvedGenerationUpperBound: outstanding.reservedTokens, newReservedTokens: r.reservedTokens,
    originalHistoricalConsumption: "UNKNOWN", dailyHeadroomProven: false };
}
