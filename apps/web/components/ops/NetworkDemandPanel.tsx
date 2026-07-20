"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  adoptFederatedDemandAction,
  setFederatedDemandFollowAction,
} from "@/lib/actions/federated-demand";
import type { NetworkDemandView } from "@/lib/federation/demand-read-model";
import { InlineBusy } from "@/components/ui/InlineBusy";
import { LocalTime } from "@/components/ui/LocalTime";
import { CollapsibleList, EmptyState, StatusBadge } from "@/components/ui/report-kit";

export function NetworkDemandPanel({ items }: { items: NetworkDemandView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeMirror, setActiveMirror] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = (mirrorId: string, action: "follow" | "unfollow" | "adopt") => {
    setActiveMirror(mirrorId);
    setMessage(null);
    startTransition(async () => {
      const result = action === "adopt"
        ? await adoptFederatedDemandAction(mirrorId)
        : await setFederatedDemandFollowAction(mirrorId, action === "follow");
      if (!result.ok) setMessage(result.error);
      else if (result.disposition === "adopted") {
        setMessage(`Added ${result.itemId ?? "the item"} to your local backlog.`);
      }
      setActiveMirror(null);
      router.refresh();
    });
  };

  return (
    <section aria-labelledby="network-demand-heading" className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="network-demand-heading" className="text-base font-semibold text-[var(--dpf-text)]">
            Shared by connected installations
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-[var(--dpf-muted)]">
            Review demand that another installation chose to share. Follow it for updates, or adopt it when your organization wants to own local work. Your local backlog stays authoritative.
          </p>
        </div>
        <Link href="/platform/federation-links" className="text-xs font-medium text-[var(--dpf-accent)] hover:underline">
          Manage connections
        </Link>
      </div>

      {message ? <p role="status" className="mb-3 text-xs text-[var(--dpf-muted)]">{message}</p> : null}

      {items.length === 0 ? (
        <EmptyState
          size="sm"
          title="No shared demand yet"
          description="Connect another DPF installation and approve a demand-sharing policy. Local work continues normally while no peers are connected."
          action={<Link href="/platform/federation-links" className="text-xs font-medium text-[var(--dpf-accent)] hover:underline">Review connections</Link>}
        />
      ) : (
        <CollapsibleList previewCount={5} as="div" listClassName="space-y-2">
          {items.map((item) => {
            const isBusy = pending && activeMirror === item.mirrorId;
            const withdrawn = item.disposition === "withdrawn" || item.syncStatus === "withdrawn";
            return (
              <article key={item.mirrorId} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{item.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--dpf-muted)]">{item.summary}</p>
                  </div>
                  <StatusBadge
                    intent={withdrawn ? "neutral" : item.disposition === "adopted" ? "success" : item.disposition === "followed" ? "accent" : "info"}
                    label={withdrawn ? "Withdrawn" : item.disposition}
                    variant="soft"
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--dpf-muted)]">
                  {item.workType ? <span>{item.workType}</span> : null}
                  <span>{item.occurrenceCount} signal{item.occurrenceCount === 1 ? "" : "s"}</span>
                  {item.affectedOrganizations !== null ? <span>{item.affectedOrganizations} organization{item.affectedOrganizations === 1 ? "" : "s"}</span> : null}
                  <span>{item.attribution} attribution</span>
                  <span>Updated <LocalTime value={item.updatedAt} mode="datetime" /></span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {item.localItemId ? (
                    <Link href={`/ops?itemId=${encodeURIComponent(item.localItemId)}`} className="text-xs font-medium text-[var(--dpf-accent)] hover:underline">
                      Open {item.localItemId}
                    </Link>
                  ) : withdrawn ? (
                    <span className="text-xs text-[var(--dpf-muted)]">No new local work can be created from this withdrawn demand.</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={pending}
                        aria-busy={isBusy}
                        onClick={() => run(item.mirrorId, item.disposition === "followed" ? "unfollow" : "follow")}
                        className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
                      >
                        {isBusy ? <InlineBusy label="Saving…" tone="current" /> : item.disposition === "followed" ? "Stop following" : "Follow"}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        aria-busy={isBusy}
                        onClick={() => run(item.mirrorId, "adopt")}
                        className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--dpf-bg)] disabled:opacity-50"
                      >
                        {isBusy ? <InlineBusy label="Adding…" tone="current" /> : "Adopt into our backlog"}
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </CollapsibleList>
      )}
    </section>
  );
}
