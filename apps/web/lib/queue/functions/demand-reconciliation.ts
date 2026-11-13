import { cron } from "@/lib/jobs/triggers";

import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";

/** Automatic same-organization demand sync plus durable retry safety-net. */
export const demandReconciliationScheduled = jobs.createFunction(
  {
    id: "federation/demand-reconciliation",
    retries: 1,
    // Preserve a five-minute safety net without joining the minute-zero herd.
    triggers: [cron("1,6,11,16,21,26,31,36,41,46,51,56 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "federation/demand-reconciliation");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    // A production authority queues its guidance snapshot for its development
    // companion (BI-1B165D02) ahead of the posture step, whose outbox drain then
    // delivers it in this cycle. A no-op everywhere that is not an authority.
    const guidance = await step.run("publish-guidance-snapshot", async () => {
      const { runGuidanceSnapshotPublication } = await import("@/lib/federation/guidance-snapshot-publication");
      return runGuidanceSnapshotPublication();
    });
    // This install's operational posture goes to every trusted same-organization
    // peer on the same cadence (BI-648F01A0 Slice 2.2). Queued first so the demand
    // step's outbox drain delivers it in this cycle; its own drain is a no-op then.
    const posture = await step.run("project-operational-posture", async () => {
      const { runOperationalPostureReconciliation } = await import("@/lib/federation/operational-posture-reconciliation");
      return runOperationalPostureReconciliation();
    });
    // Receiving side of the same exchange: every peer's mirrored posture is
    // reflected into this install's runtime-target registry, so the coordination
    // map shows both installs (BI-648F01A0 Slice 3).
    const peerTargets = await step.run("reflect-peer-runtime-targets", async () => {
      const { syncPeerRuntimeTargets } = await import("@/lib/federation/operational-posture-peer-targets");
      return syncPeerRuntimeTargets();
    });
    const demand = await step.run("reconcile-federated-demand", async () => {
      const { runDemandReconciliation } = await import("@/lib/federation/demand-reconciliation");
      return runDemandReconciliation();
    });
    // Same cadence, separate step: pull every same-organization peer's backlog
    // into local mirrors (BI-FF8A57EF). A demand failure never blocks work sync
    // and vice versa.
    const work = await step.run("sync-federated-work", async () => {
      const { runWorkSync } = await import("@/lib/federation/work-sync");
      return runWorkSync();
    });
    // Renew each claim this installation holds at an item's home, and release
    // the ones whose Workroom has ended (BI-30EDDB7F). Queued in the outbox,
    // so a home that cannot be reached receives them when it returns.
    const workClaims = await step.run("reconcile-federated-work-claims", async () => {
      const { runFederatedWorkClaimReconciliation } = await import("@/lib/federation/work-claim-exchange.server");
      return runFederatedWorkClaimReconciliation();
    });
    // Keep the peer ledger and link set honest on the same cadence: one link per
    // peer, and the teardown-surviving ledger current (EP-ZERO-CONFIG-FEDERATION).
    const links = await step.run("reconcile-federation-links", async () => {
      const { reconcileFederationLinks } = await import("@/lib/federation/boot-reconcile");
      return reconcileFederationLinks();
    });
    // A member with organization material and no trusted link to its authority
    // enrols now, on proof of membership (EP-ZERO-CONFIG-FEDERATION §5.6).
    const membership = await step.run("enrol-organization-membership", async () => {
      const { reconcileOrganizationMembership } = await import("@/lib/federation/organization-membership");
      return reconcileOrganizationMembership();
    });
    // A link that has not synced for over 6 hours gets one Needs-you item, and
    // the item clears on the next good pull (BI-85DE8EBD). Last, and it reports
    // a failure instead of throwing, so it never retries or holds up the steps above.
    const workWatch = await step.run("watch-federated-work", async () => {
      const { prisma } = await import("@dpf/db");
      const { runWorkSyncWatchSafely } = await import("@/lib/federation/work-sync-watch");
      const { notifyAttentionLive, resolveOperatorRecipient } = await import("@/lib/attention/notify-live");
      return runWorkSyncWatchSafely(prisma as never, {
        notify: async (notice) => {
          const recipient = await resolveOperatorRecipient();
          // No resolvable owner: notification is best-effort; the row still projects.
          if (!recipient) return;
          await notifyAttentionLive({ source: "platform-health", userId: recipient, ...notice });
        },
      });
    });
    return { guidance, posture, peerTargets, demand, work, workWatch, workClaims, links, membership };
  },
);
