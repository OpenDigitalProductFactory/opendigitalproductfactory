"use client";

import type { BuildSandboxState } from "@/lib/build/sandbox-state";
import { TruthSourceBadge } from "./TruthSourceBadge";

type Props = {
  sandbox: BuildSandboxState | null;
};

export function BuildSandboxCard({ sandbox }: Props) {
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
