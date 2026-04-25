// apps/web/app/(shell)/customer/engagements/page.tsx
import Link from "next/link";
import { prisma } from "@dpf/db";

const STATUS_COLOURS: Record<string, string> = {
  new: "#fbbf24",
  contacted: "#38bdf8",
  qualified: "#4ade80",
  unqualified: "#8888a0",
  converted: "#a78bfa",
};

const SOURCE_LABELS: Record<string, string> = {
  web_inquiry: "Web",
  manual: "Manual",
  referral: "Referral",
  import: "Import",
};

export default async function EngagementsPage() {
  const engagements = await prisma.engagement.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      contact: { select: { id: true, email: true, firstName: true, lastName: true } },
      account: { select: { id: true, accountId: true, name: true } },
      assignedTo: { select: { id: true, email: true } },
    },
  });

  const statusCounts = engagements.reduce<Record<string, number>>((acc, e) => {
    acc[e.status] = (acc[e.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Engagements</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {engagements.length} engagement{engagements.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Status summary chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {Object.entries(statusCounts).map(([status, count]) => {
          const color = STATUS_COLOURS[status] ?? "#8888a0";
          return (
            <span
              key={status}
              className="text-[10px] px-2 py-1 rounded-full"
              style={{ background: `${color}20`, color }}
            >
              {status} ({count})
            </span>
          );
        })}
      </div>

      {/* Engagement list */}
      <div className="space-y-2">
        {engagements.map((e) => {
          const color = STATUS_COLOURS[e.status] ?? "#8888a0";
          const contactName = [e.contact.firstName, e.contact.lastName]
            .filter(Boolean)
            .join(" ") || e.contact.email;

          return (
            <div
              key={e.id}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4 flex items-start justify-between gap-3"
              style={{ borderLeftColor: color }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold text-[var(--dpf-text)] truncate">
                    {e.title}
                  </p>
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                    style={{ background: `${color}20`, color }}
                  >
                    {e.status}
                  </span>
                  {e.source && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] shrink-0">
                      {SOURCE_LABELS[e.source] ?? e.source}
                    </span>
                  )}
                </div>
                <div className="flex gap-3 text-[9px] text-[var(--dpf-muted)]">
                  <span>{contactName}</span>
                  {e.account && <span>{e.account.name}</span>}
                  {e.assignedTo && <span>→ {e.assignedTo.email}</span>}
                </div>
              </div>
              <p className="text-[9px] text-[var(--dpf-muted)] shrink-0">
                {new Date(e.createdAt).toLocaleDateString()}
              </p>
            </div>
          );
        })}
      </div>

      {engagements.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No engagements yet.</p>
      )}
    </div>
  );
}
