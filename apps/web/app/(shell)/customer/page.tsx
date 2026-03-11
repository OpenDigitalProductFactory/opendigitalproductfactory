// apps/web/app/(shell)/customer/page.tsx
import { prisma } from "@dpf/db";

const STATUS_COLOURS: Record<string, string> = {
  prospect: "#fbbf24",
  active:   "#4ade80",
};

export default async function CustomerPage() {
  const accounts = await prisma.customerAccount.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      accountId: true,
      name: true,
      status: true,
      _count: { select: { contacts: true } },
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Customer</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {accounts.length} account{accounts.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {accounts.map((a) => {
          const contactCount = a._count.contacts;
          const statusColour = STATUS_COLOURS[a.status] ?? "#555566";

          return (
            <div
              key={a.id}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
              style={{ borderLeftColor: "#f472b6" }}
            >
              <p className="text-[9px] font-mono text-[var(--dpf-muted)] mb-1">
                {a.accountId}
              </p>
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-white leading-tight">
                  {a.name}
                </p>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: `${statusColour}20`, color: statusColour }}
                >
                  {a.status}
                </span>
              </div>
              <p className="text-[9px] text-[var(--dpf-muted)]">
                {contactCount === 0 ? "No contacts" : `${contactCount} ${contactCount === 1 ? "contact" : "contacts"}`}
              </p>
            </div>
          );
        })}
      </div>

      {accounts.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No accounts registered yet.</p>
      )}
    </div>
  );
}
