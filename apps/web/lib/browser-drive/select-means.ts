// Per-task means selector (EP-BROWSER-DRIVE, spec §5.2 / Verdict 1).
//
// The capability does NOT pin a default means. For each task, a scoped
// principle_decide call scores the three means (deterministic / plugin /
// delegated) on task-derived features and returns the winner + a contribution
// ledger (persisted to BrowserSessionBinding.meansDecisionJson). A proven
// recorded M1 script short-circuits the decision (spec Q4) so repeat tasks on a
// known target don't pay a full WWMD round-trip.

import { executeTool } from "@/lib/mcp-tools";
import type { BrowserMeans } from "./session-binding";

export const MEANS_SELECT_SURFACE = "browser-drive-means-select";

/** Task-derived signals (each 0..1 unless noted) that drive means selection. */
export type MeansSelectionTask = {
  /** Does the task take an outward, irreversible side effect (publish/submit/order)? */
  outwardSideEffect: number;
  /** How novel/volatile is the target site (no stable selectors)? */
  siteVolatility: number;
  /** Is this a recurring workflow worth a deterministic script? */
  recurrence: number;
  /** Does the task need the operator's own live session (vs a service account)? */
  needsOperatorSession: number;
  /** A proven, recorded M1 deterministic script already exists for this target. */
  hasRecordedScript: boolean;
};

export type MeansSelectionResult = {
  means: BrowserMeans;
  confidence: string;
  margin: number;
  /** Contribution ledger for BrowserSessionBinding.meansDecisionJson. */
  ledger: unknown;
  status: "recommended" | "needs-human" | "shortcut-recorded";
  reason: string;
};

type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  context: Record<string, unknown>,
) => Promise<{ success?: boolean; data?: Record<string, unknown>; error?: string }>;

const clamp = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Map the task signals to per-means feature vectors over the principle dimension
 * registry. Higher = stronger alignment. These encode the trust/speed/generality
 * trade-offs from the means table (§6): M1 wins on determinism+reuse for recurring
 * high-error-cost work; M2 wins on generality for novel/volatile or operator-session
 * tasks; M3 sits between with isolation at a coordination cost.
 */
export function meansFeatures(task: MeansSelectionTask): Record<BrowserMeans, Record<string, number>> {
  const { outwardSideEffect: s, siteVolatility: v, recurrence: r, needsOperatorSession: o } = task;
  return {
    deterministic: {
      blast_radius: clamp(0.5 + 0.4 * (1 - v)), // contained when the site is stable
      reusability: clamp(0.4 + 0.5 * r),
      speed_to_value: clamp(0.3 + 0.5 * r * (1 - v)),
      capacity_utilization: clamp(0.6 + 0.3 * (1 - v)),
      long_term_maintainability: clamp(0.4 + 0.4 * r - 0.3 * v),
      cost_efficiency: clamp(0.7 - 0.4 * v),
      data_privacy: clamp(0.8 - 0.5 * o), // service-account profile, not operator session
    },
    plugin: {
      blast_radius: clamp(0.5 - 0.2 * o), // operator-session driving widens blast
      reusability: clamp(0.45 + 0.3 * v),
      speed_to_value: clamp(0.4 + 0.4 * v), // works on a novel site with no script
      capacity_utilization: clamp(0.45 - 0.2 * s),
      long_term_maintainability: clamp(0.5 - 0.2 * v),
      cost_efficiency: clamp(0.4 - 0.1 * v),
      data_privacy: clamp(0.7 - 0.4 * o),
    },
    delegated: {
      blast_radius: clamp(0.55 + 0.1 * (1 - o)), // isolated child session
      reusability: clamp(0.5 + 0.2 * v),
      speed_to_value: clamp(0.45),
      capacity_utilization: clamp(0.4),
      long_term_maintainability: clamp(0.5),
      cost_efficiency: clamp(0.4),
      data_privacy: clamp(0.6),
    },
  };
}

const MEANS_DESCRIPTIONS: Record<BrowserMeans, string> = {
  deterministic: "M1 deterministic: version-pinned Playwright / recorded-replay on a service-account profile.",
  plugin: "M2 plugin: adaptive LLM driving via the browser-use sidecar (service-account) or attended operator-live session.",
  delegated: "M3 delegated: bounded browser task handed to an isolated child CLI agent.",
};

/**
 * Select the means for a browser-driving task. Injectable executor for tests;
 * defaults to the platform tool executor so the real call goes through the
 * governed principle_decide path.
 */
export async function selectMeans(
  task: MeansSelectionTask,
  opts: { userId: string; routeContext?: string; toolExecutor?: ToolExecutor },
): Promise<MeansSelectionResult> {
  // Short-circuit: a proven recorded script means deterministic, no WWMD round-trip.
  if (task.hasRecordedScript) {
    return {
      means: "deterministic",
      confidence: "high",
      margin: 1,
      ledger: { shortCircuit: "recorded-m1-script" },
      status: "shortcut-recorded",
      reason: "A proven deterministic script exists for this target; reused without re-scoring.",
    };
  }

  const features = meansFeatures(task);
  const options = (Object.keys(features) as BrowserMeans[]).map((means) => ({
    id: means,
    description: MEANS_DESCRIPTIONS[means],
    features: features[means],
  }));

  const exec = opts.toolExecutor ?? executeTool;
  const response = await exec(
    "principle_decide",
    {
      context:
        "Pick the browser-driving means for a bounded auth-walled task by trust/speed/generality trade-off.",
      callingPopulation: "in_platform_coworker",
      callingSurface: MEANS_SELECT_SURFACE,
      options,
    },
    opts.userId,
    { routeContext: opts.routeContext ?? MEANS_SELECT_SURFACE },
  );

  const data = response.success ? response.data : undefined;
  const rec = data?.recommendation as
    | { optionId?: string; confidence?: string; margin?: number }
    | undefined;
  const means = (rec?.optionId as BrowserMeans) ?? "plugin";
  const confidence = rec?.confidence ?? "low";

  return {
    means,
    confidence,
    margin: typeof rec?.margin === "number" ? rec.margin : 0,
    ledger: data?.scores ?? data ?? null,
    status: confidence === "high" ? "recommended" : "needs-human",
    reason:
      typeof data?.reasoning === "string"
        ? (data.reasoning as string)
        : "Means selected by governed decision.",
  };
}
