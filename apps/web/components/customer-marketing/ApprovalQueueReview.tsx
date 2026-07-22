"use client";

import { useMemo, useState, useTransition } from "react";
import {
  approveOutboundDraftAction,
  requestChangesOnDraftAction,
  rejectOutboundDraftAction,
} from "@/app/(shell)/customer/marketing/actions";
import { assessArchetypeFit } from "@/lib/marketing/archetype-fit";
import { ArchetypeFitNotice } from "./ArchetypeFitNotice";

type Props = {
  draftId: string;
  initialBody: string;
  assetTaskTitle: string | null;
  channelId: string;
  assetType: string;
  category: string | null;
};

type FlashState = { kind: "ok" | "err"; message: string } | null;

export function ApprovalQueueReview({ draftId, initialBody, assetTaskTitle, channelId, assetType, category }: Props) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(initialBody);
  const [notes, setNotes] = useState("");
  const [flash, setFlash] = useState<FlashState>(null);
  const [pending, startTransition] = useTransition();

  // Live archetype-fit check on the body the operator is about to approve.
  // Recomputes as they edit, so removing a platform-leak term re-enables Approve.
  const fit = useMemo(
    () =>
      assessArchetypeFit({
        text: [assetTaskTitle, body].filter(Boolean).join("\n"),
        category,
      }),
    [assetTaskTitle, body, category],
  );

  function showError(err: string) {
    setFlash({ kind: "err", message: err });
  }

  function approve(withEdits: boolean) {
    if (fit.blocked) {
      showError(fit.summary);
      return;
    }
    startTransition(async () => {
      const editedBody = withEdits && body !== initialBody ? body : undefined;
      const result = await approveOutboundDraftAction(draftId, editedBody, notes || undefined);
      if (result.ok) {
        setFlash({ kind: "ok", message: withEdits ? "Approved with your edits" : "Approved" });
        setOpen(false);
      } else {
        showError(result.error);
      }
    });
  }

  function requestChanges() {
    if (!notes.trim()) {
      showError("Add a note explaining what to change.");
      return;
    }
    startTransition(async () => {
      const result = await requestChangesOnDraftAction(draftId, notes);
      if (result.ok) {
        setFlash({ kind: "ok", message: "Changes requested" });
        setOpen(false);
      } else {
        showError(result.error);
      }
    });
  }

  function reject() {
    startTransition(async () => {
      const result = await rejectOutboundDraftAction(draftId, notes || undefined);
      if (result.ok) {
        setFlash({ kind: "ok", message: "Rejected" });
        setOpen(false);
      } else {
        showError(result.error);
      }
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-sm text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
        >
          {open ? "Close" : "Review"}
        </button>
        {flash ? (
          <span
            data-testid="approval-flash"
            className={
              flash.kind === "ok"
                ? "text-sm text-[var(--dpf-accent)]"
                : "text-sm text-[var(--dpf-text)]"
            }
            role="status"
          >
            {flash.message}
          </span>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                Source
              </p>
              <p className="mt-1 text-sm text-[var(--dpf-text)]">
                {assetTaskTitle ?? "Manual draft"}
              </p>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                Channel
              </p>
              <p className="mt-1 text-sm text-[var(--dpf-text)]">
                {channelId} · {assetType}
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                Body (markdown)
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none"
              />

              <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                Notes (optional, required for "Request changes")
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="What should the drafter change?"
                className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none"
              />

              <ArchetypeFitNotice assessment={fit} className="mt-3" />

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending || fit.blocked}
                  onClick={() => approve(false)}
                  className="rounded-full bg-[var(--dpf-accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={pending || fit.blocked || body === initialBody}
                  onClick={() => approve(true)}
                  className="rounded-full border border-[var(--dpf-accent)] bg-[var(--dpf-surface-1)] px-4 py-1.5 text-sm font-medium text-[var(--dpf-accent)] disabled:opacity-50"
                >
                  Approve with edits
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={requestChanges}
                  className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-1.5 text-sm text-[var(--dpf-text)] disabled:opacity-50"
                >
                  Request changes
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={reject}
                  className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-1.5 text-sm text-[var(--dpf-text)] disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
