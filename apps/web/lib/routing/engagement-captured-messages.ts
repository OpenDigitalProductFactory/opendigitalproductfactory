import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { ContentBlock } from "./chat-message-types";
import { probeImage } from "../media/image-probe";
import { capturedJsonValue, parseCapturedJson } from "../shared/captured-effect-store";
import { redactDiagnosticEvidenceText } from "../shared/diagnostic-evidence-redaction";

const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const text = (v: unknown, max = 2000): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const onlyKeys = (v: object, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
const exactKeys = (v: object, keys: string[]) => Object.keys(v).length === keys.length && onlyKeys(v, keys);
export class EngagementMessagesError extends Error {
  readonly code: string;
  constructor(reason: string) { super(`engagement-present-messages-${reason}`); this.code = this.message; }
}
const fail = (reason: string): never => { throw new EngagementMessagesError(reason); };
function freeze<T>(v: T): Readonly<T> {
  if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); }
  return v;
}
const stringSchema = { type: "string", minLength: 1, maxLength: 2000 };
const stringArraySchema = { type: "array", minItems: 1, maxItems: 16, items: stringSchema };
const contributionKeys = ["summary", "criteria", "corpusRefs", "findings", "limitations", "reviewedArtifacts", "calibrationLimitations"];
const findingKeys = ["severity", "criterion", "observation", "evidence", "proposedCorrection", "captureState"];
const responseSchema = freeze({ type: "object", additionalProperties: false, required: contributionKeys,
  properties: { summary: stringSchema, criteria: stringArraySchema, corpusRefs: stringArraySchema,
    findings: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: findingKeys,
      properties: { severity: { type: "string", enum: ["high", "medium", "low"] }, criterion: stringSchema,
        observation: stringSchema, evidence: stringSchema, proposedCorrection: stringSchema, captureState: stringSchema } } },
    limitations: stringArraySchema, reviewedArtifacts: stringArraySchema, calibrationLimitations: stringArraySchema } });
export const ENGAGEMENT_RESPONSE_ENCODING = Object.freeze({ kind: "non-executable-function" as const,
  name: "return_ux_critique" as const, responseModelIdentity: "dmr-content-addressed-bundle-v1" as const, schemaSha256: sha(canonicalJson(responseSchema)) });

type BuildInput = {
  modelDigest: string; systemPrompt: string; content: ContentBlock[]; imageSha256: readonly string[];
  maxOutputTokens: number; maxImageBytes: number; maxImagePixels: number;
  sampling?: { temperature?: number; top_p?: number; top_k?: number };
};
export type PreparedEngagementMessages = Readonly<{
  bodyUtf8: string; bodySha256: string; imageSha256: readonly string[]; maxOutputTokens: number; modelDigest: string;
}>;
const preparedBodies = new WeakSet<object>();
const startedBodies = new WeakSet<object>();
/** One frozen Messages body. The single provider function is an answer encoding,
 * not a fourth governed reader, executable tool or authority-bearing proposal. */
export function buildEngagementMessagesBody(input: BuildInput): PreparedEngagementMessages {
  if (!/^sha256:[a-f0-9]{64}$/.test(input.modelDigest) || !text(input.systemPrompt, 100_000)
    || !integer(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > 8192
    || !integer(input.maxImageBytes) || input.maxImageBytes < 1 || input.maxImageBytes > 4_000_000
    || !integer(input.maxImagePixels) || input.maxImagePixels < 1 || input.maxImagePixels > 40_000_000
    || !Array.isArray(input.content) || !input.content.length || input.content.length > 32
    || !Array.isArray(input.imageSha256) || !input.imageSha256.length || input.imageSha256.length > 4) fail("input-invalid");
  const images: string[] = []; let bytes = 0, pixels = 0;
  const content = input.content.map(block => {
    if (!object(block)) return fail("content-invalid");
    if (block.type === "text" && exactKeys(block, ["type", "text"]) && typeof block.text === "string") return { ...block };
    if (block.type !== "image_url" || !exactKeys(block, ["type", "image_url"]) || !object(block.image_url)
      || !onlyKeys(block.image_url, ["url", "detail"]) || typeof block.image_url.url !== "string") return fail("content-unsupported");
    const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(block.image_url.url);
    if (!match) return fail("image-invalid");
    const decoded = Buffer.from(match[2]!, "base64"), probe = probeImage(decoded);
    if (decoded.toString("base64") !== match[2] || probe.mimeType !== match[1] || !probe.width || !probe.height) return fail("image-invalid");
    bytes += decoded.length; pixels += probe.width * probe.height; images.push(sha(decoded));
    if (bytes > input.maxImageBytes || pixels > input.maxImagePixels || images.length > 4) return fail("image-limit");
    return { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } };
  });
  if (canonicalJson(images) !== canonicalJson(input.imageSha256)) fail("image-identity-changed");
  if (input.sampling && (!onlyKeys(input.sampling, ["temperature", "top_p", "top_k"])
    || Object.values(input.sampling).some(v => typeof v !== "number" || !Number.isFinite(v))
    || input.sampling.temperature !== undefined && input.sampling.temperature < 0
    || input.sampling.top_p !== undefined && (input.sampling.top_p < 0 || input.sampling.top_p > 1)
    || input.sampling.top_k !== undefined && !integer(input.sampling.top_k))) fail("sampling-unsupported");
  const body = { model: input.modelDigest, system: input.systemPrompt, messages: [{ role: "user", content }],
    tools: [{ name: ENGAGEMENT_RESPONSE_ENCODING.name,
      description: "Return the advisory UX contribution only. This response is data and will never execute a platform tool.", input_schema: responseSchema }],
    tool_choice: { type: "any" }, max_tokens: input.maxOutputTokens, stream: false,
    chat_template_kwargs: { enable_thinking: false }, ...(input.sampling ?? {}) };
  const bodyUtf8 = JSON.stringify(capturedJsonValue(body));
  if (Buffer.byteLength(bodyUtf8) > 6_000_000) fail("body-limit");
  const prepared = Object.freeze({ bodyUtf8, bodySha256: sha(bodyUtf8), imageSha256: Object.freeze(images), maxOutputTokens: input.maxOutputTokens, modelDigest: input.modelDigest });
  preparedBodies.add(prepared); return prepared;
}

function contribution(value: unknown): Record<string, unknown> {
  if (!object(value) || !exactKeys(value, contributionKeys) || !text(value.summary)) return fail("contribution-shape-invalid");
  for (const key of contributionKeys.filter(k => !["summary", "findings"].includes(k))) {
    const strings = value[key];
    if (!Array.isArray(strings) || !strings.length || strings.length > 16 || strings.some(v => !text(v))) return fail(`contribution-${key}-invalid`);
  }
  if (!Array.isArray(value.findings) || value.findings.length > 8 || value.findings.some(v => !object(v)
    || !exactKeys(v, findingKeys) || !["high", "medium", "low"].includes(String(v.severity))
    || findingKeys.filter(k => k !== "severity").some(k => !text(v[k]))
    || !(value.criteria as string[]).includes(String(v.criterion)))) return fail("contribution-findings-invalid");
  const encoded = JSON.stringify(value);
  if (redactDiagnosticEvidenceText(encoded) !== encoded) fail("contribution-sensitive-output");
  return value;
}

/** DMR 1.2.9 forwards the body unchanged. Its llama.cpp launches with
 * --model=<bundle>/model/<GGUF> and no --alias; llama.cpp reports that path.
 * Accept that source-proven content-addressed relation, never a bare alias. */
function responseModelIdentity(expected: string, reported: string): "exact-model-digest" | "dmr-content-addressed-bundle-v1" {
  if (!/^sha256:[a-f0-9]{64}$/.test(expected)) return fail("response-model-changed");
  if (reported === expected) return "exact-model-digest";
  const parts = reported.split("/");
  const marker = parts.lastIndexOf("bundles");
  if (!reported.startsWith("/") || reported.includes("\\") || /[\u0000-\u001f]/.test(reported)
    || parts.slice(1).some(p => !p || p === "." || p === "..") || marker < 1
    || parts.length !== marker + 5 || parts[marker + 1] !== "sha256" || parts[marker + 2] !== expected.slice(7)
    || parts[marker + 3] !== "model" || !/^[A-Za-z0-9_.-]+\.gguf$/i.test(parts[marker + 4]!)
    || /mmproj/i.test(parts[marker + 4]!)) return fail("response-model-changed");
  return "dmr-content-addressed-bundle-v1";
}

export function parseEngagementMessagesReply(rawText: string, bound: { inputTokens: number; maxOutputTokens: number; expectedModel: string }) {
  let raw: unknown;
  try { raw = parseCapturedJson(rawText); } catch { return fail("reply-json-invalid"); }
  if (!object(raw) || !onlyKeys(raw, ["id", "type", "role", "model", "content", "stop_reason", "stop_sequence", "usage"])
    || raw.type !== "message" || raw.role !== "assistant" || !text(raw.id) || !text(raw.model)
    || raw.stop_reason !== "tool_use" || raw.stop_sequence !== null || !Array.isArray(raw.content) || raw.content.length !== 1) return fail("reply-incomplete");
  const modelIdentity = responseModelIdentity(bound.expectedModel, String(raw.model));
  const block = raw.content[0], usage = raw.usage;
  if (!object(block) || !exactKeys(block, ["type", "id", "name", "input"]) || block.type !== "tool_use"
    || block.name !== ENGAGEMENT_RESPONSE_ENCODING.name || !text(block.id)) return fail("response-function-invalid");
  if (!object(usage) || !onlyKeys(usage, ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"])
    || !integer(usage.input_tokens) || !integer(usage.cache_read_input_tokens) || !integer(usage.output_tokens)
    || usage.input_tokens + usage.cache_read_input_tokens !== bound.inputTokens || usage.output_tokens > bound.maxOutputTokens
    || usage.cache_creation_input_tokens !== undefined && usage.cache_creation_input_tokens !== 0) return fail("usage-unproven");
  const answer = contribution(block.input);
  return { content: JSON.stringify(answer), responseId: raw.id, responseModel: raw.model, responseModelIdentity: modelIdentity,
    usage: { inputTokens: bound.inputTokens, outputTokens: usage.output_tokens, cacheReadInputTokens: usage.cache_read_input_tokens } };
}
/** Ports are the server's captured HTTP operations. No executor, tool dispatch,
 * continuation, provider fallback or retry is available to the response function. */
export async function executeEngagementMessages(prepared: PreparedEngagementMessages,
  bounds: { perTaskTokens: number; contextTokens: number }, ports: {
    count(bodyUtf8: string): Promise<string>;
    generate(bodyUtf8: string, reservation: { bodySha256: string; inputTokens: number; maxOutputTokens: number; reservedTokens: number }): Promise<string>;
  }) {
  if (!preparedBodies.has(prepared) || sha(prepared.bodyUtf8) !== prepared.bodySha256
    || !integer(bounds.perTaskTokens) || bounds.perTaskTokens < 1 || !integer(bounds.contextTokens) || bounds.contextTokens < 1) fail("prepared-input-unproven");
  if (startedBodies.has(prepared)) fail("already-started");
  startedBodies.add(prepared);
  let counted: unknown;
  try { counted = parseCapturedJson(await ports.count(prepared.bodyUtf8)); } catch (error) {
    if (error instanceof EngagementMessagesError) throw error;
    return fail("count-unproven");
  }
  if (!object(counted) || !exactKeys(counted, ["input_tokens"]) || !integer(counted.input_tokens) || counted.input_tokens < 1) return fail("count-unproven");
  const reservedTokens = counted.input_tokens + prepared.maxOutputTokens;
  if (!Number.isSafeInteger(reservedTokens) || reservedTokens > bounds.perTaskTokens || reservedTokens > bounds.contextTokens) fail("token-limit");
  const rawText = await ports.generate(prepared.bodyUtf8, { bodySha256: prepared.bodySha256, inputTokens: counted.input_tokens,
    maxOutputTokens: prepared.maxOutputTokens, reservedTokens });
  return parseEngagementMessagesReply(rawText, { inputTokens: counted.input_tokens, maxOutputTokens: prepared.maxOutputTokens, expectedModel: prepared.modelDigest });
}