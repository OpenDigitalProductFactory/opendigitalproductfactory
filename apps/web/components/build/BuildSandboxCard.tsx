"use client";

import type { BuildSandboxState } from "@/lib/build/sandbox-state";
import type { SandboxSourceCurrencyStatus } from "@/lib/build/sandbox/sandbox-source-currency";
import { getTruthSourceAge } from "@/lib/build/progress-visibility-types";
import { TruthSourceBadge } from "./TruthSourceBadge";

type Props = {
  sandbox: BuildSandboxState | null;
};

export function BuildSandboxCard({ sandbox }: Props) {
  const sourceCurrencyAge = sandbox?.sourceCurrency
    ? getTruthSourceAge(sandbox.sourceCurrency.checkedAt)
    : null;

  return (
    <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Sandbox branch</h3>
        <TruthSourceBadge source="sandbox-git" observedAt={sandbox?.observedAt ?? null} ageLabel={sandbox?.headAgeLabel ?? null} />
      </div>
      {!sandbox ? (
        <p className="mt-3 text-xs text-[var(--dpf-muted)]">No sandbox state is available for this build.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 text-xs text-[var(--dpf-muted)] sm:grid-cols-3">
            <div>
              <div className="text-[10px] uppercase text-[var(--dpf-muted)]">Branch</div>
              <div className="font-mono text-[var(--dpf-text)]">{sandbox.branch ?? "unknown"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-[var(--dpf-muted)]">Head</div>
              <div className="font-mono text-[var(--dpf-text)]">{sandbox.headSha?.slice(0, 8) ?? "unknown"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-[var(--dpf-muted)]">Ahead</div>
              <div className="font-mono text-[var(--dpf-text)]">{sandbox.commitsAhead ?? "unknown"}</div>
            </div>
          </div>

          {sandbox.sourceCurrency && (
            <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase text-[var(--dpf-muted)]">Source currency</span>
                  <TruthSourceBadge
                    source="sandbox-git"
                    observedAt={sandbox.sourceCurrency.checkedAt}
                    ageLabel={sourceCurrencyAge?.label ?? null}
                    conflict={sourceCurrencyAge?.stale ?? false}
                  />
                </div>
                <span className={`font-semibold ${sourceCurrencyStatusClass(sandbox.sourceCurrency.status)}`}>
                  {sandbox.sourceCurrency.status}
                </span>
              </div>
              <div className="mt-2 grid gap-2 text-[var(--dpf-muted)] sm:grid-cols-3">
                <div>
                  <div className="text-[10px] uppercase">Target</div>
                  <div className="font-mono text-[var(--dpf-text)]">{sandbox.sourceCurrency.targetRef}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase">Ahead / behind</div>
                  <div className="font-mono text-[var(--dpf-text)]">
                    {sandbox.sourceCurrency.aheadBy ?? "?"} / {sandbox.sourceCurrency.behindBy ?? "?"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase">Action</div>
                  <div className="font-mono text-[var(--dpf-text)]">{sandbox.sourceCurrency.recommendedAction}</div>
                </div>
              </div>
              {sandbox.sourceCurrency.reason && (
                <p className="mt-2 text-[var(--dpf-muted)]">{sandbox.sourceCurrency.reason}</p>
              )}
              {sourceCurrencyAge?.stale && (
                <p className="mt-2 rounded border border-[var(--dpf-warning)] bg-[var(--dpf-surface-1)] px-2 py-1 text-[var(--dpf-warning)]">
                  Source currency snapshot is stale.
                </p>
              )}
            </div>
          )}

          <div>
            <div className="text-[10px] uppercase text-[var(--dpf-muted)]">Source diffstat</div>
            <div className="mt-1 space-y-1">
              {sandbox.sourceDiffstat.length > 0 ? sandbox.sourceDiffstat.map((entry) => (
                <div key={entry.path} className="flex items-center justify-between gap-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs">
                  <span className="min-w-0 truncate font-mono text-[var(--dpf-text)]">{entry.path}</span>
                  <span className="shrink-0 text-[var(--dpf-muted)]">+{entry.additions} -{entry.deletions}</span>
                </div>
              )) : (
                <p className="text-xs text-[var(--dpf-muted)]">{sandbox.unavailableReason ?? "No source diff recorded yet."}</p>
              )}
            </div>
          </div>

          {sandbox.expectedPlanFiles.length > 0 && (
            <div>
              <div className="text-[10px] uppercase text-[var(--dpf-muted)]">Expected files</div>
              <div className="mt-1 space-y-1">
                {sandbox.expectedPlanFiles.map((file) => (
                  <div key={file.path} className="flex items-center justify-between gap-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs">
                    <span className="min-w-0 truncate font-mono text-[var(--dpf-text)]">{file.path}</span>
                    <span className="shrink-0 text-[var(--dpf-muted)]">{file.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function sourceCurrencyStatusClass(status: SandboxSourceCurrencyStatus): string {
  switch (status) {
    case "current":
    case "ahead":
      return "text-[var(--dpf-success)]";
    case "behind":
    case "unknown":
      return "text-[var(--dpf-warning)]";
    case "dirty":
    case "diverged":
      return "text-[var(--dpf-error)]";
    default:
      return "text-[var(--dpf-muted)]";
  }
}
