// BI-AD949172 — /ops/dev-loop: coordination map for worktrees, leases, RuntimeTargets.
// Shows the live state so operators can see who is doing what and whether
// stale entries have been cleaned up by the runtimeTargetJanitor function.

import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { prisma } from "@dpf/db";
import { LocalTime } from "@/components/ui/LocalTime";

export const dynamic = "force-dynamic";

type RuntimeTargetRow = {
  id: string;
  targetId: string;
  kind: string;
  status: string;
  lastHeartbeatAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  hostUrl: string | null;
  workCapsule: { headBranch: string | null } | null;
  featureBuild: { buildId: string } | null;
};

type LeaseRow = {
  id: string;
  leaseId: string;
  environmentKey: string;
  status: string;
  ownerProvider: string;
  purpose: string;
  worktreePath: string | null;
  branchName: string | null;
  expiresAt: Date;
  releasedAt: Date | null;
  createdAt: Date;
};

async function getData() {
  const [targets, leases] = await Promise.all([
    prisma.runtimeTarget.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        targetId: true,
        kind: true,
        status: true,
        lastHeartbeatAt: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        hostUrl: true,
        workCapsule: { select: { headBranch: true } },
        featureBuild: { select: { buildId: true } },
      },
    }) as Promise<RuntimeTargetRow[]>,
    prisma.nonProductionEnvironmentLease.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        leaseId: true,
        environmentKey: true,
        status: true,
        ownerProvider: true,
        purpose: true,
        worktreePath: true,
        branchName: true,
        expiresAt: true,
        releasedAt: true,
        createdAt: true,
      },
    }) as Promise<LeaseRow[]>,
  ]);
  return { targets, leases };
}

const STATUS_COLORS: Record<string, string> = {
  running:    "bg-green-500/15 text-green-700 dark:text-green-400",
  starting:   "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  verifying:  "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  verified:   "bg-green-700/15 text-green-800 dark:text-green-300",
  planned:    "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
  assigned:   "bg-blue-500/10 text-blue-600",
  expired:    "bg-red-500/10 text-red-600",
  failed:     "bg-red-600/15 text-red-700",
  released:   "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
  blocked:    "bg-orange-500/15 text-orange-700",
  active:     "bg-green-500/15 text-green-700 dark:text-green-400",
};

function StatusChip({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

export default async function DevLoopPage() {
  const { targets, leases } = await getData();

  const active = targets.filter(t => ["running", "starting", "verifying", "assigned"].includes(t.status));
  const stale = targets.filter(t => t.status === "expired" || t.status === "failed");
  const inactive = targets.filter(t => ["planned", "verified", "released"].includes(t.status));
  const activeLeases = leases.filter(l => l.status === "active" && !l.releasedAt);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Dev Loop</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Runtime coordination map — worktree leases, sandbox targets, and
          heartbeat status. Stale entries are swept hourly by the
          runtimeTargetJanitor function (BI-AD949172).
        </p>
      </div>

      <OpsTabNav />

      {/* Active leases */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-2">
          Active nonprod leases ({activeLeases.length})
        </h2>
        {activeLeases.length === 0 ? (
          <p className="text-xs text-[var(--dpf-muted)] py-2">
            No active leases — all local-CI sandbox slots are free.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--dpf-border)]">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
                  <th className="px-3 py-2 text-left">Environment</th>
                  <th className="px-3 py-2 text-left">Provider</th>
                  <th className="px-3 py-2 text-left">Branch</th>
                  <th className="px-3 py-2 text-left">Purpose</th>
                  <th className="px-3 py-2 text-left">Expires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--dpf-border)]">
                {activeLeases.map(l => (
                  <tr key={l.id} className="bg-[var(--dpf-surface-1)]">
                    <td className="px-3 py-2 font-mono text-[var(--dpf-text)]">{l.environmentKey}</td>
                    <td className="px-3 py-2 text-[var(--dpf-muted)]">{l.ownerProvider}</td>
                    <td className="px-3 py-2 font-mono text-[var(--dpf-text)]">{l.branchName ?? "—"}</td>
                    <td className="px-3 py-2 text-[var(--dpf-muted)] max-w-xs truncate">{l.purpose}</td>
                    <td className="px-3 py-2 text-[var(--dpf-muted)]">
                      <LocalTime value={l.expiresAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Active runtime targets */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-2">
          Active runtime targets ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="text-xs text-[var(--dpf-muted)] py-2">No active runtime targets.</p>
        ) : (
          <RuntimeTargetTable rows={active} />
        )}
      </section>

      {/* Stale / expired */}
      {stale.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-2">
            Stale / expired ({stale.length}) — swept by janitor hourly
          </h2>
          <RuntimeTargetTable rows={stale} />
        </section>
      )}

      {/* Inactive */}
      <section className="mt-6">
        <details>
          <summary className="text-sm font-semibold text-[var(--dpf-text)] cursor-pointer select-none">
            Inactive targets ({inactive.length})
          </summary>
          <div className="mt-2">
            <RuntimeTargetTable rows={inactive} />
          </div>
        </details>
      </section>

      {/* Janitor hint */}
      <div className="mt-8 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4 text-xs text-[var(--dpf-muted)]">
        <strong className="text-[var(--dpf-text)]">Janitor rules</strong>
        <ul className="mt-1 list-disc pl-4 space-y-0.5">
          <li>running/starting + no heartbeat for 2 h → <strong>expired</strong></li>
          <li>planned + no consumer for 7 days → <strong>released</strong></li>
          <li>NonProductionEnvironmentLease past expiresAt → <strong>status=expired</strong></li>
        </ul>
        <p className="mt-2">
          Run <code className="bg-[var(--dpf-surface-1)] px-1 rounded">bash scripts/worktree-janitor.sh --dry-run</code> from the
          repo root to audit local worktrees. Pass <code className="bg-[var(--dpf-surface-1)] px-1 rounded">--live</code> to prune.
        </p>
      </div>
    </div>
  );
}

function RuntimeTargetTable({ rows }: { rows: RuntimeTargetRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--dpf-border)]">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
            <th className="px-3 py-2 text-left">ID</th>
            <th className="px-3 py-2 text-left">Kind</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">URL</th>
            <th className="px-3 py-2 text-left">Last heartbeat</th>
            <th className="px-3 py-2 text-left">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--dpf-border)]">
          {rows.map(t => (
            <tr key={t.id} className="bg-[var(--dpf-surface-1)]">
              <td className="px-3 py-2 font-mono text-[var(--dpf-text)] max-w-xs truncate"
                title={t.targetId}>{t.targetId.slice(0, 32)}{t.targetId.length > 32 ? "…" : ""}</td>
              <td className="px-3 py-2 text-[var(--dpf-muted)]">{t.kind}</td>
              <td className="px-3 py-2"><StatusChip status={t.status} /></td>
              <td className="px-3 py-2 font-mono text-[var(--dpf-muted)] max-w-xs truncate">
                {t.hostUrl ?? "—"}
              </td>
              <td className="px-3 py-2 text-[var(--dpf-muted)]">
                {t.lastHeartbeatAt ? <LocalTime value={t.lastHeartbeatAt} /> : <span className="italic">never</span>}
              </td>
              <td className="px-3 py-2 text-[var(--dpf-muted)]">
                <LocalTime value={t.updatedAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
