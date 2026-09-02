import { cron } from "inngest";

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

/** Automatic same-organization demand sync plus durable retry safety-net. */
export const demandReconciliationScheduled = inngest.createFunction(
  {
    id: "federation/demand-reconciliation",
    retries: 1,
    // Preserve a five-minute safety net without joining the minute-zero herd.
    triggers: [cron("1,6,11,16,21,26,31,36,41,46,51,56 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

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
    return { demand, work, links, membership };
  },
);
