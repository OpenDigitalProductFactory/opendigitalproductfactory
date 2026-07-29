// BI-404E9BEA — the "what do I do about this?" header for the Decision log.
// Server-rendered; the disclosure is a native <details> so the explainer costs
// no client JS and no inference (deterministic copy from decision-help.ts).

import Link from "next/link";

import { buildAwaitingDigest } from "@/lib/wiki/decision-help";
import type { DecisionTierStats } from "@/lib/wiki/decision-audit";

export function DecisionAwaitingHelp({ stats }: { stats: DecisionTierStats[] }) {
  const digest = buildAwaitingDigest(stats);
  if (!digest) return null;

  return (
    <div className="mb-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm font-medium text-[var(--dpf-text)]">
          {digest.headline}
          <span className="text-[var(--dpf-muted)]"> — {digest.fragments.join(", ")}</span>
        </p>
        <Link
          href="/coworker-decisions/review"
          data-owner-first-next-action
          className="rounded-md border border-[var(--dpf-accent)] px-2.5 py-1 text-xs font-medium text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)] shrink-0"
        >
          Work through them on Review &amp; adjust →
        </Link>
      </div>
      <details data-dpf-disclosure className="mt-2 group">
        <summary className="cursor-pointer text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] list-none [&::-webkit-details-marker]:hidden">
          <span className="underline decoration-dotted underline-offset-2">
            What does &ldquo;awaiting review&rdquo; mean — do I have to act?
          </span>
        </summary>
        <div className="mt-2 space-y-2 text-xs text-[var(--dpf-muted)] max-w-2xl">
          <p>
            <span className="font-medium text-[var(--dpf-text)]">Escalated</span> means your AI
            stopped short of making a call alone — the decision was risky, its confidence was low,
            or two of your principles disagreed.{" "}
            <span className="font-medium text-[var(--dpf-text)]">Deferred</span> means it found
            nothing recorded that answers the question, so it declined to guess.
          </p>
          <p>
            Nothing on this page is silently stuck: the coworker that asked handled its moment
            (usually by taking the safest option or asking in its own session) and moved on. The
            one exception is a Build Studio build waiting at a decision gate — its own record says
            so.
          </p>
          <p>
            You do not work this log line by line. Review &amp; adjust rolls these rows into a
            short list of themes — answer a theme once, or add a stance that covers it, and your AI
            stops needing to ask.
          </p>
        </div>
      </details>
    </div>
  );
}
