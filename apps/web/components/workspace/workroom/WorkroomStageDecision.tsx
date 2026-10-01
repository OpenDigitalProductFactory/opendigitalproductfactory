"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { FormStatus, TextField } from "@/components/ui/form";
import { recordWorkroomStageDecision } from "@/lib/actions/workroom-stage-decision";
import { useT } from "@/lib/i18n/use-t";
import type { StageDecisionChoice, WorkroomStageDecisionView } from "@/lib/work-management/workroom-stage-decision";

/**
 * The decision a governed stage is waiting on, inside the room's Attention card.
 *
 * Progressive disclosure, because the card is one cell of a dense header: ONE
 * line saying what waits and who decides, and a single "Decide" button. The
 * choices, the date (only for Defer), the optional rationale and what the
 * earlier stages found stay behind that button. Copy lives in the `workrooms`
 * message catalog namespace. Anyone who is not the decider
 * sees the line and no control — the server refuses them anyway.
 */
export function WorkroomStageDecision({ view }: { view: WorkroomStageDecisionView }) {
  const t = useT("workrooms");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<StageDecisionChoice | null>(null);
  const [deferUntil, setDeferUntil] = useState("");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const line = view.canDecide
    ? t("stageDecision.yours", { stage: view.stageTitle })
    : view.deciderName
      ? t("stageDecision.waitingOn", { name: view.deciderName, stage: view.stageTitle })
      : t("stageDecision.waiting", { stage: view.stageTitle });

  function submit() {
    if (!choice) return;
    setError(null);
    startTransition(async () => {
      const result = await recordWorkroomStageDecision(view.caseKey, view.roomRowId, {
        stageKey: view.stageKey,
        choice,
        ...(choice === "defer" ? { deferUntil } : {}),
        ...(rationale.trim() ? { rationale: rationale.trim() } : {}),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-[var(--dpf-text)]">{line}</p>
        {view.canDecide && !open ? (
          <Button size="sm" onClick={() => setOpen(true)}>{t("stageDecision.decide")}</Button>
        ) : null}
      </div>
      {!view.canDecide && !view.deciderName && view.refusal ? (
        <p className="text-xs text-[var(--dpf-muted)]">{view.refusal}</p>
      ) : null}

      {view.canDecide && open ? (
        <div className="space-y-3 border-t border-[var(--dpf-border)] pt-3">
          {view.findings.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-[var(--dpf-muted)]">{t("stageDecision.found")}</p>
              <ul className="mt-1 space-y-1">
                {view.findings.map((finding) => (
                  <li key={finding.stageKey} className="text-xs text-[var(--dpf-text)]">
                    <span className="text-[var(--dpf-muted)]">{finding.title}: </span>
                    {finding.summary}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <fieldset>
            <legend className="sr-only">{t("stageDecision.choice")}</legend>
            <div className="flex flex-wrap gap-1">
              {view.choices.map((option) => (
                <label
                  key={option}
                  className={`inline-flex min-h-9 cursor-pointer items-center rounded-md border px-3 text-xs font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--dpf-accent)] ${
                    choice === option
                      ? "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                      : "border-[var(--dpf-border)] text-[var(--dpf-muted)]"
                  }`}
                >
                  <input
                    type="radio"
                    name={`stage-decision-${view.stageKey}`}
                    value={option}
                    checked={choice === option}
                    onChange={() => setChoice(option)}
                    className="sr-only"
                  />
                  {t(`stageDecision.choices.${option}`)}
                </label>
              ))}
            </div>
          </fieldset>

          {choice === "defer" ? (
            <TextField
              name="stage-decision-defer-until"
              label={t("stageDecision.deferUntil")}
              type="date"
              required
              value={deferUntil}
              onValueChange={setDeferUntil}
              autoComplete="off"
            />
          ) : null}
          <TextField
            name="stage-decision-rationale"
            label={t("stageDecision.rationale")}
            optional
            value={rationale}
            onValueChange={setRationale}
            maxLength={500}
            autoComplete="off"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={submit} disabled={!choice || pending || (choice === "defer" && !deferUntil)}>
              {t("stageDecision.record")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {t("stageDecision.cancel")}
            </Button>
          </div>
          <FormStatus error={error} />
        </div>
      ) : null}
    </div>
  );
}
