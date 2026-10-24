"use client";

import { useActionState, useState } from "react";

import { manageCareAction, type CareActionResult } from "@/app/(shell)/workspace/rescue/care/actions";
import { FormStatus, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import { APPOINTMENT_STATUS_LABEL, VET_VISIT_DEFAULTS, VET_VISIT_KINDS, type VetAppointmentCard, type VeterinaryWorkspace } from "@/lib/animal-welfare/veterinary-vocabulary";
import { formatInstant } from "@/lib/datetime";

const CONTROL = "min-h-11";

function AppointmentCard({ card, action, pending, timeZone }: { card: VetAppointmentCard; action: (payload: FormData) => void; pending: boolean; timeZone: string }) {
  const [outcome, setOutcome] = useState("fulfilled");
  const [reason, setReason] = useState("");
  const [provider, setProvider] = useState("");
  const [complication, setComplication] = useState("");
  const open = ["pending", "booked", "arrived"].includes(card.status);
  const procedureKey = card.kind === "sterilization" ? "sterilization" : card.kind === "vaccination" ? "vaccination" : null;
  return (
    <li className="rounded-lg border border-[var(--dpf-border)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{card.kindLabel} · {card.animalName}</p>
          <p className="text-sm text-[var(--dpf-muted)]">
            <time dateTime={card.scheduledStart}>{formatInstant(card.scheduledStart, { timeZone })}</time>
            {card.practiceName ? ` at ${card.practiceName}` : ""}
            {card.recoveryUntil ? ` · recovery until ${formatInstant(card.recoveryUntil, { timeZone })}` : ""}
            {card.note ? ` · ${card.note}` : ""}
          </p>
        </div>
        <StatusBadge intent={card.inRecovery ? "warning" : open ? "neutral" : "success"} label={card.inRecovery ? "In recovery" : APPOINTMENT_STATUS_LABEL[card.status] ?? card.status} uppercase={false} />
      </div>
      {open ? (
        <form action={action} className="mt-2 grid gap-2 md:grid-cols-[10rem_1fr_auto] md:items-end">
          <input type="hidden" name="intent" value="close-appointment" />
          <input type="hidden" name="appointmentId" value={card.appointmentId} />
          <input type="hidden" name="expectedVersion" value={card.version} />
          {procedureKey ? <input type="hidden" name="procedureRequirement" value={procedureKey} /> : null}
          <SelectField name="outcome" label="Outcome" selectClassName={CONTROL} value={outcome} onValueChange={setOutcome} options={[{ value: "fulfilled", label: "Done" }, { value: "no-show", label: "Missed" }, { value: "cancelled", label: "Cancelled" }]} />
          {outcome === "fulfilled" && procedureKey ? (
            <div className="grid gap-2 md:grid-cols-2">
              <TextField name="provider" label="Vet who performed it" inputClassName={CONTROL} required value={provider} onValueChange={setProvider} maxLength={160} />
              {procedureKey === "sterilization" ? <TextField name="complication" label="Complication (leave blank if none)" inputClassName={CONTROL} value={complication} onValueChange={setComplication} maxLength={240} /> : <TextField name="product" label="Product" inputClassName={CONTROL} required value={reason} onValueChange={setReason} maxLength={120} />}
            </div>
          ) : outcome !== "fulfilled" ? (
            <TextField name="reason" label="Why" inputClassName={CONTROL} required value={reason} onValueChange={setReason} maxLength={400} />
          ) : <span />}
          <SubmitButton className={CONTROL} pending={pending} pendingLabel="Saving…">Close visit</SubmitButton>
        </form>
      ) : null}
    </li>
  );
}

export function VeterinaryOperations({ workspace, timeZone }: { workspace: VeterinaryWorkspace; timeZone: string }) {
  const [state, action, pending] = useActionState<CareActionResult | null, FormData>(manageCareAction, null);
  const [animalId, setAnimalId] = useState(workspace.animals[0]?.animalProfileId ?? "");
  const [kind, setKind] = useState("checkup");
  const [locationId, setLocationId] = useState(workspace.practices[0]?.locationId ?? "");
  const [visitDate, setVisitDate] = useState("");
  const [visitTime, setVisitTime] = useState("09:00");
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [arrangement, setArrangement] = useState("");
  const noAnimals = workspace.animals.length === 0;

  return (
    <section className="mt-5 space-y-4" aria-labelledby="vet-heading">
      <div>
        <h2 id="vet-heading" className="text-base font-semibold text-[var(--dpf-text)]">Veterinary visits</h2>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">A visit is booked at a partner practice with a recovery period. Until recovery ends the animal cannot be placed, and a done surgery goes straight onto the intake checklist.</p>
      </div>
      <FormStatus error={state && !state.ok ? state.error : null} success={state?.ok ? state.data.message : null} />

      <Surface as="section">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Booked and recovering</h3>
        {workspace.appointments.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-[var(--dpf-border)] p-4 text-sm text-[var(--dpf-muted)]">No visits are booked and no animal is in recovery.</p>
        ) : (
          <ul className="mt-3 space-y-3" aria-label="Veterinary visits">
            {workspace.appointments.map((card) => <AppointmentCard key={card.appointmentId} card={card} action={action} pending={pending} timeZone={timeZone} />)}
          </ul>
        )}
      </Surface>

      <Surface as="section">
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-[var(--dpf-text)]">Book a visit</summary>
          <form action={action} className="mt-3 grid gap-3 md:grid-cols-3" aria-label="Book a visit">
            <input type="hidden" name="intent" value="appointment" />
            <SelectField name="animalProfileId" label="Animal" selectClassName={CONTROL} required value={animalId} onValueChange={setAnimalId} options={workspace.animals.map((a) => ({ value: a.animalProfileId, label: `${a.name} · ${a.animalRef}` }))} placeholder={noAnimals ? "No animals in care" : undefined} disabled={noAnimals} />
            <SelectField name="kind" label="Kind of visit" selectClassName={CONTROL} required value={kind} onValueChange={setKind} options={VET_VISIT_KINDS.map((k) => ({ value: k, label: `${VET_VISIT_DEFAULTS[k].label}${VET_VISIT_DEFAULTS[k].recoveryMinutes ? ` · ${Math.round(VET_VISIT_DEFAULTS[k].recoveryMinutes / 1440)}d recovery` : ""}` }))} />
            <SelectField name="locationId" label="Practice" selectClassName={CONTROL} value={locationId} onValueChange={setLocationId} options={[{ value: "", label: "At the shelter" }, ...workspace.practices.map((p) => ({ value: p.locationId, label: p.name }))]} />
            <TextField name="visitDate" label="Date" inputClassName={CONTROL} type="date" required value={visitDate} onValueChange={setVisitDate} />
            <TextField name="visitTime" label="Time" inputClassName={CONTROL} type="time" required value={visitTime} onValueChange={setVisitTime} />
            <TextField name="note" label="Note" inputClassName={CONTROL} value={note} onValueChange={setNote} maxLength={200} placeholder="Fasting from midnight" />
            <div className="md:col-span-3">
              <SubmitButton className={CONTROL} pending={pending} pendingLabel="Booking…" disabled={noAnimals}>Book visit</SubmitButton>
            </div>
          </form>
        </details>
      </Surface>

      <Surface as="section">
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-[var(--dpf-text)]">Partner practices ({workspace.practices.length})</summary>
          {workspace.practices.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm text-[var(--dpf-muted)]" aria-label="Partner practices">
              {workspace.practices.map((p) => <li key={p.locationId}><span className="font-medium text-[var(--dpf-text)]">{p.name}</span>{p.contactName ? ` · ${p.contactName}` : ""}{p.phone ? ` · ${p.phone}` : ""}{p.arrangement ? ` · ${p.arrangement}` : ""}</li>)}
            </ul>
          ) : null}
          <form action={action} className="mt-3 grid gap-3 md:grid-cols-2" aria-label="Register a partner practice">
            <input type="hidden" name="intent" value="practice" />
            <TextField name="name" label="Practice name" inputClassName={CONTROL} required value={name} onValueChange={setName} maxLength={160} />
            <TextField name="contactName" label="Contact" inputClassName={CONTROL} value={contactName} onValueChange={setContactName} maxLength={160} />
            <TextField name="phone" label="Phone" inputClassName={CONTROL} type="tel" value={phone} onValueChange={setPhone} maxLength={40} />
            <TextField name="arrangement" label="Arrangement" inputClassName={CONTROL} value={arrangement} onValueChange={setArrangement} maxLength={240} placeholder="Charity rate, monthly account, £500 limit" />
            <div className="md:col-span-2">
              <SubmitButton className={CONTROL} pending={pending} pendingLabel="Registering…">Register practice</SubmitButton>
            </div>
          </form>
        </details>
      </Surface>
    </section>
  );
}
