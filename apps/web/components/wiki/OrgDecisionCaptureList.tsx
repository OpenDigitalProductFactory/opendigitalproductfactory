"use client";
// BI-9677364B: "Waiting on your call" — unresolved WWWD business decisions,
// answerable inline on the Review & Adjust workspace.
//
// Cognitive-load contract (AGENTS.md §12): one card per open decision, one
// plain-language question, one answer box, one pre-checked "remember this"
// toggle. Answering with the toggle on writes the ruling back as standing
// doctrine so the equivalent decision never escalates again — the loop the
// stance-onboarding design closes.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { captureOrgDecisionOutcome } from "@/lib/actions/org-decision-capture";
import { LocalTime } from "@/components/ui/LocalTime";

export type OpenOrgDecision = {
  interactionId: string;
  question: string;
  riskTier: string | null;
  outcomeType: string;
  /** ISO timestamp; rendered in the viewer's timezone via LocalTime. */
  createdAt: string;
  // BI-6DCF772F: the scored option menu (when the gate scored one) and the
  // kernel's recommendation, so the owner picks a structured option.
  scoredOptions?: { id: string; description: string }[] | null;
  recommendedOptionId?: string | null;
};

function CaptureCard({ decision }: { decision: OpenOrgDecision }) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [chosenOptionId, setChosenOptionId] = useState<string>(decision.recommendedOptionId ?? "");
  const [makeStanding, setMakeStanding] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { standing: boolean }>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await captureOrgDecisionOutcome({
        interactionId: decision.interactionId,
        answer,
        makeStanding,
        chosenOptionId: chosenOptionId || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone({ standing: result.standingPromoted === true });
      router.refresh();
    });
  }

  if (done) {
    return (
      <li className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
        <p className="text-sm text-[var(--dpf-success)]">
          Answer recorded{done.standing ? " — and saved as your standing answer for cases like this." : "."}
        </p>
      </li>
    );
  }

  return (
    <li className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-sm font-medium text-[var(--dpf-text)] min-w-0 flex-1">
          {decision.question}
        </span>
        {decision.riskTier && (
          <span className="text-xs text-[var(--dpf-muted)] shrink-0">risk: {decision.riskTier}</span>
        )}
        <LocalTime value={decision.createdAt} mode="date" className="text-xs text-[var(--dpf-muted)] shrink-0" />
      </div>
      <form onSubmit={onSubmit}>
        {decision.scoredOptions && decision.scoredOptions.length > 0 && (
          <fieldset className="grid gap-1.5 text-xs text-[var(--dpf-text)] mb-2">
            <legend className="font-medium mb-1">Which option did you choose?</legend>
            {decision.scoredOptions.map((option) => (
              <label key={option.id} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`chosen-${decision.interactionId}`}
                  value={option.id}
                  checked={chosenOptionId === option.id}
                  onChange={() => setChosenOptionId(option.id)}
                  className="accent-[var(--dpf-accent)]"
                />
                <span>{option.description}</span>
                {decision.recommendedOptionId === option.id && (
                  <span className="text-[var(--dpf-muted)]">(recommended)</span>
                )}
              </label>
            ))}
          </fieldset>
        )}
        <label className="sr-only" htmlFor={`answer-${decision.interactionId}`}>
          What should the business do?
        </label>
        <textarea
          id={`answer-${decision.interactionId}`}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={2}
          placeholder="What should the business do?"
          className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] mb-2"
        />
        {error && (
          <p className="text-xs text-[var(--dpf-error)] mb-2" role="alert">
            {error}
          </p>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="submit"
            disabled={pending || answer.trim().length === 0}
            className="rounded-md border border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-accent)] hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Recording…" : "Answer"}
          </button>
          <label className="flex items-center gap-1.5 text-xs text-[var(--dpf-text)]">
            <input
              type="checkbox"
              checked={makeStanding}
              onChange={(e) => setMakeStanding(e.target.checked)}
            />
            Remember this as our standing answer
          </label>
        </div>
      </form>
    </li>
  );
}

export function OrgDecisionCaptureList({ decisions }: { decisions: OpenOrgDecision[] }) {
  if (decisions.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-[var(--dpf-text)] mb-1">Waiting on your call</h2>
      <p className="text-xs text-[var(--dpf-muted)] mb-3">
        Business decisions your AI escalated because it had no settled answer. Answering with
        &ldquo;remember this&rdquo; on teaches it — equivalent cases resolve on their own next time.
      </p>
      <ul className="flex flex-col gap-2">
        {decisions.map((d) => (
          <CaptureCard key={d.interactionId} decision={d} />
        ))}
      </ul>
    </section>
  );
}
