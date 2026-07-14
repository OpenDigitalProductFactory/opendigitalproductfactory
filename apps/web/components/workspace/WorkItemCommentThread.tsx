"use client";

// BI-B416B12A (EP-WORK-CONVERGENCE): the Discussion surface for a Work Case.
// Reads the projected commentThread view model and posts new comments through
// the postWorkItemCommentAction "use server" wrapper (which returns domain
// failures as values — we render its error text rather than throwing).

import { MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { LocalTime } from "@/components/ui/LocalTime";
import { postWorkItemCommentAction } from "@/lib/actions/work-item-comments";
import type { WorkItemCommentThread } from "@/lib/work-management/workspace-case-loader";

type Props = {
  thread: WorkItemCommentThread;
};

const ERROR_COPY: Record<string, string> = {
  unauthorized: "Sign in to post a comment.",
  empty: "Write a comment before posting.",
  not_found: "This work item is no longer available.",
  failed: "Could not post your comment. Try again.",
};

function errorCopy(error: string): string {
  return ERROR_COPY[error] ?? "Could not post your comment. Try again.";
}

export function WorkItemCommentThread({ thread }: Props) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = body.trim();
  const disabled = !thread.canComment || !thread.workItemId || trimmed.length === 0 || pending;

  async function handlePost() {
    if (!thread.workItemId || trimmed.length === 0) return;
    setPending(true);
    setError(null);
    try {
      const result = await postWorkItemCommentAction({ workItemId: thread.workItemId, body: trimmed });
      if (result.ok) {
        setBody("");
        router.refresh();
      } else {
        setError(errorCopy(result.error));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="work-case-discussion-title"
      className="overflow-hidden rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
    >
      <div className="flex items-center gap-2 border-b border-[var(--dpf-border)] px-4 py-3">
        <MessageSquare className="size-4 text-[var(--dpf-accent)]" aria-hidden="true" />
        <h2 id="work-case-discussion-title" className="text-sm font-semibold text-[var(--dpf-text)]">
          Discussion
        </h2>
      </div>

      {thread.participants.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--dpf-border)] px-4 py-2 text-xs text-[var(--dpf-muted)]">
          <span className="font-medium">In this thread:</span>
          {thread.participants.map((participant) => (
            <span
              key={participant}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 text-[var(--dpf-text)]"
            >
              <span className="size-1.5 rounded-full bg-[var(--dpf-success)]" aria-hidden="true" />
              {participant}
            </span>
          ))}
        </div>
      ) : null}

      {thread.messages.length > 0 ? (
        <ol className="divide-y divide-[var(--dpf-border)]">
          {thread.messages.map((message) => (
            <li key={message.messageId} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--dpf-text)]">{message.senderLabel}</p>
                {message.createdAt ? (
                  <span className="text-xs text-[var(--dpf-muted)]">
                    <LocalTime value={message.createdAt} mode="datetime" />
                  </span>
                ) : null}
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

      <div className="space-y-2 border-t border-[var(--dpf-border)] px-4 py-3">
        <label htmlFor="work-case-comment-body" className="sr-only">
          Add a comment
        </label>
        <textarea
          id="work-case-comment-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          disabled={!thread.canComment || !thread.workItemId || pending}
          placeholder="Add a comment…"
          className="w-full resize-y rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
        />
        {error ? <p className="text-xs text-[var(--dpf-error)]">{error}</p> : null}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-[var(--dpf-muted)]">Use @name to notify a teammate.</p>
          <button
            type="button"
            onClick={handlePost}
            disabled={disabled}
            className="inline-flex items-center rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-on-accent,white)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Posting…" : "Post comment"}
          </button>
        </div>
      </div>
    </section>
  );
}
