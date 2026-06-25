import { redirect } from "next/navigation";

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  ServiceTicketsTable,
  type ServiceTicketRow,
} from "@/components/platform/service-desk/ServiceTicketsTable";

export const dynamic = "force-dynamic";

// EP-MSP-FEDERATION · A3 operator surface — Platform > Service Desk.
// Customer-facing service tickets, routed by customer estate. Incident tickets
// are created automatically from correlated edge events (A2 correlation job).
export default async function ServiceDeskPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?next=/platform/service-desk");
  if (
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "manage_platform",
    )
  ) {
    redirect("/403");
  }

  const tickets = await prisma.serviceTicket.findMany({
    include: { customerAccount: { select: { name: true } } },
    orderBy: { openedAt: "desc" },
    take: 200,
  });

  const rows: ServiceTicketRow[] = tickets.map((t) => ({
    ticketId: t.ticketId,
    ticketKind: t.ticketKind,
    status: t.status,
    priority: t.priority,
    title: t.title,
    customerName: t.customerAccount?.name ?? null,
    scopeKey: t.scopeKey,
    openedAtISO: t.openedAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Service Desk</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Customer service tickets, routed by customer estate. Incident tickets are created
          automatically from correlated edge events; distinct from the internal issue inbox.
        </p>
      </div>
      <ServiceTicketsTable rows={rows} />
    </div>
  );
}
