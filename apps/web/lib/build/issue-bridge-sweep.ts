/**
 * Boot + periodic safety net for hive issue mirrors (BI-AE9FCB4C): an item that
 * reached done/retired while GitHub was unreachable, or through a write path
 * that never dispatched the close, still has its upstream issue open. The
 * bridge's candidate filter makes every run idempotent, so this can fire at
 * boot and every twenty minutes without double-commenting.
 */

import { sweepUpstreamIssueClosures } from "./issue-bridge";

export const UPSTREAM_CLOSURE_SWEEP_INTERVAL_MS = 20 * 60 * 1000;

export async function runUpstreamClosureSweep(log: Pick<Console, "log" | "warn"> = console): Promise<void> {
  try {
    const r = await sweepUpstreamIssueClosures();
    if (r.closed > 0 || r.failed > 0) {
      log.log(`[issue-bridge] upstream closure sweep: ${r.closed} closed, ${r.failed} failed, ${r.candidates} candidates`);
    }
  } catch (err) {
    log.warn(`[issue-bridge] upstream closure sweep failed: ${(err as Error).message}`);
  }
}

export function startUpstreamClosureSweep(
  options: { log?: Pick<Console, "log" | "warn">; intervalMs?: number } = {},
): { stop: () => void } {
  const interval = options.intervalMs ?? UPSTREAM_CLOSURE_SWEEP_INTERVAL_MS;
  void runUpstreamClosureSweep(options.log);
  const timer = setInterval(() => void runUpstreamClosureSweep(options.log), interval);
  return { stop: () => clearInterval(timer) };
}
