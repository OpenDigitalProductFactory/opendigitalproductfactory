"use client";

// The instance's direction — mission, vision and top-level outcomes
// (BI-916216E7; spec docs/superpowers/specs/2026-10-28-instance-direction-design.md).
//
// Shown on the business settings page and as the "direction" setup step. The
// owner's own words: fields start empty, the mission starter is a button the
// owner presses, and nothing is saved until they press Save. Each missing part
// is marked "Not set yet" so a skipped step is visible, never silent.

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { FormStatus, SubmitButton, TextField, TextareaField } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/report-kit";
import { useT } from "@/lib/i18n/use-t";
import { saveDirectionAction } from "@/lib/actions/organization-direction";
import { DIRECTION_LIMITS, MAX_INSTANCE_OUTCOMES } from "@/lib/organization-direction/direction-vocabulary";

type OutcomeRow = { id: string | null; statement: string; measure: string };

export type DirectionPanelProps = {
  initial: {
    mission: string;
    vision: string;
    outcomes: Array<{ id: string; statement: string; measure: string | null }>;
  };
  /** "setup" during first-run setup (asks for one to three outcomes). */
  source: "settings" | "setup";
  entityNoun: "business" | "organization";
  /** Archetype-aware mission starter, applied only when the owner presses it. */
  missionSuggestion?: string;
};

function SectionHeading({ title, missing, notSet }: { title: string; missing: boolean; notSet: string }) {
  return (
    <div className="flex items-center gap-2">
      <h4 className="text-sm font-semibold text-[var(--dpf-text)]">{title}</h4>
      {missing && <StatusBadge intent="warning" label={notSet} uppercase={false} />}
    </div>
  );
}

export function DirectionPanel({ initial, source, entityNoun, missionSuggestion }: DirectionPanelProps) {
  const t = useT("storefront");
  const noun = { noun: entityNoun };
  const notSet = t("direction.notSet");
  const [mission, setMission] = useState(initial.mission);
  const [vision, setVision] = useState(initial.vision);
  const [outcomes, setOutcomes] = useState<OutcomeRow[]>(
    initial.outcomes.length > 0
      ? initial.outcomes.map((o) => ({ id: o.id, statement: o.statement, measure: o.measure ?? "" }))
      : [{ id: null, statement: "", measure: "" }],
  );
  const [saved, setSaved] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const touch = () => setSuccess(null);
  const updateOutcome = (index: number, patch: Partial<OutcomeRow>) => {
    touch();
    setOutcomes((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const removeOutcome = (index: number) => {
    touch();
    setOutcomes((rows) => {
      const next = rows.filter((_, i) => i !== index);
      return next.length > 0 ? next : [{ id: null, statement: "", measure: "" }];
    });
  };

  async function save() {
    setError(null);
    setSuccess(null);
    setPending(true);
    try {
      const result = await saveDirectionAction({ mission, vision, outcomes }, source);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved({ mission: mission.trim(), vision: vision.trim(), outcomes: result.data.outcomes });
      setOutcomes(
        result.data.outcomes.length > 0
          ? result.data.outcomes.map((o) => ({ id: o.id, statement: o.statement, measure: o.measure ?? "" }))
          : [{ id: null, statement: "", measure: "" }],
      );
      setSuccess(t("direction.saved", { version: result.data.version }));
    } catch {
      setError(t("direction.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  const missingOutcomes = saved.outcomes.length === 0;
  const canAdd = outcomes.length < MAX_INSTANCE_OUTCOMES;

  return (
    <Surface as="section" padding="lg" className="mb-6 max-w-[560px] text-[var(--dpf-text)]" id="direction" aria-labelledby="direction-heading">
      <h3 id="direction-heading" className="text-base font-semibold text-[var(--dpf-text)]">
        {t("direction.heading")}
      </h3>
      <p className="mt-1 text-sm text-[var(--dpf-muted)]">{t("direction.intro", noun)}</p>

      <div className="mt-4 flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <SectionHeading title={t("direction.mission.title")} missing={!saved.mission.trim()} notSet={notSet} />
            {missionSuggestion && mission.trim() === "" && (
              <Button type="button" variant="ghost" size="sm" onClick={() => { touch(); setMission(missionSuggestion); }}>
                {t("direction.mission.suggest")}
              </Button>
            )}
          </div>
          <TextareaField
            name="mission"
            label={t("direction.mission.label", noun)}
            value={mission}
            onValueChange={(v) => { touch(); setMission(v); }}
            rows={2}
            maxLength={DIRECTION_LIMITS.mission}
            placeholder={t("direction.mission.placeholder")}
          />
        </div>

        <div className="flex flex-col gap-2">
          <SectionHeading title={t("direction.vision.title")} missing={!saved.vision.trim()} notSet={notSet} />
          <TextareaField
            name="vision"
            label={t("direction.vision.label", noun)}
            hint={t("direction.vision.hint")}
            value={vision}
            onValueChange={(v) => { touch(); setVision(v); }}
            rows={2}
            maxLength={DIRECTION_LIMITS.vision}
          />
        </div>

        <div className="flex flex-col gap-3">
          <SectionHeading title={t("direction.outcomes.title")} missing={missingOutcomes} notSet={notSet} />
          <p className="text-xs text-[var(--dpf-muted)]">
            {source === "setup"
              ? t("direction.outcomes.setupHint")
              : t("direction.outcomes.settingsHint", { max: MAX_INSTANCE_OUTCOMES })}
          </p>
          <ol className="flex flex-col gap-3">
            {outcomes.map((row, index) => (
              <li key={row.id ?? `new-${index}`}>
                <Surface level={2} padding="sm" className="flex flex-col gap-2">
                  <TextField
                    name={`outcome-${index}`}
                    label={t("direction.outcomes.label", { n: index + 1 })}
                    value={row.statement}
                    onValueChange={(v) => updateOutcome(index, { statement: v })}
                    maxLength={DIRECTION_LIMITS.statement}
                    autoComplete="off"
                  />
                  <TextField
                    name={`outcome-${index}-measure`}
                    label={t("direction.outcomes.measureLabel")}
                    optional
                    hint={t("direction.outcomes.measureHint")}
                    value={row.measure}
                    onValueChange={(v) => updateOutcome(index, { measure: v })}
                    maxLength={DIRECTION_LIMITS.measure}
                    autoComplete="off"
                  />
                  {(outcomes.length > 1 || row.statement || row.measure) && (
                    <div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeOutcome(index)}>
                        {t("direction.outcomes.remove", { n: index + 1 })}
                      </Button>
                    </div>
                  )}
                </Surface>
              </li>
            ))}
          </ol>
          {canAdd && (
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => { touch(); setOutcomes((rows) => [...rows, { id: null, statement: "", measure: "" }]); }}
              >
                {t("direction.outcomes.add")}
              </Button>
            </div>
          )}
        </div>

        <FormStatus error={error} success={success} />
        <div>
          <SubmitButton type="button" onClick={save} pending={pending} pendingLabel={t("direction.saving")}>
            {t("direction.save")}
          </SubmitButton>
        </div>
      </div>
    </Surface>
  );
}
