import type { SelfUpgradeDashboard } from "@/lib/actions/self-upgrade";
import { requestPortalSelfUpgradeAction } from "@/lib/actions/self-upgrade";
import { LocalTime } from "@/components/ui/LocalTime";

function shortSha(value: string | null): string {
  return value ? value.slice(0, 12) : "unknown";
}

function statusLabel(value: string): string {
  return value.replace(/_/g, " ");
}

export function SelfUpgradePanel({ dashboard }: { dashboard: SelfUpgradeDashboard }) {
  const versionState = dashboard.versionState;

  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <div className="text-xs font-medium uppercase text-[var(--dpf-muted)]">Configured Source</div>
          <div className="mt-2 text-sm font-semibold text-[var(--dpf-text)]">
            {dashboard.config.repositoryRemote}/{dashboard.config.repositoryBranch}
          </div>
          <div className="mt-1 text-xs text-[var(--dpf-muted)]">
            {dashboard.config.hostSourceMountPath}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <div className="text-xs font-medium uppercase text-[var(--dpf-muted)]">Running Image</div>
          <div className="mt-2 font-mono text-sm text-[var(--dpf-text)]">
            {shortSha(versionState?.currentSha ?? null)}
          </div>
          <div className="mt-1 text-xs text-[var(--dpf-muted)]">
            {versionState?.comparable ? "Git SHA comparable" : "Comparison limited"}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <div className="text-xs font-medium uppercase text-[var(--dpf-muted)]">Target Head</div>
          <div className="mt-2 font-mono text-sm text-[var(--dpf-text)]">
            {shortSha(versionState?.targetSha ?? null)}
          </div>
          <div className="mt-1 text-xs text-[var(--dpf-muted)]">
            {versionState?.upToDate ? "Already current" : versionState?.reason ?? dashboard.versionError ?? "Pending read"}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Self-Upgrade Control</h2>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              Uses compose project {dashboard.config.composeProject} and health check {dashboard.config.healthUrl}.
            </p>
          </div>
          <form action={requestPortalSelfUpgradeAction}>
            <button
              type="submit"
              className="rounded-lg bg-[var(--dpf-accent)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Queue Upgrade Check
            </button>
          </form>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Recent Runs</h2>
          <span className="text-xs text-[var(--dpf-muted)]">{dashboard.runs.length} shown</span>
        </div>
        {dashboard.runs.length === 0 ? (
          <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6 text-center text-sm text-[var(--dpf-muted)]">
            No self-upgrade runs have been recorded yet.
          </div>
        ) : (
          <div className="space-y-3">
            {dashboard.runs.map((run) => (
              <article
                key={run.runId}
                className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-[var(--dpf-text)]">{run.runId}</span>
                      <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 text-xs text-[var(--dpf-muted)]">
                        {statusLabel(run.status)}
                      </span>
                      <span className="text-xs text-[var(--dpf-muted)]">{run.trigger}</span>
                    </div>
                    <div className="mt-2 grid gap-2 text-xs text-[var(--dpf-muted)] sm:grid-cols-3">
                      <span>from {shortSha(run.currentSha)}</span>
                      <span>to {shortSha(run.targetSha)}</span>
                      <span>deployed {shortSha(run.deployedSha)}</span>
                    </div>
                    {run.reason && (
                      <p className="mt-2 text-xs text-[var(--dpf-muted)]">{run.reason}</p>
                    )}
                  </div>
                  <div className="text-xs text-[var(--dpf-muted)] md:text-right">
                    <div>
                      started{" "}
                      <LocalTime value={run.startedAt} fallback="not recorded" />
                    </div>
                    <div>
                      updated{" "}
                      <LocalTime value={run.updatedAt} fallback="not recorded" />
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
