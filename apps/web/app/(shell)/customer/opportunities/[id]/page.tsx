// apps/web/app/(shell)/customer/opportunities/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";

const STAGE_COLOURS: Record<string, string> = {
  qualification: "#fbbf24",
  discovery: "#fb923c",
  proposal: "#38bdf8",
  negotiation: "#a78bfa",
  closed_won: "#4ade80",
  closed_lost: "#ef4444",
};

const ACTIVITY_ICONS: Record<string, string> = {
  note: "📝", call: "📞", email: "📧", meeting: "📅", task: "☑️",
  status_change: "🔄", quote_event: "📋", system: "⚙️",
};

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [opportunity, quotes] = await Promise.all([
    prisma.opportunity.findUnique({
      where: { id },
      include: {
        account: true,
        contact: { select: { id: true, email: true, firstName: true, lastName: true, phone: true } },
        assignedTo: { select: { id: true, email: true } },
        activities: {
          orderBy: { createdAt: "desc" },
          include: { createdBy: { select: { id: true, email: true } } },
        },
      },
    }),
    prisma.quote.findMany({
      where: { opportunityId: id },
      orderBy: { version: "desc" },
      select: {
        id: true, quoteNumber: true, version: true, status: true,
        totalAmount: true, currency: true, sentAt: true, acceptedAt: true,
      },
    }),
  ]);

  if (!opportunity) notFound();

  const stageColour = STAGE_COLOURS[opportunity.stage] ?? "#8888a0";
  const isClosed = opportunity.stage === "closed_won" || opportunity.stage === "closed_lost";

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/customer/opportunities" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Pipeline
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{opportunity.title}</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">{opportunity.title}</h1>
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full"
            style={{ background: `${stageColour}20`, color: stageColour }}
          >
            {opportunity.stage.replace("_", " ")}
          </span>
          {opportunity.isDormant && (
            <span className="text-[8px] px-1 py-0.5 rounded-full bg-red-900/30 text-red-400">
              dormant
            </span>
          )}
        </div>
        <p className="text-[10px] font-mono text-[var(--dpf-muted)]">
          {opportunity.opportunityId}
        </p>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
          <p className="text-[10px] text-[var(--dpf-muted)]">Account</p>
          <Link href={`/customer/${opportunity.account.id}`} className="text-sm text-[var(--dpf-text)] hover:text-[var(--dpf-accent)]">
            {opportunity.account.name}
          </Link>
        </div>
        <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
          <p className="text-[10px] text-[var(--dpf-muted)]">Probability</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{opportunity.probability}%</p>
        </div>
        {opportunity.expectedValue && (
          <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
            <p className="text-[10px] text-[var(--dpf-muted)]">Value</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">
              {opportunity.currency} {Number(opportunity.expectedValue).toLocaleString()}
            </p>
          </div>
        )}
        {opportunity.expectedClose && (
          <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
            <p className="text-[10px] text-[var(--dpf-muted)]">Expected Close</p>
            <p className="text-sm text-[var(--dpf-text)]">
              {new Date(opportunity.expectedClose).toLocaleDateString()}
            </p>
          </div>
        )}
        {opportunity.assignedTo && (
          <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
            <p className="text-[10px] text-[var(--dpf-muted)]">Owner</p>
            <p className="text-sm text-[var(--dpf-text)]">{opportunity.assignedTo.email}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline (2/3) */}
        <div className="lg:col-span-2">
          <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
            Timeline
            <span className="ml-2 normal-case font-normal">{opportunity.activities.length}</span>
          </h2>

          {opportunity.activities.length === 0 ? (
            <p className="text-sm text-[var(--dpf-muted)]">No activity yet.</p>
          ) : (
            <div className="space-y-1">
              {opportunity.activities.map((act) => (
                <div key={act.id} className="p-3 rounded-lg bg-[var(--dpf-surface-1)] flex gap-3">
                  <span className="text-sm shrink-0">{ACTIVITY_ICONS[act.type] ?? "•"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--dpf-text)]">{act.subject}</p>
                    {act.body && (
                      <p className="text-[10px] text-[var(--dpf-muted)] mt-0.5 line-clamp-2">{act.body}</p>
                    )}
                    <div className="flex gap-2 mt-1 text-[9px] text-[var(--dpf-muted)]">
                      <span>{new Date(act.createdAt).toLocaleString()}</span>
                      {act.createdBy && <span>by {act.createdBy.email}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar (1/3) */}
        <div className="space-y-6">
          {/* Quotes */}
          <div>
            <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
              Quotes
              <span className="ml-2 normal-case font-normal">{quotes.length}</span>
            </h2>
            {quotes.length === 0 ? (
              <p className="text-[10px] text-[var(--dpf-muted)]">No quotes yet.</p>
            ) : (
              <div className="space-y-2">
                {quotes.map((q) => {
                  const qColor = q.status === "accepted" ? "#4ade80" : q.status === "sent" ? "#38bdf8" : "#8888a0";
                  return (
                    <Link
                      key={q.id}
                      href={`/customer/quotes/${q.id}`}
                      className="block p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] hover:bg-[var(--dpf-surface-2)]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-[var(--dpf-text)]">{q.quoteNumber}</span>
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{ background: `${qColor}20`, color: qColor }}
                        >
                          {q.status}
                        </span>
                      </div>
                      <p className="text-[10px] font-mono text-[var(--dpf-text)] mt-1">
                        {q.currency} {Number(q.totalAmount).toLocaleString()}
                      </p>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Contact */}
          {opportunity.contact && (
            <div>
              <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-2">
                Primary Contact
              </h2>
              <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
                <p className="text-xs text-[var(--dpf-text)]">
                  {[opportunity.contact.firstName, opportunity.contact.lastName].filter(Boolean).join(" ") || opportunity.contact.email}
                </p>
                <p className="text-[9px] text-[var(--dpf-muted)]">{opportunity.contact.email}</p>
                {opportunity.contact.phone && (
                  <p className="text-[9px] text-[var(--dpf-muted)]">{opportunity.contact.phone}</p>
                )}
              </div>
            </div>
          )}

          {/* Lost reason */}
          {opportunity.lostReason && (
            <div>
              <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-2">
                Lost Reason
              </h2>
              <p className="text-xs text-red-400">{opportunity.lostReason}</p>
            </div>
          )}

          {/* Notes */}
          {opportunity.notes && (
            <div>
              <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-2">
                Notes
              </h2>
              <p className="text-xs text-[var(--dpf-muted)] whitespace-pre-wrap">{opportunity.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
