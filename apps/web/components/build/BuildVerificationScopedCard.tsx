"use client";

import type { ScopedVerificationView } from "@/lib/build/scoped-verification";
import { TruthSourceBadge } from "./TruthSourceBadge";

type Props = {
  verification: ScopedVerificationView | null;
};

export function BuildVerificationScopedCard({ verification }: Props) {
  return (
    <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Scoped verification</h3>
        <TruthSourceBadge source="verification" observedAt={verification?.observedAt ?? null} />
      </div>
      {!verification ? (
        <p className="mt-3 text-xs text-[var(--dpf-muted)]">No verification output recorded yet.</p>
      ) : (
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
            <div className="text-[10px] uppercase text-[var(--dpf-muted)]">Build scope</div>
            <div className="mt-1 font-medium text-[var(--dpf-text)]">{verification.buildScoped.failureAxis ?? "no failure"}</div>
            <div className="mt-1 text-[var(--dpf-muted)]">
              {verification.buildScoped.affectedFiles.length} affected file(s)
            </div>
          </div>
          <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
            <div className="text-[10px] uppercase text-[var(--dpf-muted)]">Global health</div>
            <div className="mt-1 font-medium text-[var(--dpf-text)]">
              {verification.globalHealth.testsFailed ?? 0} failed test(s)
            </div>
            {verification.globalHealth.outputExcerpt && (
              <div className="mt-1 truncate text-[var(--dpf-muted)]">{verification.globalHealth.outputExcerpt}</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
