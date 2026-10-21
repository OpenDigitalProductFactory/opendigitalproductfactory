import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { currentGovernedInferenceDeadline, currentInferenceSignal } from "./governed-inference-deadline";
import type { LocalThinkingBudgetEvidence } from "./types";

/** Safe identity only. Possessing a binding grants no tool or dispatch authority. */
export type LocalContinuationBinding = Readonly<{ fingerprint: string }>;
type BindingInput = {
  providerId: string; modelId: string; apiEndpoint: string;
  providerConnectionId?: string; providerConnectionVersion?: string;
  runtime: LocalThinkingBudgetEvidence; systemPrompt: string;
  tools?: ReadonlyArray<Record<string, unknown>>;
};
type Continuation = {
  binding: string; snapshot: string; reasoning: string; fingerprint: string;
};
type Invocation = {
  active: boolean; captures: number; capturedChars: number;
  entries: WeakMap<object, Continuation>;
  policyFingerprint?: string;
};

const invocations = new AsyncLocalStorage<Invocation>();
// Factory-issued objects carry only a digest. The weak registry prevents a
// spread/cast object from masquerading as a verified binding.
const bindings = new WeakMap<LocalContinuationBinding, string>();
const AUDITED_TEMPLATE = "c3cf9e34abf4f9e36c2d72165aa9c132d3e2a725b6c2586aaa3a8af9d7a81041";
// UTF-16 code units, matching the context estimator: at most 128 KiB of raw
// reasoning per capture, 512 KiB per invocation, and 64 capture records. Limits
// omit a WHOLE continuation; they never manufacture a truncated native trace.
// Transfers share one private record and consume no additional raw storage.
// The cumulative budget is deliberately not reclaimed on invalidation/GC.
const MAX_CAPTURE_CHARS = 65_536;
const MAX_INVOCATION_CHARS = 262_144;
const MAX_CAPTURES = 64;
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const currentSignal = (): AbortSignal | undefined =>
  currentInferenceSignal(currentGovernedInferenceDeadline()?.signal);

function close(invocation: Invocation): void {
  invocation.active = false;
  invocation.entries = new WeakMap();
}

function activeInvocation(): Invocation | undefined {
  const invocation = invocations.getStore();
  if (!invocation?.active) return undefined;
  if (currentSignal()?.aborted) {
    close(invocation);
    return undefined;
  }
  return invocation;
}

/** One active loop/recovery invocation; late async descendants cannot revive it. */
export async function withLocalNativeContinuation<T>(execute: () => Promise<T>): Promise<T> {
  const invocation: Invocation = {
    active: true, captures: 0, capturedChars: 0, entries: new WeakMap(),
  };
  const signal = currentSignal();
  const abort = () => close(invocation);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) close(invocation);
  try {
    return await invocations.run(invocation, execute);
  } finally {
    signal?.removeEventListener("abort", abort);
    close(invocation);
  }
}

export function isLocalNativeContinuationActive(): boolean {
  return activeInvocation() !== undefined;
}

/** The caller must obtain this runtime proof from the live DMR recognizer again
 * at dispatch. Shape checks here neither establish freshness nor authorize it. */
export function createLocalContinuationBinding(input: BindingInput): LocalContinuationBinding | undefined {
  try {
    const runtime = input.runtime;
    const endpoint = new URL(input.apiEndpoint);
    if (input.providerId !== "local" || typeof input.modelId !== "string" || !input.modelId.trim()
      || !["http:", "https:"].includes(endpoint.protocol)
      || typeof input.systemPrompt !== "string" || !runtime
      || runtime.dialect !== "llama.cpp-b9879" || runtime.templateDigest !== AUDITED_TEMPLATE
      || !/^sha256:[a-f0-9]{64}$/.test(runtime.modelDigest)
      || !/^[a-f0-9]{64}$/.test(runtime.configDigest)
      || !/^Running: llama\.cpp b9879(?:-|\s)/.test(runtime.engineIdentity)) return undefined;
    const fingerprint = sha256(JSON.stringify({
      providerId: input.providerId, modelId: input.modelId,
      apiEndpoint: endpoint.href,
      providerConnectionId: input.providerConnectionId ?? null,
      providerConnectionVersion: input.providerConnectionVersion ?? null,
      dialect: runtime.dialect, modelDigest: runtime.modelDigest,
      engineIdentity: runtime.engineIdentity, templateDigest: runtime.templateDigest,
      configDigest: runtime.configDigest,
      // Preserve tools ordering, which is part of the actual prompt prefix.
      systemPrompt: input.systemPrompt, tools: input.tools ?? [],
    }));
    const binding = Object.freeze({ fingerprint });
    bindings.set(binding, fingerprint);
    return binding;
  } catch {
    // Unsupported/cyclic inputs disable this optimization, without diagnostics
    // that could expose a private system prompt, tool payload, or native trace.
    return undefined;
  }
}

/** Adapter `text` and inference/history `content` share the same snapshot.
 * Message mutation, malformed history and unfinished reasoning-only output
 * invalidate native state rather than attempting to repair its semantics. */
function snapshot(target: object): string | undefined {
  try {
    const value = target as { role?: unknown; text?: unknown; content?: unknown; toolCalls?: unknown };
    if (value.role !== undefined && value.role !== "assistant") return undefined;
    if (value.text !== undefined && typeof value.text !== "string") return undefined;
    if (value.content !== undefined && typeof value.content !== "string") return undefined;
    if (typeof value.text === "string" && typeof value.content === "string" && value.text !== value.content) return undefined;
    const content = typeof value.text === "string" ? value.text : value.content;
    if (typeof content !== "string") return undefined;
    if (value.toolCalls !== undefined && !Array.isArray(value.toolCalls)) return undefined;
    const toolCalls = value.toolCalls ?? [];
    if (!content.trim() && !(toolCalls as unknown[]).length) return undefined;
    return sha256(JSON.stringify({ content, toolCalls }));
  } catch {
    return undefined;
  }
}

function continuation(target: object): Continuation | undefined {
  const invocation = activeInvocation();
  const entry = invocation?.entries.get(target);
  if (!entry) return undefined;
  if (!entry.reasoning || snapshot(target) !== entry.snapshot) {
    entry.reasoning = "";
    invocation!.entries.delete(target);
    return undefined;
  }
  return entry;
}

export function captureLocalNativeContinuation(
  target: object, reasoning: string, binding: LocalContinuationBinding | undefined,
): void {
  const invocation = activeInvocation();
  if (!invocation) return;
  invocation.entries.delete(target);
  const identity = binding && bindings.get(binding);
  if (!identity || typeof reasoning !== "string" || !reasoning.length
    || reasoning.length > MAX_CAPTURE_CHARS || invocation.captures >= MAX_CAPTURES
    || invocation.capturedChars + reasoning.length > MAX_INVOCATION_CHARS) return;
  const messageSnapshot = snapshot(target);
  if (!messageSnapshot) return;
  const fingerprint = `local-native/v1:${sha256(JSON.stringify({
    binding: identity, snapshot: messageSnapshot, reasoningDigest: sha256(reasoning), chars: reasoning.length,
  }))}:${reasoning.length}`;
  invocation.entries.set(target, {
    binding: identity, snapshot: messageSnapshot, reasoning, fingerprint,
  });
  invocation.captures++;
  invocation.capturedChars += reasoning.length;
}

/** Copy private state only when ordinary answer/tool-call snapshots agree. */
export function transferLocalNativeContinuation<T extends object>(source: object, target: T): T {
  const invocation = activeInvocation();
  if (!invocation) return target;
  const entry = continuation(source);
  invocation.entries.delete(target);
  if (entry && snapshot(target) === entry.snapshot) invocation.entries.set(target, entry);
  return target;
}

export function readLocalNativeContinuation(
  target: object, binding: LocalContinuationBinding | undefined,
): string | undefined {
  const identity = binding && bindings.get(binding);
  if (!identity) return undefined;
  const entry = continuation(target);
  return entry?.binding === identity ? entry.reasoning : undefined;
}

/** Digest and character count only, suitable for screening payload fingerprints. */
export function localNativeContinuationFingerprint(target: object): string | undefined {
  return continuation(target)?.fingerprint;
}

export function localNativeContinuationChars(target: object): number {
  return continuation(target)?.reasoning.length ?? 0;
}

export function invalidateLocalNativeContinuations(targets: readonly object[]): void {
  const invocation = activeInvocation();
  if (invocation) for (const target of targets) {
    // Transfers share this private record. Erase its raw bytes so invalidating
    // a dispatch clone also revokes every retained original and other alias.
    const entry = invocation.entries.get(target);
    if (entry) entry.reasoning = "";
    invocation.entries.delete(target);
  }
}

/** Observe safe policy-version evidence, never payload-derived hashes or raw
 * values. A changed policy epoch invalidates all aliases before re-screening;
 * the invocation stays open so subsequent responses may establish new state. */
export function observeLocalNativeContinuationPolicy(safePolicyDigest: string): boolean {
  const invocation = activeInvocation();
  if (!invocation) return false;
  const fingerprint = sha256(safePolicyDigest);
  const changed = invocation.policyFingerprint !== undefined
    && invocation.policyFingerprint !== fingerprint;
  invocation.policyFingerprint = fingerprint;
  if (changed) invocation.entries = new WeakMap();
  return changed;
}
