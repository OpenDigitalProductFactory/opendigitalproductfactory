"use client";

import { useActionState, useState } from "react";

import { manageIntakeAction, type IntakeActionResult } from "@/app/(shell)/workspace/rescue/intake/actions";
import { FormStatus, SelectField, SubmitButton, TextField, TextareaField } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import type { IntakeQueueEntry, IntakeWorkspace } from "@/lib/animal-welfare/intake-workspace";
import { formatInstant } from "@/lib/datetime";
import { OWNER_FIRST_NEXT_ACTION_ATTR } from "@/lib/owner-first/ux-audit";

const CONTROL = "min-h-11";

const INTAKE_TYPES = [
  { value: "stray", label: "Stray" },
  { value: "owner-relinquished", label: "Owner relinquished" },
  { value: "transfer-in", label: "Transfer in" },
  { value: "born-in-care", label: "Born in care" },
  { value: "return", label: "Return" },
  { value: "seizure-confiscate", label: "Seizure or confiscation" },
  { value: "other", label: "Other" },
];

const REQUIREMENTS = [
  { value: "identity-check", label: "Identity and microchip check" },
  { value: "intake-examination", label: "Intake examination" },
  { value: "weight-condition", label: "Weight and body condition" },
  { value: "vaccination", label: "Vaccination" },
  { value: "parasite-treatment", label: "Parasite treatment" },
  { value: "sterilization", label: "Sterilization" },
  { value: "behaviour-assessment", label: "Behaviour assessment" },
] as const;

type RequirementKey = (typeof REQUIREMENTS)[number]["value"];

const GROUP_LABEL: Record<IntakeQueueEntry["group"], { label: string; intent: "danger" | "warning" | "neutral" | "success" }> = {
  blocked: { label: "Blocked", intent: "danger" },
  assessment: { label: "In assessment", intent: "neutral" },
  recovery: { label: "Recovering", intent: "warning" },
  ready: { label: "Ready to verify", intent: "success" },
};

function readable(value: string) {
  return value.replaceAll("-", " ").replaceAll("_", " ");
}

function EvidenceFields({ requirement }: { requirement: RequirementKey }) {
  const [provider, setProvider] = useState("");
  const [outcome, setOutcome] = useState("");
  const [product, setProduct] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("kg");
  const [procedureOutcome, setProcedureOutcome] = useState("completed");
  const [recoveryUntil, setRecoveryUntil] = useState("");
  const [complication, setComplication] = useState("");
  const [scanned, setScanned] = useState("yes");
  const [chip, setChip] = useState("");
  const providerLabel = requirement === "identity-check" || requirement === "behaviour-assessment" ? "Checked by" : "Provider";
  return (
    <>
      {requirement !== "weight-condition" ? (
        <TextField name="provider" label={providerLabel} inputClassName={CONTROL} required value={provider} onValueChange={setProvider} maxLength={160} />
      ) : null}
      {requirement === "identity-check" ? (
        <>
          <SelectField name="microchipScanned" label="Microchip scanned" selectClassName={CONTROL} required value={scanned} onValueChange={setScanned} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No chip found" }]} />
          <TextField name="microchipNumber" label="Microchip number" inputClassName={CONTROL} value={chip} onValueChange={setChip} maxLength={40} />
        </>
      ) : null}
      {requirement === "intake-examination" || requirement === "behaviour-assessment" || requirement === "parasite-treatment" ? (
        <TextareaField name="outcome" label={requirement === "intake-examination" ? "Findings" : "Outcome"} required value={outcome} onValueChange={setOutcome} rows={2} />
      ) : null}
      {requirement === "vaccination" || requirement === "parasite-treatment" ? (
        <TextField name="product" label="Product" inputClassName={CONTROL} required value={product} onValueChange={setProduct} maxLength={120} />
      ) : null}
      {requirement === "weight-condition" ? (
        <>
          <TextField name="value" label="Weight" inputClassName={CONTROL} type="number" required value={value} onValueChange={setValue} min={0.01} step={0.01} />
          <SelectField name="unit" label="Unit" selectClassName={CONTROL} required value={unit} onValueChange={setUnit} options={[{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }]} />
        </>
      ) : null}
      {requirement === "sterilization" ? (
        <>
          <SelectField name="procedureOutcome" label="Outcome" selectClassName={CONTROL} required value={procedureOutcome} onValueChange={setProcedureOutcome} options={[{ value: "completed", label: "Completed" }, { value: "previously-verified", label: "Previously verified" }, { value: "complication", label: "Complication" }]} />
          <TextField name="recoveryUntil" label="Recovery until" inputClassName={CONTROL} type="date" value={recoveryUntil} onValueChange={setRecoveryUntil} />
          {procedureOutcome === "complication" ? (
            <TextareaField name="complication" label="Complication" required value={complication} onValueChange={setComplication} rows={2} />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function AnimalCard({ entry, action, pending }: { entry: IntakeQueueEntry; action: (payload: FormData) => void; pending: boolean }) {
  const [requirement, setRequirement] = useState<RequirementKey>(
    (entry.checklist.missing.find((key) => key !== "housing") as RequirementKey | undefined) ?? "identity-check",
  );
  const [holdReason, setHoldReason] = useState("");
  const group = GROUP_LABEL[entry.group];
  return (
    <li className="rounded-lg border border-[var(--dpf-border)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
            {entry.name} <span className="font-mono text-xs font-normal text-[var(--dpf-muted)]">{entry.animalRef}</span>
          </h3>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            {readable(entry.intakeType)} · arrived {formatInstant(entry.openedAt)} · stage {readable(entry.stage)}
            {entry.housingLabel ? ` · housed in ${entry.housingLabel}` : " · no housing recorded"}
          </p>
        </div>
        <StatusBadge intent={group.intent} label={group.label} uppercase={false} />
      </div>

      <p className="mt-3 text-sm text-[var(--dpf-text)]">
        Checklist {entry.checklist.satisfied} of {entry.checklist.total} complete.
      </p>
      {entry.readiness.blockers.length > 0 ? (
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[var(--dpf-muted)]" aria-label={`Why ${entry.name} is not placement-ready`}>
          {entry.readiness.blockers.map((blocker) => (
            <li key={`${blocker.code}:${blocker.requirementKey ?? ""}:${blocker.recordIds.join(",")}`}>{blocker.message}</li>
          ))}
        </ul>
      ) : null}

      {entry.holdActive ? (
        <form action={action} className="mt-3 grid gap-3 rounded-md bg-[var(--dpf-surface-muted)] p-3 md:grid-cols-[1fr_auto] md:items-end">
          <input type="hidden" name="intent" value="release-hold" />
          <input type="hidden" name="animalProfileId" value={entry.animalProfileId} />
          <input type="hidden" name="expectedVersion" value={entry.version} />
          <TextField name="reason" label={`Release hold${entry.holdReason ? ` (${entry.holdReason})` : ""}`} inputClassName={CONTROL} required value={holdReason} onValueChange={setHoldReason} maxLength={240} placeholder="Hold period elapsed; owner not found" />
          <SubmitButton className={CONTROL} pending={pending} pendingLabel="Releasing…">Release hold</SubmitButton>
        </form>
      ) : null}

      <details className="mt-3 rounded-md border border-[var(--dpf-border)] px-3">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-[var(--dpf-text)]">Record checklist evidence</summary>
        <form action={action} className="grid gap-3 pb-3 md:grid-cols-2" key={requirement}>
          <input type="hidden" name="intent" value="evidence" />
          <input type="hidden" name="animalProfileId" value={entry.animalProfileId} />
          <SelectField name="requirementKey" label="Requirement" selectClassName={CONTROL} required value={requirement} onValueChange={(value) => setRequirement(value as RequirementKey)} options={REQUIREMENTS.map((r) => ({ value: r.value, label: r.label }))} />
          <EvidenceFields requirement={requirement} />
          <div className="md:col-span-2">
            <SubmitButton className={CONTROL} pending={pending} pendingLabel="Saving evidence…">Save evidence</SubmitButton>
          </div>
        </form>
      </details>

      {entry.readiness.ready ? (
        <form action={action} className="mt-3">
          <input type="hidden" name="intent" value="mark-ready" />
          <input type="hidden" name="animalProfileId" value={entry.animalProfileId} />
          <input type="hidden" name="expectedVersion" value={entry.version} />
          <span {...{ [OWNER_FIRST_NEXT_ACTION_ATTR]: "true" }}>
            <SubmitButton className={CONTROL} pending={pending} pendingLabel="Verifying…">Verify placement readiness</SubmitButton>
          </span>
        </form>
      ) : null}
    </li>
  );
}

export function IntakeOperations({ workspace }: { workspace: IntakeWorkspace }) {
  const [state, action, pending] = useActionState<IntakeActionResult | null, FormData>(manageIntakeAction, null);
  const [existingId, setExistingId] = useState("");
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("dog");
  const [breed, setBreed] = useState("");
  const [sex, setSex] = useState("");
  const [microchip, setMicrochip] = useState("");
  const [intakeType, setIntakeType] = useState("stray");
  const [sourceName, setSourceName] = useState("");
  const [housingId, setHousingId] = useState(workspace.housing[0]?.id ?? "");
  const [holdKind, setHoldKind] = useState("none");
  const [holdSource, setHoldSource] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [holdUntil, setHoldUntil] = useState("");
  const noHousing = workspace.housing.length === 0;

  return (
    <section className="mt-5 space-y-4" aria-labelledby="intake-actions-heading">
      <div>
        <h2 id="intake-actions-heading" className="text-base font-semibold text-[var(--dpf-text)]">Admit an animal</h2>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          An admission opens custody, freezes the intake checklist and places the animal in housing in one step. Nothing becomes adoptable until the checklist is verified.
        </p>
      </div>
      <FormStatus error={state && !state.ok ? state.error : null} success={state?.ok ? state.data.message : null} />

      <Surface as="section">
      <form action={action} className="grid gap-3 md:grid-cols-2" aria-label="Admit an animal">
        <input type="hidden" name="intent" value="admit" />
        {workspace.existingAnimals.length > 0 ? (
          <SelectField name="existingAnimalProfileId" label="Returning animal" selectClassName={CONTROL} value={existingId} onValueChange={setExistingId} options={[{ value: "", label: "New animal" }, ...workspace.existingAnimals.map((a) => ({ value: a.animalProfileId, label: `${a.name} · ${a.animalRef}` }))]} />
        ) : null}
        {!existingId ? (
          <>
            <TextField name="name" label="Name" inputClassName={CONTROL} required value={name} onValueChange={setName} maxLength={120} />
            <SelectField name="species" label="Species" selectClassName={CONTROL} required value={species} onValueChange={setSpecies} options={[{ value: "dog", label: "Dog" }, { value: "cat", label: "Cat" }, { value: "rabbit", label: "Rabbit" }, { value: "other", label: "Other" }]} />
            <details className="md:col-span-2 rounded-md border border-[var(--dpf-border)] px-3">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-[var(--dpf-text)]">More identity details (breed, sex, microchip)</summary>
              <div className="grid gap-3 pb-3 md:grid-cols-3">
                <TextField name="breed" label="Breed" inputClassName={CONTROL} value={breed} onValueChange={setBreed} maxLength={120} />
                <SelectField name="sex" label="Sex" selectClassName={CONTROL} value={sex} onValueChange={setSex} options={[{ value: "", label: "Unknown" }, { value: "female", label: "Female" }, { value: "male", label: "Male" }]} />
                <TextField name="microchipNumber" label="Microchip number" inputClassName={CONTROL} value={microchip} onValueChange={setMicrochip} maxLength={40} />
              </div>
            </details>
          </>
        ) : null}
        <SelectField name="intakeType" label="Intake source" selectClassName={CONTROL} required value={intakeType} onValueChange={setIntakeType} options={INTAKE_TYPES} />
        <TextField name="sourceName" label="Where from" inputClassName={CONTROL} value={sourceName} onValueChange={setSourceName} maxLength={160} placeholder="Finder, owner, or transferring shelter" />
        <SelectField name="initialHousingResourceId" label="Housing" selectClassName={CONTROL} required value={housingId} onValueChange={setHousingId} options={workspace.housing.map((h) => ({ value: h.id, label: `${h.label} · ${h.available} open` }))} placeholder={noHousing ? "No open housing" : undefined} disabled={noHousing} />
        <SelectField name="holdKind" label="Hold" selectClassName={CONTROL} value={holdKind} onValueChange={setHoldKind} options={[{ value: "none", label: "No hold" }, { value: "legal", label: "Legal hold" }, { value: "policy", label: "Policy hold" }]} />
        {holdKind !== "none" ? (
          <>
            <TextField name="holdSource" label="Hold source" inputClassName={CONTROL} required value={holdSource} onValueChange={setHoldSource} maxLength={160} placeholder="Ordinance, contract, or policy" />
            <TextField name="holdReason" label="Hold reason" inputClassName={CONTROL} required value={holdReason} onValueChange={setHoldReason} maxLength={240} />
            <TextField name="holdUntil" label="Hold until" inputClassName={CONTROL} type="date" value={holdUntil} onValueChange={setHoldUntil} />
          </>
        ) : null}
        <div className="md:col-span-2">
          <span {...{ [OWNER_FIRST_NEXT_ACTION_ATTR]: "true" }}>
            <SubmitButton className={CONTROL} pending={pending} pendingLabel="Admitting…" disabled={noHousing}>Admit and house</SubmitButton>
          </span>
          {noHousing ? (
            <p className="mt-2 text-sm text-[var(--dpf-muted)]">No open housing. Add or unblock a unit on the housing board before admitting.</p>
          ) : null}
        </div>
      </form>
      </Surface>

      <Surface as="section">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Animals in intake</h2>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">Showing up to {workspace.limit} open admissions, blocked first.</p>
        {workspace.entries.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-[var(--dpf-border)] p-4 text-sm text-[var(--dpf-muted)]">No animals are in intake.</p>
        ) : (
          <ul className="mt-4 space-y-3" aria-label="Intake queue">
            {workspace.entries.map((entry) => <AnimalCard key={entry.episodeRef} entry={entry} action={action} pending={pending} />)}
          </ul>
        )}
      </Surface>
    </section>
  );
}
