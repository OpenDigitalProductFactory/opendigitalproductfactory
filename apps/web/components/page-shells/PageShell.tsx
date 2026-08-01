// apps/web/components/page-shells/PageShell.tsx
//
// L1 page shells (EP-UX-SYSTEM spec §6 L1, BI-36CE8BAB).
//
// WHY THIS EXISTS. The platform could already MEASURE that its surfaces were
// walls of text — the route sweep baselined 201 routes and found a median of
// 192 default-visible words against outliers of 5,349 and 15,517 — but nothing
// made the good structure the path of least resistance, so every new surface
// regressed to the model's house style by default (spec RC6). Budgets without
// primitives just tell you afterwards that you did it wrong again.
//
// A shell is not a layout wrapper. It is a CONTRACT about what a reader meets
// on arrival:
//
//   1. a lead band — the short answer to "what is this and what needs me",
//      stamped `data-dpf-lead` so the sweep can measure it;
//   2. at most a couple of primary actions, stamped `data-dpf-primary-action`
//      so "the verb is buried" is a finding rather than a matter of opinion;
//   3. the default-visible body, which is what the reader came for;
//   4. everything else — inventories, diagnostics, history, raw identifiers —
//      behind ONE disclosure, closed by default.
//
// The measurement-scope rule makes that fourth slot pay: the sweep excises
// closed `<details>` and `data-dpf-disclosure` subtrees before counting, so
// deferring detail IMPROVES a route's score instead of being taxed by it.
// Progressive disclosure is the budget's grain, not its victim.
//
// Deliberately "shell", never "archetype" — archetype already means the
// industry vertical on this platform, and the two must not collide.

import type { ReactNode } from "react";
import Link from "next/link";

/** Which reading contract this surface is honouring. Mirrors UX_SHELLS. */
export type PageShellKind = "cockpit" | "list" | "detail" | "settings";

export type PageShellAction = {
  label: string;
  href: string;
  /** Marks the one action the reader most likely came to take. */
  primary?: boolean;
};

export type PageShellProps = {
  kind: PageShellKind;
  /** The page's own name. Rendered as the single h1. */
  title: string;
  /**
   * The lead band: one or two plain sentences answering "what is this, and is
   * anything waiting on me". Keep it short — the budget for this band is tens
   * of words, not hundreds, because it is the part everyone actually reads.
   */
  lead: ReactNode;
  /**
   * Optional attention line. Render ONLY when something genuinely needs the
   * reader; a permanent "all clear" banner is noise that trains people to skip
   * the whole band.
   */
  attention?: ReactNode;
  /**
   * The one thing the reader most likely came to DO. Rendered in the lead band
   * and stamped `data-owner-first-next-action`, which is what makes "this screen
   * tells you what to do next" a measurable property rather than a claim.
   *
   * Omit it when the surface genuinely has no single next move — a marked
   * next action that is not really the next action is worse than none, because
   * it teaches readers the marker means nothing.
   */
  nextAction?: { label: string; href: string; hint?: string };
  actions?: PageShellAction[];
  /** What the reader came for. Stays default-visible. */
  children: ReactNode;
  /**
   * Technical inventories, diagnostics, raw identifiers, history. Rendered
   * inside one closed disclosure. Nothing is removed from the page — it stops
   * competing with the reason the reader is here.
   */
  technicalDetails?: ReactNode;
  /** Label for the disclosure. Defaults to the conventional wording. */
  technicalDetailsLabel?: string;
};

/**
 * The shared frame every concrete shell composes. Exported for surfaces that
 * genuinely need to name their own `kind`; prefer the named shells below so the
 * intent is legible at the call site.
 */
export function PageShell({
  kind,
  title,
  lead,
  attention,
  nextAction,
  actions = [],
  children,
  technicalDetails,
  technicalDetailsLabel = "Technical details",
}: PageShellProps) {
  const primary = actions.filter((a) => a.primary);
  const secondary = actions.filter((a) => !a.primary);

  return (
    <div data-dpf-shell={kind}>
      <header data-dpf-lead="" className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{title}</h1>
        <div className="mt-1 text-sm text-[var(--dpf-muted)]">{lead}</div>

        {attention ? (
          <div
            className="mt-3 rounded border px-3 py-2 text-sm"
            style={{
              borderColor: "color-mix(in srgb, var(--dpf-warning) 40%, var(--dpf-border))",
              background: "color-mix(in srgb, var(--dpf-warning) 8%, var(--dpf-surface-1))",
              color: "var(--dpf-text)",
            }}
          >
            {attention}
          </div>
        ) : null}

        {nextAction ? (
          <div className="mt-3 flex flex-wrap items-baseline gap-2">
            <Link
              href={nextAction.href}
              data-owner-first-next-action=""
              data-dpf-primary-action=""
              className="dpf-tap-target inline-flex items-center rounded border border-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-accent)] hover:bg-[color-mix(in_srgb,var(--dpf-accent)_10%,transparent)]"
            >
              {nextAction.label}
            </Link>
            {nextAction.hint ? (
              <span className="text-xs text-[var(--dpf-muted)]">{nextAction.hint}</span>
            ) : null}
          </div>
        ) : null}

        {actions.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {primary.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                data-dpf-primary-action=""
                className="dpf-tap-target inline-flex items-center rounded border border-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-accent)] hover:bg-[color-mix(in_srgb,var(--dpf-accent)_10%,transparent)]"
              >
                {a.label}
              </Link>
            ))}
            {secondary.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="dpf-tap-target inline-flex items-center rounded border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              >
                {a.label}
              </Link>
            ))}
          </div>
        ) : null}
      </header>

      <main>{children}</main>

      {technicalDetails ? (
        // Closed by default, and marked twice on purpose: the sweep excises a
        // closed <details> anyway, but the explicit attribute keeps the intent
        // readable to a human diffing the markup.
        <details
          data-dpf-disclosure=""
          className="group mt-8 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
        >
          <summary className="dpf-tap-target flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-[var(--dpf-text)] marker:hidden [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="text-[var(--dpf-muted)] transition-transform group-open:rotate-90">
              ▸
            </span>
            <span>{technicalDetailsLabel}</span>
          </summary>
          <div className="border-t border-[var(--dpf-border)] p-4">{technicalDetails}</div>
        </details>
      ) : null}
    </div>
  );
}

/** The owner's home base: status at a glance, one obvious next move. */
export function CockpitShell(props: Omit<PageShellProps, "kind">) {
  return <PageShell kind="cockpit" {...props} />;
}

/** Scanning many rows: the rows carry the words, so the chrome stays thin. */
export function ListShell(props: Omit<PageShellProps, "kind">) {
  return <PageShell kind="list" {...props} />;
}

/** One thing in depth — the shell where disclosure earns its keep. */
export function DetailShell(props: Omit<PageShellProps, "kind">) {
  return <PageShell kind="detail" {...props} />;
}

/** Config surfaces: a few essentials, the rest deferred. */
export function SettingsShell(props: Omit<PageShellProps, "kind">) {
  return <PageShell kind="settings" {...props} />;
}
