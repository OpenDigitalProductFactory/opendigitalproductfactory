// EP-SOVEREIGN-SOC P4 — /ops/security SOC console.
// Server component; the (shell)/ops layout already gates view_operations.
// First screen (spec §10.2): Are we covered? Are we exposed? What needs a
// decision? Are we improving? An empty board with no sources is NOT a green
// state — the coverage card flags it.

import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { StatCard, StatusBadge } from "@/components/ui/report-kit";
import { loadSocConsole } from "@/lib/security/console-loader";

export const dynamic = "force-dynamic";

export default async function SecurityConsolePage() {
  const { data, recentCases } = await loadSocConsole();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Security Operations</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          AI SOC console — coverage, detections, cases, and SLA across the estate.
        </p>
      </div>

      <OpsTabNav />

      {!data.coverage.monitoring && (
        <p className="mt-4 text-sm text-[var(--dpf-muted)]">
          Coverage incomplete — no security sources are reporting yet. Connect collectors before
          treating an empty board as &ldquo;all clear&rdquo;.
        </p>
      )}

      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Connected sources"
          value={data.coverage.connectedSources}
          intent={data.coverage.monitoring ? "success" : "danger"}
          hint={data.coverage.staleSources ? `${data.coverage.staleSources} stale` : "are we covered?"}
        />
        <StatCard
          label="Open detections"
          value={data.detections.open}
          intent={data.detections.open ? "warning" : "neutral"}
          hint={`${data.detections.total} in window`}
        />
        <StatCard
          label="Open cases"
          value={data.cases.open}
          intent={data.cases.open ? "warning" : "neutral"}
          hint="are we exposed?"
        />
        <StatCard
          label="Awaiting decision"
          value={data.cases.awaitingDecision}
          intent={data.cases.awaitingDecision ? "danger" : "success"}
          hint="needs you"
        />
        <StatCard
          label="MTTR"
          value={data.metrics.mttrMinutes != null ? `${data.metrics.mttrMinutes}m` : "—"}
          hint="mean time to resolve"
        />
        <StatCard
          label="False-positive rate"
          value={data.metrics.falsePositiveRate != null ? `${Math.round(data.metrics.falsePositiveRate * 100)}%` : "—"}
          hint="are we improving?"
        />
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-[var(--dpf-text)]">Recent cases</h2>
        {recentCases.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">No security cases yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[var(--dpf-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--dpf-border)] text-left text-[var(--dpf-muted)]">
                  <th className="px-3 py-2 font-medium">Case</th>
                  <th className="px-3 py-2 font-medium">Severity</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Verdict</th>
                  <th className="px-3 py-2 font-medium">Opened</th>
                </tr>
              </thead>
              <tbody>
                {recentCases.map((c) => (
                  <tr key={c.caseKey} className="border-b border-[var(--dpf-border)] last:border-0">
                    <td className="px-3 py-2 font-medium text-[var(--dpf-text)]">{c.title}</td>
                    <td className="px-3 py-2">
                      <StatusBadge domain="securitySeverity" status={c.severity} variant="soft" uppercase={false} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge domain="security" status={c.status} variant="soft" uppercase={false} />
                    </td>
                    <td className="px-3 py-2 text-[var(--dpf-muted)]">{c.verdict}</td>
                    <td className="px-3 py-2 text-[var(--dpf-muted)]">
                      {new Date(c.openedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
