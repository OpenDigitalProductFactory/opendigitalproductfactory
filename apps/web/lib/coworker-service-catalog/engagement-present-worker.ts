import { createHash } from "node:crypto";
import type { Prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { RemoteTaskSubmitOutcome } from "../mcp-task-submit-types";
import { currentEngagementPresentAssessment, readEngagementPresentConfiguration, checkEngagementPresentGenerationBudget } from "./engagement-present-assessment";
import { capturedJsonValue, appendCapturedTaskArtifact, capturedTaskArtifactId, parseCapturedJson, withCapturedProviderTransportOnly, assertCapturedProviderTransportClean, createCapturedNativeImageInputEvidence } from "../shared/captured-effect-store";
import { captureTaskExecutionFence, sameTaskExecutionFence } from "../shared/task-execution-fence";
import { redactDiagnosticEvidenceText } from "../shared/diagnostic-evidence-redaction";
import { ENGAGEMENT_NATIVE_COMPOSITION as catalog, interpretEngagementNativeRuntime } from "../shared/engagement-native-composition";
import { buildEngagementMessagesBody, executeEngagementMessages, ENGAGEMENT_RESPONSE_ENCODING } from "../routing/engagement-captured-messages";
import { preloadEngagementPresent } from "./engagement-present-preload";
type Attempt = import("../mcp-task-submit-types").RemoteTaskAttemptInput;
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const equal = (a: unknown,b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const entered = new WeakSet<object>();
const refusal = (taskRunId: string, code: string): RemoteTaskSubmitOutcome => ({ kind: "result", result: {
  taskRunId, status: "input-required", isError: true, resumable: false, requiresApproval: false,
  content: [{ type: "text", text: code }], structuredContent: { error: code } } });
function fail(reason: string): never { throw new Error(`engagement-present-${reason}`); }

/** Separate finite adapter. A durable task/policy or inherited closed ALS frame
 * cannot start this worker. All effects remain inside the original governed call. */
export type EngagementPresentPorts = {
  prepareTurn(attempt: Attempt, binding: import("./engagement-task-binding").EngagementTaskBinding): ReturnType<typeof import("../mcp-task-reassessment-preparation").prepareRemoteReviewAttempt>;
  executeRead(input: { toolName: string; args: Record<string, unknown>; agentId: string; fence: NonNullable<ReturnType<typeof captureTaskExecutionFence>> }, attempt: Attempt): Promise<import("../mcp-tool-types").ToolResult>;
};
export function executeEngagementPresentAttempt(input: Attempt, ports: EngagementPresentPorts): Promise<RemoteTaskSubmitOutcome> {
  return withCapturedProviderTransportOnly(() => executeEngagementPresentAttemptBody(input, ports));
}
async function executeEngagementPresentAttemptBody(input: Attempt, ports: EngagementPresentPorts): Promise<RemoteTaskSubmitOutcome> {
  const scope = currentEngagementPresentAssessment(), { run, parsed, token } = input;
  if (!scope || !scope.admitted || scope.taskRunId !== run.taskRunId || scope.taskRunRecordId !== run.id
    || !equal(scope.binding, parsed.engagementBinding) || !equal(scope.token, token) || entered.has(scope)) {
    return refusal(run.taskRunId, "engagement-present-live-context-required");
  }
  entered.add(scope);
  const { prisma } = await import("@dpf/db");
  const { validateEngagementTask, validateEngagementContribution } = await import("./engagement-fulfillment");
  const { engagementReadEvidence } = await import("./engagement-read-provenance");
  const { engagementProviderIdentityRefs } = await import("./engagement-task-binding");
  const { engagementVisualDeliveryRecorder } = await import("./engagement-visual-evidence");
  const { currentGovernedInferenceDeadline, withGovernedInferenceDeadline } = await import("../routing/governed-inference-deadline");
  const fence = captureTaskExecutionFence(null, scope.requestDigest);
  if (!fence || !scope.deadlineAt) return refusal(run.taskRunId, "engagement-present-admission-unproven");
  const artifact = (tx: Prisma.TransactionClient, kind: string, key: unknown, data: unknown) => appendCapturedTaskArtifact(tx, {
    namespace: "engagement-present", manifestDigest: scope.policyDigest, taskRunId: run.taskRunId,
    taskRunRecordId: run.id, agentId: scope.binding.providerAgentId, kind, key, data,
    metadata: { policyDigest: scope.policyDigest, requestDigest: scope.requestDigest!, executionFence: fence } });
  const current = async (tx: Prisma.TransactionClient) => {
    assertCapturedProviderTransportClean();
    if (currentEngagementPresentAssessment() !== scope || !scope.admitted || Date.now() >= Date.parse(scope.deadlineAt!)) fail("deadline-or-scope-ended");
    await scope.assertNativeAuthority();
    const task = await tx.taskRun.findUnique({ where: { taskRunId: run.taskRunId } }), metadata = object(task?.a2aMetadata);
    if (!task || task.id !== run.id || task.userId !== token.userId || task.status !== "working"
      || metadata.requestDigest !== scope.requestDigest || !equal(metadata.engagementBinding, scope.binding)
      || !sameTaskExecutionFence(fence, captureTaskExecutionFence(task.progressPayload, metadata.requestDigest))) fail("current-fence-refused");
    const policy = await tx.taskArtifact.findUnique({ where: { artifactId: scope.binding.presentAssessment!.policyArtifactId } });
    const part = Array.isArray(policy?.parts) ? object(policy.parts[0]) : {};
    if (!policy || policy.taskRunId !== run.id || policy.producerAgentId !== scope.binding.providerAgentId
      || !equal(part.data, scope.policy) || !equal(object(policy.metadata).policyDigest, scope.policyDigest)) fail("persisted-policy-changed");
    const config = await readEngagementPresentConfiguration(scope.binding.providerAgentId, tx);
    if (config.configurationDigest !== scope.configuration.configurationDigest) fail("configuration-changed");
    await validateEngagementTask({ binding: scope.binding, token, taskRunId: run.taskRunId,
      authorityScope: parsed.authorityScope ?? [], requireAssociation: true, request: parsed, db: tx });
    return task;
  };
  const locked = async <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "TaskRun" WHERE "taskRunId" = ${run.taskRunId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "CoworkerEngagement" WHERE "engagementId" = ${scope.binding.engagementId} FOR UPDATE`;
    await current(tx); return fn(tx);
  }, { isolationLevel: "Serializable" });
  const verify = async () => { try { await current(prisma); return true; } catch { return false; } };
  let sequence = 0, generationId: string | null = null;
  // Observation is an audit append even after cancellation/expiry. It grants no
  // additional send, result publication, replay, deadline or generation.
  const observe = (kind: string, key: unknown, data: unknown) => prisma.$transaction(tx => artifact(tx, kind, key, data));
  const http = async (operation: "configuration" | "count" | "generation", url: string, bodyUtf8?: string,
    reservation?: { bodySha256: string; inputTokens: number; maxOutputTokens: number; reservedTokens: number }) => {
    const root = scope.configuration.apiRoot, wire = `${root}/engines/llama.cpp/v1/messages`;
    const allowedGet = [`${root}/version`, `${root}/engines/status`,
      `${root}/engines/_configure?model=${encodeURIComponent(catalog.logicalModelRef)}`,
      `${root}/models/${catalog.modelDigest}`, `${root}/engines/ps`];
    if (operation === "configuration" ? bodyUtf8 !== undefined || !allowedGet.includes(url)
      : typeof bodyUtf8 !== "string" || url !== (operation === "count" ? `${wire}/count_tokens` : wire)) fail("http-contract-refused");
    if (operation === "generation" && (!reservation || sha(bodyUtf8!) !== reservation.bodySha256 || generationId)) fail("generation-reservation-refused");
    if (sequence >= scope.policy.limits.maxProviderStarts) fail("provider-start-limit");
    const ordinal = ++sequence;
    const audit = await locked(async tx => {
      const budgetAccounting = operation === "generation" ? await checkEngagementPresentGenerationBudget(tx, {
        budget: scope.configuration.budget, reservation: reservation! }) : null;
      const event = { ordinal, operation, url, method: operation === "configuration" ? "GET" : "POST",
        bodySha256: bodyUtf8 === undefined ? null : sha(bodyUtf8), bodyBytes: bodyUtf8 === undefined ? 0 : Buffer.byteLength(bodyUtf8),
        tokenReservation: reservation ?? null, budgetOwnerAgentId: scope.configuration.budget.registryAgentId, budgetAccounting };
      await artifact(tx, "effect-reserved", ordinal, event);
      return tx.toolExecution.create({ data: { threadId: input.threadId, taskRunId: run.taskRunId, userId: token.userId,
        agentId: scope.configuration.budget.registryAgentId, toolName: "engagement_present_capture", executionMode: "finite-engagement-capture",
        auditClass: "restricted-reassessment", parameters: capturedJsonValue({ ...event, policyDigest: scope.policyDigest,
          requestDigest: scope.requestDigest!, executionFence: fence }), result: { executionStatus: "reserved", consumption: "UNKNOWN" }, success: false } });
    });
    if (operation === "generation") generationId = audit.id;
    let response: Response | undefined, bytes = Buffer.alloc(0);
    try {
      // Reservation commits before this final recheck and actual transport.
      await current(prisma);
      const deadline = currentGovernedInferenceDeadline();
      if (!deadline) fail("deadline-unbound");
      await deadline.assertAuthority();
      response = await deadline.localFetch(url, { method: operation === "configuration" ? "GET" : "POST", redirect: "error",
        ...(bodyUtf8 === undefined ? {} : { body: bodyUtf8, headers: { "content-type": "application/json" } }), signal: deadline.signal });
      const reader = response.body?.getReader();
      if (!reader) fail("http-body-unavailable");
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        if (bytes.length + chunk.value.length > 1024 * 1024) { await reader.cancel(); fail("http-response-limit"); }
        bytes = Buffer.concat([bytes, Buffer.from(chunk.value)]);
      }
      const rawText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const retainedText = redactDiagnosticEvidenceText(rawText);
      const output = { status: response.status, bodySha256: sha(bytes), bodyBytes: bytes.length,
        bodyText: retainedText, redacted: retainedText !== rawText, observedAt: new Date().toISOString() };
      await prisma.$transaction(async tx => {
        await artifact(tx, "effect-observed", ordinal, { reservationId: audit.id, ...output });
        await tx.toolExecution.update({ where: { id: audit.id }, data: { result: capturedJsonValue({ executionStatus: "observed",
          ...output, ...(operation === "generation" ? { consumption: "reserved-until-validated-usage" } : {}) }), success: operation !== "generation" } });
      });
      if (!response.ok || retainedText !== rawText) fail("http-refused-or-sensitive");
      return rawText;
    } catch (error) {
      await observe("effect-uncertain-or-refused", ordinal, { reservationId: audit.id, status: response?.status ?? null,
        partialBodySha256: sha(bytes), partialBodyBytes: bytes.length, partialBodyText: redactDiagnosticEvidenceText(bytes.toString("utf8")),
        reason: redactDiagnosticEvidenceText(error instanceof Error ? error.message : "HTTP observation unavailable"),
        consumption: operation === "generation" ? "UNKNOWN-with-reserved-upper-bound" : "effect-outcome-unproven", replay: false });
      throw error;
    }
  };
  try {
    await locked(tx => artifact(tx, "execution-open", "one-worker", { taskRunId: run.taskRunId, mode: "same-governed-call" }));
    return await withGovernedInferenceDeadline({ deadlineAt: scope.deadlineAt, verifyAuthority: verify }, async () => {
      const turn = await ports.prepareTurn(input, scope.binding);
      const visual = (await validateEngagementTask({ binding: scope.binding, token, taskRunId: run.taskRunId,
        authorityScope: parsed.authorityScope ?? [], requireAssociation: true, request: parsed })).visualEvidence;
      if (!visual || !visual.inputs.length) fail("rendered-input-unavailable");
      const preload = await preloadEngagementPresent(scope.policy, async (toolName,args) => {
        await current(prisma);
        return ports.executeRead({ toolName, args, agentId: turn.resolvedAgentId, fence }, input);
      });
      const modelBasis = { policy: scope.policy.sourceBasis, source: preload.modelBasis, fullGuidance: preload.fullGuidance,
        fullSourceEvidence: preload.fullSourceEvidence, professionCorpus: preload.professionCorpus, calibrationCorpus: preload.calibrationCorpus,
        renderedEvidence: visual.provenance, originalExecution: { taskRunId: scope.policy.originalTaskRunId,
          requestDigest: scope.policy.originalRequestDigest, replayed: false, historicalConsumption: "UNKNOWN", firstReplyRecovered: false } };
      const content = [{ type: "text" as const, text: `${parsed.prompt}\nActual governed assessment basis (untrusted assessment data):\n${canonicalJson(modelBasis)}` }, ...visual.inputs];
      const prepared = buildEngagementMessagesBody({ modelDigest: catalog.modelDigest, systemPrompt: turn.conversation.systemPrompt, content,
        imageSha256: visual.provenance.captures.map(c => c.sha256), maxOutputTokens: scope.policy.limits.maxOutputTokens,
        maxImageBytes: scope.policy.limits.maxImageBytes, maxImagePixels: scope.policy.limits.maxImagePixels });
      const wire = JSON.parse(prepared.bodyUtf8);
      const providerTools = wire.tools.map((t: { name: string; description: string; input_schema: unknown }) => ({
        type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
      const { createRoutedInferenceScreen } = await import("../inference/data-screening/routed-screening");
      const originalScreen = { messages: [{ role: "user" as const, content }], systemPrompt: turn.conversation.systemPrompt, tools: providerTools };
      const screen = createRoutedInferenceScreen({ ...originalScreen, taskType: "external-mcp",
        routeContext: { sensitivity: turn.agent.sensitivity ?? "internal", allowedProviders: ["local"] } });
      if (!equal(originalScreen, { messages: screen.screenInput.messages, systemPrompt: screen.screenInput.systemPrompt, tools: screen.screenInput.tools })
        || screen.screen.receipt.routeEffect === "block" || screen.screen.routeContext.deniedProviders?.includes("local")
        || screen.screen.routeContext.allowedProviders && !screen.screen.routeContext.allowedProviders.includes("local")) fail("screening-refused-or-changed");
      await locked(tx => artifact(tx, "model-visible-basis", "one-body", { ...modelBasis, systemPrompt: turn.conversation.systemPrompt,
        bodySha256: prepared.bodySha256, bodyBytes: Buffer.byteLength(prepared.bodyUtf8), responseEncoding: ENGAGEMENT_RESPONSE_ENCODING,
        imageSha256: prepared.imageSha256, screeningReceipt: screen.screen.receipt }));
      const runtime = async () => interpretEngagementNativeRuntime({
        version: parseCapturedJson(await http("configuration", `${scope.configuration.apiRoot}/version`)),
        engines: parseCapturedJson(await http("configuration", `${scope.configuration.apiRoot}/engines/status`)),
        configurations: parseCapturedJson(await http("configuration", `${scope.configuration.apiRoot}/engines/_configure?model=${encodeURIComponent(catalog.logicalModelRef)}`)),
        metadata: parseCapturedJson(await http("configuration", `${scope.configuration.apiRoot}/models/${catalog.modelDigest}`)) });
      const capacity = async () => {
        const { readPublishedHostGpuObservation, parseEngineRunners, decideLocalGpuAdmission, requiredLocalModelMiB } = await import("../inference/host-gpu-admission");
        const raw = parseCapturedJson(await http("configuration", `${scope.configuration.apiRoot}/engines/ps`));
        if (!Array.isArray(raw) || raw.some(v => { const r = object(v); return typeof r.model_name !== "string" || typeof r.mode !== "string"
          || typeof r.in_use !== "boolean" || typeof r.loading !== "boolean"; })) fail("capacity-response-invalid");
        const published = await readPublishedHostGpuObservation();
        const decision = decideLocalGpuAdmission({ runners: parseEngineRunners(raw), snapshot: published.snapshot,
          nowMs: published.observedAtMs, requiredMiB: requiredLocalModelMiB(scope.configuration.modelId) });
        await locked(tx => artifact(tx, "capacity-observation", sequence, { ...published, decision }));
        if (decision.defer) fail(`capacity-${decision.defer}`);
      };
      const { withLocalInferenceLock } = await import("../queue/resource-lane");
      return withLocalInferenceLock(async () => {
        const qualified = await runtime();
        const imageInputEvidence = createCapturedNativeImageInputEvidence({ modelId: scope.configuration.modelId,
          modelDigest: catalog.modelDigest, observationDigest: qualified.observationDigest });
        const { prepareReassessmentNativeStaticRoute } = await import("../inference/routed-inference");
        const { checkReassessmentBudget } = await import("../inference/budget-gate");
        const daily = await checkReassessmentBudget(scope.configuration.budget);
        const route = await prepareReassessmentNativeStaticRoute(originalScreen.messages, originalScreen.systemPrompt,
          turn.agent.sensitivity ?? "internal", { ...turn.modelRequirements, agentId: turn.resolvedAgentId, taskType: "external-mcp",
            tools: providerTools, allowedProviders: ["local"], requiresStreaming: false, requireTools: true,
            minimumCapabilities: scope.configuration.minimumCapabilities ?? undefined, agentMinimumContextTokens: scope.configuration.minimumContextTokens },
          { reader: async (_fetch, selected) => selected.provider.providerId === "local"
            && selected.modelId === scope.configuration.modelId ? { contextTokens: qualified.contextTokens, imageInputEvidence } : null, budgetStatus: daily.status });
        const selected = route.manifests.find(m => m.id === route.decision.selectedEndpoint);
        await locked(tx => artifact(tx, "native-qualification", "current-route", { qualified, decision: route.decision, contract: route.contract }));
        if (!selected || selected.providerId !== "local" || selected.modelId !== scope.configuration.modelId
          || route.decision.routingConfidence?.qualityFloorRelaxed || route.decision.executionPlan?.providerConnectionId !== "provider-default-local") fail("current-routing-refused");
        const reply = await executeEngagementMessages(prepared, { perTaskTokens: scope.policy.limits.perTaskTokens, contextTokens: qualified.contextTokens }, {
          count: body => http("count", `${scope.configuration.apiRoot}/engines/llama.cpp/v1/messages/count_tokens`, body),
          generate: async (body, reservation) => {
            const refreshed = await runtime();
            if (!equal(qualified, refreshed)) fail("native-composition-changed");
            await capacity();
            const raw = await http("generation", `${scope.configuration.apiRoot}/engines/llama.cpp/v1/messages`, body, reservation);
            await engagementVisualDeliveryRecorder(run.taskRunId, scope.binding, fence, visual)({
              sha256: [...prepared.imageSha256], providerId: "local", modelId: catalog.modelDigest, adapterKind: catalog.kind });
            return raw;
          } });
        return locked(async tx => {
          const task = await tx.taskRun.findUnique({ where: { taskRunId: run.taskRunId } }), metadata = object(task?.a2aMetadata);
          const executions = await tx.toolExecution.findMany({ where: { taskRunId: run.taskRunId, userId: token.userId,
            agentId: { in: engagementProviderIdentityRefs(scope.binding.providerAgentId) }, success: true } });
          let predicate = "contribution-unproven";
          const contribution = validateEngagementContribution(scope.binding, reply.content, executions, "ux-design",
            engagementReadEvidence(metadata.engagementReadEvidence), metadata.engagementVisualDelivery, code => { predicate = code; });
          if (!contribution) fail(predicate);
          const engagement = await tx.coworkerEngagement.findUnique({ where: { engagementId: scope.binding.engagementId } });
          const room = await tx.workroom.findUnique({ where: { capsuleId: scope.binding.workroomId } });
          if (!engagement || !room || !generationId) fail("result-owner-unavailable");
          const resultArtifactId = capturedTaskArtifactId({ namespace: "engagement-present", taskRunId: run.taskRunId,
            manifestDigest: scope.policyDigest, kind: "validated-critic-result", key: "one-result" });
          const result = { ...contribution, taskRunId: run.taskRunId, resultArtifactId,
            authorityDecisionId: scope.context.authorityDecisionId!, executionRef: generationId, responseId: reply.responseId,
            responseModel: reply.responseModel, responseModelIdentity: reply.responseModelIdentity, providerId: "local", modelDigest: catalog.modelDigest,
            policyArtifactId: scope.binding.presentAssessment!.policyArtifactId, policyDigest: scope.policyDigest,
            originalExecution: modelBasis.originalExecution, assessmentRelation: "separate-present-assessment", modelVisibleBasis: modelBasis,
            actualUsage: reply.usage, authorDisposition: "pending", advisoryOnly: true };
          await artifact(tx, "validated-critic-result", "one-result", result);
          await tx.$queryRaw`SELECT "id" FROM "Agent" WHERE "id" = ${scope.configuration.budget.executionAgentRowId} FOR UPDATE`;
          await tx.tokenUsage.create({ data: { traceId: generationId, agentId: scope.configuration.budget.registryAgentId, providerId: "local",
            recordedProviderConnectionRef: "provider-default-local", contextKey: `engagement-present:${run.taskRunId}`,
            inputTokens: reply.usage.inputTokens, outputTokens: reply.usage.outputTokens, costUsd: 0 } });
          await tx.toolExecution.update({ where: { id: generationId }, data: { success: true, inputTokens: reply.usage.inputTokens, outputTokens: reply.usage.outputTokens } });
          await tx.taskRun.update({ where: { id: run.id }, data: { status: "completed", completedAt: new Date(),
            progressPayload: capturedJsonValue({ ...object(task!.progressPayload), summary: reply.content, resultRef: resultArtifactId, resumable: false }) } });
          await tx.coworkerEngagement.update({ where: { id: engagement.id }, data: { status: "completed", completedAt: new Date(),
            metadata: capturedJsonValue({ ...object(engagement.metadata), presentAssessment: {
              ...object(object(engagement.metadata).presentAssessment), state: "completed", executionRef: generationId, resultArtifactId,
              nextAction: "The routing author must respond and dispose the actual advisory findings." }, result }) } });
          await tx.workroomActivity.create({ data: { workCapsuleId: room.id, kind: "evidence-recorded",
            summary: `AGT-906 present advisory contribution returned for ${scope.binding.engagementId}`,
            recordedById: token.userId, recordedByAgentId: turn.resolvedAgentId,
            payload: capturedJsonValue({ kind: "coworker-engagement-result", engagementId: scope.binding.engagementId,
              taskRunId: run.taskRunId, executionRef: generationId, result }) } });
          return { kind: "result" as const, result: { taskRunId: run.taskRunId, status: "completed", resumable: false, requiresApproval: false,
            structuredContent: result, content: [{ type: "text", text: String(object(JSON.parse(reply.content)).summary) }], isError: false } };
        });
      }, { modelId: scope.configuration.modelId, origin: "autonomous", signal: currentGovernedInferenceDeadline()!.signal, capturedCapacityProbe: capacity });
    });
  } catch (error) {
    const reason = redactDiagnosticEvidenceText(error instanceof Error ? error.message : "engagement-present-outcome-unproven");
    // Persist the first predicate and hold without publishing any critique or
    // erasing another generation/cancellation. The one candidate stays consumed.
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "TaskRun" WHERE "taskRunId" = ${run.taskRunId} FOR UPDATE`;
      const task = await tx.taskRun.findUnique({ where: { taskRunId: run.taskRunId } });
      await artifact(tx, "assessment-held", "first-failure", { reason, generationRef: generationId, providerStarts: sequence,
        originalReplay: false, candidateConsumed: true, nextAction: "Inspect retained failure/raw-response evidence. This assessment cannot be replayed or replaced." });
      if (!task || task.status !== "working" || !sameTaskExecutionFence(fence, captureTaskExecutionFence(task.progressPayload, object(task.a2aMetadata).requestDigest))) return;
      await tx.$queryRaw`SELECT "id" FROM "CoworkerEngagement" WHERE "engagementId" = ${scope.binding.engagementId} FOR UPDATE`;
      const engagement = await tx.coworkerEngagement.findUnique({ where: { engagementId: scope.binding.engagementId } });
      await tx.taskRun.update({ where: { id: run.id }, data: { status: "input-required", completedAt: null, progressPayload: capturedJsonValue({
        ...object(task.progressPayload), summary: reason, engagementPresentHold: { reason, resumable: false, candidateConsumed: true, generationRef: generationId } }) } });
      if (engagement && object(object(engagement.metadata).presentAssessment).taskRunId === run.taskRunId) {
        await tx.coworkerEngagement.update({ where: { id: engagement.id }, data: { metadata: capturedJsonValue({
          ...object(engagement.metadata), presentAssessment: { ...object(object(engagement.metadata).presentAssessment),
            state: "held", reason, generationRef: generationId, resumable: false, nextAction: "Inspect retained original assessment evidence; do not replay or create a replacement request." } }) } });
      }
    });
    return refusal(run.taskRunId, reason);
  }
}
