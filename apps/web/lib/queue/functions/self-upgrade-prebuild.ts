/**
 * BI-F9EE05E5 plan item 0: build the candidate image BEFORE the drain.
 *
 * The swap used to run promote.sh end to end after admission closed, so the
 * portal refused new work for the whole `next build`: 6-14 minutes per upgrade
 * on 2026-10-02, and on 2026-09-30 (SUR-3B7203FD) the door stayed closed for a
 * build that was then killed. The prebuild runs promote.sh with
 * PROMOTE_PHASE=build (prepare + image build, no state written) while the
 * portal still serves. The swap that follows builds against the warm cache, so
 * its identity checks still run, in seconds.
 *
 * A failed prebuild fails the run before anything is closed or changed.
 */
import type { PromoterParams, PromoterResult } from "@/lib/self-upgrade/promoter";
import { resolvePromoterTimeoutMs } from "@/lib/self-upgrade/promoter-timeout";
import { ok, err, type ActionResult } from "@/lib/shared/action-result";

/**
 * The prebuild's budget. It runs while the portal still serves, so nothing waits
 * on it, and it does the slow part (a cold `next build`). SUR-CD779647 was killed
 * at the 25-minute swap budget after its build alone took 1326s on a loaded host.
 * Never less than the swap's own budget; DPF_PROMOTER_PREBUILD_TIMEOUT_MS tunes it.
 */
const PREBUILD_TIMEOUT_DEFAULT_MS = 75 * 60 * 1000;

function prebuildTimeoutMs(base: PromoterParams): number {
  const env = Number(process.env.DPF_PROMOTER_PREBUILD_TIMEOUT_MS);
  const prebuild = Number.isFinite(env) && env > 0 ? env : PREBUILD_TIMEOUT_DEFAULT_MS;
  return Math.max(prebuild, resolvePromoterTimeoutMs(base));
}

export function prebuildPromoterParams(base: PromoterParams, runId: string): PromoterParams {
  return {
    ...base,
    phase: "build",
    timeoutMs: prebuildTimeoutMs(base),
    // Its own container name, so it never collides with the swap's promoter.
    containerName: `dpf-promoter-${runId}-prebuild`,
    // Its own backup subdirectory: a prebuild keeps nothing there, and it must
    // never share a path with the swap's recovery copy.
    backupPath: `${base.backupPath.replace(/\/$/, "")}/prebuild`,
  };
}

/** Tail of the promoter output carried into the failure, as the swap does. */
const FAILURE_TAIL_CHARS = 4_000;

export async function runPrebuild(input: {
  params: PromoterParams;
  runPromoter: (params: PromoterParams) => Promise<PromoterResult>;
}): Promise<ActionResult> {
  let result: PromoterResult;
  try {
    result = await input.runPromoter(input.params);
  } catch (error) {
    return err(`prebuild-spawn-error: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (result.exitCode === 0) return ok();
  const output = `${result.stdout}\n${result.stderr}`.trim();
  return err(output.slice(-FAILURE_TAIL_CHARS) || `prebuild exited ${result.exitCode}`);
}
