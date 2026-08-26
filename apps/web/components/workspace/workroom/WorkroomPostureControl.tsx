"use client";

import { useState, useTransition } from "react";

import { Surface } from "@/components/ui/Surface";
import type { ActionResult } from "@/lib/shared/action-result";
import {
  resetWorkroomPosture,
  saveWorkroomPosture,
  saveWorkroomShape,
} from "@/lib/actions/workroom-posture";
import { WORKROOM_SHAPE_KEYS, type WorkroomShapeKey } from "@/lib/work-management/room-shapes";

/**
 * EP-WORK-POSTURE — the control the room's read-only posture section implied
 * existed and did not.
 *
 * Until this shipped, pace and priority were settable ONLY per coworker
 * (CoworkerPriorityControl, CoworkerProactivitySetting) — which answers "how
 * does this coworker behave", not "how does work in THIS room behave". The room
 * displayed a posture nobody could change from the portal.
 *
 * Two settings, in the order that matters. The SHAPE comes first because it
 * bounds what is permitted at all; the PACE only changes how hard the room
 * pushes inside those bounds. Written in the words an owner uses, not the
 * platform's internal vocabulary.
 */

const SHAPE_COPY: Record<WorkroomShapeKey, { label: string; when: string }> = {
  "specialist-alignment": {
    label: "Specialist check",
    when: "someone qualified should look before the accountable person does",
  },
  "approval-sign-off": {
    label: "Sign-off",
    when: "someone prepares it and an accountable person signs it off",
  },
  "outward-review": {
    label: "Goes outside",
    when: "the result leaves the business under its own name",
  },
  "change-consequential": {
    label: "Consequential change",
    when: "a change is confirmed before it takes effect",
  },
  escalation: {
    label: "Escalation",
    when: "something is blocked and needs the owner to unblock it",
  },
  "craft-stewardship": {
    label: "Background curation",
    when: "ongoing upkeep by people who know the craft",
  },
};

const PACE_COPY = [
  { value: "quiet", label: "Quiet", when: "don't interrupt unless asked" },
  { value: "balanced", label: "Follows up", when: "chase it, without nagging" },
  { value: "assertive", label: "Pushes", when: "warn early and escalate sooner" },
] as const;

const AUTHORITY_COPY = [
  { value: "advise", label: "Advises only", when: "says what it would do; never acts" },
  { value: "propose", label: "Asks first", when: "puts the action up for approval" },
  { value: "preauthorized", label: "Acts alone", when: "goes ahead without asking" },
] as const;

export function WorkroomPostureControl({
  roomRowId,
  caseKey,
  currentShape,
  currentPace,
  currentAuthority,
  hasDeclaration,
}: {
  roomRowId: string;
  caseKey: string;
  currentShape: WorkroomShapeKey | null;
  currentPace: string | null;
  currentAuthority: string | null;
  hasDeclaration: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      // Server actions return failures as DATA, not throws — a thrown error is
      // redacted in production and the operator would see nothing useful. The
      // action's own message is shown, so the operator learns WHICH thing failed.
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <Surface className="mt-3 p-4">
      <h4 className="text-sm font-medium text-[var(--dpf-fg)]">Set how this room works</h4>
      <p className="mt-1 text-xs text-[var(--dpf-fg-muted)]">
        Applies to everyone in this room. Leave blank to follow the work and the default.
      </p>

      <fieldset className="mt-4" disabled={pending}>
        <legend className="text-xs font-medium text-[var(--dpf-fg)]">What kind of work is this?</legend>
        <p className="mt-1 text-xs text-[var(--dpf-fg-muted)]">Decides what may happen here.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {WORKROOM_SHAPE_KEYS.map((shape) => {
            const selected = currentShape === shape;
            return (
              <button
                key={shape}
                type="button"
                aria-pressed={selected}
                onClick={() => run(() => saveWorkroomShape(roomRowId, caseKey, shape))}
                title={SHAPE_COPY[shape].when}
                className={`rounded border px-2.5 py-1.5 text-xs transition-colors ${
                  selected
                    ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] text-[var(--dpf-fg)]"
                    : "border-[var(--dpf-border)] text-[var(--dpf-fg-muted)] hover:text-[var(--dpf-fg)]"
                }`}
              >
                {SHAPE_COPY[shape].label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-4" disabled={pending}>
        <legend className="text-xs font-medium text-[var(--dpf-fg)]">How hard should it push?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {PACE_COPY.map((option) => {
            const selected = currentPace === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                title={option.when}
                onClick={() =>
                  run(() =>
                    saveWorkroomPosture(roomRowId, caseKey, { proactivityLevel: option.value }),
                  )
                }
                className={`rounded border px-2.5 py-1.5 text-xs transition-colors ${
                  selected
                    ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] text-[var(--dpf-fg)]"
                    : "border-[var(--dpf-border)] text-[var(--dpf-fg-muted)] hover:text-[var(--dpf-fg)]"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-4" disabled={pending}>
        <legend className="text-xs font-medium text-[var(--dpf-fg)]">
          May it act without asking?
        </legend>
        <p className="mt-1 text-xs text-[var(--dpf-fg-muted)]">
          Stricter always applies. A looser choice cannot give a coworker more freedom
          than its own permissions allow.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {AUTHORITY_COPY.map((option) => {
            const selected = currentAuthority === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                title={option.when}
                onClick={() =>
                  run(() =>
                    saveWorkroomPosture(roomRowId, caseKey, { actionBoundary: option.value }),
                  )
                }
                className={`rounded border px-2.5 py-1.5 text-xs transition-colors ${
                  selected
                    ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] text-[var(--dpf-fg)]"
                    : "border-[var(--dpf-border)] text-[var(--dpf-fg-muted)] hover:text-[var(--dpf-fg)]"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {hasDeclaration ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => resetWorkroomPosture(roomRowId, caseKey))}
          className="mt-4 text-xs text-[var(--dpf-fg-muted)] underline hover:text-[var(--dpf-fg)]"
        >
          Clear this room's settings and go back to the default
        </button>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-xs text-[var(--dpf-danger)]">
          {error}
        </p>
      ) : null}
    </Surface>
  );
}
