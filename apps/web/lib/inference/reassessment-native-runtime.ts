import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { LocalContextReader } from "../routing/loader";
import type { ReassessmentFiniteTokenProof, QualifiedReassessmentExecution } from "../routing/reassessment-execution-scope";
import { assertReassessmentPlan, currentFiniteReassessmentExecution, currentReassessmentExecution, currentReassessmentQualification, refuseReassessmentExecution } from "../routing/reassessment-execution-scope";
import type { RoutedExecutionPlan } from "../routing/recipe-types";
import { canonicalLocalModelKey, validateLocalModelReference } from "./local-model-management";
import { resolveLocalRoutingRuntime } from "./local-model-context-reconcile";
import { getOllamaApiRoot, getOllamaBaseUrl } from "./ollama-url";
import type { BudgetStatus } from "./budget-gate";
import { captureReassessmentHttpRequest, currentReassessmentHttpTransport } from "./reassessment-http-capture";
import { REASSESSMENT_NATIVE_COMPOSITION, reassessmentNativeCatalogDigest } from "../shared/reassessment-native-composition";
export { REASSESSMENT_NATIVE_COMPOSITION, reassessmentNativeCatalogDigest } from "../shared/reassessment-native-composition";

const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const textHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const refuse = (reason: string): never => refuseReassessmentExecution(`reassessment-native-${reason}`);
type Provider = { providerId: string; baseUrl: string | null; endpoint: string | null };
export type ReassessmentNativeRoutingFacts = { reader: LocalContextReader; budgetStatus: BudgetStatus };

export type ReassessmentNativeRuntimeObservation = Readonly<{
  schemaVersion: 1; catalogDigest: string; observationDigest: string;
  apiRoot: string; modelRef: string; modelsUrl: string; contextTokens: number;
  finiteTokenProof: ReassessmentFiniteTokenProof;
}>;
type ObservedRecords = { provider: Provider; responses: ReadonlyMap<string, string>; reader: LocalContextReader; root: string };
const observations = new WeakMap<ReassessmentNativeRuntimeObservation, ObservedRecords>();
const rootIdentity = (context: { taskRunId: string; requestDigest: string; manifest: unknown }) =>
  canonicalJson({ taskRunId: context.taskRunId ?? null, requestDigest: context.requestDigest ?? null, manifest: context.manifest ?? null });

export function reassessmentNativeRuntimeUrls(provider: Provider, modelRef: string): string[] {
  if (provider.providerId !== "local") return refuse("provider-unsupported");
  try { validateLocalModelReference(modelRef); } catch { return refuse("model-reference-invalid"); }
  const base = getOllamaBaseUrl(provider).replace(/\/+$/, "");
  const dispatchBase = (provider.baseUrl ?? provider.endpoint)?.replace(/\/+$/, "");
  if (!dispatchBase || base !== dispatchBase) return refuse("endpoint-configuration-conflict");
  const root = getOllamaApiRoot(provider).replace(/\/+$/, "");
  for (const value of [base, root]) {
    let url: URL;
    try { url = new URL(value); } catch { return refuse("endpoint-invalid"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return refuse("endpoint-invalid");
  }
  if (!/^https?:\/\//.test(root) || base !== `${root}/v1` && base !== `${root}/engines/v1`
    && base !== `${root}/engines/llama.cpp/v1`) return refuse("endpoint-unsupported");
  return [`${root}/version`, `${root}/engines/status`, `${root}/engines/_configure?model=${encodeURIComponent(modelRef)}`,
    `${root}/models/${REASSESSMENT_NATIVE_COMPOSITION.modelDigest}`, `${base}/models`];
}

function interpret(provider: Provider, modelRef: string, urls: string[], values: unknown[], responses: Map<string, string>) {
  const catalog = REASSESSMENT_NATIVE_COMPOSITION;
  const [version, engines, configurations, metadata] = values;
  if (!object(version) || version.version !== catalog.runtimeVersion) return refuse("runtime-version-changed");
  const identity = object(engines) ? engines["llama.cpp"] : undefined;
  // The archive is the runtime owner's logical installation report. It is
  // intentionally distinct from the retained executable-byte digest above.
  if (identity !== `Running: llama.cpp ${catalog.engineBuild} (sha256:${catalog.engineArchiveDigest}) ${catalog.engineSourceCommit.slice(0, 7)}`
    || !object(engines) || Object.entries(engines).some(([name, value]) => name !== "llama.cpp" && typeof value === "string" && value.startsWith("Running"))) return refuse("engine-changed");
  if (!Array.isArray(configurations) || configurations.length !== 1 || !object(configurations[0])) return refuse("runtime-configuration-ambiguous");
  const configuration = configurations[0];
  if (configuration.Backend !== "llama.cpp" || configuration.Mode !== "completion" || typeof configuration.Model !== "string"
    || canonicalLocalModelKey(configuration.Model) !== canonicalLocalModelKey(modelRef) || configuration.ModelID !== catalog.modelDigest
    || !object(configuration.Config) || Object.keys(configuration.Config).some(key => key !== "context-size")
    || configuration.Config["context-size"] !== undefined && !positive(configuration.Config["context-size"])) return refuse("runtime-configuration-changed");
  if (!object(metadata) || metadata.id !== catalog.modelDigest || !object(metadata.config)
    || hash(metadata.config) !== catalog.logicalModelConfigurationDigest || !object(metadata.config.gguf)) return refuse("model-configuration-changed");
  const template = metadata.config.gguf["tokenizer.chat_template"];
  if (typeof template !== "string" || template.length !== catalog.templateCharacters || textHash(template) !== catalog.templateDigest) return refuse("template-changed");
  const replay: typeof fetch = async input => {
    // The canonical interpreter asks for the logical selected reference. Its
    // config response above proves that alias resolves to the captured full SHA.
    const aliasMetadataUrl = `${urls[0]!.slice(0, -"/version".length)}/models/${modelRef.split("/").map(encodeURIComponent).join("/")}`;
    const text = responses.get(String(input) === aliasMetadataUrl ? urls[3]! : String(input));
    if (text === undefined) return refuse("uncaptured-context-read");
    return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
  };
  const reader: LocalContextReader = async (_fetch, selected) => {
    if (selected.provider.providerId !== provider.providerId || canonicalLocalModelKey(selected.modelId) !== canonicalLocalModelKey(modelRef)) return null;
    if (reassessmentNativeRuntimeUrls(selected.provider, selected.modelId).some((url, index) => url !== urls[index])) return refuse("context-endpoint-changed");
    const result = await resolveLocalRoutingRuntime(replay, selected);
    if (!positive(result.contextTokens)) return refuse("context-unproven");
    return result;
  };
  return { identity, runtimeConfigurationDigest: hash(configuration.Config), reader };
}

/** One bounded snapshot. Every GET is captured and consumes the existing root
 * allowance before this parser can brand its immutable logical observation. */
export async function captureReassessmentNativeRuntime(input: {
  provider: Provider; modelRef: string; fetchImpl: typeof fetch; assertCurrent(): Promise<void>;
}): Promise<ReassessmentNativeRuntimeObservation> {
  const qualification = currentReassessmentQualification();
  const execution = qualification ? null : currentReassessmentExecution();
  if (!qualification && !execution) return refuse("scope-required");
  const urls = reassessmentNativeRuntimeUrls(input.provider, input.modelRef);
  if (execution && (execution.qualification.providerId !== input.provider.providerId || execution.qualification.modelId !== input.modelRef
    || execution.qualification.finiteTokenProof?.apiRoot !== urls[0]!.slice(0, -"/version".length))) return refuse("bound-runtime-changed");
  const values: unknown[] = [], responses = new Map<string, string>(), exactBytes: Array<{ url: string; bodyBase64: string }> = [];
  for (const url of urls) {
    const response = await captureReassessmentHttpRequest({ url, method: "GET", operation: "configuration",
      fetchImpl: input.fetchImpl, assertCurrent: input.assertCurrent });
    if (!response.ok) return refuse("runtime-read-failed");
    const bytes = await response.arrayBuffer();
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); values.push(JSON.parse(text)); }
    catch { return refuse("runtime-response-invalid"); }
    responses.set(url, text); exactBytes.push({ url, bodyBase64: Buffer.from(bytes).toString("base64") });
  }
  const interpreted = interpret(input.provider, input.modelRef, urls, values, responses);
  const runtime = await interpreted.reader(undefined, { modelId: input.modelRef, provider: input.provider });
  const contextTokens = typeof runtime === "object" && runtime !== null ? runtime.contextTokens : runtime;
  if (!positive(contextTokens)) return refuse("context-unproven");
  const proof: ReassessmentFiniteTokenProof = Object.freeze({ schemaVersion: 1, kind: "dmr-native-messages-v1",
    apiRoot: urls[0]!.slice(0, -"/version".length), runtimeVersion: "v1.2.8", modelDigest: REASSESSMENT_NATIVE_COMPOSITION.modelDigest,
    engineIdentity: interpreted.identity, engineArtifactDigest: `sha256:${REASSESSMENT_NATIVE_COMPOSITION.engineArchiveDigest}`,
    engineSourceCommit: "72874f5", templateDigest: REASSESSMENT_NATIVE_COMPOSITION.templateDigest, configDigest: interpreted.runtimeConfigurationDigest });
  const observation = Object.freeze({ schemaVersion: 1 as const, catalogDigest: reassessmentNativeCatalogDigest(),
    observationDigest: hash({ urls, responses: exactBytes }), apiRoot: proof.apiRoot, modelRef: input.modelRef,
    modelsUrl: urls[4]!, contextTokens, finiteTokenProof: proof });
  observations.set(observation, { provider: input.provider, responses, reader: interpreted.reader, root: rootIdentity((qualification ?? execution)!) });
  return observation;
}

export function nativeRuntimeReaderFor(observation: ReassessmentNativeRuntimeObservation): LocalContextReader {
  const records = observations.get(observation);
  if (!records) return refuse("captured-observation-required");
  const assertRoot = () => {
    const current = currentReassessmentQualification() ?? currentReassessmentExecution();
    if (!current || records.root !== rootIdentity(current)) return refuse("observation-root-lineage-changed");
  };
  assertRoot();
  // Each request receives a fresh cache key; a process-wide loader entry cannot
  // substitute a former snapshot or carry this reader into another root.
  return async (fetch, selected) => { assertRoot(); return records.reader(fetch, selected); };
}

export function assertNativeRuntimeMatches(qualified: QualifiedReassessmentExecution, observed: ReassessmentNativeRuntimeObservation): void {
  nativeRuntimeReaderFor(observed);
  if (!qualified.finiteTokenProof || canonicalJson(qualified.finiteTokenProof) !== canonicalJson(observed.finiteTokenProof)) return refuse("runtime-changed");
}

/** Screening may refuse sensitive input; it cannot silently remove any part of
 * the finite reviewer's protected source/history and then count a smaller body. */
export function assertReassessmentNativeScreenUnchanged(before: { messages: unknown; systemPrompt: unknown; tools?: unknown },
  after: { messages: unknown; systemPrompt: unknown; tools?: unknown }): void {
  if (canonicalJson({ messages: before.messages, systemPrompt: before.systemPrompt, tools: before.tools ?? null })
    !== canonicalJson({ messages: after.messages, systemPrompt: after.systemPrompt, tools: after.tools ?? null })) return refuse("screen-payload-changed");
}

/** Fresh logical evidence timestamps may change; all semantic plan fields,
 * actual settings and policy choices must still equal the admitted plan. */
export function reassessmentNativePlansEqual(left: RoutedExecutionPlan, right: RoutedExecutionPlan): boolean {
  const semantic = (plan: RoutedExecutionPlan) => ({ ...plan, ...(plan.localThinkingBudgetEvidence ? {
    localThinkingBudgetEvidence: { ...plan.localThinkingBudgetEvidence, observedAt: null },
  } : {}) });
  return canonicalJson(semantic(left)) === canonicalJson(semantic(right));
}

/** Concrete native wire contract. Neither an adapter selector nor an old v1
 * finite DTO can activate it; every call requires the actual promoted E scope. */
export function reassessmentNativeMessagesFetch(plan: RoutedExecutionPlan, tools?: Array<Record<string, unknown>>): typeof fetch {
  const admitted = currentFiniteReassessmentExecution();
  if (!admitted) return refuse("promoted-execution-required");
  return async (input, init) => {
    const current = currentFiniteReassessmentExecution();
    if (!current || current !== admitted) return refuse("execution-root-changed");
    assertReassessmentPlan({ providerId: plan.providerId, modelId: plan.modelId, plan, tools });
    const proof = current.qualification.finiteTokenProof!;
    const root = `${proof.apiRoot}/engines/llama.cpp/v1/messages`;
    const url = typeof input === "string" || input instanceof URL ? String(input) : "";
    const operation = url === root ? "generation" : url === `${root}/count_tokens` ? "count" : null;
    if (!operation || init?.method !== "POST" || typeof init.body !== "string" || init.redirect !== "error"
      || Object.keys(init).some(key => !["method", "headers", "body", "redirect", "signal"].includes(key))) return refuse("message-transport-unsupported");
    const headers = new Headers(init.headers);
    if (headers.get("content-type") !== "application/json" || [...headers].some(([key, value]) => key !== "content-type" || value !== "application/json")) return refuse("message-headers-unsupported");
    let body: Record<string, unknown>;
    try { body = JSON.parse(init.body); } catch { return refuse("message-body-invalid"); }
    const wireTools = tools?.map(tool => {
      const fn = tool.function as { name?: unknown; description?: unknown; parameters?: unknown };
      return { name: fn.name, ...(fn.description !== undefined ? { description: fn.description } : {}), input_schema: fn.parameters };
    });
    if (!object(body) || Object.keys(body).some(key => !["model", "system", "messages", "tools", "tool_choice", "max_tokens", "stream", "temperature", "top_p", "top_k"].includes(key))
      || body.model !== proof.modelDigest || body.max_tokens !== current.qualification.bounds.maxOutputTokens
      || body.stream !== false || typeof body.system !== "string" || !Array.isArray(body.messages)
      || canonicalJson(body.tools) !== canonicalJson(wireTools)) return refuse("message-body-changed");
    const ports = currentReassessmentHttpTransport();
    return captureReassessmentHttpRequest({ ...ports, url, method: "POST", operation, bodyUtf8: init.body,
      headers, signal: init.signal ?? undefined });
  };
}
