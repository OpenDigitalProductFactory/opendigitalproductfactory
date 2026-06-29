"use client";

import { useState } from "react";
import { Clock3, Eye, Sparkles } from "lucide-react";
import { StatusBadge } from "@/components/ui/report-kit";
import type { BuildStudioCustodianPrompt } from "./build-studio-custodian";

type Props = {
  prompt: BuildStudioCustodianPrompt;
  onPrimaryAction: () => void;
  onSnooze: () => void;
};

export function BuildStudioCustodianCallout({ prompt, onPrimaryAction, onSnooze }: Props) {
  const [showWhy, setShowWhy] = useState(false);

  return (
    <section
      aria-label="AI Coworker proactive help"
      data-testid="build-studio-custodian-callout"
      className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-3"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <StatusBadge intent={prompt.intent} label={prompt.statusLabel} variant="soft" uppercase={false} />
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{prompt.title}</p>
          </div>
          <p className="text-sm leading-5 text-[var(--dpf-text)]">{prompt.whyNow}</p>
          <p className="text-xs leading-5 text-[var(--dpf-muted)]">{prompt.recommendedAction}</p>
          {showWhy && (
            <ul className="mt-2 space-y-1 text-xs leading-5 text-[var(--dpf-muted)]" data-testid="build-studio-custodian-detail">
              {prompt.details.map((detail) => (
                <li key={detail} className="break-words">- {detail}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onPrimaryAction}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {prompt.primaryLabel}
          </button>
          <button
            type="button"
            onClick={() => setShowWhy((value) => !value)}
            aria-expanded={showWhy}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-xs font-semibold text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            {showWhy ? "Hide why" : "Show why"}
          </button>
          <button
            type="button"
            onClick={onSnooze}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-xs font-semibold text-[var(--dpf-muted)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
          >
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            Snooze
          </button>
        </div>
      </div>
    </section>
  );
}
