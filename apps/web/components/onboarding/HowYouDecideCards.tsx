"use client";
// "How you decide" — the company-stance confirmation cards (BI-D6DC2432).
//
// Cognitive-load contract (AGENTS.md §12, UX-fit ledger on the PR): five
// scenario cards, every one pre-answered from the archetype, one-click
// "Confirm all" fast path (<60s), per-card inline adjust as the only second
// level. No platform vocabulary — no classes, weights, or grades. Mounted in
// two places: the "how-you-decide" setup step routes to
// /coworker-decisions/stance, and the same cards stay there afterwards for
// later adjustment.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { confirmStanceVectors } from "@/lib/actions/stance-confirm";

export type StanceCard = {
  key: string;
  title: string;
  stance: string;
  ceilingUsd: number | null;
  /** True when this vector's material already sits at confirmed/ruled tier. */
  confirmed: boolean;
};

/** Curated ceiling choices (DoA-style levels, never a raw numeric input). */
const CEILING_CHOICES = [25, 50, 75, 100, 150, 200, 250, 300, 500, 1000];

function ceilingOptions(current: number | null): number[] {
  if (current == null) return CEILING_CHOICES;
  return CEILING_CHOICES.includes(current)
    ? CEILING_CHOICES
    : [...CEILING_CHOICES, current].sort((a, b) => a - b);
}

export function HowYouDecideCards({ cards }: { cards: StanceCard[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState(() =>
    cards.map((c) => ({ ...c, adjusting: false })),
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmedNow, setConfirmedNow] = useState(false);
  const [pending, startTransition] = useTransition();

  const unconfirmed = drafts.filter((d) => !d.confirmed);
  if (cards.length === 0 || (unconfirmed.length === 0 && !confirmedNow)) {
    return null;
  }

  function update(key: string, patch: Partial<StanceCard> & { adjusting?: boolean }) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function confirmAll() {
    setError(null);
    startTransition(async () => {
      const result = await confirmStanceVectors({
        vectors: unconfirmed.map((d) => ({
          key: d.key as never,
          stance: d.stance,
          ceilingUsd: d.ceilingUsd,
        })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirmedNow(true);
      router.refresh();
    });
  }

  if (confirmedNow) {
    return (
      <section className="mb-8 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <p className="text-sm text-[var(--dpf-success)]">
          Done — your AI now handles everyday calls like these on its own and
          still checks with you on anything big or unusual.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-[var(--dpf-text)] mb-1">How you decide</h2>
      <p className="text-xs text-[var(--dpf-muted)] mb-3">
        Your AI checks these answers before acting on business calls. We&rsquo;ve
        pre-filled them for a business like yours — confirm them, or adjust any
        card first. Big or unusual decisions always come to you regardless.
      </p>

      <ul className="flex flex-col gap-2 mb-4">
        {unconfirmed.map((card) => (
          <li
            key={card.key}
            className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-[var(--dpf-text)] min-w-0 flex-1">
                {card.title}
              </span>
              {!card.adjusting && (
                <button
                  type="button"
                  onClick={() => update(card.key, { adjusting: true })}
                  className="text-xs text-[var(--dpf-accent)] hover:underline shrink-0"
                >
                  Adjust
                </button>
              )}
            </div>

            {card.adjusting ? (
              <div className="mt-2">
                <textarea
                  value={card.stance}
                  onChange={(e) => update(card.key, { stance: e.target.value })}
                  rows={3}
                  aria-label={`Your stance: ${card.title}`}
                  className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] mb-2"
                />
                {card.ceilingUsd != null && (
                  <label className="flex items-center gap-2 text-xs text-[var(--dpf-text)]">
                    Without asking, up to
                    <select
                      value={card.ceilingUsd}
                      onChange={(e) => update(card.key, { ceilingUsd: Number(e.target.value) })}
                      className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-text)]"
                    >
                      {ceilingOptions(card.ceilingUsd).map((amount) => (
                        <option key={amount} value={amount}>
                          ${amount}
                        </option>
                      ))}
                    </select>
                    per case
                  </label>
                )}
              </div>
            ) : (
              <p className="text-xs text-[var(--dpf-muted)] mt-1.5">
                {card.stance}
                {card.ceilingUsd != null && (
                  <span> Up to ${card.ceilingUsd} per case without asking.</span>
                )}
              </p>
            )}
          </li>
        ))}
      </ul>

      {error && (
        <p className="text-xs text-[var(--dpf-error)] mb-3" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={confirmAll}
          disabled={pending}
          className="rounded-md border border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-accent)] hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Confirming…" : unconfirmed.length === drafts.length ? "These look right — confirm all" : "Confirm remaining"}
        </button>
        <span className="text-xs text-[var(--dpf-muted)]">
          Based on your mission and who you serve. You can fine-tune any stance
          here later.
        </span>
      </div>
    </section>
  );
}
