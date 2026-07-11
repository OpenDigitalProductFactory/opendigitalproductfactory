// The operator cockpit — the ONE consolidated "what needs you now" surface on the
// workspace home (BI-8C3EB52C, BI-2651043B, BI-D35DE119).
//
// This folds the three previously-competing framings — the "Needs you" decision
// band, the command-center "Needs attention" strip, and the archetype category
// cards — into a single surface with ONE attention count and ONE ranking. The
// count is the length of the outside-in PRIMARY queue (buildOutsideInCockpit): when
// it is zero this surface says so plainly, so no other panel can contradict it
// (the F2 fix).
//
// It is organized OUTSIDE-IN (BI-8C3EB52C): the primary perspective is from the
// customer inward — Products & services, then Workforce, then the inner portfolios
// only when a blocker jumps the queue. The ranking key is customer-impact / depth,
// never recency or volume (the F7 fix). Ranking + grouping live in the pure,
// unit-tested lib/attention/outside-in.ts; this component only renders it.
//
// An async server component: read-only projection over the scattered queues.

import Link from "next/link";
import { prisma } from "@dpf/db";
import { loadAttentionItems, filterAttentionForAudience } from "@/lib/attention/aggregate";
import { attentionAgeLabel } from "@/lib/attention/triage";
import {
  buildOutsideInCockpit,
  blocksBusinessOutcome,
  outsideInReason,
  type OutsideInCockpit,
  type OutsideInGroup,
} from "@/lib/attention/outside-in";
import type { AttentionItem, AttentionSource } from "@/lib/attention/types";

const PREVIEW_PER_GROUP = 4;

function CockpitShell({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
      <div className="flex items-center gap-2 border-b border-[var(--dpf-border)] px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-[var(--dpf-text)]">
          What needs you now
        </h2>
        {count > 0 ? (
          <span className="rounded-full bg-[var(--dpf-accent)] px-2 py-0.5 text-[11px] font-bold text-[var(--dpf-on-accent,var(--dpf-surface-1))]">
            {count}
          </span>
        ) : null}
        <Link
          href="/workspace/inbox"
          className="ml-auto text-[11px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Open inbox →
        </Link>
      </div>
      {children}
    </section>
  );
}

function CockpitItemRow({ item, nowMs }: { item: AttentionItem; nowMs: number }) {
  const jumps = blocksBusinessOutcome(item);
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {jumps ? (
            <span className="rounded border border-[var(--dpf-accent)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--dpf-accent)]">
              Blocker
            </span>
          ) : null}
          <span className="text-[10px] text-[var(--dpf-muted)]">
            {attentionAgeLabel(item.createdAtIso, nowMs)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs font-medium text-[var(--dpf-text)]">{item.title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-[var(--dpf-muted)]">
          {outsideInReason(item)}
        </p>
      </div>
      <Link
        href={item.deepLink}
        className="shrink-0 self-center text-[10px] font-semibold text-[var(--dpf-accent)] hover:opacity-80"
      >
        Open →
      </Link>
    </li>
  );
}

function CockpitGroup({ group, nowMs }: { group: OutsideInGroup; nowMs: number }) {
  const shown = group.items.slice(0, PREVIEW_PER_GROUP);
  const overflow = group.items.length - shown.length;
  return (
    <div>
      <div className="flex items-center gap-2 bg-[var(--dpf-surface-1)] px-4 py-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
          {group.label}
        </p>
        <span className="text-[10px] text-[var(--dpf-muted)]">{group.items.length}</span>
      </div>
      <ul className="divide-y divide-[var(--dpf-border)]">
        {shown.map((item) => (
          <CockpitItemRow key={item.id} item={item} nowMs={nowMs} />
        ))}
      </ul>
      {overflow > 0 ? (
        <Link
          href="/workspace/inbox"
          className="block px-4 py-1.5 text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          +{overflow} more in {group.label.toLowerCase()} →
        </Link>
      ) : null}
    </div>
  );
}

/** The pure presentational cockpit — deps-injected so the single-source-of-truth
 *  behavior (empty → says nothing needs you; non-empty → shows the count) is unit-
 *  testable without a live database. */
export function OperatorCockpitView({
  cockpit,
  failedSources,
  nowMs,
}: {
  cockpit: OutsideInCockpit;
  failedSources: AttentionSource[];
  nowMs: number;
}) {
  const failedNote =
    failedSources.length > 0 ? (
      <p className="border-t border-[var(--dpf-border)] px-4 py-2 text-[10px] text-[var(--dpf-warning)]">
        Couldn&apos;t load {failedSources.length} source
        {failedSources.length === 1 ? "" : "s"} — some items may be missing.
      </p>
    ) : null;

  // Empty PRIMARY queue: this surface is the single source of truth, so it states
  // the calm plainly — nothing elsewhere may claim otherwise (the F2 fix).
  if (cockpit.count === 0) {
    return (
      <CockpitShell count={0}>
        <div className="px-4 py-5">
          <p className="text-xs text-[var(--dpf-text)]">
            {cockpit.secondary.length > 0
              ? "Nothing is blocking a customer or business outcome right now."
              : "Nothing needs you right now."}
          </p>
          <p className="mt-1 text-[11px] text-[var(--dpf-muted)]">
            Decisions the AI couldn&apos;t make on its own surface here, ordered from the
            customer inward.
            {cockpit.secondary.length > 0 ? (
              <>
                {" "}
                <Link href="/workspace/inbox" className="text-[var(--dpf-accent)] hover:opacity-80">
                  {cockpit.secondary.length} inner item
                  {cockpit.secondary.length === 1 ? " is" : "s are"} in hand →
                </Link>
              </>
            ) : null}
          </p>
        </div>
        {failedNote}
      </CockpitShell>
    );
  }

  return (
    <CockpitShell count={cockpit.count}>
      <p className="px-4 pt-2 text-[11px] text-[var(--dpf-muted)]">
        Decisions the AI couldn&apos;t make on its own — organized from the customer inward
        (products &amp; services, then workforce), with any inner blocker pulled to the top.
        The work backlog lives in Operations; this is only what needs a decision now.
      </p>

      <div className="mt-1 divide-y divide-[var(--dpf-border)]">
        {cockpit.primaryGroups.map((group) => (
          <CockpitGroup key={group.portfolio} group={group} nowMs={nowMs} />
        ))}
      </div>

      {cockpit.secondary.length > 0 ? (
        <Link
          href="/workspace/inbox"
          className="block border-t border-[var(--dpf-border)] px-4 py-2 text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          {cockpit.secondary.length} inner item{cockpit.secondary.length === 1 ? "" : "s"} in hand —
          none blocking a customer outcome →
        </Link>
      ) : null}

      {failedNote}
    </CockpitShell>
  );
}

/** The async server component: read-only projection over the scattered queues,
 *  partitioned + ranked OUTSIDE-IN, rendered through the pure view above. */
export async function OperatorCockpit({ userId }: { userId?: string }) {
  const { items, failedSources } = await loadAttentionItems(prisma, {
    aiReadinessUserId: userId,
  });
  const visible = filterAttentionForAudience(items, { operator: true });
  const cockpit = buildOutsideInCockpit(visible);
  return <OperatorCockpitView cockpit={cockpit} failedSources={failedSources} nowMs={Date.now()} />;
}
