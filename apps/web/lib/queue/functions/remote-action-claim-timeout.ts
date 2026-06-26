// apps/web/lib/queue/functions/remote-action-claim-timeout.ts
// EP-REMOTE-ACTION · P2 — claim-timeout sweep (the timeout's operational trigger).
//
// Times out RemoteActions a node CLAIMED but never reported a terminal result for
// (claim-then-die: crash, network partition), so the read-only pull queue cannot
// wedge an action in `claimed` forever. Pure logic lives in
// lib/remote-action/dispatch-orchestrator (timeoutStaleClaims, unit-tested); this
// is the thin Inngest wrapper + quiescence gate, mirroring edge-incident-correlation.
//
// Dark-launched behind DPF_REMOTE_ACTION_DISPATCH_ENABLED — the SAME flag that
// gates the claim/result routes — so it deploys inert and activates exactly when
// the operator turns the dispatch channel on for verification. Read-only by
// construction: a timed-out collect is lost telemetry, never a half-applied mutation.

import { cron } from "inngest";

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import { timeoutStaleClaims, type DispatchOrchestratorDb } from "@/lib/remote-action/dispatch-orchestrator";
import { envFlagEnabled } from "@/lib/runtime/env-flags";

export async function runRemoteActionClaimTimeout(): Promise<{ timedOut: number }> {
  const { prisma } = await import("@dpf/db");
  return timeoutStaleClaims(prisma as unknown as DispatchOrchestratorDb);
}

export const remoteActionClaimTimeout = inngest.createFunction(
  { id: "ops/remote-action-claim-timeout", retries: 2, triggers: [cron("8,18,28,38,48,58 * * * *")] },
  async ({ step }) => {
    if (!envFlagEnabled(process.env, "DPF_REMOTE_ACTION_DISPATCH_ENABLED")) {
      return { skipped: true, reason: "flag-disabled" };
    }
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return await step.run("timeout-stale-remote-action-claims", async () => runRemoteActionClaimTimeout());
  },
);
