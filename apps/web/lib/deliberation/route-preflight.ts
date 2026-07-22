// BI-8C44DB49 slice 2 — refuse a deliberation whose branches cannot route,
// BEFORE any TaskRun exists.
//
// WHY NOT SETTLE THE RUN AFTER IT FAILS. orchestrator.ts already catches and
// calls settleBootstrapTaskRun(taskRunId, "failed"), and yet all 5,026 stalled
// rows on the live install carry `stalled` — the WATCHDOG's state, not the
// orchestrator's. settleBootstrapTaskRun scopes its update to rows still in
// active|working|queued|running, so once the watchdog reaps a slow failure the
// orchestrator's own handler is a silent no-op. Every post-hoc settle loses that
// same race.
//
// A row that is never created cannot stall, cannot be reaped, cannot be
// re-dispatched by the sweep, and cannot hold the self-upgrade quiescence gate
// open as `coworker.reasoning-loop`. That is the whole fix.
//
// PROBING THE RIGHT GATE. The live failure was
//   `No endpoint satisfies agent capability floor (EP-AGENT-CAP-002). Missing: toolUse`
// which routed-inference throws ONLY when `options.minimumCapabilities` is set.
// For a deliberation that floor is per-role: buildBranchRequestContract sets
// `minimumCapabilities = ROLE_DEFAULT_CAPABILITIES[roleId]`, and notably sets
// `requiresTools: false`.
//
// So a probe that passes `tools` would test the wrong thing twice over: tools are
// not the deliberation gate, and routing RELAXES an unsatisfiable tools
// requirement anyway (routed-inference.ts:375 retries with requiresTools=false
// and strips tools). Such a probe would pass on an install where every real
// branch fails — the exact blindness this slice exists to remove. We pass the
// role's real capability floor instead.
//
// FAIL-SAFE. previewRoute is a side-effect-free dry run of the same routing the
// branches use. We block only when EVERY role's floor throws structurally. If
// any role can route, the deliberation proceeds — it can run with fewer
// branches. A transient throw, an unexpected shape, or a bug here all proceed
// exactly as before: a false block silently stops legitimate deliberation, which
// is worse than the flood this prevents.

import { previewRoute, type RouteAndCallOptions } from "@/lib/inference/routed-inference";
import {
  classifyDispatchFailure,
  type DispatchFailureVerdict,
} from "@/lib/inference/dispatch-failure-class";
import type { AgentMinimumCapabilities } from "@/lib/routing/agent-capability-types";

export interface DeliberationRoutePreflight {
  /** True when NO role could dispatch — do not create a TaskRun. */
  blocked: boolean;
  /** Set when blocked: why, in operator-actionable terms. */
  verdict?: DispatchFailureVerdict;
}

const PROCEED: DeliberationRoutePreflight = { blocked: false };

export interface DeliberationRouteProbe {
  roleId: string;
  minimumCapabilities: AgentMinimumCapabilities;
}

/**
 * Probe whether any deliberation branch could route.
 *
 * Blocks only when every supplied role fails structurally — i.e. no branch of
 * this deliberation could ever dispatch, so creating a TaskRun would produce a
 * guaranteed corpse for the sweep to retry forever.
 */
export async function preflightDeliberationRoute(
  probes: readonly DeliberationRouteProbe[],
  opts: {
    taskType?: string;
    sensitivity?: "public" | "internal" | "confidential" | "restricted";
    previewRouteImpl?: typeof previewRoute;
  } = {},
): Promise<DeliberationRoutePreflight> {
  if (probes.length === 0) return PROCEED;
  const preview = opts.previewRouteImpl ?? previewRoute;
  const sensitivity = opts.sensitivity ?? "internal";
  const taskType = opts.taskType ?? "conversation";

  let lastStructural: DispatchFailureVerdict | undefined;

  for (const probe of probes) {
    try {
      await preview([{ role: "user", content: "deliberation route preflight" }], sensitivity, {
        taskType,
        // The gate that actually failed on the live install. Without this the
        // floor is never evaluated and the probe is meaningless.
        minimumCapabilities: probe.minimumCapabilities,
      } as RouteAndCallOptions);
      // One routable role is enough — the deliberation can run.
      return PROCEED;
    } catch (error) {
      const verdict = classifyDispatchFailure(error);
      // Anything not provably structural: fail safe and let it run.
      if (verdict.retryable) return PROCEED;
      lastStructural = verdict;
    }
  }

  return lastStructural ? { blocked: true, verdict: lastStructural } : PROCEED;
}
