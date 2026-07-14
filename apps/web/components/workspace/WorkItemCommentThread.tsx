"use client";

// BI-B416B12A (EP-WORK-CONVERGENCE): the work-item comment thread + compose box.
// Renders the projected thread (WorkCaseCommentThread) and posts new comments via
// the postWorkItemComment server action, which fans out @mention notifications.

import { MessageSquare, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { LocalTime } from "@/components/ui/LocalTime";
import { postWorkItemComment } from "@/lib/actions/work-item-comments";
import type { WorkCaseCommentThread } from "@/lib/work-management/case-types";

type Props = {
  thread: WorkCaseCommentThread;
};

export function WorkItemCommentThread({ thread }: Props) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = body.trim();
  const disabled = isPending || !trimmed || !thread.canComment || !thread.workItemId;

  async function handlePost() {
    if (!thread.workItemId || !trimmed) return;
    setIsPending(true);
    setError(null);
    try {
      const result = await postWorkItemComment({ workItemId: thread.workItemId, body: trimmed });
      if (result.ok) {
        setBody("");
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch {
      setError("failed");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <section
      aria-labelledby="work-case-discussion-title"
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
    >
      <div className="flex items-center gap-2 border-b border-[var(--dpf-border)] px-4 py-3">
        <MessageSquare className="size-4 text-[var(--dpf-accent)]" aria-hidden="true" />
        <h2 id="work-case-discussion-title" className="text-sm font-semibold text-[var(--dpf-text)]">
          Discussion
        </h2>
      </div>

      {thread.participants.length > 0 ? (
        <div className="flex items-center gap-2 border-b border-[var(--dpf-border)] px-4 py-2 text-xs text-[var(--dpf-muted)]">
          <Users className="size-3.5" aria-hidden="true" />
          <span>In this thread:</span>
          <span className="flex flex-wrap gap-1.5">
            {thread.participants.map((participant) => (
              <span
                key={participant}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 font-medium text-[var(--dpf-text)]"
              >
                <span className="size-1.5 rounded-full bg-[var(--dpf-success)]" aria-hidden="true" />
                {participant}
              </span>
            ))}
          </span>
        </div>
      ) : null}

      {thread.messages.length > 0 ? (
        <ol className="divide-y divide-[var(--dpf-border)]">
          {thread.messages.map((message) => (
            <li key={message.messageId} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--dpf-text)]">{message.senderLabel}</span>
                <span className="text-xs text-[var(--dpf-muted)]">
                  <LocalTime value={message.createdAt} mode="datetime" />
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--dpf-text)]">{message.body}</p>
            </li>
          ))}
        </ol>
      ) : (
        <div className="px-4 py-6 text-sm text-[var(--dpf-muted)]">
          No comments yet. Start the discussion below.
        </div>
      )}

      <div className="border-t border-[var(--dpf-border)] p-4">
        <label htmlFor="work-case-comment-body" className="sr-only">
          Add a comment
        </label>
        <textarea
          id="work-case-comment-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          disabled={isPending || !thread.canComment || !thread.workItemId}
          placeholder="Add a comment…"
          className="w-full resize-y rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[var(--dpf-muted)]">Use @name to notify a teammate.</p>
          <div className="flex items-center gap-3">
            {error ? (
              <span role="alert" className="text-xs font-medium text-[var(--dpf-danger)]">
                {error}
              </span>
            ) : null}
            <button
              type="button"
              onClick={handlePost}
              disabled={disabled}
              className="inline-flex items-center rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-semibold text-[var(--dpf-on-accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Posting…" : "Post comment"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
