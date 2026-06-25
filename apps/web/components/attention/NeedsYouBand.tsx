// "Needs you" — the first-viewport attention band on /workspace.
// An async server component: it projects the residue across the scattered queues
// (read-only) and shows the top few, tiered, with a one-line "why now" each, then
// links to the full /workspace/inbox. Renders NOTHING when the queue is empty so a
// clear workspace stays clear (mirrors EscalationsAttention). Spec §6.1.
//
// V1 is operator-view — consistent with the command-center already on this page;
// worker scoping (own approvals only) is the BI-AS-4 fast-follow.

import Link from "next/link";
import { prisma } from "@dpf/db";
import { loadAttentionItems, filterAttentionForAudience } from "@/lib/attention/aggregate";
import { orderReason, attentionAgeLabel, isOverrideTier, overrideReason } from "@/lib/attention/triage";

const PREVIEW_COUNT = 5;

export async function NeedsYouBand() {
  const { items, failedSources } = await loadAttentionItems(prisma);
  const visible = filterAttentionForAudience(items, { operator: true });
  if (visible.length === 0 && failedSources.length === 0) return null;

  const nowMs = Date.now();
  const top = visible.slice(0, PREVIEW_COUNT);

  return (
    <section className="mb-6 overflow-hidden rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
      <div className="flex items-center gap-2 border-b border-[var(--dpf-border)] px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-text)]">
          Needs you
        </h2>
        <span className="text-[10px] font-semibold text-[var(--dpf-accent)]">{visible.length}</span>
        <Link
          href="/workspace/inbox"
          className="ml-auto text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          {visible.length > top.length ? `View all ${visible.length}` : "Open inbox"} →
        </Link>
      </div>

      <p className="px-3 pt-2 text-[11px] text-[var(--dpf-muted)]">
        Decisions the AI couldn&apos;t make on its own — ordered by what&apos;s most pressing, each with
        why it needs you. The work backlog lives in Operations; this is only what needs a decision now.
      </p>

      <ul className="mt-1 divide-y divide-[var(--dpf-border)]">
        {top.map((item) => {
          const pin = isOverrideTier(item) ? overrideReason(item) : null;
          return (
            <li key={item.id} className="flex items-start gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {pin ? (
                    <span className="rounded border border-[var(--dpf-accent)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--dpf-accent)]">
                      Pinned · {pin}
                    </span>
                  ) : null}
                  <span className="text-[10px] text-[var(--dpf-muted)]">
                    {attentionAgeLabel(item.createdAtIso, nowMs)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs font-medium text-[var(--dpf-text)]">{item.title}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--dpf-muted)]">{orderReason(item)}</p>
              </div>
              <Link
                href={item.deepLink}
                className="shrink-0 self-center text-[10px] font-semibold text-[var(--dpf-accent)] hover:opacity-80"
              >
                Open →
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
