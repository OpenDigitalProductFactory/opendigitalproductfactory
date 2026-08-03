"use client";

import { FormField, SelectField, TextField, fieldControlClass } from "@/components/ui/form";
import { SaveStateIndicator } from "@/components/ui/SaveStateIndicator";
import { useSaveState } from "@/lib/shared/use-save-state";
import type { RentalPhysicalProfile } from "@/lib/storefront/rental-physical-profile";

const READINESS = [
  "ready", "inspection-due", "cleaning", "charging", "incomplete", "blocked", "unknown",
].map((value) => ({ value, label: value }));
const OCCUPANCY = ["vacant", "reserved", "occupied", "move-out", "unknown"]
  .map((value) => ({ value, label: value }));
const ACCESS = ["ready", "pending", "overlocked", "disabled", "unknown"]
  .map((value) => ({ value, label: value }));

function localDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function isoDateTime(value: string): string {
  return value ? new Date(value).toISOString() : "";
}

function numberValue(value: string): number {
  return Math.max(0, Number(value) || 0);
}

export function RentalPhysicalEditor({
  unitId,
  profile,
  onPersisted,
}: {
  unitId: string;
  profile: RentalPhysicalProfile;
  onPersisted: (profile: RentalPhysicalProfile) => void;
}) {
  const save = useSaveState({
    value: profile,
    resetKey: unitId,
    debounceMs: 500,
    failureMessage: "Could not save this unit's physical details.",
    async onSave(next) {
      const response = await fetch(`/api/storefront/admin/units/${unitId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ physicalProfile: next }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        return { ok: false, error: body?.message ?? "The rental unit could not be updated." };
      }
      const body = (await response.json()) as { physicalProfile: RentalPhysicalProfile };
      onPersisted(body.physicalProfile);
      return { ok: true };
    },
  });
  const current = save.value;
  const change = (next: RentalPhysicalProfile) => save.change(next);
  const withMaintenance = () => current.maintenanceHold ?? {
    severity: "hard" as const,
    reason: "Maintenance",
    startAt: new Date().toISOString(),
    endAt: new Date(Date.now() + 3_600_000).toISOString(),
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 rounded-dpf-lg bg-[var(--dpf-surface-2)] p-dpf-md md:grid-cols-4">
        <TextField name={`${unitId}-site`} label="Site / facility" optional autoComplete="off"
          value={current.location?.site ?? ""} placeholder="North Yard"
          onValueChange={(site) => change({ ...current, location: { ...current.location, site } })} />
        <TextField name={`${unitId}-zone`} label="Zone / floor" optional autoComplete="off"
          value={current.location?.zone ?? ""} placeholder="Ready line"
          onValueChange={(zone) => change({ ...current, location: { ...current.location, zone } })} />
        <TextField name={`${unitId}-position`} label="Bay / unit" optional autoComplete="off"
          value={current.location?.position ?? ""} placeholder="Bay 4"
          onValueChange={(position) => change({ ...current, location: { ...current.location, position } })} />
        <SelectField name={`${unitId}-readiness`} label="Pickup readiness" value={current.readiness}
          options={READINESS}
          onValueChange={(readiness) => change({
            ...current, readiness: readiness as RentalPhysicalProfile["readiness"],
          })} />

        {current.kind === "self-storage" ? (
          <>
            <TextField name={`${unitId}-size`} label="Unit size" optional autoComplete="off"
              value={current.sizeLabel ?? ""} placeholder="10 x 10"
              onValueChange={(sizeLabel) => change({ ...current, sizeLabel })} />
            <SelectField name={`${unitId}-occupancy`} label="Occupancy" value={current.occupancy}
              options={OCCUPANCY}
              onValueChange={(occupancy) => change({
                ...current, occupancy: occupancy as typeof current.occupancy,
              })} />
            <SelectField name={`${unitId}-access`} label="Access" value={current.accessState}
              options={ACCESS}
              onValueChange={(accessState) => change({
                ...current, accessState: accessState as typeof current.accessState,
              })} />
            <TextField name={`${unitId}-waitlist`} label="Waitlist" type="number" min={0}
              value={String(current.waitlistCount)}
              onValueChange={(waitlistCount) => change({
                ...current, waitlistCount: numberValue(waitlistCount),
              })} />
          </>
        ) : (
          <>
            <TextField name={`${unitId}-pickup-prep`} label="Pickup prep (min)" type="number" min={0}
              value={String(current.pickupWindowMinutes)}
              onValueChange={(pickupWindowMinutes) => change({
                ...current, pickupWindowMinutes: numberValue(pickupWindowMinutes),
              })} />
            <TextField name={`${unitId}-return-reset`} label="Return reset (min)" type="number" min={0}
              value={String(current.returnWindowMinutes)}
              onValueChange={(returnWindowMinutes) => change({
                ...current, returnWindowMinutes: numberValue(returnWindowMinutes),
              })} />
            {current.kind === "production-kit" && (
              <>
                <TextField name={`${unitId}-required-items`} label="Kit items required" type="number" min={0}
                  value={String(current.requiredItemCount)}
                  onValueChange={(requiredItemCount) => change({
                    ...current, requiredItemCount: numberValue(requiredItemCount),
                  })} />
                <TextField name={`${unitId}-ready-items`} label="Kit items ready" type="number" min={0}
                  value={String(current.readyItemCount)}
                  onValueChange={(readyItemCount) => change({
                    ...current, readyItemCount: numberValue(readyItemCount),
                  })} />
              </>
            )}
          </>
        )}
      </div>

      <details data-dpf-disclosure className="rounded-dpf-lg border border-[var(--dpf-border)] p-dpf-md">
        <summary className="cursor-pointer text-dpf-body font-dpf-medium text-[var(--dpf-text)]">
          Maintenance downtime
          {current.maintenanceHold && <span className="ml-2 text-dpf-caption text-[var(--dpf-warning)]">active hold</span>}
        </summary>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <SelectField name={`${unitId}-maintenance-severity`} label="Severity"
            value={current.maintenanceHold?.severity ?? "hard"}
            options={[{ value: "soft", label: "Soft down" }, { value: "hard", label: "Hard down" }]}
            onValueChange={(severity) => change({
              ...current,
              maintenanceHold: { ...withMaintenance(), severity: severity as "soft" | "hard" },
            })} />
          <TextField name={`${unitId}-maintenance-reason`} label="Reason" optional autoComplete="off"
            value={current.maintenanceHold?.reason ?? ""} placeholder="Annual inspection"
            onValueChange={(reason) => change({
              ...current, maintenanceHold: { ...withMaintenance(), reason },
            })} />
          <FormField name={`${unitId}-maintenance-start`} label="From" optional>
            {(control) => <input {...control} type="datetime-local" autoComplete="off"
              className={fieldControlClass} value={localDateTime(current.maintenanceHold?.startAt)}
              onChange={(event) => change({
                ...current,
                maintenanceHold: { ...withMaintenance(), startAt: isoDateTime(event.target.value) },
              })} />}
          </FormField>
          <FormField name={`${unitId}-maintenance-end`} label="Until" optional>
            {(control) => <input {...control} type="datetime-local" autoComplete="off"
              className={fieldControlClass} value={localDateTime(current.maintenanceHold?.endAt)}
              onChange={(event) => change({
                ...current,
                maintenanceHold: { ...withMaintenance(), endAt: isoDateTime(event.target.value) },
              })} />}
          </FormField>
          {current.maintenanceHold && (
            <button type="button" className="min-h-11 justify-self-start rounded-dpf-md px-3 text-dpf-caption font-dpf-medium text-[var(--dpf-error)]"
              onClick={() => {
                const { maintenanceHold: _removed, ...rest } = current;
                change(rest as RentalPhysicalProfile);
              }}>
              Clear maintenance hold
            </button>
          )}
        </div>
      </details>
      <SaveStateIndicator compact status={save.status} error={save.error}
        onRetry={save.retry} onRevert={save.revert} />
    </div>
  );
}
