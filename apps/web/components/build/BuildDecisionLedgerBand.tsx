// apps/web/components/build/BuildDecisionLedgerBand.tsx
//
// Band 3 of the Build Studio overseer "Solution & Oversight" layer:
// "The decisions we made & why" — promotes the governed decisions (peer-review /
// debate consensus + kernel / WWMD calls) to a plain, top-altitude list for a
// non-technical overseer. Data comes from the pure read-model in
// apps/web/lib/build/decision-ledger.ts (BI-EC934FC6). Presentational only —
// no prompt-send, no mutation; composes report-kit StatusBadge (no hardcoded
// colors). Spec: docs/superpowers/specs/2026-06-22-build-studio-overseer-ux-design.md.

import { StatusBadge } from "@/components/ui/report-kit";
import type { BuildDecisionLedgerEntry } from "@/lib/build/decision-ledger";

const PHASE_LABEL: Record<BuildDecisionLedgerEntry["phase"], string> = {
  ideate: "Design",
  plan: "Plan",
  build: "Build",
  review: "Review",
};

export function BuildDecisionLedgerBand({
  entries,
  engineerView = false,
}: {
  entries: readonly BuildDecisionLedgerEntry[];
  engineerView?: boolean;
}) {
  if (!engineerView) {
    return <OperatorDecisionSummary entries={entries} />;
  }

  return (
    <section
      data-testid="build-decision-ledger-band"
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 shadow-dpf-xs"
    >
      <div className="flex items-center gap-2">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className="text-[var(--dpf-muted)]"
        >
          <path d="M12 3v18M3 7l9-4 9 4M5 10v6m14-6v6M3 16l2 4h-4zM21 16l2 4h-4zM10 7h4" />
        </svg>
        <h3 className="m-0 text-sm font-semibold text-[var(--dpf-text)]">
          The decisions we made &amp; why
        </h3>
      </div>

      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--dpf-muted)]">
          No decisions have been recorded for this build yet. As the coworker reviews
          the design and plan, the calls it makes will show up here in plain language.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--dpf-border)]">
          {entries.map((entry) => (
            <li key={entry.id} className="py-2 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-[var(--dpf-text)]">
                  {entry.theCall}
                </span>
                {entry.governance && (
                  <StatusBadge intent="success" label="Governance" variant="soft" />
                )}
                <StatusBadge
                  intent={entry.source === "kernel" ? "accent" : "neutral"}
                  label={PHASE_LABEL[entry.phase]}
                  variant="soft"
                />
              </div>

              {entry.theOptions.length > 0 && (
                <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                  Weighed: {entry.theOptions.join(" vs ")}
                </p>
              )}

              {entry.theWhy && (
                <p className="mt-1 text-xs leading-relaxed text-[var(--dpf-text-secondary)]">
                  {entry.theWhy}
                </p>
              )}

              {entry.unresolvedRisks.length > 0 && (
                <div className="mt-1">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--dpf-warning)]">
                    Still open
                  </div>
                  <ul className="mt-0.5 list-disc pl-5 text-xs leading-relaxed text-[var(--dpf-text-secondary)]">
                    {entry.unresolvedRisks.map((risk, index) => (
                      <li key={`${entry.id}-risk-${index}`}>{risk}</li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OperatorDecisionSummary({
  entries,
}: {
  entries: readonly BuildDecisionLedgerEntry[];
}) {
  const latest = entries[0] ?? null;
  const openConcernCount = entries.reduce((sum, entry) => sum + entry.unresolvedRisks.length, 0);

  return (
    <section
      data-testid="build-decision-ledger-band"
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 shadow-dpf-xs"
    >
      <div className="flex items-center gap-2">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className="text-[var(--dpf-muted)]"
        >
          <path d="M12 3v18M3 7l9-4 9 4M5 10v6m14-6v6M3 16l2 4h-4zM21 16l2 4h-4zM10 7h4" />
        </svg>
        <h3 className="m-0 text-sm font-semibold text-[var(--dpf-text)]">
          AI Coworker decision
        </h3>
      </div>

      {latest ? (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[var(--dpf-text)]">
              Current call: {latest.theCall}
            </span>
            <StatusBadge
              intent={latest.source === "kernel" ? "accent" : "neutral"}
              label={PHASE_LABEL[latest.phase]}
              variant="soft"
            />
            {latest.governance && <StatusBadge intent="success" label="Governed" variant="soft" />}
          </div>

          {latest.theWhy && (
            <p className="m-0 max-w-3xl text-xs leading-relaxed text-[var(--dpf-text-secondary)]">
              Why: {compactOperatorDecisionLine(latest.theWhy)}
            </p>
          )}

          <p className="m-0 text-xs text-[var(--dpf-muted)]">
            {openConcernCount > 0
              ? `AI Coworker is carrying ${openConcernCount} technical ${openConcernCount === 1 ? "concern" : "concerns"} in Engineer view.`
              : "No extra decision is waiting on you."}
            {entries.length > 1 ? ` ${entries.length - 1} more ${entries.length === 2 ? "decision is" : "decisions are"} tracked in Engineer view.` : ""}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-[var(--dpf-muted)]">
          No build decision is waiting on you. AI Coworker will surface one here when your direction is needed.
        </p>
      )}
    </section>
  );
}

function compactOperatorDecisionLine(value: string, maxLength = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const sentenceBreak = normalized.lastIndexOf(".", maxLength);
  const cutAt = sentenceBreak >= 80 ? sentenceBreak + 1 : maxLength;
  return `${normalized.slice(0, cutAt).trim()}...`;
}
