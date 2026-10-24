"use client";

import { useActionState, useState } from "react";

import { manageCareAction, type CareActionResult } from "@/app/(shell)/workspace/rescue/care/actions";
import { FormStatus, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import { CARE_ROUTINE_KINDS, KIND_LABEL, type CareRound, type DailyCareBoard } from "@/lib/animal-welfare/daily-care-vocabulary";
import { formatInstant } from "@/lib/datetime";
import { OWNER_FIRST_NEXT_ACTION_ATTR } from "@/lib/owner-first/ux-audit";

const CONTROL = "min-h-11";
const OUTCOMES = [
  { value: "done", label: "Done" },
  { value: "partial", label: "Partly done" },
  { value: "not-eaten", label: "Did not eat" },
  { value: "refused", label: "Refused" },
  { value: "concern", label: "Concern to report" },
];
const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

function RoundCard({ round, action, pending, timeZone }: { round: CareRound; action: (payload: FormData) => void; pending: boolean; timeZone: string }) {
  const [outcome, setOutcome] = useState("done");
  const [observation, setObservation] = useState("");
  const needsNote = outcome !== "done" && outcome !== "partial";
  return (
    <li className="rounded-lg border border-[var(--dpf-border)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{round.kind ? KIND_LABEL[round.kind] : "Care"} · {round.animalName}</p>
          <p className="text-sm text-[var(--dpf-muted)]">
            {round.instruction ? `${round.instruction} · ` : ""}due <time dateTime={round.dueAt}>{formatInstant(round.dueAt, { timeZone })}</time>
          </p>
        </div>
        {round.medicationOverdue ? <StatusBadge intent="danger" label="Medication overdue" uppercase={false} />
          : round.overdue ? <StatusBadge intent="warning" label="Overdue" uppercase={false} />
          : <StatusBadge intent="neutral" label="Due" uppercase={false} />}
      </div>
      <form action={action} className="mt-2 grid gap-2 md:grid-cols-[10rem_1fr_auto] md:items-end">
        <input type="hidden" name="intent" value="round" />
        <input type="hidden" name="roundId" value={round.id} />
        <SelectField name="outcome" label="What happened" selectClassName={CONTROL} value={outcome} onValueChange={setOutcome} options={OUTCOMES} />
        <TextField name="observation" label={needsNote ? "What you observed (required)" : "Note"} inputClassName={CONTROL} required={needsNote} value={observation} onValueChange={setObservation} maxLength={400} />
        <SubmitButton className={CONTROL} pending={pending} pendingLabel="Saving…">Record</SubmitButton>
      </form>
    </li>
  );
}

export function DailyCareOperations({ board, timeZone }: { board: DailyCareBoard; timeZone: string }) {
  const [state, action, pending] = useActionState<CareActionResult | null, FormData>(manageCareAction, null);
  const [animalId, setAnimalId] = useState(board.animals[0]?.animalProfileId ?? "");
  const [kind, setKind] = useState("feed");
  const [timeOfDay, setTimeOfDay] = useState("08:00");
  const [frequency, setFrequency] = useState("daily");
  const [forDays, setForDays] = useState("");
  const [instruction, setInstruction] = useState("");
  const [ackNote, setAckNote] = useState("");
  const overdueMedication = board.rounds.filter((r) => r.medicationOverdue).length;

  return (
    <section className="mt-5 space-y-4" aria-labelledby="care-actions-heading">
      <div>
        <h2 id="care-actions-heading" className="text-base font-semibold text-[var(--dpf-text)]">Today's care</h2>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">Every round is a dated commitment to one animal. Record what happened; anything that is not simply done becomes a follow-up a person must take on.</p>
      </div>
      <FormStatus error={state && !state.ok ? state.error : null} success={state?.ok ? state.data.message : null} />

      {board.escalations.length > 0 ? (
        <Surface as="section">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Welfare follow-ups needing a person</h3>
          <ul className="mt-3 space-y-3" aria-label="Welfare follow-ups">
            {board.escalations.map((item) => (
              <li key={item.id} className="rounded-lg border border-[var(--dpf-border)] p-3">
                <p className="text-sm font-medium text-[var(--dpf-text)]">{item.title}</p>
                {item.reason ? <p className="mt-1 text-sm text-[var(--dpf-muted)]">{item.reason}</p> : null}
                <form action={action} className="mt-2 grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
                  <input type="hidden" name="intent" value="acknowledge" />
                  <input type="hidden" name="escalationId" value={item.id} />
                  <TextField name="note" label="What was done or decided" inputClassName={CONTROL} required value={ackNote} onValueChange={setAckNote} maxLength={400} />
                  <SubmitButton className={CONTROL} pending={pending} pendingLabel="Saving…">Resolve</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </Surface>
      ) : null}

      <Surface as="section">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Rounds due (overdue first)</h3>
          <form action={action}>
            <input type="hidden" name="intent" value="escalate-missed" />
            <SubmitButton className={CONTROL} pending={pending} pendingLabel="Checking…" disabled={overdueMedication === 0}>
              {overdueMedication === 0 ? "No medication overdue" : `Escalate ${overdueMedication} missed medication`}
            </SubmitButton>
          </form>
        </div>
        {board.rounds.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-[var(--dpf-border)] p-4 text-sm text-[var(--dpf-muted)]">No rounds are due. Set up a routine below so tomorrow's list exists before anyone has to remember it.</p>
        ) : (
          <ul className="mt-3 space-y-3" aria-label="Care rounds">
            {[...board.rounds].sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.dueAt.localeCompare(b.dueAt)).map((round) => (
              <RoundCard key={round.id} round={round} action={action} pending={pending} timeZone={timeZone} />
            ))}
          </ul>
        )}
      </Surface>

      <Surface as="section">
        <details open={board.rounds.length === 0}>
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-[var(--dpf-text)]">Set up a routine</summary>
        <form action={action} className="mt-3 grid gap-3 md:grid-cols-3" aria-label="Set up a routine">
          <input type="hidden" name="intent" value="routine" />
          <SelectField name="animalProfileId" label="Animal" selectClassName={CONTROL} required value={animalId} onValueChange={setAnimalId} options={board.animals.map((a) => ({ value: a.animalProfileId, label: `${a.name} · ${a.animalRef}` }))} placeholder={board.animals.length === 0 ? "No animals in care" : undefined} disabled={board.animals.length === 0} />
          <SelectField name="kind" label="Routine" selectClassName={CONTROL} required value={kind} onValueChange={setKind} options={CARE_ROUTINE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
          <TextField name="timeOfDay" label="Time of day" inputClassName={CONTROL} type="time" required value={timeOfDay} onValueChange={setTimeOfDay} />
          <SelectField name="frequency" label="How often" selectClassName={CONTROL} value={frequency} onValueChange={setFrequency} options={[{ value: "daily", label: "Every day" }, { value: "weekly", label: "Chosen weekdays" }]} />
          {frequency === "weekly" ? (
            <fieldset className="md:col-span-2">
              <legend className="text-sm font-medium text-[var(--dpf-text)]">Weekdays</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => (
                  <label key={day} className="dpf-tap-target flex min-h-11 items-center gap-1 rounded-md border border-[var(--dpf-border)] px-3 text-sm text-[var(--dpf-text)]">
                    <input type="checkbox" name="weekdays" value={day} defaultChecked={day !== "SA" && day !== "SU"} /> {day}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <TextField name="forDays" label="For how many days (blank = ongoing)" inputClassName={CONTROL} type="number" value={forDays} onValueChange={setForDays} min={1} max={365} />
          <TextField name="instruction" label={kind === "medication" ? "Product and dose (required)" : "Instruction"} inputClassName={CONTROL} required={kind === "medication"} value={instruction} onValueChange={setInstruction} maxLength={160} placeholder={kind === "medication" ? "Bravecto 250mg with food" : "Half a cup dry, wet topper"} />
          <div className="md:col-span-3">
            <span {...{ [OWNER_FIRST_NEXT_ACTION_ATTR]: "true" }}>
              <SubmitButton className={CONTROL} pending={pending} pendingLabel="Scheduling…" disabled={board.animals.length === 0}>Schedule routine</SubmitButton>
            </span>
          </div>
        </form>
        </details>
      </Surface>
    </section>
  );
}
