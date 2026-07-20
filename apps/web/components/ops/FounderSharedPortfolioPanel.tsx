"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  dispositionFounderDemandClusterAction,
  promoteFounderDemandOriginAction,
  proposeFounderDemandClusterAction,
} from "@/lib/actions/founder-portfolio";
import type {
  FounderPortfolioClusterView,
  FounderPortfolioInboxItem,
} from "@/lib/federation/founder-portfolio";
import { InlineBusy } from "@/components/ui/InlineBusy";
import { EmptyState, StatusBadge } from "@/components/ui/report-kit";

export function FounderSharedPortfolioPanel({
  inbox,
  clusters,
}: {
  inbox: FounderPortfolioInboxItem[];
  clusters: FounderPortfolioClusterView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const available = useMemo(() => inbox.filter((item) => !item.clusterId), [inbox]);

  const run = (operation: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    setMessage(null);
    startTransition(async () => {
      const result = await operation();
      setMessage(result.ok ? result.message ?? "Saved." : result.error ?? "Unable to save.");
      if (result.ok) router.refresh();
    });
  };

  return (
    <section aria-labelledby="founder-portfolio-heading" className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
      <div>
        <h2 id="founder-portfolio-heading" className="text-base font-semibold text-[var(--dpf-text)]">Founder shared portfolio</h2>
        <p className="mt-1 max-w-3xl text-xs text-[var(--dpf-muted)]">
          Curate minimized demand arriving through trusted reseller channels. Reach counts distinct originating installations, not reseller hops; accepted clusters become normal local backlog items.
        </p>
      </div>
      {message ? <p role="status" className="mt-3 text-xs text-[var(--dpf-muted)]">{message}</p> : null}

      <div className="mt-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Unclustered inbox</h3>
        {available.length === 0 ? (
          <EmptyState size="sm" title="No unclustered founder demand" description="New minimized demand appears here after a trusted upstream channel delivers it." />
        ) : (
          <>
            <ul className="mt-3 space-y-2">
              {available.map((item) => (
                <li key={item.mirrorId} className="rounded border border-[var(--dpf-border)] p-2">
                  <label className="flex items-start gap-2 text-sm text-[var(--dpf-text)]">
                    <input
                      type="checkbox"
                      checked={selected.includes(item.mirrorId)}
                      onChange={(event) => setSelected((current) => event.target.checked
                        ? [...current, item.mirrorId]
                        : current.filter((id) => id !== item.mirrorId))}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium">{item.title}</span>
                      <span className="mt-0.5 block text-xs text-[var(--dpf-muted)]">{item.summary}</span>
                      <span className="mt-1 block text-[11px] text-[var(--dpf-muted)]">{item.environmentClass} · {item.routeCount} observed route{item.routeCount === 1 ? "" : "s"}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-xs text-[var(--dpf-muted)]">
                Cluster title
                <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 block min-w-72 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1.5 text-sm text-[var(--dpf-text)]" />
              </label>
              <button
                type="button"
                disabled={pending || selected.length === 0 || !title.trim()}
                onClick={() => run(async () => {
                  const result = await proposeFounderDemandClusterAction({ title, mirrorIds: selected });
                  if (result.ok) { setSelected([]); setTitle(""); }
                  return result;
                })}
                className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--dpf-bg)] disabled:opacity-50"
              >
                {pending ? <InlineBusy label="Creating…" tone="current" /> : "Create review cluster"}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {clusters.map((cluster) => (
          <article key={cluster.clusterId} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{cluster.title}</h3>
                <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                  {cluster.distinctOriginReach} distinct origin{cluster.distinctOriginReach === 1 ? "" : "s"} · {cluster.routeCount} route{cluster.routeCount === 1 ? "" : "s"} · {cluster.productionEligibleOrigins} production eligible
                </p>
              </div>
              <StatusBadge label={cluster.status} intent={cluster.status === "accepted" ? "success" : cluster.status === "rejected" ? "danger" : "info"} variant="soft" />
            </div>
            <ul className="mt-3 space-y-1">
              {cluster.members.map((member) => (
                <li key={member.memberId} className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--dpf-muted)]">
                  <span>{member.environmentClass} origin · {member.mirrorRefs.length} route{member.mirrorRefs.length === 1 ? "" : "s"}</span>
                  {member.environmentClass !== "production" && !member.promotedAt ? (
                    <button type="button" disabled={pending} onClick={() => run(() => promoteFounderDemandOriginAction(member.memberId))} className="rounded border border-[var(--dpf-border)] px-2 py-1 text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50">
                      Promote to production portfolio
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {cluster.status === "proposed" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={pending} onClick={() => run(() => dispositionFounderDemandClusterAction({ clusterId: cluster.clusterId, disposition: "accepted" }))} className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--dpf-bg)] disabled:opacity-50">Accept into backlog</button>
                <button type="button" disabled={pending} onClick={() => run(() => dispositionFounderDemandClusterAction({ clusterId: cluster.clusterId, disposition: "rejected" }))} className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] disabled:opacity-50">Reject</button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
