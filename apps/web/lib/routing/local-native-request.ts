// apps/web/lib/routing/local-native-request.ts
//
// BI-8B2DB9E8: build an Ollama-native /api/chat request, so the parameters the
// OpenAI-compatible endpoint silently drops actually reach the model.
//
// Ollama's /v1/chat/completions accepts temperature, top_p, max_tokens, seed,
// stop and response_format — and IGNORES top_k, min_p, repeat_penalty and
// num_ctx. Qwen3's published thinking profile is 0.6 / 0.95 / 20 / 0; through the
// compatibility endpoint we deliver the first two and the last two are dropped on
// the floor with no error. Running at engine defaults instead is the documented
// cause of repetition loops on Qwen3 and DeepSeek-R1.
//
// This module is deliberately the PURE half: it builds the request body and
// nothing else. The transport switch is a separate, conservative decision (see
// `localNativeTransportEnabled`), because /api/chat returns a different response
// shape from the OpenAI path and the existing local branch carries several
// hard-won tool-call rescue paths — textual <tool_call> markers, Anthropic-style
// tool_use emitted as content — that a new transport must not lose.
//
// `num_ctx` is READ from the served-context reconciler, never invented here:
// local-model-context-reconcile.ts already computes a VRAM-aware ceiling and is
// the single source of truth for the served window. Passing a larger num_ctx
// than the server was configured for makes Ollama silently spill KV cache to
// host RAM, which costs far more than the parameters are worth.
//
// Spec: docs/superpowers/specs/2026-09-18-situational-llm-call-parameterization-design.md §4

import type { RoutedExecutionPlan } from "./recipe-types";
import { toWireSampling } from "./sampling-profile";

export interface LocalNativeMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface LocalNativeRequest {
  model: string;
  messages: LocalNativeMessage[];
  stream: boolean;
  /** Ollama's sampling + runtime block — the reason this transport exists. */
  options: Record<string, number>;
  /** Keep the model resident; -1 means "do not evict". */
  keep_alive: number;
  /** Reasoning toggle, when the effort decision asked for it. */
  think?: boolean;
  /** Grammar-constrained decoding: "json" or a JSON Schema object. */
  format?: "json" | Record<string, unknown>;
  tools?: Array<Record<string, unknown>>;
}

/**
 * Build the native request body.
 *
 * `servedContextTokens` comes from the reconciler; when it is null the key is
 * omitted so the server keeps whatever it was configured with. Omitting is
 * always safe; guessing is not.
 */
export function buildLocalNativeRequest(input: {
  modelId: string;
  systemPrompt?: string;
  messages: LocalNativeMessage[];
  plan: RoutedExecutionPlan;
  servedContextTokens?: number | null;
  tools?: Array<Record<string, unknown>>;
  stream?: boolean;
  jsonSchema?: Record<string, unknown> | null;
}): LocalNativeRequest {
  const { plan } = input;

  const options: Record<string, number> = {
    // The full sampling set, including the three keys /v1 drops.
    ...toWireSampling({
      values: plan.sampling?.values ?? {},
      provenance: {},
      dropped: [],
      mode: plan.sampling?.mode ?? "default",
    }),
  };

  if (plan.maxTokens > 0) options.num_predict = plan.maxTokens;
  if (typeof input.servedContextTokens === "number" && input.servedContextTokens > 0) {
    options.num_ctx = input.servedContextTokens;
  }

  const messages: LocalNativeMessage[] = input.systemPrompt
    ? [{ role: "system", content: input.systemPrompt }, ...input.messages]
    : [...input.messages];

  const request: LocalNativeRequest = {
    model: input.modelId,
    messages,
    stream: input.stream ?? false,
    options,
    keep_alive: -1,
  };

  if (plan.providerSettings?.think === true) request.think = true;

  // Prefer a real schema over generic JSON mode: a schema makes malformed output
  // mechanically impossible, where "json" only guarantees it parses.
  if (input.jsonSchema) request.format = input.jsonSchema;
  else if (plan.responsePolicy?.strictSchema) request.format = "json";

  if (input.tools && input.tools.length > 0) request.tools = input.tools;

  return request;
}

/** The native chat endpoint for a local base URL. */
export function localNativeChatUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${trimmed}/api/chat`;
}

export const LOCAL_NATIVE_TRANSPORT_CONFIG_KEY = "inference-local-native-transport";

/**
 * Whether to use the native transport.
 *
 * Defaults to FALSE. The body construction above is unit-tested, but the
 * response shape, streaming frames, tool-call extraction and usage accounting on
 * /api/chat all differ from the OpenAI path, and none of that is exercised here
 * against a live Ollama. Shipping it on by default would bet the platform's
 * FALLBACK path — the one that catches everything during an outage or an upgrade
 * drain — on untested transport code. That is the worst path to gamble with, so
 * the switch is explicit and the compatibility endpoint remains the default
 * until there is evidence from a live install.
 */
export function localNativeTransportEnabled(
  config: { enabled?: boolean } | null | undefined,
): boolean {
  return config?.enabled === true;
}
