"use client";

import { useState, useTransition } from "react";

import { Surface } from "@/components/ui/Surface";
import {
  resetWorkroomPostureDefault,
  saveWorkroomPostureDefault,
} from "@/lib/actions/workroom-posture";

/**
 * EP-WORK-POSTURE — decree how ROOMS behave, platform-wide.
 *
 * The existing controls on this surface answer "how does this COWORKER behave".
 * That is a different question from "how does work in a room behave", and the
 * second had no control at all: a room could only inherit a coworker-shaped
 * default that was never about rooms.
 *
 * This sits ABOVE the coworker ladder for room work and BELOW both the room's
 * own declaration and what the work actually is — a blanket preference should
 * not outrank the shape of the job in front of you.
 */

const PACE = [
  { value: "quiet", label: "Quiet", when: "rooms don't interrupt unless asked" },
  { value: "balanced", label: "Follows up", when: "rooms chase, without nagging" },
  { value: "assertive", label: "Pushes", when: "rooms warn early and escalate sooner" },
] as const;

const AUTHORITY = [
  { value: "advise", label: "Advises only", when: "rooms never act on their own" },
  { value: "propose", label: "Asks first", when: "rooms put actions up for approval" },
  { value: "preauthorized", label: "Acts alone", when: "rooms may go ahead without asking" },
] as const;

export function WorkroomDefaultControl({
  currentPace,
  currentAuthority,
}: {
  currentPace: string | null;
  currentAuthority: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isSet = Boolean(currentPace || currentAuthority);

  function run(fn: () => Promise<{ ok: boolean }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError("Couldn't save that. Your change was not applied.");
    });
  }

  return (
    <Surface className="p-5">
      <h3 className="text-sm font-medium text-[var(--dpf-fg)]">How work rooms behave</h3>
      <p className="mt-1 text-xs text-[var(--dpf-fg-muted)]">
        The default for every room, unless the room or the work says otherwise. Separate
        from the coworker settings above: a room and a coworker are different questions.
      </p>

      <fieldset className="mt-4" disabled={pending}>
        <legend className="text-xs font-medium text-[var(--dpf-fg)]">How hard should rooms push?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {PACE.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={currentPace === option.value}
              title={option.when}
              onClick={() => run(() => saveWorkroomPostureDefault({ proactivityLevel: option.value }))}
              className={`rounded border px-2.5 py-1.5 text-xs transition-colors ${
                currentPace === option.value
                  ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] text-[var(--dpf-fg)]"
                  : "border-[var(--dpf-border)] text-[var(--dpf-fg-muted)] hover:text-[var(--dpf-fg)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-4" disabled={pending}>
        <legend className="text-xs font-medium text-[var(--dpf-fg)]">
          May rooms act without asking?
        </legend>
        <p className="mt-1 text-xs text-[var(--dpf-fg-muted)]">
          A looser setting never grants more freedom than a coworker already has.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {AUTHORITY.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={currentAuthority === option.value}
              title={option.when}
              onClick={() => run(() => saveWorkroomPostureDefault({ actionBoundary: option.value }))}
              className={`rounded border px-2.5 py-1.5 text-xs transition-colors ${
                currentAuthority === option.value
                  ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] text-[var(--dpf-fg)]"
                  : "border-[var(--dpf-border)] text-[var(--dpf-fg-muted)] hover:text-[var(--dpf-fg)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      {isSet ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => resetWorkroomPostureDefault())}
          className="mt-4 text-xs text-[var(--dpf-fg-muted)] underline hover:text-[var(--dpf-fg)]"
        >
          Remove this default
        </button>
      ) : (
        <p className="mt-4 text-xs text-[var(--dpf-fg-muted)]">
          No default set — rooms follow the work.
        </p>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-xs text-[var(--dpf-danger)]">
          {error}
        </p>
      ) : null}
    </Surface>
  );
}
