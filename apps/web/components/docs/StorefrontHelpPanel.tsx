import type { StorefrontHelpPanel as HelpPanelData } from "@/lib/docs/storefront-help-panel";

type Props = {
  panel: HelpPanelData;
  sourceRoute: string;
};

// A task-focused help panel that leads the docs page when an owner opens the
// contextual "Docs" link from a storefront admin route (BI-2DD18122). It answers
// the four questions a non-technical owner has BEFORE the full docs catalog:
// what is this, what to do next, what changes if I save, how do I recover.
export function StorefrontHelpPanel({ panel, sourceRoute }: Props) {
  return (
    <section
      aria-label="Contextual help for this page"
      className="mb-6 rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--dpf-accent)]">
            Help for this page
          </p>
          <h2 className="mt-1 text-lg font-bold text-[var(--dpf-text)]">{panel.title}</h2>
          <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">
            Opened from <span className="font-mono">{sourceRoute}</span>
          </p>
        </div>
        <a
          href={sourceRoute}
          className="shrink-0 inline-flex items-center rounded-full border border-[var(--dpf-border)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-muted)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)]"
        >
          Back to page
        </a>
      </div>

      <HelpBlock label="What is this?">
        <p className="text-sm leading-relaxed text-[var(--dpf-text)]">{panel.whatIsThis}</p>
      </HelpBlock>

      <HelpBlock label="What should I do next?">
        <HelpList items={panel.whatToDoNext} ordered />
      </HelpBlock>

      <HelpBlock label="What changes if I save or confirm?">
        <HelpList items={panel.whatChangesIfYouSave} />
      </HelpBlock>

      <HelpBlock label="How do I recover or undo?">
        <HelpList items={panel.howToRecover} />
      </HelpBlock>
    </section>
  );
}

function HelpBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--dpf-muted)]">
        {label}
      </p>
      {children}
    </div>
  );
}

function HelpList({ items, ordered = false }: { items: string[]; ordered?: boolean }) {
  const ListTag = ordered ? "ol" : "ul";
  return (
    <ListTag
      className={[
        "space-y-1.5 text-sm leading-relaxed text-[var(--dpf-text)]",
        ordered ? "list-decimal" : "list-disc",
        "pl-5",
      ].join(" ")}
    >
      {items.map((item, i) => (
        <li key={i} className="marker:text-[var(--dpf-muted)]">
          {item}
        </li>
      ))}
    </ListTag>
  );
}
