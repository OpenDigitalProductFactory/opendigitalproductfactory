// BI-C64EDA33 (plan 2026-11-14-workroom-runtime-core): the Workroom runtime's
// effect worker. It leases outbox effects (workroom-effect-store.ts), runs each
// one, and reports the result back as an `effect.settled` command with a
// deterministic id, so the result and its log rows commit together and a
// repeated report is a replay. It never writes room state itself.
//
// Reproduces T3 Code's EffectWorker shape (pingdotgg/t3code@24e77473, MIT).

import type { EffectKind } from "./runtime-decider";
import type { ClaimedEffect } from "./workroom-effect-store";

export const EFFECT_LEASE_MS = 2 * 60_000;
export const EFFECT_SWEEP_MS = 5_000;

/** Thrown by an executor when the effect's provider process is gone: the effect is retired, not retried. */
export class RetireEffectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetireEffectError";
  }
}

export type EffectReport = {
  outcome: "succeeded" | "failed" | "retired";
  final: boolean;
  result?: Record<string, unknown>;
  error?: string | null;
  retryAfterMs?: number;
};

export type EffectWorkerDeps = {
  owner: string;
  claim(input: { owner: string; liveGenerations: string[]; limit: number; leaseMs: number }): Promise<ClaimedEffect[]>;
  recoverExpired(): Promise<number>;
  liveGenerations(): string[];
  execute(effect: ClaimedEffect): Promise<Record<string, unknown> | void>;
  report(effect: ClaimedEffect, report: EffectReport): Promise<void>;
  leaseMs?: number;
  batch?: number;
  log?: (message: string) => void;
};

/** Exponential, capped: 1 s, 2 s, 4 s … 60 s. */
export const effectBackoffMs = (attempt: number) => Math.min(60_000, 1000 * 2 ** Math.max(0, attempt - 1));

export const effectResultCommandId = (effect: Pick<ClaimedEffect, "id" | "attemptCount">) => `effect-result:${effect.id}:${effect.attemptCount}`;

export function createEffectWorker(deps: EffectWorkerDeps) {
  const log = deps.log ?? ((message: string) => console.error(`[workroom-runtime] ${message}`));
  let draining: Promise<number> | null = null;
  let again = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function reportWithRetry(effect: ClaimedEffect, report: EffectReport): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await deps.report(effect, report);
        return;
      } catch (error) {
        if (attempt >= 3) {
          // The lease expires and the effect runs again; the report's id makes the next report a replay.
          log(`report for ${effect.kind as EffectKind} ${effect.id} failed: ${error instanceof Error ? error.message : "unknown"}`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
      }
    }
  }

  async function runOne(effect: ClaimedEffect): Promise<void> {
    let report: EffectReport;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      // Give up well inside the lease, so no second claim of this effect can start while this one still runs.
      const timeoutMs = Math.floor((deps.leaseMs ?? EFFECT_LEASE_MS) * 0.75);
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs); });
      const result = await Promise.race([deps.execute(effect), timeout]);
      report = { outcome: "succeeded", final: true, result: result ?? {} };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      if (error instanceof RetireEffectError) {
        report = { outcome: "retired", final: true, error: message };
      } else {
        const final = effect.attemptCount >= effect.maxAttempts;
        report = { outcome: "failed", final, error: message, retryAfterMs: final ? undefined : effectBackoffMs(effect.attemptCount) };
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
    await reportWithRetry(effect, report);
  }

  /**
   * Claim and run until nothing is runnable. Rooms run side by side: a claim
   * yields at most one effect per room (a room's later effects wait behind its
   * running one), and a slow effect holds only its own room.
   */
  async function drainOnce(): Promise<number> {
    let ran = 0;
    await deps.recoverExpired().catch((error: unknown) => log(`lease recovery failed: ${error instanceof Error ? error.message : "unknown"}`));
    const running = new Set<Promise<void>>();
    for (;;) {
      const claimed = await deps.claim({ owner: deps.owner, liveGenerations: deps.liveGenerations(), limit: deps.batch ?? 10, leaseMs: deps.leaseMs ?? EFFECT_LEASE_MS });
      for (const effect of claimed) {
        const task: Promise<void> = runOne(effect).finally(() => { running.delete(task); });
        running.add(task);
      }
      ran += claimed.length;
      if (running.size === 0) return ran;
      // Something finished (its room's next effect may now run), or poll again for other rooms' new work.
      await Promise.race([...running, new Promise((resolve) => setTimeout(resolve, 250))]);
    }
  }

  /** Run every runnable effect now; concurrent callers share one pass and a kick during it runs another. */
  function drain(): Promise<number> {
    if (draining) {
      again = true;
      return draining;
    }
    draining = (async () => {
      let total = 0;
      do {
        again = false;
        total += await drainOnce();
      } while (again);
      return total;
    })().finally(() => { draining = null; });
    return draining;
  }

  return {
    drain,
    /** After a commit: run its effects soon, without making the caller wait for them. */
    kick(): void {
      void drain().catch((error: unknown) => log(`effect pass failed: ${error instanceof Error ? error.message : "unknown"}`));
    },
    start(intervalMs = EFFECT_SWEEP_MS): void {
      if (timer) return;
      timer = setInterval(() => { void drain().catch(() => {}); }, intervalMs);
      timer.unref?.();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export type EffectWorker = ReturnType<typeof createEffectWorker>;
