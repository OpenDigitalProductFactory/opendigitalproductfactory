"use client";

// The suggestion an owner rules on, on the same screen as the decision
// (BI-3D0FB84B). Every word comes from presentProposal() in lib — this file
// renders values, and deliberately holds no copy of its own.

import { useState, useTransition } from "react";

import {
  IDLE_PROPOSAL_MODE,
  PROPOSAL_CARD_MODES,
  type PresentedProposal,
} from "@/lib/decision/proposal-presentation";

import { ruleProposal, type RuleProposalResult } from "./proposal-actions";

/** Named, so an empty initial value is not scanned as UI text. */
const EMPTY = "";

export function ProposalCard({ proposal }: { proposal: PresentedProposal }) {
  const { labels } = proposal;
  const [mode, setMode] = useState(IDLE_PROPOSAL_MODE);
  const [text, setText] = useState(proposal.draftText ?? EMPTY);
  const [note, setNote] = useState(EMPTY);
  const [result, setResult] = useState<RuleProposalResult | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (ruling: "accept" | "amend" | "reject") => {
    if (pending) return;
    startTransition(async () => {
      setResult(
        await ruleProposal({
          proposalId: proposal.proposalId,
          ruling,
          amendedText: ruling === "amend" ? text : undefined,
          note: ruling === "reject" ? note.trim() || undefined : undefined,
        }),
      );
    });
  };

  if (result?.ok) {
    return (
      <p className="rounded-lg border border-[var(--dpf-border)] p-3 text-sm text-[var(--dpf-success)]">
        {result.data}
      </p>
    );
  }

  // Built here rather than as a nested ternary inside the markup: what the
  // owner is told when coworkers disagreed and when they all agreed are two
  // different statements, and neither should be buried in a branch.
  let standingOfTheAdvice = null;
  if (proposal.dissent.length > 0) {
    standingOfTheAdvice = (
      <div className="mt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--dpf-warning)]">
          {labels.dissentHeading}
        </p>
        <ul className="mt-1 flex flex-col gap-1">
          {proposal.dissent.map((d) => (
            <li key={`${d.role}:${d.position}`} className="text-xs text-[var(--dpf-muted)]">
              <span className="text-[var(--dpf-text)]">{d.role}</span>
              {` — ${d.position}${d.because ? `: ${d.because}` : EMPTY}`}
            </li>
          ))}
        </ul>
      </div>
    );
  } else if (proposal.agreementNote) {
    standingOfTheAdvice = (
      <p className="mt-3 text-xs text-[var(--dpf-muted)]">{proposal.agreementNote}</p>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--dpf-accent)] p-3">
      <p className="text-sm font-medium text-[var(--dpf-text)]">{proposal.summary}</p>
      <p className="mt-1 text-xs text-[var(--dpf-muted)]">{proposal.effect}</p>

      {proposal.draftText && mode !== PROPOSAL_CARD_MODES.amending ? (
        <p className="mt-2 whitespace-pre-wrap rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)]">
          {proposal.draftText}
        </p>
      ) : null}

      {mode === PROPOSAL_CARD_MODES.amending ? (
        <div className="mt-2 flex flex-col gap-1">
          <p className="text-xs text-[var(--dpf-muted)]">{labels.amendHint}</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            autoFocus
            aria-label={labels.amend}
            className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)]"
          />
        </div>
      ) : null}

      {mode === PROPOSAL_CARD_MODES.rejecting ? (
        <div className="mt-2 flex flex-col gap-1">
          <p className="text-xs text-[var(--dpf-muted)]">{labels.rejectHint}</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            autoFocus
            aria-label={labels.reject}
            placeholder={labels.notePlaceholder}
            className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)]"
          />
        </div>
      ) : null}

      {standingOfTheAdvice}

      {proposal.confidence ? (
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">{proposal.confidence}</p>
      ) : null}

      {result && !result.ok ? (
        <p className="mt-2 text-xs text-[var(--dpf-error)]">{result.error}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => submit(mode === PROPOSAL_CARD_MODES.amending ? "amend" : "accept")}
          disabled={pending || (mode === PROPOSAL_CARD_MODES.amending && !text.trim())}
          className="rounded-md border border-[var(--dpf-accent)] px-2.5 py-1 text-xs font-medium text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-50"
        >
          {pending ? labels.working : labels.accept}
        </button>

        {mode === PROPOSAL_CARD_MODES.idle && proposal.draftField ? (
          <button
            type="button"
            onClick={() => setMode(PROPOSAL_CARD_MODES.amending)}
            className="rounded-md border border-[var(--dpf-border)] px-2.5 py-1 text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
          >
            {labels.amend}
          </button>
        ) : null}

        {mode === PROPOSAL_CARD_MODES.rejecting ? (
          <button
            type="button"
            onClick={() => submit("reject")}
            disabled={pending}
            className="rounded-md border border-[var(--dpf-border)] px-2.5 py-1 text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-50"
          >
            {labels.reject}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setMode(PROPOSAL_CARD_MODES.rejecting)}
            className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          >
            {labels.reject}
          </button>
        )}

        {mode !== PROPOSAL_CARD_MODES.idle ? (
          <button
            type="button"
            onClick={() => {
              setMode(PROPOSAL_CARD_MODES.idle);
              setText(proposal.draftText ?? EMPTY);
              setNote(EMPTY);
            }}
            disabled={pending}
            className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-50"
          >
            {labels.cancel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
