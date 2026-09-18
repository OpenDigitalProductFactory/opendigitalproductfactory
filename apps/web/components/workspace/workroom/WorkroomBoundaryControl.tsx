"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { FormStatus, TextField, TextareaField } from "@/components/ui/form";
import type { ActionResult } from "@/lib/shared/action-result";
import { saveWorkroomBoundary } from "@/lib/actions/workroom-boundary";
import type { WorkroomBoundaryClaim } from "@/lib/work-management/workroom-boundary-claim";

/**
 * The control the room's boundary notice implied existed and did not.
 *
 * The notice lists what the room has not defined and, until now, offered no way
 * to define any of it — while the header printed "NEXT ACTION: Assign owner". A
 * surface that names the next action and withholds the affordance reads as
 * broken rather than incomplete: there is no way to tell a missing permission
 * from a missing feature.
 *
 * FIELD ORDER FOLLOWS THE SPEC, NOT THE STRUCT. 2026-07-26-work-rooms-
 * collaboration-design.md §7.2 requires ONE authorized repair action and
 * forbids blocking the surface behind a multi-field wizard; §7 keeps full
 * policy behind progressive disclosure. So: a single button, then the two
 * fields the notice's own repair sentence names, then the remaining six behind
 * a disclosure. Nobody fills eleven fields to clear one sentence.
 *
 * Written in the words an owner uses. "Who answers for this?" is a question a
 * person can answer; "accountablePrincipalRef" is not.
 */

type Props = {
  caseKey: string;
  roomRowId: string;
  current: WorkroomBoundaryClaim | null;
};

function lines(value: readonly string[] | undefined): string {
  return (value ?? []).join("\n");
}

function toList(value: string): string[] {
  return value.split("\n").map((entry) => entry.trim()).filter(Boolean);
}

export function WorkroomBoundaryControl({ caseKey, roomRowId, current }: Props) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const [outcome, setOutcome] = useState(current?.outcome ?? "");
  const [accountable, setAccountable] = useState(current?.accountablePrincipalRef ?? "");
  const [scopeIncluded, setScopeIncluded] = useState(lines(current?.scopeIncluded));
  const [scopeExcluded, setScopeExcluded] = useState(lines(current?.scopeExcluded));
  const [authority, setAuthority] = useState(lines(current?.authoritySummary));
  const [sensitivity, setSensitivity] = useState(current?.sensitivityCeiling ?? "");
  const [measures, setMeasures] = useState(lines(current?.measures));
  const [closure, setClosure] = useState(current?.closureRuleSummary ?? "");

  function save() {
    startTransition(async () => {
      const saved = await saveWorkroomBoundary(caseKey, roomRowId, {
        outcome,
        accountablePrincipalRef: accountable,
        scopeIncluded: toList(scopeIncluded),
        scopeExcluded: toList(scopeExcluded),
        authoritySummary: toList(authority),
        sensitivityCeiling: sensitivity,
        measures: toList(measures),
        closureRuleSummary: closure,
      });
      setResult(saved);
      if (saved.ok) setOpen(false);
    });
  }

  if (!open) {
    return (
      <div className="mt-3">
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Define this room
        </Button>
        <FormStatus className="mt-2" error={result && !result.ok ? result.error : null} />
      </div>
    );
  }

  return (
    <Surface className="mt-3 space-y-4">
      <TextField
        name="room-outcome"
        label="What does finished look like?"
        hint="What is true when this room is done."
        value={outcome}
        onValueChange={setOutcome}
        autoComplete="off"
      />
      <TextField
        name="room-accountable"
        label="Who answers for it?"
        hint="One person or role, not a team."
        value={accountable}
        onValueChange={setAccountable}
        autoComplete="off"
      />

      {more ? (
        <div className="space-y-4 border-t border-[var(--dpf-border)] pt-4">
          <TextareaField
            name="room-scope-in"
            label="In scope"
            hint="One per line."
            value={scopeIncluded}
            onValueChange={setScopeIncluded}
          />
          <TextareaField
            name="room-scope-out"
            label="Not in scope"
            hint="What stops the room growing."
            value={scopeExcluded}
            onValueChange={setScopeExcluded}
          />
          <TextareaField
            name="room-authority"
            label="Decide here without asking"
            hint="Anything else escalates."
            value={authority}
            onValueChange={setAuthority}
          />
          <TextField
            name="room-sensitivity"
            label="Most sensitive thing allowed"
            value={sensitivity}
            onValueChange={setSensitivity}
            autoComplete="off"
          />
          <TextareaField
            name="room-measures"
            label="How anyone would know it worked"
            hint="One per line."
            value={measures}
            onValueChange={setMeasures}
          />
          <TextareaField
            name="room-closure"
            label="When it stops"
            hint="Including when it stops unfinished."
            rows={2}
            value={closure}
            onValueChange={setClosure}
          />
        </div>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setMore(true)}>
          Add scope, authority, measures and closure
        </Button>
      )}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <FormStatus error={result && !result.ok ? result.error : null} />
      </div>
    </Surface>
  );
}
