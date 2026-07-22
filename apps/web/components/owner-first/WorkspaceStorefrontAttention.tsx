// apps/web/components/owner-first/WorkspaceStorefrontAttention.tsx
//
// Reconciles Storefront/Funnel signals into the Workspace attention surface
// BEFORE the generic coworker decisions (BI-3BCAF95F). The live audit found the
// workspace home led with generic `Make this business decision?` cards while the
// `RESERVATIONS 0` rail chip and the funnel's `BOOKINGS 12 / INQUIRIES 1` never
// became a concrete owner action. This band renders the pending storefront work
// first, in owner language, then the OperatorCockpit renders the residue below.
//
// Read-only projection over the storefront queues — their rows stay canonical.

import { prisma } from "@dpf/db";

import { OwnerFirstSummaryBand } from "./OwnerFirstSummary";
import { loadOwnerFirstContext } from "@/lib/owner-first/context";
import { buildWorkspaceStorefrontSummary, hasOwnerFirstAction } from "@/lib/owner-first/domain-summary";

export async function WorkspaceStorefrontAttention({
  density = "full",
}: {
  density?: "full" | "simple";
}) {
  const [{ vocab }, pendingReservations, newInquiries, pendingOrders] = await Promise.all([
    loadOwnerFirstContext(),
    prisma.storefrontBooking.count({ where: { status: "pending" } }),
    prisma.storefrontInquiry.count({ where: { status: "new" } }),
    prisma.storefrontOrder.count({ where: { status: "pending" } }),
  ]);

  const summary = buildWorkspaceStorefrontSummary(
    { pendingReservations, newInquiries, pendingOrders },
    vocab,
  );

  // Only take the top of the workspace when there is real guest work. When it is
  // clear, the OperatorCockpit's own "nothing needs you" state is enough — a second
  // empty band would just add noise to the very surface we are decluttering.
  if (!hasOwnerFirstAction(summary)) return null;

  return <OwnerFirstSummaryBand summary={summary} density={density} />;
}
