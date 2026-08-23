"use client";

// The answer-once affordance for an org-business gap (BI-3AAB96E9). The gate
// deferred because the organization is silent on this kind of call; the
// operator answers the representative question here and it flows into the WWWD
// corpus as draft. One low-friction input beats routing them to hand-author a
// whole stance.

import { useState, useTransition } from "react";

import { answerGovernanceGap } from "./actions";

export function GapAnswerForm({
  domainClass,
  question,
  autoOpen = false,
}: {
  domainClass: string;
  question: string;
  /**
   * True when the reader arrived from a decision record's "answer it once"
   * step. The box opens already showing the question they were just reading,
   * so following the advice never lands on an empty form (BI-6700AF66).
   */
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  if (result?.ok) {
    return (
      <p className="mt-2 ml-1 text-xs text-[var(--dpf-success)]">
        ✓ {result.message}
      </p>
    );
  }

  if (!open) {
    return (
      <div className="mt-2 ml-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-[var(--dpf-border)] px-2.5 py-1 text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
        >
          Answer this once →
        </button>
      </div>
    );
  }

  const submit = () => {
    const trimmed = answer.trim();
    if (!trimmed || pending) return;
    startTransition(async () => {
      const res = await answerGovernanceGap({ domainClass, question, answer: trimmed });
      setResult(res);
    });
  };

  return (
    <div className="mt-2 ml-1 flex flex-col gap-2">
      <p className="text-xs text-[var(--dpf-muted)]">
        Answer in your own words — it&#39;s saved as a draft for you to review, not
        published automatically.
      </p>
      <p className="text-xs text-[var(--dpf-text)]">{question}</p>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={3}
        autoFocus
        placeholder="How your business would decide this…"
        className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)]"
      />
      {result && !result.ok && (
        <p className="text-xs text-[var(--dpf-error)]">{result.message}</p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !answer.trim()}
          className="rounded-md border border-[var(--dpf-accent)] px-2.5 py-1 text-xs font-medium text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-50"
        >
          {pending ? "Capturing…" : "Capture answer"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setAnswer("");
            setResult(null);
          }}
          disabled={pending}
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
