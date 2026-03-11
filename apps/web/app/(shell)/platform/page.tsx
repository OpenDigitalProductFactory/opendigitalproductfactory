// apps/web/app/(shell)/platform/page.tsx
import { prisma } from "@dpf/db";

const STATE_COLOURS: Record<string, string> = {
  active: "#4ade80",
};

export default async function PlatformPage() {
  const capabilities = await prisma.platformCapability.findMany({
    orderBy: { capabilityId: "asc" },
    select: {
      id: true,
      capabilityId: true,
      name: true,
      description: true,
      state: true,
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Platform</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {capabilities.length} capabilit{capabilities.length !== 1 ? "ies" : "y"}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {capabilities.map((c) => {
          const stateColour = STATE_COLOURS[c.state] ?? "#555566";

          return (
            <div
              key={c.id}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
              style={{ borderLeftColor: "#fb923c" }}
            >
              <p className="text-[9px] font-mono text-[var(--dpf-muted)] mb-1">
                {c.capabilityId}
              </p>
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-sm font-semibold text-white leading-tight">
                  {c.name}
                </p>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: `${stateColour}20`, color: stateColour }}
                >
                  {c.state}
                </span>
              </div>
              {c.description != null && (
                <p className="text-[10px] text-[var(--dpf-muted)] line-clamp-2">
                  {c.description}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {capabilities.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No capabilities registered yet.</p>
      )}
    </div>
  );
}
