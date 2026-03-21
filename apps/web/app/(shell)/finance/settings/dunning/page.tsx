// apps/web/app/(shell)/finance/settings/dunning/page.tsx
import { getDefaultDunningSequence } from "@/lib/actions/dunning";
import { SeedDunningButton } from "@/components/finance/SeedDunningButton";
import Link from "next/link";

const SEVERITY_COLOURS: Record<string, string> = {
  friendly: "#4ade80",
  firm: "#fbbf24",
  final: "#fb923c",
  escalation: "#ef4444",
};

function formatDayOffset(dayOffset: number): string {
  if (dayOffset < 0) return `${Math.abs(dayOffset)} day${Math.abs(dayOffset) !== 1 ? "s" : ""} before due`;
  if (dayOffset === 0) return "On due date";
  return `${dayOffset} day${dayOffset !== 1 ? "s" : ""} after due`;
}

export default async function DunningSettingsPage() {
  const sequence = await getDefaultDunningSequence();

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link
          href="/finance"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link href="/finance/settings" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Settings</Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Dunning</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">
            Payment Reminder Sequence
          </h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            Automated reminders are sent based on invoice due dates.
          </p>
        </div>
      </div>

      {!sequence || sequence.steps.length === 0 ? (
        <div className="p-8 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-center">
          <p className="text-sm text-[var(--dpf-muted)] mb-4">
            No default dunning sequence configured. Seed the standard credit
            control sequence to get started.
          </p>
          <SeedDunningButton />
        </div>
      ) : (
        <div>
          {/* Sequence info */}
          <div className="mb-6 p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-[var(--dpf-text)]">
                {sequence.name}
              </p>
              {sequence.isDefault && (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full"
                  style={{ color: "#4ade80", backgroundColor: "#4ade8020" }}
                >
                  default
                </span>
              )}
              {sequence.isActive && (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full"
                  style={{ color: "#38bdf8", backgroundColor: "#38bdf820" }}
                >
                  active
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--dpf-muted)] mt-1">
              {sequence.steps.length} step{sequence.steps.length !== 1 ? "s" : ""}
            </p>
          </div>

          {/* Timeline */}
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-5 top-0 bottom-0 w-px bg-[var(--dpf-border)]" />

            <div className="space-y-4">
              {sequence.steps.map((step, idx) => {
                const colour =
                  SEVERITY_COLOURS[step.severity] ?? "#6b7280";
                return (
                  <div key={step.id} className="relative flex gap-4">
                    {/* Timeline dot */}
                    <div
                      className="relative z-10 flex-shrink-0 w-10 h-10 rounded-full border-2 flex items-center justify-center text-[10px] font-bold"
                      style={{
                        borderColor: colour,
                        backgroundColor: `${colour}15`,
                        color: colour,
                      }}
                    >
                      {idx + 1}
                    </div>

                    {/* Step card */}
                    <div className="flex-1 p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] mb-2">
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{
                            color: colour,
                            backgroundColor: `${colour}20`,
                          }}
                        >
                          {formatDayOffset(step.dayOffset)}
                        </span>
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{
                            color: colour,
                            backgroundColor: `${colour}15`,
                          }}
                        >
                          {step.severity}
                        </span>
                      </div>
                      <p className="text-sm text-[var(--dpf-text)] font-medium">
                        {step.subject}
                      </p>
                      <p className="text-[9px] font-mono text-[var(--dpf-muted)] mt-1">
                        template: {step.emailTemplate}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer note */}
          <div className="mt-6 p-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
            <p className="text-xs text-[var(--dpf-muted)]">
              Reminders run automatically. Each reminder includes a Pay Now link.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
