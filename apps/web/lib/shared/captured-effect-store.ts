import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";

type RefuseCapture = (code: "invalid" | "secret", message: string) => never;
const refuseCapture: RefuseCapture = (code, message) => { throw new Error(`capture-${code}: ${message}`); };

/** Shared encoding only; this grants no task, tool, provider or publication authority. */
export function capturedJsonValue(value: unknown, refuse: RefuseCapture = refuseCapture): Prisma.InputJsonValue {
  const active = new Set<object>();
  const invalid = (): never => refuse("invalid", "The complete capture is not losslessly serializable JSON.");
  const visit = (entry: unknown): void => {
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") return;
    if (typeof entry === "number" && Number.isFinite(entry)) return;
    if (typeof entry !== "object" || active.has(entry)
      || (!Array.isArray(entry) && Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null)) invalid();
    const arrayLength = Array.isArray(entry) ? entry.length : null;
    const keys = Reflect.ownKeys(entry as object);
    if (arrayLength !== null && keys.length !== arrayLength + 1) invalid();
    active.add(entry as object);
    for (const key of keys) {
      if (arrayLength !== null && key === "length") continue;
      const property = Object.getOwnPropertyDescriptor(entry, key);
      if (typeof key !== "string" || !property?.enumerable || !Object.prototype.hasOwnProperty.call(property, "value")
        || (arrayLength !== null && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= arrayLength))) invalid();
      if (/^(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|credential|credentials)$/i.test(String(key))) {
        refuse("secret", "Authentication secrets cannot enter capture.");
      }
      visit(property!.value);
    }
    active.delete(entry as object);
  };
  visit(value);
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

type CapturedArtifactIdentity = {
  namespace: string; taskRunId: string; manifestDigest: string; kind: string; key: unknown;
};
export function capturedTaskArtifactId(input: CapturedArtifactIdentity): string {
  if (!/^[a-z][a-z0-9-]{0,50}$/.test(input.namespace) || !input.taskRunId || !input.kind
    || !/^[a-f0-9]{64}$/.test(input.manifestDigest)) throw new Error("capture-artifact-identity-invalid");
  const { taskRunId, manifestDigest, kind, key } = input;
  const identity = capturedJsonValue({ taskRunId, manifestDigest, kind, key });
  return `ta-${input.namespace}-${createHash("sha256").update(canonicalJson(identity)).digest("hex")}`;
}

/** Caller owns its transaction, current authority and fence checks. Unique ids
 * make reservation appends fail closed; this helper never upserts or retries. */
export async function appendCapturedTaskArtifact(tx: Pick<Prisma.TransactionClient, "taskArtifact">,
  input: CapturedArtifactIdentity & { taskRunRecordId: string; agentId: string; data: unknown; metadata: unknown }): Promise<void> {
  const artifactId = capturedTaskArtifactId(input);
  await tx.taskArtifact.create({ data: {
    id: randomUUID(), artifactId, taskRunId: input.taskRunRecordId, name: input.kind,
    parts: capturedJsonValue([{ type: input.kind, mimeType: "application/json", data: input.data }]),
    metadata: capturedJsonValue(input.metadata), producerAgentId: input.agentId,
  } });
}
function duplicateMember(source: string): boolean {
  const stack: Array<{ object: boolean; key: boolean; names: Set<string> }> = [];
  for (const match of source.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]/g)) {
    const token = match[0], frame = stack.at(-1);
    if (token === "{" || token === "[") stack.push({ object: token === "{", key: token === "{", names: new Set() });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && frame?.object) frame.key = true;
    else if (token.startsWith('"') && frame?.object && frame.key) {
      const name = JSON.parse(token) as string;
      if (frame.names.has(name)) return true;
      frame.names.add(name); frame.key = false;
    }
  }
  return false;
}

/** Decode complete bounded provider/policy JSON without duplicate object members.
 * Escaped key spellings cannot give different parsers different authority or results. */
export function parseCapturedJson(source: string): unknown {
  if (typeof source !== "string" || Buffer.byteLength(source) > 1024 * 1024 || duplicateMember(source)) {
    throw new Error("capture-json-ambiguous-or-limit");
  }
  return JSON.parse(source) as unknown;
}
const capturedProviderScopes = new AsyncLocalStorage<{ violated: boolean; closed: boolean }>();
/** Narrows a finite server workflow; never grants an effect or an identity.
 * Descendant async work remains fenced even after its parent returned. */
export async function withCapturedProviderTransportOnly<T>(execute: () => Promise<T>): Promise<T> {
  if (capturedProviderScopes.getStore()) return execute();
  const frame = { violated: false, closed: false };
  try { return await capturedProviderScopes.run(frame, execute); }
  finally { frame.closed = true; }
}
export function assertOrdinaryProviderTransportAllowed(): void {
  const scope = capturedProviderScopes.getStore();
  if (scope) { scope.violated = true; throw new Error("capture-provider-transport-required"); }
}
export function assertCapturedProviderTransportClean(): void {
  if (capturedProviderScopes.getStore()?.closed) throw new Error("capture-provider-scope-expired");
  if (capturedProviderScopes.getStore()?.violated) throw new Error("capture-unmediated-provider-attempt");
}

export function inCapturedProviderTransportScope(): boolean { return !!capturedProviderScopes.getStore(); }

export type CapturedNativeImageInputEvidence = Readonly<{ schemaVersion: 1; kind: "captured-native-image-input";
  modelId: string; modelDigest: string; observationDigest: string }>;
const capturedImages = new WeakMap<object, { violated: boolean; closed: boolean }>();
/** The server producer must first validate its captured model/engine/template
 * image path. This container supplies identity and lifetime, never authority
 * or an independent capability proof. Serialized copies cannot activate it. */
export function createCapturedNativeImageInputEvidence(input: {
  modelId: string; modelDigest: string; observationDigest: string;
}): CapturedNativeImageInputEvidence {
  const frame = capturedProviderScopes.getStore();
  if (!frame || frame.closed || frame.violated) throw new Error("capture-provider-scope-required");
  if (!input.modelId || !/^sha256:[a-f0-9]{64}$/.test(input.modelDigest) || !/^[a-f0-9]{64}$/.test(input.observationDigest)) {
    throw new Error("capture-native-image-evidence-invalid");
  }
  const evidence = Object.freeze({ schemaVersion: 1 as const, kind: "captured-native-image-input" as const, ...input });
  capturedImages.set(evidence, frame); return evidence;
}
export function isCapturedNativeImageInputEvidence(value: unknown, modelId: string): value is CapturedNativeImageInputEvidence {
  const frame = capturedProviderScopes.getStore();
  return !!frame && !frame.closed && !frame.violated && !!value && typeof value === "object"
    && capturedImages.get(value) === frame && (value as CapturedNativeImageInputEvidence).modelId === modelId;
}
