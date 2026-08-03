"use client";

import { useMemo, useState } from "react";
import {
  FormStatus,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/ui/form";
import { SaveStateIndicator } from "@/components/ui/SaveStateIndicator";
import { useSaveState } from "@/lib/shared/use-save-state";
import type { RentalPhysicalProfile } from "@/lib/storefront/rental-physical-profile";
import { MediaUploader } from "./MediaUploader";
import { RentalPhysicalEditor } from "./RentalPhysicalEditor";

interface MediaItem {
  attachmentId: string;
  assetId: string;
  url: string;
  altText: string | null;
  caption: string | null;
}

interface AdminUnit {
  id: string;
  unitId: string;
  storefrontItemId: string;
  label: string;
  unitRef: string | null;
  status: string;
  physicalProfile: RentalPhysicalProfile;
  media: MediaItem[];
}

interface RentalClass {
  id: string;
  name: string;
  poolCapacity: number;
}

interface UnitIdentity {
  label: string;
  unitRef: string;
  status: string;
}

const UNIT_STATUS_OPTIONS = [
  "available", "reserved", "out", "returned", "maintenance", "retired",
].map((value) => ({ value, label: value }));

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" ? message : fallback;
}

function RentalPoolCapacityEditor({
  rentalClass,
  disabled,
}: {
  rentalClass: RentalClass;
  disabled: boolean;
}) {
  const save = useSaveState({
    value: rentalClass.poolCapacity,
    resetKey: rentalClass.id,
    debounceMs: 400,
    failureMessage: "Could not save quantity-pool stock.",
    async onSave(poolCapacity) {
      const response = await fetch("/api/storefront/admin/units", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storefrontItemId: rentalClass.id, poolCapacity }),
      });
      if (response.ok) return { ok: true };
      return { ok: false, error: errorMessage(await response.json().catch(() => null), "Could not update pool stock.") };
    },
  });
  if (disabled) return null;
  return (
    <div className="flex min-w-48 flex-col gap-1">
      <TextField name={`${rentalClass.id}-pool-capacity`} label="Quantity-pool stock"
        type="number" min={0} value={String(save.value)}
        onValueChange={(value) => save.change(Math.max(0, Number(value) || 0))} />
      <SaveStateIndicator compact status={save.status} error={save.error}
        onRetry={save.retry} onRevert={save.revert} />
    </div>
  );
}

function UnitIdentityEditor({
  unit,
  onPersisted,
  onDelete,
}: {
  unit: AdminUnit;
  onPersisted: (identity: UnitIdentity) => void;
  onDelete: () => Promise<void>;
}) {
  const identity = useMemo<UnitIdentity>(() => ({
    label: unit.label,
    unitRef: unit.unitRef ?? "",
    status: unit.status,
  }), [unit.label, unit.unitRef, unit.status]);
  const save = useSaveState({
    value: identity,
    resetKey: unit.id,
    debounceMs: 400,
    failureMessage: "Could not save the unit identity or status.",
    async onSave(next) {
      const response = await fetch(`/api/storefront/admin/units/${unit.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) {
        return { ok: false, error: errorMessage(await response.json().catch(() => null), "Could not update this unit.") };
      }
      onPersisted(next);
      return { ok: true };
    },
  });
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="grid items-end gap-3 md:grid-cols-[minmax(12rem,2fr)_minmax(10rem,1fr)_minmax(9rem,1fr)_auto]">
      <TextField name={`${unit.id}-label`} label="Unit label" required autoComplete="off"
        value={save.value.label}
        onValueChange={(label) => save.change({ ...save.value, label })} />
      <TextField name={`${unit.id}-reference`} label="Serial / plate" optional autoComplete="off"
        value={save.value.unitRef}
        onValueChange={(unitRef) => save.change({ ...save.value, unitRef })} />
      <SelectField name={`${unit.id}-status`} label="Lifecycle status"
        value={save.value.status} options={UNIT_STATUS_OPTIONS}
        onValueChange={(status) => save.change({ ...save.value, status })} />
      <SubmitButton type="button" pending={deleting} pendingLabel="Removing…"
        className="border border-[var(--dpf-border)] bg-transparent text-[var(--dpf-error)]"
        onClick={() => {
          setDeleting(true);
          void onDelete().finally(() => setDeleting(false));
        }}>
        Delete
      </SubmitButton>
      <SaveStateIndicator compact className="md:col-span-4" status={save.status}
        error={save.error} onRetry={save.retry} onRevert={save.revert} />
    </div>
  );
}

export function UnitsManager({
  archetypeId,
  classes,
  units: initial,
}: {
  archetypeId: string;
  classes: RentalClass[];
  units: AdminUnit[];
}) {
  const [units, setUnits] = useState(initial);
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [unitRef, setUnitRef] = useState("");
  const [site, setSite] = useState("");
  const [zone, setZone] = useState("");
  const [position, setPosition] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(null as string | null);

  const byClass = useMemo(() => {
    const map = new Map<string, AdminUnit[]>();
    for (const unit of units) map.set(unit.storefrontItemId, [...(map.get(unit.storefrontItemId) ?? []), unit]);
    return map;
  }, [units]);
  const defaultKind = archetypeId === "self-storage"
    ? "self-storage"
    : archetypeId === "production-equipment-rental" ? "production-kit" : "equipment";
  const summary = useMemo(() => ({
    total: units.length,
    ready: units.filter((unit) => unit.status === "available" && unit.physicalProfile.readiness === "ready").length,
    committed: units.filter((unit) => ["reserved", "out"].includes(unit.status)).length,
    attention: units.filter((unit) =>
      unit.status === "returned" || unit.status === "maintenance" || unit.physicalProfile.readiness !== "ready").length,
  }), [units]);

  function newPhysicalProfile(): RentalPhysicalProfile {
    const location = site || zone || position ? {
      ...(site ? { site } : {}), ...(zone ? { zone } : {}), ...(position ? { position } : {}),
    } : undefined;
    if (defaultKind === "self-storage") return {
      version: 1, kind: "self-storage", readiness: "ready", capabilityKeys: [],
      occupancy: "vacant", accessState: "pending", waitlistCount: 0, location,
    };
    if (defaultKind === "production-kit") return {
      version: 1, kind: "production-kit", readiness: "ready", capabilityKeys: [],
      requiredItemCount: 0, readyItemCount: 0, pickupWindowMinutes: 0, returnWindowMinutes: 0, location,
    };
    return {
      version: 1, kind: "equipment", readiness: "ready", capabilityKeys: [],
      pickupWindowMinutes: 0, returnWindowMinutes: 0, location,
    };
  }

  async function createUnit() {
    if (!classId || !label.trim()) {
      setError("Choose a rental class and enter a unit label.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/storefront/admin/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storefrontItemId: classId, label, unitRef, physicalProfile: newPhysicalProfile() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(errorMessage(body, "Could not add this rental unit."));
        return;
      }
      setUnits((current) => [...current, body as AdminUnit]);
      setLabel("");
      setUnitRef("");
      setPosition("");
      setSuccess("Unit added to physical capacity.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteUnit(id: string) {
    const response = await fetch(`/api/storefront/admin/units/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setError(errorMessage(await response.json().catch(() => null), "Could not remove this unit."));
      return;
    }
    setUnits((current) => current.filter((unit) => unit.id !== id));
  }

  if (classes.length === 0) {
    return <p className="max-w-2xl text-dpf-body text-[var(--dpf-muted)]">
        Add a rental item in Items first.
    </p>;
  }

  return (
    <div className="flex max-w-6xl flex-col gap-dpf-lg">
      <header data-dpf-lead>
        <h1 className="text-dpf-heading font-dpf-semibold text-[var(--dpf-text)]">Physical capacity</h1>
        <p className="mt-1 max-w-3xl text-dpf-body text-[var(--dpf-muted)]">
          Track location, readiness, and stock.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-dpf-sm md:grid-cols-4" aria-label="Fleet summary">
        {[["Units", summary.total], ["Ready", summary.ready],
          ["Committed", summary.committed], ["Attention", summary.attention]].map(([title, value]) => (
          <div key={title} className="rounded-dpf-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-md">
            <div className="text-dpf-title font-dpf-semibold tabular-nums text-[var(--dpf-text)]">{value}</div>
            <div className="mt-1 text-dpf-caption font-dpf-medium uppercase tracking-wide text-[var(--dpf-muted)]">{title}</div>
          </div>
        ))}
      </div>

      <form className="rounded-dpf-xl border border-[var(--dpf-border)] p-dpf-md"
        onSubmit={(event) => { event.preventDefault(); void createUnit(); }}>
        <div className="grid items-end gap-dpf-sm md:grid-cols-3">
          <SelectField name="rental-class" label="Rental class" required value={classId}
            options={classes.map((item) => ({ value: item.id, label: item.name }))} onValueChange={setClassId} />
          <TextField name="unit-label" label="Unit label" required autoComplete="off"
            value={label} placeholder="Excavator #2" onValueChange={setLabel} />
          <TextField name="unit-reference" label="Serial / plate" optional autoComplete="off"
            value={unitRef} onValueChange={setUnitRef} />
          <TextField name="unit-site" label="Site / facility" optional autoComplete="off"
            value={site} placeholder="North Yard" onValueChange={setSite} />
          <TextField name="unit-zone" label="Zone / floor" optional autoComplete="off"
            value={zone} placeholder="Ready line" onValueChange={setZone} />
          <TextField name="unit-position" label="Bay / unit" optional autoComplete="off"
            value={position} placeholder="Bay 4" onValueChange={setPosition} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-dpf-sm">
          <SubmitButton pending={busy} pendingLabel="Adding unit…" data-dpf-primary-action>Add unit</SubmitButton>
          <FormStatus error={error} success={success} />
        </div>
      </form>

      {classes.map((rentalClass) => {
        const list = byClass.get(rentalClass.id) ?? [];
        return (
          <section key={rentalClass.id} className="space-y-3" aria-labelledby={`${rentalClass.id}-heading`}>
            <div className="flex flex-wrap items-end justify-between gap-dpf-sm">
              <div>
                <h2 id={`${rentalClass.id}-heading`} className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]">{rentalClass.name}</h2>
                <p className="text-dpf-caption text-[var(--dpf-muted)]">{list.length} serialized unit{list.length === 1 ? "" : "s"}</p>
              </div>
              <RentalPoolCapacityEditor rentalClass={rentalClass} disabled={list.length > 0} />
            </div>
            {list.length === 0 && rentalClass.poolCapacity === 0 && (
              <div className="rounded-dpf-lg border border-dashed border-[var(--dpf-border)] p-dpf-md text-dpf-body text-[var(--dpf-muted)]">
                Add units or set pooled stock.
              </div>
            )}
            {list.map((unit) => (
              <article key={unit.id} className="space-y-4 rounded-dpf-xl border border-[var(--dpf-border)] p-dpf-md">
                <UnitIdentityEditor unit={unit}
                  onPersisted={(identity) => setUnits((current) => current.map((item) =>
                    item.id === unit.id ? { ...item, ...identity, unitRef: identity.unitRef || null } : item))}
                  onDelete={() => deleteUnit(unit.id)} />
                <RentalPhysicalEditor unitId={unit.id} profile={unit.physicalProfile}
                  onPersisted={(physicalProfile) => setUnits((current) => current.map((item) =>
                    item.id === unit.id ? { ...item, physicalProfile } : item))} />
                <MediaUploader ownerType="RentableUnit" ownerId={unit.id} role="equipment"
                  label="Equipment photos" hint="Condition baseline + listing imagery" />
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
