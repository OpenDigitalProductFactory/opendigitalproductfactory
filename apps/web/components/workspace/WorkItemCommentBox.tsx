"use client";

// BI-B416B12A: post a comment on a work item, with @mention support. Typing
// "@name" notifies that teammate or coworker (parsed + resolved server-side).

import { useState, useTransition } from "react";

import { submitWorkItemComment } from "@/lib/work-management/submit-work-item-comment";

export function WorkItemCommentBox({
  workItemId,
  workItemTitle,
  caseKey,
}: {
  workItemId: string;
  workItemTitle: string;
  caseKey: string;
}) {
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const text = body.trim();
    if (!text) return;
    startTransition(async () => {
      const result = await submitWorkItemComment({ workItemId, workItemTitle, caseKey, body: text });
      if (result.ok) {
        setBody("");
        const notified = result.notifiedUserIds.length + result.mentionedAgentIds.length;
        setStatus(
          notified > 0
            ? `Posted — notified ${notified} ${notified === 1 ? "teammate" : "teammates"}.`
            : "Posted.",
        );
      } else {
        setStatus(
          result.error === "empty"
            ? "Write something first."
            : result.error === "forbidden"
              ? "You do not have permission to update this room."
              : "Please sign in to comment.",
        );
      }
    });
  }

  return (
    <section className="space-y-2">
      <label htmlFor="work-item-comment" className="block text-sm font-semibold text-[var(--dpf-text)]">
        Share an update
      </label>
      <p id="work-item-comment-help" className="text-xs leading-5 text-[var(--dpf-muted)]">
        Add context or @mention a participant.
      </p>
      <textarea
        id="work-item-comment"
        aria-describedby="work-item-comment-help"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        placeholder="Write an update…"
        className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface)] p-3 text-sm text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending || body.trim().length === 0}
          className="min-h-11 rounded-md bg-[var(--dpf-accent)] px-4 text-sm font-semibold text-[var(--dpf-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)] disabled:opacity-50"
        >
          {pending ? "Posting…" : "Post"}
        </button>
        <span aria-live="polite" className="text-xs text-[var(--dpf-muted)]">{status}</span>
      </div>
    </section>
  );
}
