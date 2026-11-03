import { isLocalProviderId } from "../routing/provider-locality";
import { assertGovernedInferenceAuthority, currentInferenceSignal } from "../routing/governed-inference-deadline";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";

export type ProviderAttemptIdentity = { providerId: string; modelId: string; providerConnectionId?: string; traceId?: string | null; accountMode: "local" | "credential" | "unresolved" };
export type ProviderSettlementEvent = Partial<ProviderAttemptIdentity> & {
  attemptId: string;
  state: "adapter-registered" | "adapter-not-dispatched" | "dispatching" | "response-completed" | "client-ended";
  providerRequestId?: string;
  adapterAttemptId?: string; responseDigest?: string; providerId?: string; modelId?: string; providerConnectionId?: string; traceId?: string | null;
};
export type ProviderSettlementWriter = (event: ProviderSettlementEvent) => Promise<void>;

/** Observe the original HTTP response only. Abort/EOF alone never attests provider settlement. */
export function captureProviderFetch(fetchImpl: typeof fetch, write: ProviderSettlementWriter): typeof fetch {
  return async (input, init) => {
    const attemptId = randomUUID();
    await write({ attemptId, state: "dispatching" });
    let response: Response;
    try { response = await fetchImpl(input, init); }
    catch (error) {
      await write({ attemptId, state: "client-ended" });
      throw error;
    }
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    // This is an evidence bound, never a generation or response-size limit.
    const maxEvidenceBytes = 262_144;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (!next.done) {
            size += next.value.byteLength;
            if (size <= maxEvidenceBytes) chunks.push(next.value);
            controller.enqueue(next.value);
            return;
          }
          const bytes = size <= maxEvidenceBytes ? Buffer.concat(chunks) : null;
          const providerRequestId = response.ok && bytes ? completedChatResponse(bytes) : null;
          await write(providerRequestId && bytes
            ? { attemptId, state: "response-completed", providerRequestId,
                responseDigest: createHash("sha256").update(bytes).digest("hex") }
            : { attemptId, state: "client-ended" });
          controller.close();
        } catch (error) { controller.error(error); }
      },
      async cancel(reason) {
        try { await reader.cancel(reason); }
        finally { await write({ attemptId, state: "client-ended" }); }
      },
    }, { highWaterMark: 0 });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

function completedChatResponse(bytes: Uint8Array): string | null {
  try {
    const value = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (!value || typeof value.id !== "string" || !value.id.trim() || value.id.length > 512
      || !Array.isArray(value.choices) || value.choices.length === 0
      || !value.choices.every((choice: unknown) => choice !== null && typeof choice === "object"
        && typeof (choice as { finish_reason?: unknown }).finish_reason === "string"
        && ["stop", "length", "tool_calls", "function_call", "content_filter"].includes((choice as { finish_reason: string }).finish_reason))) return null;
    return value.id;
  } catch { return null; }
}

/** A local ledger predicate, not recovery authority. The caller must authenticate its binding. */
export function providerAttemptsSettled(events: readonly Pick<ProviderSettlementEvent, "attemptId" | "state">[]): boolean {
  const started = new Set<string>();
  const completed = new Set<string>();
  for (const event of events) {
    if (event.state === "dispatching") {
      if (!event.attemptId || started.has(event.attemptId)) return false;
      started.add(event.attemptId);
    } else if (event.state === "response-completed") {
      if (!started.has(event.attemptId)) return false;
      completed.add(event.attemptId);
    }
  }
  return started.size > 0 && [...started].every(id => completed.has(id));
}

const WRITERS_KEY = Symbol.for("dpf.provider-settlement.writers.v1");
const writerGlobal = globalThis as typeof globalThis & { [WRITERS_KEY]?: AsyncLocalStorage<ProviderSettlementWriter> };
const writers = writerGlobal[WRITERS_KEY] ??= new AsyncLocalStorage<ProviderSettlementWriter>();
/** Server-only scoped writer; a caller without a writer retains ordinary transport behavior. */
export function withProviderSettlementWriter<T>(write: ProviderSettlementWriter, execute: () => T): T {
  return writers.run(write, execute);
}
export function providerSettlementFetch(fetchImpl: typeof fetch, binding: ProviderAttemptIdentity & { adapterAttemptId: string }): typeof fetch {
  const write = writers.getStore();
  return write ? captureProviderFetch(async (input, init) => {
    await assertGovernedInferenceAuthority(currentInferenceSignal());
    return fetchImpl(input, init);
  }, event => write({ ...event, ...binding })) : fetchImpl;
}
export async function registerProviderSettlementAttempt(attemptId: string, identity: ProviderAttemptIdentity): Promise<void> {
  await writers.getStore()?.({ attemptId, state: "adapter-registered", ...identity });
}
export type ProviderSettlementBinding = { taskNodeId: string; requestDigest: string; generation: string };
export type ProviderSettlementLedger = ProviderSettlementBinding & { schemaVersion: 1; sealed: boolean; events: ProviderSettlementEvent[] };
const MAX_EVENTS = 64;
function ledgerFor(value: unknown, binding: ProviderSettlementBinding): ProviderSettlementLedger {
  if (value == null) return { ...binding, schemaVersion: 1, sealed: false, events: [] };
  const v = value as ProviderSettlementLedger;
  if (!v || v.schemaVersion !== 1 || typeof v.sealed !== "boolean" || !Array.isArray(v.events)
    || v.events.length > MAX_EVENTS || v.taskNodeId !== binding.taskNodeId
    || v.requestDigest !== binding.requestDigest || v.generation !== binding.generation)
    throw new Error("provider-settlement-binding-invalid");
  return v;
}
export function appendProviderSettlement(value: unknown, event: ProviderSettlementEvent, binding: ProviderSettlementBinding): ProviderSettlementLedger {
  const ledger = ledgerFor(value, binding);
  if (ledger.sealed || ledger.events.length >= MAX_EVENTS) throw new Error("provider-settlement-registration-closed");
  if (ledger.events.some(e => e.attemptId === event.attemptId && e.state === event.state))
    throw new Error("provider-settlement-duplicate-observation");
  return { ...ledger, events: [...ledger.events, event] };
}
export function sealProviderSettlement(value: unknown, binding: ProviderSettlementBinding): ProviderSettlementLedger {
  return { ...ledgerFor(value, binding), sealed: true };
}
export function providerLedgerSettled(value: unknown, binding: ProviderSettlementBinding): boolean {
  try {
    const ledger = ledgerFor(value, binding);
    if (!ledger.sealed || ledger.events.length === 0) return false;
    const registered = ledger.events.filter(e => e.state === "adapter-registered").map(e => e.attemptId);
    const requests = ledger.events.filter(e => e.state !== "adapter-registered" && e.state !== "adapter-not-dispatched");
    const notDispatched = ledger.events.filter(e => e.state === "adapter-not-dispatched").map(e => e.attemptId);
    if (registered.length === 0 || new Set(registered).size !== registered.length
      || registered.some(id => !notDispatched.includes(id) && !requests.some(e => e.adapterAttemptId === id && e.state === "dispatching"))
      || notDispatched.some(id => !registered.includes(id) || requests.some(e => e.adapterAttemptId === id))
      || requests.some(e => !e.adapterAttemptId || !registered.includes(e.adapterAttemptId))
      || requests.some(e => e.state === "response-completed" && (!e.providerRequestId
        || typeof e.responseDigest !== "string" || !/^[a-f0-9]{64}$/.test(e.responseDigest)))) return false;
    const identities = ledger.events.filter(e => e.state === "adapter-registered");
    const keys = ["providerId", "modelId", "providerConnectionId", "traceId", "accountMode"] as const;
    if (identities.some(e => typeof e.providerId !== "string" || !e.providerId || e.providerId.length > 256
      || typeof e.modelId !== "string" || !e.modelId || e.modelId.length > 512
      || typeof e.traceId !== "string" || !e.traceId || e.traceId.length > 128
      || !(e.accountMode === "local" && isLocalProviderId(e.providerId) && !e.providerConnectionId
        || e.accountMode === "credential" && typeof e.providerConnectionId === "string" && !!e.providerConnectionId))
      || requests.some(e => { const identity = identities.find(i => i.attemptId === e.adapterAttemptId);
        return !identity || keys.some(key => e[key] !== identity[key]); })) return false;
    return requests.length === 0 ? registered.every(id => notDispatched.includes(id)) : providerAttemptsSettled(requests);
  } catch { return false; }
}


export async function recordProviderAdmissionEnded(attemptId: string): Promise<void> {
  await writers.getStore()?.({ attemptId, state: "adapter-not-dispatched" });
}
