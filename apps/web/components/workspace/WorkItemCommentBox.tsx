"use client";

// BI-B416B12A: post a comment on a work item, with @mention support. Typing
// "@name" notifies that teammate or coworker (parsed + resolved server-side).

import { useState, useTransition } from "react";

import { submitWorkItemComment } from "@/lib/work-management/submit-work-item-comment";

export function WorkItemCommentBox({
  workItemId,
  workItemTitle,
}: {
  workItemId: string;
  workItemTitle: string;
}) {
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const text = body.trim();
    if (!text) return;
    startTransition(async () => {
      const result = await submitWorkItemComment({ workItemId, workItemTitle, body: text });
      if (result.ok) {
        setBody("");
        const notified = result.notifiedUserIds.length + result.mentionedAgentIds.length;
        setStatus(
          notified > 0
            ? `Posted — notified ${notified} ${notified === 1 ? "teammate" : "teammates"}.`
            : "Posted.",
        );
      } else {
        setStatus(result.error === "empty" ? "Write something first." : "Please sign in to comment.");
      }
    });
  }

  return (
    <section className="space-y-2">
      <label htmlFor="work-item-comment" className="block text-sm font-semibold text-[var(--dpf-text)]">
        Add a comment
      </label>
      <textarea
        id="work-item-comment"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        placeholder="Comment… use @name to notify a teammate or coworker"
        className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface)] p-2 text-sm text-[var(--dpf-text)]"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending || body.trim().length === 0}
          className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Posting…" : "Post"}
        </button>
        {status && <span className="text-xs text-[var(--dpf-muted)]">{status}</span>}
      </div>
    </section>
  );
}
