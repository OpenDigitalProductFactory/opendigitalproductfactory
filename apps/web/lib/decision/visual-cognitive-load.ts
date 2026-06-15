// Visual cognitive-load assessment for the WWMD UI-surface rubric.
//
// The structural path (evaluate_page / axe-core findings) cannot see visual
// density, whitespace, grouping, or information scent — the exact signals the
// `human_cognitive_load` axis of `ui-surface-features.ts` wants. This module
// feeds a *rendered screenshot* to a vision-capable model and returns a measured
// cognitive-load score that flows into that rubric, closing the
// structural-vs-functional gap on UI evaluation.
//
// The model is selected by CAPABILITY, not by name: routeAndCall with the
// `imageInput` floor (EP-AGENT-CAP-002) picks whatever vision-capable endpoint
// is configured — a local Gemma 4 via Docker Model Runner (zero egress), or any
// hosted multimodal model. No provider pinning. Spike-verified on-machine
// (2026-06-15): ai/gemma4:12B scores a clean single-action card at 0.10 and a
// dense 24-card dashboard at 0.75 via the OpenAI-compatible image_url path.

import type { ChatMessage } from "@/lib/ai-inference";

export interface VisualCognitiveLoad {
  /** 0..1 — higher means harder for a first-time user to understand. */
  cognitiveLoad: number;
  /** 0..1 — visual density / clutter. */
  visualDensity: number;
  /** Model's estimate of the number of interactive controls visible. */
  controlCountEstimate: number;
  /** One-sentence rationale from the model. */
  reasoning: string;
  /** Which endpoint produced the assessment (audit / observability). */
  providerId: string;
  modelId: string;
}

const SYSTEM_PROMPT =
  "You are a UI cognitive-load assessor. You see a rendered UI screenshot and " +
  "judge how much mental effort it imposes on a first-time user. Be objective and " +
  "terse. Respond with JSON only.";

const USER_PROMPT =
  "Assess the cognitive load this UI imposes on a first-time user. " +
  'Return ONLY JSON: {"cognitive_load": 0.0-1.0, "visual_density": 0.0-1.0, ' +
  '"control_count_estimate": <integer>, "reasoning": "one sentence"}. ' +
  "Higher cognitive_load = harder to understand.";

const clamp01 = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;

/** Minimal inference surface so tests can inject a deterministic responder. */
export type VisionInferenceFn = (
  messages: ChatMessage[],
  systemPrompt: string,
) => Promise<{ content: string; providerId: string; modelId: string }>;

/**
 * Parse the model's JSON reply into a normalized assessment. Tolerates ```json
 * fences and surrounding prose. Returns null when no JSON object is present.
 * Exported for unit testing the parse/clamp logic independent of any model.
 */
export function parseVisualCognitiveLoad(
  content: string,
  providerId: string,
  modelId: string,
): VisualCognitiveLoad | null {
  const match = /\{[\s\S]*\}/.exec(content ?? "");
  if (!match) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));
  const controlRaw = num(raw.control_count_estimate);
  return {
    cognitiveLoad: clamp01(num(raw.cognitive_load)),
    visualDensity: clamp01(num(raw.visual_density)),
    controlCountEstimate: Number.isFinite(controlRaw) ? Math.max(0, Math.round(controlRaw)) : 0,
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning : "",
    providerId,
    modelId,
  };
}

/** Default inference: capability-routed call through the platform pipeline. */
async function routedVisionInference(
  messages: ChatMessage[],
  systemPrompt: string,
): Promise<{ content: string; providerId: string; modelId: string }> {
  const { routeAndCall } = await import("@/lib/inference/routed-inference");
  const res = await routeAndCall(messages, systemPrompt, "internal", {
    taskType: "ui_visual_assessment",
    // Capability floor — selects any vision-capable endpoint, no provider pin.
    minimumCapabilities: { imageInput: true },
    routingActor: { kind: "system", id: "visual-cognitive-load" },
    persistDecision: false,
    effort: "low",
  });
  return { content: res.content, providerId: res.providerId, modelId: res.modelId };
}

/**
 * Assess the visual cognitive load of a rendered UI screenshot.
 *
 * `screenshot` may be a full data URL (`data:image/png;base64,...`) or a bare
 * base64 string (assumed PNG). Returns null when no vision-capable endpoint is
 * configured or the model returns no parseable assessment — the caller treats a
 * null as "visual signal unavailable" and falls back to the structural rubric.
 * This is an ENHANCEMENT, never a hard dependency.
 */
export async function assessVisualCognitiveLoad(
  screenshot: string,
  opts?: { inferenceFn?: VisionInferenceFn },
): Promise<VisualCognitiveLoad | null> {
  if (!screenshot) return null;
  const url = screenshot.startsWith("data:")
    ? screenshot
    : `data:image/png;base64,${screenshot}`;
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: USER_PROMPT },
        { type: "image_url", image_url: { url } },
      ],
    },
  ];
  const infer = opts?.inferenceFn ?? routedVisionInference;
  try {
    const res = await infer(messages, SYSTEM_PROMPT);
    return parseVisualCognitiveLoad(res.content, res.providerId, res.modelId);
  } catch {
    // No vision endpoint (NoEligibleEndpointsError) or transport failure → the
    // visual signal is simply unavailable; the structural rubric still applies.
    return null;
  }
}
