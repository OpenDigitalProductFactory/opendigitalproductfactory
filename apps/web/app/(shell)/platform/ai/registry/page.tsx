// apps/web/app/(shell)/platform/ai/registry/page.tsx
// Agent Registry — admin view of the canonical IT4IT-aligned roster
// (packages/db/data/agent_registry.json) reconciled against the operational
// Agent table. Built to close the gap that prompted this feature: the
// AI Ops Engineer was confidently denying the existence of agents like
// `deploy-orchestrator` because they live in the registry but are not
// surfaced anywhere in the UI.

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { getAgentGrantSummaries } from "@/lib/agent-grants";

const TIER_ORDER = ["orchestrator", "specialist", "cross-cutting"] as const;

const TIER_LABELS: Record<string, string> = {
  orchestrator: "Tier 1 — Orchestrators",
  specialist: "Tier 2 — Specialists",
  "cross-cutting": "Tier 3 — Cross-cutting",
};

export default async function AgentRegistryPage() {
  const session = await auth();
  const user = session?.user;
  if (!user || !can(
    { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
    "manage_platform",
  )) {
    redirect("/platform/ai");
  }

  const [registrySummaries, dbCoworkers] = await Promise.all([
    getAgentGrantSummaries(),
    prisma.agent.findMany({
      where: { type: "coworker", archived: false },
      select: {
        agentId: true,
        slugId: true,
        name: true,
        tier: true,
        valueStream: true,
        description: true,
        lifecycleStage: true,
      },
      orderBy: [{ tier: "asc" }, { name: "asc" }],
    }).catch(() => []),
  ]);

  // Reconciliation: which registry agents are also seeded into the Agent table?
  // Match by name or by slug/id (both sources use slugified names).
  const dbNameSet = new Set(dbCoworkers.map((c) => c.name.toLowerCase()));
  const dbIdSet = new Set(
    dbCoworkers.flatMap((c) => [c.agentId.toLowerCase(), (c.slugId ?? "").toLowerCase()].filter(Boolean)),
  );
  const registryNameSet = new Set(registrySummaries.map((r) => r.agentName.toLowerCase()));

  const groupedRegistry: Record<string, typeof registrySummaries> = {};
  for (const r of registrySummaries) {
    const key = TIER_ORDER.includes(r.tier as (typeof TIER_ORDER)[number])
      ? r.tier
      : "specialist";
    (groupedRegistry[key] ??= []).push(r);
  }

  // DB coworkers not present in the canonical registry — these are coworkers
  // we operate but that have no IT4IT-aligned definition. Not necessarily a
  // bug, but worth surfacing so the gap is visible.
  const dbOnly = dbCoworkers.filter((c) => !registryNameSet.has(c.name.toLowerCase()));

  const totalRegistry = registrySummaries.length;
  const totalDb = dbCoworkers.length;
  const reconciledCount = registrySummaries.filter(
    (r) =>
      dbNameSet.has(r.agentName.toLowerCase()) ||
      dbIdSet.has(r.agentId.toLowerCase()),
  ).length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Agent Registry</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Canonical IT4IT-aligned agent roster from{" "}
          <code className="text-xs bg-[var(--dpf-surface-2)] px-1 rounded">
            packages/db/data/agent_registry.json
          </code>
          , reconciled against the operational Agent table.
        </p>
      </div>

      {/* Reconciliation summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <SummaryCard
          label="Canonical registry"
          value={totalRegistry}
          hint="orchestrators + specialists in agent_registry.json"
        />
        <SummaryCard
          label="Operational coworkers"
          value={totalDb}
          hint="rows in Agent table with type=coworker"
        />
        <SummaryCard
          label="Reconciled"
          value={`${reconciledCount} / ${totalRegistry}`}
          hint="registry agents with a matching DB row"
          tone={reconciledCount < totalRegistry ? "warn" : "ok"}
        />
      </div>

      {/* Registry — grouped by tier */}
      {TIER_ORDER.map((tier) => {
        const rows = groupedRegistry[tier] ?? [];
        if (rows.length === 0) return null;
        return (
          <section key={tier} className="mb-6">
            <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-2">
              {TIER_LABELS[tier]} <span className="text-[var(--dpf-muted)] font-normal">({rows.length})</span>
            </h2>
            <div className="border border-[var(--dpf-border)] rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Agent</th>
                    <th className="text-left px-3 py-2 font-medium">ID</th>
                    <th className="text-left px-3 py-2 font-medium">Value stream</th>
                    <th className="text-left px-3 py-2 font-medium">Supervisor</th>
                    <th className="text-left px-3 py-2 font-medium">HITL</th>
                    <th className="text-left px-3 py-2 font-medium">Grants</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => {
                    const inDb =
                      dbNameSet.has(a.agentName.toLowerCase()) ||
                      dbIdSet.has(a.agentId.toLowerCase());
                    return (
                      <tr key={a.agentId} className="border-t border-[var(--dpf-border)]">
                        <td className="px-3 py-2 text-[var(--dpf-text)]">{a.agentName}</td>
                        <td className="px-3 py-2 font-mono text-[var(--dpf-muted)]">{a.agentId}</td>
                        <td className="px-3 py-2 text-[var(--dpf-muted)]">{a.valueStream}</td>
                        <td className="px-3 py-2 text-[var(--dpf-muted)]">{a.supervisorId || "—"}</td>
                        <td className="px-3 py-2 text-[var(--dpf-muted)]">tier {a.hitlTier}</td>
                        <td className="px-3 py-2 text-[var(--dpf-muted)]">{a.grantCount}</td>
                        <td className="px-3 py-2">
                          {inDb ? (
                            <Badge tone="ok">in DB</Badge>
                          ) : (
                            <Badge tone="warn">registry only</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {/* DB coworkers with no canonical registry entry */}
      {dbOnly.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-2">
            DB coworkers without a canonical registry entry{" "}
            <span className="text-[var(--dpf-muted)] font-normal">({dbOnly.length})</span>
          </h2>
          <p className="text-xs text-[var(--dpf-muted)] mb-2">
            These coworkers are seeded into the Agent table but have no matching entry in
            agent_registry.json. They may be UI-side personas that pre-date the canonical
            registry, or registry entries that need to be added.
          </p>
          <div className="border border-[var(--dpf-border)] rounded overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Coworker</th>
                  <th className="text-left px-3 py-2 font-medium">Slug</th>
                  <th className="text-left px-3 py-2 font-medium">Value stream</th>
                  <th className="text-left px-3 py-2 font-medium">Lifecycle</th>
                  <th className="text-left px-3 py-2 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {dbOnly.map((c) => (
                  <tr key={c.agentId} className="border-t border-[var(--dpf-border)]">
                    <td className="px-3 py-2 text-[var(--dpf-text)]">{c.name}</td>
                    <td className="px-3 py-2 font-mono text-[var(--dpf-muted)]">{c.slugId ?? c.agentId}</td>
                    <td className="px-3 py-2 text-[var(--dpf-muted)]">{c.valueStream ?? "—"}</td>
                    <td className="px-3 py-2 text-[var(--dpf-muted)]">{c.lifecycleStage}</td>
                    <td className="px-3 py-2 text-[var(--dpf-muted)] max-w-md truncate" title={c.description ?? ""}>
                      {c.description ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number | string;
  hint: string;
  tone?: "ok" | "warn";
}) {
  const accent =
    tone === "warn"
      ? "border-l-4 border-l-amber-500"
      : tone === "ok"
        ? "border-l-4 border-l-emerald-500"
        : "";
  return (
    <div
      className={[
        "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded p-3",
        accent,
      ].join(" ")}
    >
      <div className="text-2xl font-bold text-[var(--dpf-text)]">{value}</div>
      <div className="text-xs font-medium text-[var(--dpf-text)] mt-0.5">{label}</div>
      <div className="text-[10px] text-[var(--dpf-muted)] mt-0.5">{hint}</div>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "ok" | "warn" }) {
  const cls =
    tone === "ok"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded border ${cls}`}>
      {children}
    </span>
  );
}
