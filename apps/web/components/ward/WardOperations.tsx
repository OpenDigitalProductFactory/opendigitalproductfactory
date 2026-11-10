"use client";

import { useActionState, useState } from "react";

import { manageHousingAction, type HousingActionResult } from "@/app/(shell)/workspace/ward/actions";
import {
  ConsequenceNotice,
  FormStatus,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/ui/form";
import { OWNER_FIRST_NEXT_ACTION_ATTR } from "@/lib/owner-first/ux-audit";

const OPERATIONAL_CONTROL_CLASS = "min-h-11";

export interface WardOperationAnimal {
  animalRef: string;
  name: string;
  allocationId: string | null;
  resourceId: string | null;
}

export interface WardOperationResource {
  id: string;
  label: string;
  kindSlug: string;
  capacity: number;
  occupied: number;
  available: number;
  blockedReason: string | null;
  version: number;
}

function ResourceEditor({
  action,
  pending,
  resource,
}: {
  action: (payload: FormData) => void;
  pending: boolean;
  resource: WardOperationResource;
}) {
  const [label, setLabel] = useState(resource.label);
  const [capacity, setCapacity] = useState(String(resource.capacity));

  return (
    <form action={action} className="grid gap-3 rounded-md bg-[var(--dpf-surface-muted)] p-3 md:grid-cols-[1fr_8rem_auto] md:items-end">
      <input type="hidden" name="intent" value="update" />
      <input type="hidden" name="resourceId" value={resource.id} />
      <input type="hidden" name="expectedVersion" value={resource.version} />
      <TextField
        name="label"
        label="Housing label"
        inputClassName={OPERATIONAL_CONTROL_CLASS}
        required
        value={label}
        onValueChange={setLabel}
        maxLength={120}
      />
      <TextField
        name="capacity"
        label="Capacity"
        inputClassName={OPERATIONAL_CONTROL_CLASS}
        type="number"
        required
        value={capacity}
        onValueChange={setCapacity}
        min={1}
        max={resource.kindSlug === "foster-home" ? 12 : 100}
      />
      <SubmitButton className={OPERATIONAL_CONTROL_CLASS} pending={pending} pendingLabel="Saving…">
        Save changes
      </SubmitButton>
    </form>
  );
}

export function WardOperations({
  animals,
  resources,
}: {
  animals: WardOperationAnimal[];
  resources: WardOperationResource[];
}) {
  const [state, action, pending] = useActionState<HousingActionResult | null, FormData>(
    manageHousingAction,
    null,
  );
  const destinations = resources.filter((resource) => resource.available > 0 && !resource.blockedReason);
  const placed = animals.filter((animal) => animal.allocationId && animal.resourceId);
  const [animalRef, setAnimalRef] = useState(animals[0]?.animalRef ?? "");
  const [destinationId, setDestinationId] = useState(destinations[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [kindSlug, setKindSlug] = useState("kennel");
  const [serviceArea, setServiceArea] = useState("");
  const [capacity, setCapacity] = useState("1");

  return (
    <section className="space-y-4" aria-labelledby="ward-actions-heading">
      <div>
        <h2 id="ward-actions-heading" className="text-base font-semibold text-[var(--dpf-text)]">
          Housing actions
        </h2>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          Place or move an animal now. Set up or pause housing only when the roster changes.
        </p>
      </div>

      <FormStatus
        error={state && !state.ok ? state.error : null}
        success={state?.ok ? state.data.message : null}
      />

      <form action={action} className="grid gap-3 rounded-lg border border-[var(--dpf-border)] p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <input type="hidden" name="intent" value="place" />
        <SelectField
          name="animalRef"
          label="Animal"
          selectClassName={OPERATIONAL_CONTROL_CLASS}
          required
          value={animalRef}
          onValueChange={setAnimalRef}
          options={animals.map((animal) => ({ value: animal.animalRef, label: animal.name }))}
          placeholder={animals.length === 0 ? "No animals in care" : undefined}
          disabled={animals.length === 0}
        />
        <SelectField
          name="destinationResourceId"
          label="Open housing"
          selectClassName={OPERATIONAL_CONTROL_CLASS}
          required
          value={destinationId}
          onValueChange={setDestinationId}
          options={destinations.map((resource) => ({
            value: resource.id,
            label: `${resource.label} · ${resource.available} open`,
          }))}
          placeholder={destinations.length === 0 ? "No open housing" : undefined}
          disabled={destinations.length === 0}
        />
        <span {...{ [OWNER_FIRST_NEXT_ACTION_ATTR]: "true" }}>
          <SubmitButton
            className={OPERATIONAL_CONTROL_CLASS}
            pending={pending}
            pendingLabel="Saving placement…"
            disabled={animals.length === 0 || destinations.length === 0}
          >
            Place or move
          </SubmitButton>
        </span>
        {destinations.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)] md:col-span-3">
            No open housing destination. Unblock a unit, add capacity, or release a stay.
          </p>
        ) : null}
      </form>

      {placed.length > 0 ? (
        <details className="rounded-lg border border-[var(--dpf-border)] px-4 py-2">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-[var(--dpf-text)]">
            Release a current stay
          </summary>
          <div className="flex flex-wrap gap-2 pb-2" aria-label="Current stays">
            {placed.map((animal) => (
              <form action={action} key={animal.animalRef}>
                <input type="hidden" name="intent" value="release" />
                <input type="hidden" name="allocationId" value={animal.allocationId ?? ""} />
                <input type="hidden" name="resourceId" value={animal.resourceId ?? ""} />
                <input type="hidden" name="reason" value="left-care" />
                <SubmitButton
                  className={OPERATIONAL_CONTROL_CLASS}
                  pending={pending}
                  pendingLabel={`Releasing ${animal.name}…`}
                >
                  Release {animal.name}
                </SubmitButton>
              </form>
            ))}
          </div>
        </details>
      ) : null}

      <details className="rounded-lg border border-[var(--dpf-border)] p-4">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-[var(--dpf-text)]">
          Housing setup
        </summary>
        <form action={action} className="mt-3 grid gap-3 md:grid-cols-2">
          <input type="hidden" name="intent" value="create" />
          <TextField
            name="label"
            label="Label"
            inputClassName={OPERATIONAL_CONTROL_CLASS}
            required
            value={label}
            onValueChange={setLabel}
            maxLength={120}
            placeholder="D4 or Northside foster"
          />
          <SelectField
            name="kindSlug"
            label="Kind"
            selectClassName={OPERATIONAL_CONTROL_CLASS}
            required
            value={kindSlug}
            onValueChange={setKindSlug}
            options={[{ value: "kennel", label: "Kennel" }, { value: "foster-home", label: "Foster home" }]}
          />
          <TextField
            name="serviceArea"
            label="Area"
            inputClassName={OPERATIONAL_CONTROL_CLASS}
            optional
            value={serviceArea}
            onValueChange={setServiceArea}
            maxLength={120}
            placeholder="Dog ward or Foster network"
          />
          <TextField
            name="capacity"
            label="Animal capacity"
            inputClassName={OPERATIONAL_CONTROL_CLASS}
            type="number"
            required
            value={capacity}
            onValueChange={setCapacity}
            min={1}
            max={kindSlug === "foster-home" ? 12 : 100}
          />
          <div className="md:col-span-2">
            <SubmitButton className={OPERATIONAL_CONTROL_CLASS} pending={pending} pendingLabel="Adding housing…">
              Add housing
            </SubmitButton>
          </div>
        </form>

        {resources.length > 0 ? (
          <ul className="mt-4 divide-y divide-[var(--dpf-border)]">
            {resources.map((resource) => (
              <li key={resource.id} className="grid gap-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--dpf-text)]">{resource.label}</p>
                    <p className="text-xs text-[var(--dpf-muted)]">
                      {resource.kindSlug === "foster-home" ? "Foster home" : "Kennel"} · {resource.occupied}/{resource.capacity}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <form action={action}>
                      <input type="hidden" name="intent" value={resource.blockedReason ? "unblock" : "block"} />
                      <input type="hidden" name="resourceId" value={resource.id} />
                      <input type="hidden" name="expectedVersion" value={resource.version} />
                      <input type="hidden" name="blockedReason" value="Out of service" />
                      <SubmitButton className={OPERATIONAL_CONTROL_CLASS} pending={pending} pendingLabel="Updating…">
                        {resource.blockedReason ? "Return to service" : "Pause use"}
                      </SubmitButton>
                    </form>
                    <form action={action}>
                      <input type="hidden" name="intent" value="retire" />
                      <input type="hidden" name="resourceId" value={resource.id} />
                      <input type="hidden" name="expectedVersion" value={resource.version} />
                      <ConsequenceNotice
                        summary={`Retiring ${resource.label} removes it from new placements.`}
                        what="The resource is retained with a retired lifecycle."
                        who="Ward operators and animals needing a new destination."
                        reversibility="A later governed update can restore it."
                        recovery="Review current stays before retiring the resource."
                        tone="warning"
                      />
                      <SubmitButton className={OPERATIONAL_CONTROL_CLASS} pending={pending} pendingLabel="Retiring…">
                        Retire
                      </SubmitButton>
                    </form>
                  </div>
                </div>
                <ResourceEditor action={action} pending={pending} resource={resource} />
              </li>
            ))}
          </ul>
        ) : null}
      </details>
    </section>
  );
}
