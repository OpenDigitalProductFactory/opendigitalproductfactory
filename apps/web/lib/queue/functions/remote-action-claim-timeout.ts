// apps/web/lib/queue/functions/remote-action-claim-timeout.ts
// EP-REMOTE-ACTION · P2 — claim-timeout sweep (the timeout's operational trigger).
//
// Times out RemoteActions a node CLAIMED but never reported a terminal result for
// (claim-then-die: crash, network partition), so the pull queue cannot wedge an
// action in `claimed` forever. Sensitive join imports are terminally timed out
// with encrypted parameters cleared; expired issued packages are cleared too.
// Pure logic lives in
// lib/remote-action/dispatch-orchestrator (timeoutStaleClaims, unit-tested); this
// is the thin Inngest wrapper + quiescence gate, mirroring edge-incident-correlation.
//
// Dark-launched behind DPF_REMOTE_ACTION_DISPATCH_ENABLED — the SAME flag that
// gates the claim/result routes — so it deploys inert and activates exactly when
// the operator turns the dispatch channel on for verification.

import { cron } from "inngest";

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import {
  clearExpiredJoinPackageMaterial,
  timeoutStaleClaims,
  type DispatchOrchestratorDb,
} from "@/lib/remote-action/dispatch-orchestrator";
import { envFlagEnabled } from "@/lib/runtime/env-flags";

export async function runRemoteActionClaimTimeout(): Promise<{ timedOut: number; joinPackagesCleared: number }> {
  const { prisma } = await import("@dpf/db");
  const db = prisma as unknown as DispatchOrchestratorDb;
  const [timeouts, packages] = await Promise.all([
    timeoutStaleClaims(db),
    clearExpiredJoinPackageMaterial(db),
  ]);
  return { timedOut: timeouts.timedOut, joinPackagesCleared: packages.cleared };
}

export const remoteActionClaimTimeout = inngest.createFunction(
  { id: "ops/remote-action-claim-timeout", retries: 2, triggers: [cron("8,18,28,38,48,58 * * * *")] },
  async ({ step }) => {
    if (!envFlagEnabled(process.env, "DPF_REMOTE_ACTION_DISPATCH_ENABLED")) {
      return { skipped: true, reason: "flag-disabled" };
    }
    const gate = await gateAtEntry(step, "ops/remote-action-claim-timeout");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return await step.run("timeout-stale-remote-action-claims", async () => runRemoteActionClaimTimeout());
  },
);
