// Boot reconciliation for the provider ↔ default-connection status split
// (BI-04E4F111).
//
// Routing eligibility filters on AiProviderConnection.status while every
// product surface renders ModelProvider.status. The connection column was
// write-once for most of its life (the seed upsert only ever updated `label`),
// so an install could hold providers that read "active" everywhere with their
// only connection "disabled" — excluded from routing with no product-visible
// cause and no product-side fix. activateProvider now heals the default
// connection on every activation; this reconciler heals installs that are
// already in the split state, where no activation event is coming.
//
// Scope is deliberately narrow: only `provider-default-<id>` connections, and
// only the "disabled" veto. An org-scoped connection an operator disabled on
// purpose stays disabled; an "unconfigured" default connection is not a dead
// end (the runtime status projection lets the provider's own status govern).

import { prisma } from "@dpf/db";

export async function reconcileProviderConnectionState(): Promise<{ healed: number }> {
  const result = await prisma.aiProviderConnection.updateMany({
    where: {
      status: "disabled",
      connectionId: { startsWith: "provider-default-" },
      provider: { status: "active" },
    },
    data: { status: "active" },
  });
  if (result.count > 0) {
    console.warn(
      `[provider-connection-reconcile] healed ${result.count} default connection(s) that were disabled behind an active provider — those providers were silently excluded from routing (BI-04E4F111)`,
    );
  }
  return { healed: result.count };
}
