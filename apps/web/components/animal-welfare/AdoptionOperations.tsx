"use client";

import { useActionState, useState } from "react";

import { manageAdoptionAction, type AdoptionActionResult } from "@/app/(shell)/workspace/rescue/adoptions/actions";
import { EmailField, FormStatus, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import { NEXT_STAGES, STAGE_LABEL, type AdoptionApplicationCard, type AdoptionWorkspace } from "@/lib/animal-welfare/adoption-vocabulary";
import { formatInstant } from "@/lib/datetime";
import { OWNER_FIRST_NEXT_ACTION_ATTR } from "@/lib/owner-first/ux-audit";

const CONTROL = "min-h-11";

function ApplicationCard({ card, action, pending, currency, timeZone }: { card: AdoptionApplicationCard; action: (payload: FormData) => void; pending: boolean; currency: string; timeZone: string }) {
  const options = NEXT_STAGES[card.status];
  const [to, setTo] = useState<string>(options[0]?.to ?? "");
  const [reason, setReason] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [visitTime, setVisitTime] = useState("10:00");
  const [feeAmount, setFeeAmount] = useState("");
  const [donorEmail, setDonorEmail] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const chosen = options.find((o) => o.to === to);
  const approving = chosen?.to === "approved";
  const blocked = approving && (!card.animalReady || card.animalOnHold || Boolean(card.reservedForOther));
  const badge = card.status === "approved" ? { intent: "success" as const, label: "Reserved" } : card.status === "waitlisted" ? { intent: "warning" as const, label: "Waitlisted" } : { intent: "neutral" as const, label: STAGE_LABEL[card.status] };
  return (
    <li className="rounded-lg border border-[var(--dpf-border)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{card.applicantName} for {card.animalName} <span className="font-mono text-xs font-normal text-[var(--dpf-muted)]">{card.applicationRef}</span></h3>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            Applied {formatInstant(card.submittedAt, { timeZone })}
            {card.nextVisitAt ? ` · visit ${formatInstant(card.nextVisitAt, { timeZone })}` : ""}
            {card.decisionReason ? ` · ${card.decisionReason}` : ""}
          </p>
        </div>
        <StatusBadge intent={badge.intent} label={badge.label} uppercase={false} />
      </div>
      {approving && blocked ? (
        <p className="mt-2 text-sm text-[var(--dpf-text)]">
          {card.reservedForOther ? `${card.animalName} is already reserved for ${card.reservedForOther}.` : card.animalOnHold ? `${card.animalName} is on a hold that a person must release first.` : `${card.animalName} is not placement-ready yet; finish the intake checklist first.`}
        </p>
      ) : null}
      {options.length > 0 ? (
        <form action={action} className="mt-3 grid gap-2 md:grid-cols-[12rem_1fr_auto] md:items-end">
          <input type="hidden" name="intent" value="transition" />
          <input type="hidden" name="applicationId" value={card.applicationId} />
          <input type="hidden" name="expectedVersion" value={card.version} />
          <SelectField name="to" label="Next step" selectClassName={CONTROL} value={to} onValueChange={setTo} options={options.map((o) => ({ value: o.to, label: STAGE_LABEL[o.to] }))} />
          {chosen?.needs === "visit" ? (
            <div className="grid grid-cols-2 gap-2">
              <TextField name="visitDate" label="Visit date" inputClassName={CONTROL} type="date" required value={visitDate} onValueChange={setVisitDate} />
              <TextField name="visitTime" label="Time" inputClassName={CONTROL} type="time" required value={visitTime} onValueChange={setVisitTime} />
            </div>
          ) : chosen?.needs === "reason" ? (
            <TextField name="reason" label="Reason" inputClassName={CONTROL} required value={reason} onValueChange={setReason} maxLength={400} />
          ) : <span />}
          <SubmitButton className={CONTROL} pending={pending} pendingLabel="Saving…" disabled={blocked}>{approving ? "Approve and reserve" : "Move on"}</SubmitButton>
        </form>
      ) : null}
      {card.status === "approved" && card.reservation?.status === "reserved" ? (
        <>
          <form action={action} className="mt-3 grid gap-2 rounded-md bg-[var(--dpf-surface-muted)] p-3 md:grid-cols-[8rem_1fr_auto] md:items-end">
            <input type="hidden" name="intent" value="place" />
            <input type="hidden" name="applicationId" value={card.applicationId} />
            <input type="hidden" name="expectedVersion" value={card.version} />
            <input type="hidden" name="currency" value={currency} />
            <TextField name="feeAmount" label={`Adoption donation (${currency})`} inputClassName={CONTROL} type="number" value={feeAmount} onValueChange={setFeeAmount} min={0} step={0.01} />
            <EmailField name="donorEmail" label="Adopter email for the receipt" inputClassName={CONTROL} required={feeAmount !== ""} value={donorEmail} onValueChange={setDonorEmail} />
            <span {...{ [OWNER_FIRST_NEXT_ACTION_ATTR]: "true" }}>
              <SubmitButton className={CONTROL} pending={pending} pendingLabel="Completing…">Complete adoption</SubmitButton>
            </span>
          </form>
          <details className="mt-2 rounded-md border border-[var(--dpf-border)] px-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-[var(--dpf-text)]">Cancel this reservation</summary>
            <form action={action} className="grid gap-2 pb-3 md:grid-cols-[1fr_auto] md:items-end">
              <input type="hidden" name="intent" value="cancel-reservation" />
              <input type="hidden" name="applicationId" value={card.applicationId} />
              <input type="hidden" name="expectedVersion" value={card.version} />
              <TextField name="reason" label="Why" inputClassName={CONTROL} required value={cancelReason} onValueChange={setCancelReason} maxLength={400} />
              <SubmitButton className={CONTROL} pending={pending} pendingLabel="Cancelling…">Cancel reservation</SubmitButton>
            </form>
          </details>
        </>
      ) : null}
    </li>
  );
}

export function AdoptionOperations({ workspace, timeZone }: { workspace: AdoptionWorkspace; timeZone: string }) {
  const [state, action, pending] = useActionState<AdoptionActionResult | null, FormData>(manageAdoptionAction, null);
  const [animalId, setAnimalId] = useState(workspace.animals[0]?.animalProfileId ?? "");
  const [applicantName, setApplicantName] = useState("");
  const [housing, setHousing] = useState("");
  const [otherPets, setOtherPets] = useState("");
  const [children, setChildren] = useState("");
  const [landlord, setLandlord] = useState("not-applicable");
  const [experience, setExperience] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [returnHousing, setReturnHousing] = useState(workspace.housing[0]?.id ?? "");

  return (
    <section className="mt-5 space-y-4" aria-labelledby="adoption-actions-heading">
      <div>
        <h2 id="adoption-actions-heading" className="text-base font-semibold text-[var(--dpf-text)]">Adoptions</h2>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">An application is screened, visited and approved before an animal is promised to anyone. Approval reserves the animal for one applicant. The fee is a donation toward that animal's care, and a returned animal always comes back with its history.</p>
      </div>
      <FormStatus error={state && !state.ok ? state.error : null} success={state?.ok ? state.data.message : null} />

      <Surface as="section">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Applications in progress</h3>
        {workspace.applications.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-[var(--dpf-border)] p-4 text-sm text-[var(--dpf-muted)]">No open applications. Record one below when an enquiry turns into a real applicant.</p>
        ) : (
          <ul className="mt-3 space-y-3" aria-label="Adoption applications">
            {workspace.applications.map((card) => <ApplicationCard key={card.applicationId} card={card} action={action} pending={pending} currency={workspace.currency} timeZone={timeZone} />)}
          </ul>
        )}
      </Surface>

      <Surface as="section">
        <details open={workspace.applications.length === 0}>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-[var(--dpf-text)]">Record an application</summary>
          <form action={action} className="mt-3 grid gap-3 md:grid-cols-2" aria-label="Record an application">
            <input type="hidden" name="intent" value="apply" />
            <SelectField name="animalProfileId" label="Animal" selectClassName={CONTROL} required value={animalId} onValueChange={setAnimalId} options={workspace.animals.map((a) => ({ value: a.animalProfileId, label: `${a.name} · ${a.animalRef}${a.ready ? "" : " (not yet placement-ready)"}` }))} placeholder={workspace.animals.length === 0 ? "No animals in care" : undefined} disabled={workspace.animals.length === 0} />
            <TextField name="applicantName" label="Applicant" inputClassName={CONTROL} required value={applicantName} onValueChange={setApplicantName} maxLength={160} />
            <TextField name="housing" label="Housing situation" inputClassName={CONTROL} required value={housing} onValueChange={setHousing} maxLength={240} placeholder="Owned house with fenced garden" />
            <TextField name="otherPets" label="Other pets" inputClassName={CONTROL} required value={otherPets} onValueChange={setOtherPets} maxLength={240} placeholder="None, or one neutered male cat" />
            <TextField name="children" label="Children in the home" inputClassName={CONTROL} required value={children} onValueChange={setChildren} maxLength={240} placeholder="None, or ages" />
            <SelectField name="landlordPermission" label="Landlord permission" selectClassName={CONTROL} value={landlord} onValueChange={setLandlord} options={[{ value: "not-applicable", label: "Not applicable (owns home)" }, { value: "yes", label: "Yes, in writing" }, { value: "no", label: "Not yet" }]} />
            <TextField name="experience" label="Experience with this kind of animal" inputClassName={CONTROL} required value={experience} onValueChange={setExperience} maxLength={400} />
            <div className="md:col-span-2">
              <SubmitButton className={CONTROL} pending={pending} pendingLabel="Recording…" disabled={workspace.animals.length === 0}>Record application</SubmitButton>
            </div>
          </form>
        </details>
      </Surface>

      {workspace.placements.length > 0 ? (
        <Surface as="section">
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-[var(--dpf-text)]">Record a return ({workspace.placements.length} placed animals)</summary>
            <ul className="mt-3 space-y-3" aria-label="Placed animals">
              {workspace.placements.map((p) => (
                <li key={p.placementId} className="rounded-lg border border-[var(--dpf-border)] p-3">
                  <p className="text-sm font-medium text-[var(--dpf-text)]">{p.animalName} <span className="font-mono text-xs font-normal text-[var(--dpf-muted)]">{p.animalRef}</span>{p.adopterName ? ` · with ${p.adopterName}` : ""}{p.placedAt ? ` since ${formatInstant(p.placedAt, { timeZone })}` : ""}</p>
                  <form action={action} className="mt-2 grid gap-2 md:grid-cols-[1fr_12rem_auto] md:items-end">
                    <input type="hidden" name="intent" value="return" />
                    <input type="hidden" name="placementId" value={p.placementId} />
                    <input type="hidden" name="expectedVersion" value={p.version} />
                    <TextField name="reason" label="Why is the animal coming back" inputClassName={CONTROL} required value={returnReason} onValueChange={setReturnReason} maxLength={400} />
                    <SelectField name="housingResourceId" label="House in" selectClassName={CONTROL} value={returnHousing} onValueChange={setReturnHousing} options={[{ value: "", label: "Decide on the board" }, ...workspace.housing.map((h) => ({ value: h.id, label: `${h.label} · ${h.available} open` }))]} />
                    <SubmitButton className={CONTROL} pending={pending} pendingLabel="Recording…">Take back</SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        </Surface>
      ) : null}
    </section>
  );
}
