"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScheduleEditor } from "./ScheduleEditor";
import {
  RESTAURANT_TABLE_SHAPES,
  type RestaurantTableAttributes,
  type RestaurantTableBookingAccess,
  type RestaurantTableShape,
} from "@/lib/storefront/restaurant-table-attributes";

export interface HospitalityResourceManagerRow {
  id: string;
  resourceId: string;
  label: string;
  kind: "table";
  status: "active" | "blocked" | "retired";
  capacity: number;
  capacityUnit: "seats";
  serviceArea: string | null;
  blockedReason: string | null;
  attributes: RestaurantTableAttributes;
  version: number;
  availability: Array<{
    id: string;
    days: number[];
    startTime: string;
    endTime: string;
    date: string | null;
    isBlocked: boolean;
    reason: string | null;
  }>;
}

function statusLabel(status: HospitalityResourceManagerRow["status"]) {
  if (status === "active") return "Available";
  if (status === "blocked") return "Blocked";
  return "Retired";
}

function ResourceEditor({
  resource,
  onResourceSaved,
  onAvailabilitySaved,
}: {
  resource: HospitalityResourceManagerRow;
  onResourceSaved(resource: HospitalityResourceManagerRow): void;
  onAvailabilitySaved(): void;
}) {
  const [label, setLabel] = useState(resource.label);
  const [capacity, setCapacity] = useState(resource.capacity);
  const [serviceArea, setServiceArea] = useState(resource.serviceArea ?? "");
  const [status, setStatus] = useState(resource.status);
  const [blockedReason, setBlockedReason] = useState(
    resource.blockedReason ?? "",
  );
  const [shape, setShape] = useState<RestaurantTableShape>(
    resource.attributes.shape,
  );
  const [combinationGroup, setCombinationGroup] = useState(
    resource.attributes.combinationGroup ?? "",
  );
  const [bookingAccess, setBookingAccess] =
    useState<RestaurantTableBookingAccess>(resource.attributes.bookingAccess);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/storefront/admin/hospitality-resources/${resource.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: label.trim(),
            capacity,
            serviceArea: serviceArea.trim() || null,
            status,
            blockedReason:
              status === "blocked" ? blockedReason.trim() || null : null,
            shape,
            combinationGroup: combinationGroup.trim() || null,
            combinableWith: resource.attributes.combinableWith,
            bookingAccess,
            expectedVersion: resource.version,
          }),
        },
      );
      const body = (await response.json()) as {
        resource?: HospitalityResourceManagerRow;
        error?: string;
        message?: string;
      };
      if (!response.ok || !body.resource) {
        setError(body.message ?? body.error ?? "Table could not be saved");
        return;
      }
      onResourceSaved(body.resource);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="border border-[var(--dpf-border)] rounded-lg">
      <summary
        className="min-h-[44px] cursor-pointer px-4 py-3"
        aria-label={`Manage ${resource.label}`}
      >
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <strong>{resource.label}</strong>
          <span>{resource.capacity} seats</span>
          <span className="text-[var(--dpf-muted)]">
            {shapeLabel(resource.attributes.shape)}
          </span>
          {resource.serviceArea && (
            <span className="text-[var(--dpf-muted)]">
              {resource.serviceArea}
            </span>
          )}
          <span
            className={
              resource.status === "blocked"
                ? "text-[var(--dpf-warning)]"
                : resource.status === "active"
                  ? "text-[var(--dpf-success)]"
                  : "text-[var(--dpf-muted)]"
            }
          >
            {statusLabel(resource.status)}
          </span>
          {resource.attributes.combinationGroup && (
            <span className="text-[var(--dpf-muted)]">
              combines in {resource.attributes.combinationGroup}
            </span>
          )}
        </span>
        {resource.blockedReason && (
          <span className="mt-1 block text-sm text-[var(--dpf-muted)]">
            {resource.blockedReason}
          </span>
        )}
      </summary>

      <div className="grid gap-3 border-t border-[var(--dpf-border)] p-4 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Table label
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="min-h-[44px] rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3"
          />
        </label>
        <label className="grid gap-1 text-sm">
          Seats
          <input
            type="number"
            min={1}
            max={100}
            value={capacity}
            onChange={(event) => setCapacity(Number(event.target.value))}
            className="min-h-[44px] rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3"
          />
        </label>
        <label className="grid gap-1 text-sm">
          Service area
          <input
            value={serviceArea}
            onChange={(event) => setServiceArea(event.target.value)}
            placeholder="Dining room, patio, bar"
            className="min-h-[44px] rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3"
          />
        </label>
        <label className="grid gap-1 text-sm">
          Table shape
          <select
            value={shape}
            onChange={(event) =>
              setShape(event.target.value as RestaurantTableShape)
            }
            className="min-h-[44px] rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3"
          >
            {RESTAURANT_TABLE_SHAPES.map((value) => (
              <option key={value} value={value}>
                {shapeLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Combination group
          <input
            value={combinationGroup}
            onChange={(event) => setCombinationGroup(event.target.value)}
            placeholder="e.g. main-banquette"
            className="min-h-[44px] rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3"
          />
          <span className="text-xs text-[var(--dpf-muted)]">
            Tables with the same group may be joined for larger parties.
          </span>
        </label>
        <label className="grid gap-1 text-sm">
          Booking access
          <select
            value={bookingAccess}
            onChange={(event) =>
              setBookingAccess(event.target.value as RestaurantTableBookingAccess)
            }
            className="min-h-[44px] rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3"
          >
            <option value="online">Online and in-house</option>
            <option value="in-house">In-house only</option>
          </select>
          <span className="text-xs text-[var(--dpf-muted)]">
            In-house tables stay available to hosts but are withheld from external booking.
          </span>
        </label>
        <label className="grid gap-1 text-sm">
          Status
          <select
            value={status}
            onChange={(event) =>
              setStatus(
                event.target.value as HospitalityResourceManagerRow["status"],
              )
            }
            className="min-h-[44px] rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3"
          >
            <option value="active">Available</option>
            <option value="blocked">Blocked</option>
            <option value="retired">Retired</option>
          </select>
        </label>
        {status === "blocked" && (
          <label className="grid gap-1 text-sm md:col-span-2">
            Why is it blocked?
            <input
              value={blockedReason}
              onChange={(event) => setBlockedReason(event.target.value)}
              placeholder="Maintenance, reserved for event, accessibility work"
              className="min-h-[44px] rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3"
            />
          </label>
        )}
        <div className="flex items-center gap-3 md:col-span-2">
          <button
            type="button"
            onClick={save}
            disabled={saving || !label.trim() || capacity < 1}
            className="min-h-[44px] rounded-md bg-[var(--dpf-accent)] px-4 font-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save table"}
          </button>
          {error && (
            <span role="alert" className="text-sm text-[var(--dpf-error)]">
              {error}
            </span>
          )}
        </div>
        <div className="border-t border-[var(--dpf-border)] pt-2 md:col-span-2">
          <ScheduleEditor
            saveEndpoint={`/api/storefront/admin/hospitality-resources/${resource.id}`}
            availability={resource.availability}
            heading="Table availability"
            onSaved={onAvailabilitySaved}
          />
        </div>
      </div>
    </details>
  );
}

export function HospitalityResourceManager({
  storefrontId,
  resources: initialResources,
}: {
  storefrontId: string;
  resources: HospitalityResourceManagerRow[];
}) {
  const router = useRouter();
  const [resources, setResources] = useState(initialResources);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [capacity, setCapacity] = useState(4);
  const [serviceArea, setServiceArea] = useState("");
  const [shape, setShape] = useState<RestaurantTableShape>("round");
  const [combinationGroup, setCombinationGroup] = useState("");
  const [bookingAccess, setBookingAccess] =
    useState<RestaurantTableBookingAccess>("online");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refreshOperationalView() {
    router.refresh();
  }

  async function addTable() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        "/api/storefront/admin/hospitality-resources",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storefrontId,
            label: label.trim(),
            capacity,
            serviceArea: serviceArea.trim() || null,
            shape,
            combinationGroup: combinationGroup.trim() || null,
            combinableWith: [],
            bookingAccess,
          }),
        },
      );
      const body = (await response.json()) as {
        resource?: HospitalityResourceManagerRow;
        error?: string;
        message?: string;
      };
      if (!response.ok || !body.resource) {
        setError(body.message ?? body.error ?? "Table could not be added");
        return;
      }
      setResources((current) => [...current, body.resource!]);
      setLabel("");
      setCapacity(4);
      setServiceArea("");
      setShape("round");
      setCombinationGroup("");
      setBookingAccess("online");
      setAdding(false);
      refreshOperationalView();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="table-management-heading" className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 id="table-management-heading" className="text-base font-semibold">
            Table management
          </h2>
          <p className="text-sm text-[var(--dpf-muted)]">
            {resources.length} physical table{resources.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          type="button"
          aria-label="Add table"
          onClick={() => setAdding((current) => !current)}
          className="min-h-[44px] rounded-md border border-[var(--dpf-border)] px-4 font-semibold"
        >
          {adding ? "Cancel" : "Add table"}
        </button>
      </div>

      {adding && (
        <div className="grid gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 md:grid-cols-3">
          <label className="grid gap-1 text-sm">
            Table label
            <input
              autoFocus
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Aster or Table 12"
              className="min-h-[44px] rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Seats
            <input
              type="number"
              min={1}
              max={100}
              value={capacity}
              onChange={(event) => setCapacity(Number(event.target.value))}
              className="min-h-[44px] rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Service area
            <input
              value={serviceArea}
              onChange={(event) => setServiceArea(event.target.value)}
              placeholder="Dining room, patio, bar"
              className="min-h-[44px] rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Table shape
            <select
              value={shape}
              onChange={(event) =>
                setShape(event.target.value as RestaurantTableShape)
              }
              className="min-h-[44px] rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3"
            >
              {RESTAURANT_TABLE_SHAPES.map((value) => (
                <option key={value} value={value}>
                  {shapeLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm md:col-span-2">
            Combination group
            <input
              value={combinationGroup}
              onChange={(event) => setCombinationGroup(event.target.value)}
              placeholder="e.g. main-banquette"
              className="min-h-[44px] rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3"
            />
            <span className="text-xs text-[var(--dpf-muted)]">
              Give adjacent tables the same group if they can be joined.
            </span>
          </label>
          <div className="flex items-center gap-3 md:col-span-3">
            <button
              type="button"
              onClick={addTable}
              disabled={saving || !label.trim() || capacity < 1}
              className="min-h-[44px] rounded-md bg-[var(--dpf-accent)] px-4 font-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add table"}
            </button>
            {error && (
              <span role="alert" className="text-sm text-[var(--dpf-error)]">
                {error}
              </span>
            )}
          </div>
        </div>
      )}

      {resources.length === 0 && !adding ? (
        <p className="rounded-lg border border-dashed border-[var(--dpf-border)] p-5 text-sm text-[var(--dpf-muted)]">
          No tables yet. Add the physical tables guests can be seated at.
        </p>
      ) : (
        <div className="grid gap-2">
          {resources.map((resource) => (
            <ResourceEditor
              key={resource.id}
              resource={resource}
              onResourceSaved={(saved) => {
                setResources((current) =>
                  current.map((row) => (row.id === saved.id ? saved : row)),
                );
                refreshOperationalView();
              }}
              onAvailabilitySaved={refreshOperationalView}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function shapeLabel(shape: RestaurantTableShape): string {
  return shape.charAt(0).toUpperCase() + shape.slice(1);
}
