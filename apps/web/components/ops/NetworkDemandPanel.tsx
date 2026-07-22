"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  adoptFederatedDemandAction,
  forwardFederatedDemandAction,
  respondToFederatedDemandAction,
  shareLocalDemandWithLinkAction,
  setFederatedDemandFollowAction,
  stopSharingLocalDemandWithLinkAction,
} from "@/lib/actions/federated-demand";
import type { DemandShareContext, NetworkDemandView } from "@/lib/federation/demand-read-model";
import { InlineBusy } from "@/components/ui/InlineBusy";
import { LocalTime } from "@/components/ui/LocalTime";
import { CollapsibleList, EmptyState, StatusBadge } from "@/components/ui/report-kit";

const EMPTY_SHARE_CONTEXT: DemandShareContext = { targets: [], founderTargets: [], localItems: [], responses: [], dispositions: [] };

export function NetworkDemandPanel({
  items,
  shareContext = EMPTY_SHARE_CONTEXT,
}: {
  items: NetworkDemandView[];
  shareContext?: DemandShareContext;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeMirror, setActiveMirror] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState(shareContext.localItems[0]?.itemId ?? "");
  const [selectedLinkId, setSelectedLinkId] = useState(shareContext.targets[0]?.linkId ?? "");
  const [founderTargetId, setFounderTargetId] = useState(shareContext.founderTargets[0]?.linkId ?? "");
  const [allowFounderForwarding, setAllowFounderForwarding] = useState(false);
  const selectedTarget = shareContext.targets.find((target) => target.linkId === selectedLinkId);
  const founderTarget = shareContext.founderTargets.find((target) => target.linkId === founderTargetId);

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

  const shareLocal = () => {
    if (!selectedItemId || !selectedLinkId) return;
    setMessage(null);
    startTransition(async () => {
      const result = await shareLocalDemandWithLinkAction({
        itemId: selectedItemId,
        linkId: selectedLinkId,
        allowForwardToFounder: allowFounderForwarding,
      });
      setMessage(result.ok ? result.message : result.error);
      router.refresh();
    });
  };

  const stopSharing = (itemId: string, linkId: string) => {
    setMessage(null);
    startTransition(async () => {
      const result = await stopSharingLocalDemandWithLinkAction({ itemId, linkId });
      setMessage(result.ok ? result.message : result.error);
      router.refresh();
    });
  };

  const forwardToFounder = (mirrorId: string) => {
    if (!founderTargetId) return;
    setActiveMirror(mirrorId);
    setMessage(null);
    startTransition(async () => {
      const result = await forwardFederatedDemandAction({ mirrorId, targetLinkId: founderTargetId });
      setMessage(result.ok ? result.message : result.error);
      setActiveMirror(null);
      router.refresh();
    });
  };

  const respond = (mirrorId: string, kind: "interest" | "help-offer") => {
    setActiveMirror(mirrorId);
    setMessage(null);
    startTransition(async () => {
      const result = await respondToFederatedDemandAction({ mirrorId, kind });
      setMessage(result.ok ? result.message : result.error);
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
            Same-company connections keep share-safe platform demand visible in both directions after approval. Across companies, each item is deliberately shared. Follow it for updates, or adopt it when your organization wants to own local work. Your local backlog stays authoritative, and so does every source backlog.
          </p>
        </div>
        <Link href="/platform/federation-links" className="text-xs font-medium text-[var(--dpf-accent)] hover:underline">
          Manage connections
        </Link>
      </div>

      {message ? <p role="status" className="mb-3 text-xs text-[var(--dpf-muted)]">{message}</p> : null}

      {shareContext.responses.length > 0 ? (
        <div className="mb-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Collaboration responses</h3>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">Interest and help offers received for demand this installation shared.</p>
          <ul className="mt-2 space-y-2">
            {shareContext.responses.map((response) => (
              <li key={response.responseId} className="text-xs text-[var(--dpf-text)]">
                <span className="font-medium">{response.sourceName}</span>{" "}
                {response.responseKind === "help-offer" ? "offered help" : "recorded interest"}
                {response.message ? `: ${response.message}` : "."}{" "}
                <span className="text-[var(--dpf-muted)]"><LocalTime value={response.receivedAt} mode="datetime" /></span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {shareContext.dispositions.length > 0 ? (
        <div className="mb-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Founder decisions</h3>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">Disposition and release-applicability notices returned for demand this installation shared.</p>
          <ul className="mt-2 space-y-2">
            {shareContext.dispositions.map((notice) => (
              <li key={notice.noticeId} className="text-xs text-[var(--dpf-text)]">
                <span className="font-medium capitalize">{notice.decision}</span>
                {notice.message ? ` — ${notice.message}` : ""}
                {notice.releaseApplicability ? ` Release: ${notice.releaseApplicability.applicability}` : ""}{" "}
                <span className="text-[var(--dpf-muted)]"><LocalTime value={notice.receivedAt} mode="datetime" /></span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mb-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Share local demand</h3>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          Across companies: End company → distributor → Founder Hub. Choose what is shareable at each step; your local backlog remains private and authoritative. Only the minimized title, summary, applicability, signal count, and chosen attribution leave this installation.
        </p>
        {shareContext.targets.length === 0 ? (
          <p className="mt-3 text-xs text-[var(--dpf-muted)]">
            No eligible distributor or Founder Hub connection is ready. <Link href="/platform/federation-links" className="font-medium text-[var(--dpf-accent)] hover:underline">Review connections</Link>
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-xs text-[var(--dpf-muted)]">
              Local demand
              <select
                aria-label="Local demand"
                value={selectedItemId}
                onChange={(event) => setSelectedItemId(event.target.value)}
                className="mt-1 block max-w-72 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1.5 text-sm text-[var(--dpf-text)]"
              >
                {shareContext.localItems.map((item) => <option key={item.itemId} value={item.itemId}>{item.title}</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--dpf-muted)]">
              Share with
              <select
                aria-label="Share with"
                value={selectedLinkId}
                onChange={(event) => {
                  const nextLinkId = event.target.value;
                  setSelectedLinkId(nextLinkId);
                  if (shareContext.targets.find((target) => target.linkId === nextLinkId)?.destinationKind !== "distributor") {
                    setAllowFounderForwarding(false);
                  }
                }}
                className="mt-1 block rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1.5 text-sm text-[var(--dpf-text)]"
              >
                {shareContext.targets.map((target) => (
                  <option key={target.linkId} value={target.linkId}>
                    {target.displayName} — {target.destinationKind === "distributor" ? "Distributor" : "Founder Hub"}
                  </option>
                ))}
              </select>
            </label>
            {selectedTarget?.destinationKind === "distributor" ? (
              <label className="flex max-w-sm items-start gap-2 text-xs text-[var(--dpf-muted)]">
                <input
                  type="checkbox"
                  checked={allowFounderForwarding}
                  onChange={(event) => setAllowFounderForwarding(event.target.checked)}
                  className="mt-0.5"
                />
                Allow {selectedTarget.displayName} to forward the minimized demand to its Founder Hub for 90 days. Your identity remains pseudonymous.
              </label>
            ) : null}
            <button
              type="button"
              disabled={pending || !selectedItemId || !selectedLinkId}
              onClick={shareLocal}
              className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--dpf-bg)] disabled:opacity-50"
            >
              {pending ? <InlineBusy label="Queuing…" tone="current" /> : `Share with ${selectedTarget?.displayName ?? "selected connection"}`}
            </button>
          </div>
        )}
        {shareContext.targets.some((target) => target.sharedItemIds.length > 0) ? (
          <div className="mt-3 border-t border-[var(--dpf-border)] pt-3">
            <p className="text-xs font-medium text-[var(--dpf-text)]">Currently shared</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {shareContext.targets.flatMap((target) => target.sharedItemIds.map((itemId) => (
                <button
                  key={`${target.linkId}:${itemId}`}
                  type="button"
                  disabled={pending}
                  onClick={() => stopSharing(itemId, target.linkId)}
                  className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-text)] hover:border-[var(--dpf-error)] disabled:opacity-50"
                >
                  Stop {itemId} → {target.displayName}
                </button>
              )))}
            </div>
          </div>
        ) : null}
      </div>

      {shareContext.founderTargets.length > 1 ? (
        <label className="mb-3 block text-xs text-[var(--dpf-muted)]">
          Founder Hub destination
          <select
            aria-label="Founder Hub destination"
            value={founderTargetId}
            onChange={(event) => setFounderTargetId(event.target.value)}
            className="ml-2 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-[var(--dpf-text)]"
          >
            {shareContext.founderTargets.map((target) => <option key={target.linkId} value={target.linkId}>{target.displayName}</option>)}
          </select>
        </label>
      ) : null}

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
                        onClick={() => respond(item.mirrorId, "interest")}
                        className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
                      >
                        {isBusy ? <InlineBusy label="Queuing…" tone="current" /> : "I'm interested"}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        aria-busy={isBusy}
                        onClick={() => respond(item.mirrorId, "help-offer")}
                        className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
                      >
                        {isBusy ? <InlineBusy label="Queuing…" tone="current" /> : "Offer help"}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        aria-busy={isBusy}
                        onClick={() => run(item.mirrorId, item.disposition === "followed" ? "unfollow" : "follow")}
                        className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
                      >
                        {isBusy ? <InlineBusy label="Saving…" tone="current" /> : item.disposition === "followed" ? "Stop following" : "Follow"}
                      </button>
                      {item.forwardingToFounderPermitted && founderTargetId ? (
                        <button
                          type="button"
                          disabled={pending}
                          aria-busy={isBusy}
                          onClick={() => forwardToFounder(item.mirrorId)}
                          className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
                        >
                          {isBusy ? <InlineBusy label="Queuing…" tone="current" /> : `Forward to ${founderTarget?.displayName ?? "Founder Hub"}`}
                        </button>
                      ) : null}
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
