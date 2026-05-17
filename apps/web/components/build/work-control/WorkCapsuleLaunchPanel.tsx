import type { LaunchStep } from "@/lib/work-capsules/launch-presenter";

export function WorkCapsuleLaunchPanel({ steps }: { steps: LaunchStep[] }) {
  if (steps.length === 0) {
    return (
      <section className="space-y-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <h2 className="text-base font-semibold text-[var(--dpf-text)]">Launch</h2>
        <p className="text-sm text-[var(--dpf-muted)]">Plan the workspace first to see the launch commands.</p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <h2 className="text-base font-semibold text-[var(--dpf-text)]">Launch</h2>
      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li key={`${step.label}-${index}`} className="space-y-1">
            <div className="text-xs font-medium text-[var(--dpf-muted)]">
              {index + 1}. {step.label}
            </div>
            <pre className="overflow-x-auto rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs text-[var(--dpf-text)]">
              <code>{step.command}</code>
            </pre>
          </li>
        ))}
      </ol>
    </section>
  );
}
