"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerSelfUpgrade } from "@/lib/actions/promotions";

type LatestRun = {
  runId: string;
  status: string;
  trigger: string | null;
  currentSha: string | null;
  targetSha: string | null;
  deployedSha: string | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  failureLog: string | null;
  createdAt: Date | string;
};

type ImageVersionSource = "git-sha" | "content-hash" | "unknown";

type Props = {
  enabled: boolean;
  channel: string;
  inMaintenanceWindow: boolean;
  deployedSha: string | null;
  deployedShaSource?: ImageVersionSource;
  targetSha: string | null;
  isFresh: boolean;
  latestRun: LatestRun | null;
  history?: LatestRun[];
  historyNextCursor?: string | null;
  platformVersion: {
    version: string;
    publishedAt: string;
    gitSha: string | null;
    imageVersion?: { raw: string; source: ImageVersionSource } | null;
    buildDate?: string | null;
    note: string | null;
  };
};

function shortSha(value: string | null | undefined): string {
  if (!value) return "";
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function sourceLabel(source: ImageVersionSource | undefined): string {
  switch (source) {
    case "git-sha":
      return "commit";
    case "content-hash":
      return "image hash";
    default:
      return "image";
  }
}

function formatDuration(start: Date | string, end: Date | string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms <= 0) return "";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

function formatDate(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

const RUN_STATUS_STYLES: Record<string, string> = {
  running: "bg-[var(--dpf-info)]/20 text-[var(--dpf-info)] border-[var(--dpf-info)]/30",
  succeeded: "bg-[var(--dpf-success)]/20 text-[var(--dpf-success)] border-[var(--dpf-success)]/30",
  failed: "bg-[var(--dpf-destructive)]/20 text-[var(--dpf-destructive)] border-[var(--dpf-destructive)]/30",
  skipped: "bg-[var(--dpf-muted)]/20 text-[var(--dpf-muted)] border-[var(--dpf-muted)]/30",
};

const DEFAULT_STATUS_STYLE =
  "bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] border-[var(--dpf-border)]";

export default function SelfUpgradeClient({
  enabled,
  channel,
  inMaintenanceWindow,
  deployedSha,
  deployedShaSource,
  targetSha,
  isFresh,
  latestRun,
  history,
  historyNextCursor,
  platformVersion,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [triggerResult, setTriggerResult] = useState<{ queued: boolean; reason?: string } | null>(null);

  function handleTrigger() {
    setTriggerResult(null);
    startTransition(async () => {
      const result = await triggerSelfUpgrade();
      setTriggerResult(result);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              enabled ? "bg-[var(--dpf-success)]" : "bg-[var(--dpf-muted)]"
            }`}
          />
          <span className="text-sm font-medium text-[var(--dpf-text)]">
            Self-Upgrade:{" "}
            <span data-upgrade-status={enabled ? "enabled" : "disabled"}>
              {enabled ? "Enabled" : "Disabled"}
            </span>
          </span>
          <span className="text-xs text-[var(--dpf-muted)]">({channel})</span>
        </div>

        {enabled && (
          <button
            type="button"
            onClick={handleTrigger}
            disabled={isPending || latestRun?.status === "running"}
            aria-busy={isPending}
            aria-label="Trigger self-upgrade now"
            className="px-3 py-1.5 text-xs rounded-lg bg-[var(--dpf-accent)]/20 text-[var(--dpf-accent)] border border-[var(--dpf-accent)]/40 hover:bg-[var(--dpf-accent)]/30 transition-colors disabled:opacity-50"
          >
            {isPending ? "Triggering..." : "Trigger Now"}
          </button>
        )}
      </div>

      {!enabled && (
        <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-sm text-[var(--dpf-muted)]">
          Self-upgrade is disabled. Enable it in settings to allow automated upgrades.
        </div>
      )}

      {enabled && inMaintenanceWindow && (
        <div className="p-3 rounded-lg bg-[var(--dpf-success)]/10 border border-[var(--dpf-success)]/30 text-sm text-[var(--dpf-text)]">
          Currently in maintenance window — upgrades are scheduled.
        </div>
      )}

      <div
        className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] space-y-1"
        data-platform-version={platformVersion.version}
      >
        <div className="text-xs text-[var(--dpf-muted)]">
          <span className="font-medium text-[var(--dpf-text)]">Platform build:</span>{" "}
          {platformVersion.gitSha || platformVersion.imageVersion?.raw ? (
            <span className="font-mono text-[var(--dpf-text)]">
              {shortSha(platformVersion.gitSha ?? platformVersion.imageVersion?.raw ?? null)}
            </span>
          ) : (
            <span className="font-mono text-[var(--dpf-text)]">dev (unbuilt)</span>
          )}
          {platformVersion.imageVersion?.source && (
            <span className="ml-2 text-[var(--dpf-muted)]">
              ({sourceLabel(platformVersion.imageVersion.source)})
            </span>
          )}
          {platformVersion.buildDate && (
            <span className="ml-2 text-[var(--dpf-muted)]">
              · built {formatDate(platformVersion.buildDate)}
            </span>
          )}
        </div>
        <div className="text-[11px] text-[var(--dpf-muted)]">
          baseline v{platformVersion.version}
        </div>
        {enabled && (
          <>
            <div className="text-xs text-[var(--dpf-muted)]">
              <span className="font-medium text-[var(--dpf-text)]">Deployed:</span>{" "}
              {deployedSha ? (
                <>
                  <span className="font-mono">{deployedSha}</span>
                  {deployedShaSource && deployedShaSource !== "unknown" && (
                    <span className="ml-2 text-[var(--dpf-muted)]">
                      ({sourceLabel(deployedShaSource)})
                    </span>
                  )}
                </>
              ) : (
                <span className="font-mono">unknown</span>
              )}
            </div>
            <div className="text-xs text-[var(--dpf-muted)]">
              <span className="font-medium text-[var(--dpf-text)]">Target:</span>{" "}
              <span className="font-mono">{targetSha ?? "unknown"}</span>
            </div>
            {isFresh && (
              <div className="text-xs text-[var(--dpf-success)]">Up to date</div>
            )}
            {!isFresh && targetSha && deployedShaSource === "content-hash" && (
              <div className="text-xs text-[var(--dpf-warning)]">
                This image wasn&apos;t stamped with a git commit, so it
                can&apos;t be compared to the upgrade target. Published releases
                are stamped automatically by CI; for a local build, rebuild with{" "}
                <span className="font-mono">scripts/build-images.sh</span>{" "}
                (<span className="font-mono">build-images.ps1</span> on Windows).
              </div>
            )}
            {!isFresh && targetSha && deployedShaSource !== "content-hash" && (
              <div className="text-xs text-[var(--dpf-warning)]">Update available</div>
            )}
          </>
        )}
      </div>

      {enabled && !latestRun && (
        <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-xs text-[var(--dpf-muted)]">
          No runs yet.
        </div>
      )}

      {latestRun && (
        <div
          className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] space-y-2"
          data-run-status={latestRun.status}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--dpf-text)]">Latest Run</span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs border ${
                RUN_STATUS_STYLES[latestRun.status] ??
                "bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] border-[var(--dpf-border)]"
              }`}
            >
              {latestRun.status}
            </span>
            <span className="text-xs font-mono text-[var(--dpf-muted)]">{latestRun.runId}</span>
          </div>

          {latestRun.currentSha && latestRun.targetSha && (
            <div className="text-xs text-[var(--dpf-muted)]">
              <span className="font-mono">{latestRun.currentSha}</span>
              {" → "}
              <span className="font-mono">{latestRun.targetSha}</span>
            </div>
          )}

          {latestRun.trigger && (
            <div className="text-xs text-[var(--dpf-muted)]">
              Triggered by: {latestRun.trigger}
            </div>
          )}

          {latestRun.startedAt && (
            <div className="text-xs text-[var(--dpf-muted)]">
              Started:{" "}
              <span className="font-mono">{formatDate(latestRun.startedAt)}</span>
              {latestRun.completedAt && (
                <> · {formatDuration(latestRun.startedAt, latestRun.completedAt)}</>
              )}
            </div>
          )}

          {latestRun.failureLog && (
            <details className="text-xs">
              <summary className="cursor-pointer text-[var(--dpf-destructive)]">
                Error details
              </summary>
              <div className="mt-1 p-2 rounded bg-[var(--dpf-destructive)]/10 text-[var(--dpf-destructive)]">
                {latestRun.failureLog}
              </div>
            </details>
          )}
        </div>
      )}

      {history && history.length > 0 && (
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
          <div className="px-3 py-2 border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
            <span className="text-xs font-medium text-[var(--dpf-text)]">Run History</span>
          </div>
          <table className="w-full text-xs">
            <tbody>
              {history.map((run) => (
                <tr
                  key={run.runId}
                  className="border-b border-[var(--dpf-border)] last:border-0"
                  data-run-id={run.runId}
                >
                  <td className="px-3 py-2 w-24 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded-full border ${
                        RUN_STATUS_STYLES[run.status] ?? DEFAULT_STATUS_STYLE
                      }`}
                    >
                      {run.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[var(--dpf-muted)]">{run.runId}</td>
                  <td className="px-3 py-2 text-[var(--dpf-muted)]">
                    {run.currentSha && run.targetSha ? (
                      <>
                        <span className="font-mono">{run.currentSha}</span>
                        {" → "}
                        <span className="font-mono">{run.targetSha}</span>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {historyNextCursor != null && (
            <div className="px-3 py-2 border-t border-[var(--dpf-border)]">
              <button
                type="button"
                className="text-xs text-[var(--dpf-accent)] hover:underline"
              >
                Load more
              </button>
            </div>
          )}
        </div>
      )}

      {triggerResult && (
        <div
          className={`p-3 rounded-lg text-sm ${
            triggerResult.queued
              ? "bg-[var(--dpf-success)]/10 text-[var(--dpf-success)] border border-[var(--dpf-success)]/30"
              : "bg-[var(--dpf-destructive)]/10 text-[var(--dpf-destructive)] border border-[var(--dpf-destructive)]/30"
          }`}
        >
          {triggerResult.queued ? "Upgrade queued." : `Not queued: ${triggerResult.reason}`}
        </div>
      )}
    </div>
  );
}
