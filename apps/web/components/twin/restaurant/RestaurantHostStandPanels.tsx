"use client";

import { useState, useTransition, type FormEvent } from "react";

import { LocalTime } from "@/components/ui/LocalTime";
import { InlineBusy } from "@/components/ui/InlineBusy";
import { createClientOperationId } from "@/lib/client-operation-id";
import {
  createRestaurantWalkIn,
  type RestaurantWalkInResult,
} from "@/lib/twin/restaurant-floor-actions";
import type { RestaurantCapacityTimelineSlot } from "@/lib/twin/restaurant-floor-loader.server";

export function RestaurantWalkInIntake({
  onCreated,
}: {
  onCreated(): void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RestaurantWalkInResult | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const next = await createRestaurantWalkIn({
        name: String(data.get("name") ?? ""),
        covers: Number(data.get("covers")),
        phone: String(data.get("phone") ?? ""),
        notes: String(data.get("notes") ?? ""),
        idempotencyKey: `walk-in:${createClientOperationId()}`,
      });
      setResult(next);
      if (next.ok) {
        form.reset();
        setOpen(false);
        onCreated();
      }
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        className="dpf-tap-target rounded-dpf-md bg-dpf-accent px-dpf-sm text-dpf-body font-dpf-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))]"
        data-dpf-primary-action="true"
        onClick={() => {
          setResult(null);
          setOpen((current) => !current);
        }}
      >
        Add walk-in
      </button>
      {open ? (
        <form
          aria-label="Add a walk-in party"
          className="absolute right-0 top-full z-40 mt-dpf-xs grid w-[min(22rem,88vw)] gap-dpf-sm rounded-dpf-lg border border-dpf-border bg-dpf-surface-1 p-dpf-md shadow-dpf-lg"
          onSubmit={submit}
        >
          <div>
            <h4 className="text-dpf-body font-dpf-semibold text-dpf-text">Walk-in party</h4>
            <p className="text-dpf-caption text-dpf-muted">Name and party size are enough to start.</p>
          </div>
          <label className="grid gap-1 text-dpf-caption font-dpf-medium text-dpf-text">
            Party name
            <input autoFocus required maxLength={120} name="name" className="dpf-tap-target rounded-dpf-md border border-dpf-border bg-dpf-bg px-dpf-sm text-dpf-body" />
          </label>
          <div className="grid grid-cols-2 gap-dpf-sm">
            <label className="grid gap-1 text-dpf-caption font-dpf-medium text-dpf-text">
              Guests
              <input required type="number" min={1} max={30} defaultValue={2} name="covers" className="dpf-tap-target rounded-dpf-md border border-dpf-border bg-dpf-bg px-dpf-sm text-dpf-body" />
            </label>
            <label className="grid gap-1 text-dpf-caption font-dpf-medium text-dpf-text">
              Phone <span className="font-dpf-normal text-dpf-muted">optional</span>
              <input maxLength={40} name="phone" inputMode="tel" className="dpf-tap-target rounded-dpf-md border border-dpf-border bg-dpf-bg px-dpf-sm text-dpf-body" />
            </label>
          </div>
          <label className="grid gap-1 text-dpf-caption font-dpf-medium text-dpf-text">
            Note <span className="font-dpf-normal text-dpf-muted">optional</span>
            <input maxLength={500} name="notes" placeholder="High chair, accessibility, celebration" className="dpf-tap-target rounded-dpf-md border border-dpf-border bg-dpf-bg px-dpf-sm text-dpf-body" />
          </label>
          {result && !result.ok ? <p role="alert" className="text-dpf-caption text-dpf-error">{result.error}</p> : null}
          <div className="flex justify-end gap-dpf-xs">
            <button type="button" className="dpf-tap-target rounded-dpf-md border border-dpf-border px-dpf-sm text-dpf-body" onClick={() => setOpen(false)}>Cancel</button>
            <button disabled={pending} className="dpf-tap-target rounded-dpf-md bg-dpf-accent px-dpf-md text-dpf-body font-dpf-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] disabled:opacity-60">
              {pending ? <InlineBusy label="Adding…" tone="current" /> : "Add to waitlist"}
            </button>
          </div>
        </form>
      ) : null}
      {result?.ok ? <span className="sr-only" role="status">Walk-in added.</span> : null}
    </div>
  );
}

export function RestaurantCapacityTimeline({
  slots,
}: {
  slots: readonly RestaurantCapacityTimelineSlot[];
}) {
  if (slots.length === 0) return null;
  return (
    <section aria-labelledby="capacity-timeline-heading" className="rounded-dpf-lg border border-dpf-border bg-dpf-surface-1 p-dpf-sm">
      <div className="flex items-baseline justify-between gap-dpf-sm">
        <h3 id="capacity-timeline-heading" className="text-dpf-body font-dpf-semibold text-dpf-text">Reservations and open tables</h3>
        <span className="text-dpf-caption text-dpf-muted">Next 3 hours</span>
      </div>
      <div className="mt-dpf-xs grid auto-cols-[minmax(7.5rem,1fr)] grid-flow-col gap-1 overflow-x-auto pb-1">
        {slots.map((slot) => (
          <article key={slot.startsAt} className="rounded-dpf-md border border-dpf-border bg-dpf-bg p-dpf-xs">
            <h4 className="text-dpf-caption font-dpf-semibold text-dpf-text"><LocalTime value={slot.startsAt} mode="time" /></h4>
            <p className="mt-1 text-dpf-caption text-dpf-text">{slot.reservationCount} reserved · {slot.reservedCovers} guests</p>
            <dl className="mt-1 grid grid-cols-2 gap-1 text-dpf-caption">
              <div><dt className="text-dpf-muted">Online</dt><dd className="font-dpf-semibold text-dpf-text">{slot.onlineOpen} open</dd></div>
              <div><dt className="text-dpf-muted">In-house</dt><dd className="font-dpf-semibold text-dpf-text">{slot.inHouseOpen} open</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
