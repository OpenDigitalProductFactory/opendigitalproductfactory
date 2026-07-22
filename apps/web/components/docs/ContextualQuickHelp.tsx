import { resolveQuickHelp, type QuickHelp } from "@/lib/docs-quick-help";

type Props = {
  sourceRoute: string;
};

/**
 * The contextual header shown when docs are opened from a specific page.
 *
 * It keeps the "Back to page" affordance and the `sourceRoute` provenance, and
 * — when the route has route-specific quick help — leads with a short panel
 * that answers the five questions someone actually has when they open help
 * while stuck: what this page is, what to do now, what happens if they do
 * nothing, what is reversible, and where recovery lives. The full doc body
 * follows underneath.
 */
export function ContextualQuickHelp({ sourceRoute }: Props) {
  if (!sourceRoute.startsWith("/")) return null;

  const help = resolveQuickHelp(sourceRoute);

  return (
    <section aria-label="Contextual help" className="mb-6">
      <ContextualSourceBanner sourceRoute={sourceRoute} />
      {help ? <QuickHelpPanel help={help} /> : null}
    </section>
  );
}

function ContextualSourceBanner({ sourceRoute }: { sourceRoute: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
          Contextual Docs
        </p>
        <p className="text-sm text-[var(--dpf-text)]">
          Opened from <span className="font-mono text-xs">{sourceRoute}</span>
        </p>
      </div>
      <a
        href={sourceRoute}
        className="inline-flex shrink-0 items-center rounded-full border border-[var(--dpf-border)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-muted)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)]"
      >
        Back to page
      </a>
    </div>
  );
}

const QUICK_HELP_ROWS: Array<{ key: keyof QuickHelp; label: string }> = [
  { key: "whatThisPageIs", label: "What this page is" },
  { key: "actionNow", label: "What to do now" },
  { key: "ifNothingDone", label: "If you do nothing" },
  { key: "reversible", label: "What's reversible" },
  { key: "recovery", label: "Where to get help" },
];

function QuickHelpPanel({ help }: { help: QuickHelp }) {
  return (
    <div className="mt-3 rounded-lg border border-[var(--dpf-accent)]/40 bg-[var(--dpf-surface-1)] p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--dpf-accent)]">
        Quick help
      </p>
      <dl className="space-y-3">
        {QUICK_HELP_ROWS.map((row) => (
          <div key={row.key}>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
              {row.label}
            </dt>
            <dd className="mt-0.5 text-sm text-[var(--dpf-text)]">{help[row.key]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
