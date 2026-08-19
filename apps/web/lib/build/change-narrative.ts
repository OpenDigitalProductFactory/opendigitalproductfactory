// apps/web/lib/build/change-narrative.ts
//
// BI-D93CF6C0 — Band 2 of the Build Studio overseer layer: an auto-generated
// PLAIN-LANGUAGE change summary. Called once at build completion from the goal +
// plan + diff; the structured result is stored on FeatureBuild.changeNarrative
// and rendered at top altitude by BuildChangeSummaryBand. This replaces the
// engineer-grade raw-diff prefix (diffSummary) for the non-technical overseer.
//
// Mirrors the routeAndCall + try/catch fallback pattern in phase-compaction.ts;
// the model call is intentionally taskType "analysis" so it routes through the
// platform's standard provider selection (local or robust tier).

import type { BuildChangeNarrative } from "@/lib/feature-build-types";

const MAX_DIFF_CHARS = 8_000;
const MAX_PLAN_CHARS = 3_000;
const MAX_GOAL_CHARS = 800;

/** Primitive inputs so the generator is decoupled from the build-doc types and
 *  trivially unit-testable. The caller (stepComplete) extracts these. */
export type ChangeNarrativeInputs = {
  title: string;
  /** The build's goal — designDoc.problemStatement || proposedApproach. */
  goal?: string | null;
  /** The implementation plan, pre-stringified by the caller. */
  planText?: string | null;
  /** The releasable git diff for the build. */
  diff: string;
};

export async function generateChangeNarrative(
  inputs: ChangeNarrativeInputs,
): Promise<BuildChangeNarrative | null> {
  const diff = (inputs.diff ?? "").trim();
  if (!diff) return null;

  try {
    const { routeAndCall } = await import("@/lib/inference/routed-inference");
    const goal = (inputs.goal ?? "").trim().slice(0, MAX_GOAL_CHARS);
    const plan = (inputs.planText ?? "").trim().slice(0, MAX_PLAN_CHARS);

    const result = await routeAndCall(
      [
        {
          role: "user",
          content:
            `Summarize what a software change does, for a NON-TECHNICAL business owner reviewing it. ` +
            `Use plain business language — no code, no file names, no jargon. ` +
            `Answer with ONLY minified JSON of shape ` +
            `{"headline":string,"bullets":string[],"whyItMatters":string,"openQuestions":string[]}.\n` +
            `- headline: one plain sentence (e.g. "Repeat customers now get an automatic 10% discount.").\n` +
            `- bullets: 2-5 plain statements of what changed, in business terms.\n` +
            `- whyItMatters: one plain sentence on the benefit to the user or their customers.\n` +
            `- openQuestions: 0-2 plain things left undecided, or [].\n\n` +
            `Feature: ${inputs.title}\n` +
            (goal ? `Goal: ${goal}\n` : "") +
            (plan ? `Plan: ${plan}\n` : "") +
            `\nCode changes (git diff):\n${diff.slice(0, MAX_DIFF_CHARS)}`,
        },
      ],
      "You translate code changes into plain business language for a non-technical reviewer. Output only minified JSON — no prose, no code fences.",
      "internal",
      { taskType: "analysis" },
    );

    const out = result as { content?: string; model?: string };
    return parseChangeNarrative(out.content ?? "", out.model ?? "local");
  } catch (err) {
    // Non-fatal: a missing narrative just falls back to the raw-diff dive-in.
    console.warn("[change-narrative] generation failed:", (err as Error)?.message);
    return null;
  }
}

/**
 * Parse a model response into a BuildChangeNarrative. Pure + defensive: tolerates
 * code fences / surrounding prose, drops non-string entries, and returns null on
 * anything missing a headline (so the band simply doesn't render).
 */
export function parseChangeNarrative(
  raw: string,
  model: string,
): BuildChangeNarrative | null {
  const json = extractJsonObject(raw);
  if (!json) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const o = parsed as Record<string, unknown>;
  const headline = typeof o.headline === "string" ? o.headline.trim() : "";
  if (!headline) return null;

  const toStringList = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim())
      : [];

  const openQuestions = toStringList(o.openQuestions);

  return {
    headline,
    bullets: toStringList(o.bullets),
    whyItMatters: typeof o.whyItMatters === "string" ? o.whyItMatters.trim() : "",
    ...(openQuestions.length > 0 ? { openQuestions } : {}),
    generatedAt: new Date().toISOString(),
    model,
  };
}

/** Pull the first {...} object out of a model response (handles fences/prose). */
function extractJsonObject(raw: string): string | null {
  if (!raw) return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}
