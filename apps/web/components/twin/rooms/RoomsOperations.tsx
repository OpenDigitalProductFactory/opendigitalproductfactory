"use client";

import { useMemo, useState } from "react";

import { CartesianSceneCanvas } from "@/components/twin/cartesian/CartesianSceneCanvas";
import { StatusBadge, intentStyle } from "@/components/ui/report-kit";
import {
  buildRoomsScene,
  buildRoomsSceneBindings,
  inventoryLabel,
  occupancyLabel,
  rankRoomExceptions,
  readinessLabel,
  summarizeRooms,
  type RoomExceptionSeverity,
  type RoomsOperationalView,
} from "@/lib/twin/rooms-operations";

import { RoomStatusAxes } from "./RoomStatusAxes";
import { RoomsList } from "./RoomsList";
import { RoomsRack } from "./RoomsRack";

type RoomsMode = "rack" | "floor" | "list";

export interface RoomsOperationsProps {
  view: RoomsOperationalView;
  demo?: boolean;
  className?: string;
}

const MODE_LABEL: Record<RoomsMode, string> = {
  rack: "Room rack",
  floor: "Floor & wing",
  list: "Accessible list",
};

const EXCEPTION_INTENT: Record<RoomExceptionSeverity, "danger" | "warning" | "info"> = {
  critical: "danger",
  warning: "warning",
  info: "info",
};

function SummaryItem({ label, value, intent = "neutral" }: {
  label: string;
  value: number;
  intent?: "success" | "warning" | "danger" | "info" | "neutral";
}) {
  const style = intentStyle(intent);
  return (
    <div
      className="min-w-[112px] rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2"
      style={{ borderTopColor: style.border, borderTopWidth: 3 }}
    >
      <p className="text-dpf-caption uppercase tracking-wide text-[var(--dpf-muted)]">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-[var(--dpf-text)]">{value}</p>
    </div>
  );
}

export function RoomsOperations({ view, demo = false, className = "" }: RoomsOperationsProps) {
  const [mode, setMode] = useState<RoomsMode>("rack");
  const [selectedRoomId, setSelectedRoomId] = useState<string>();
  const summary = useMemo(() => summarizeRooms(view), [view]);
  const exceptions = useMemo(() => rankRoomExceptions(view), [view]);
  const scene = useMemo(() => buildRoomsScene(view), [view]);
  const bindings = useMemo(() => buildRoomsSceneBindings(view), [view]);
  const selectedRoom = view.rooms.find((room) => room.id === selectedRoomId);

  return (
    <section
      aria-labelledby="rooms-operations-heading"
      className={`space-y-4 ${className}`.trim()}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2
              className="text-xl font-semibold text-[var(--dpf-text)]"
              id="rooms-operations-heading"
            >
              {view.vocabulary.heading}
            </h2>
            {demo ? (
              <StatusBadge intent="neutral" label="Demo data" uppercase={false} />
            ) : null}
          </div>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            Rack, physical layout, and housekeeping readiness from one operational view.
          </p>
        </div>
        <p className="text-xs text-[var(--dpf-muted)]">
          As of {new Date(view.asOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </p>
      </header>

      <div aria-label="Room operation summary" className="flex gap-2 overflow-x-auto pb-1">
        <SummaryItem label="Occupied" value={summary.occupied} intent="info" />
        <SummaryItem label={view.vocabulary.arrivalPlural} value={summary.arriving} intent="info" />
        <SummaryItem label={view.vocabulary.departurePlural} value={summary.departing} intent="warning" />
        <SummaryItem label="Ready by check-in" value={summary.ready} intent="success" />
        <SummaryItem label="Unassigned" value={summary.unassigned} intent={summary.unassigned ? "danger" : "success"} />
        <SummaryItem label="Blocked" value={summary.blocked} intent={summary.blocked ? "danger" : "success"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.3fr)]">
        <div className="min-w-0 space-y-3">
          <div
            aria-label="Room view"
            className="inline-flex max-w-full gap-1 overflow-x-auto rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-1"
            role="tablist"
          >
            {(Object.keys(MODE_LABEL) as RoomsMode[]).map((candidate) => (
              <button
                aria-controls={`rooms-${candidate}-panel`}
                aria-selected={mode === candidate}
                className="dpf-tap-target whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-[var(--dpf-muted)] aria-selected:bg-[var(--dpf-surface-1)] aria-selected:text-[var(--dpf-text)] aria-selected:shadow-sm"
                id={`rooms-${candidate}-tab`}
                key={candidate}
                onClick={() => setMode(candidate)}
                role="tab"
                type="button"
              >
                {MODE_LABEL[candidate]}
              </button>
            ))}
          </div>

          <div
            aria-labelledby={`rooms-${mode}-tab`}
            id={`rooms-${mode}-panel`}
            role="tabpanel"
          >
            {mode === "rack" ? (
              <RoomsRack
                onSelectRoom={setSelectedRoomId}
                selectedRoomId={selectedRoomId}
                view={view}
              />
            ) : mode === "floor" ? (
              <CartesianSceneCanvas
                ariaLabel="Room floor and wing layout"
                bindings={bindings}
                height={560}
                mode="operate"
                onActivate={(placementId) => setSelectedRoomId(placementId)}
                scene={scene}
              />
            ) : (
              <RoomsList onSelectRoom={setSelectedRoomId} view={view} />
            )}
          </div>
        </div>

        <aside className="space-y-3">
          <section
            aria-label="Needs attention"
            className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
          >
            <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Needs attention</h3>
            <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">
              Ranked by check-in risk and time.
            </p>
            <ol className="mt-3 space-y-2">
              {exceptions.map((exception) => {
                const style = intentStyle(EXCEPTION_INTENT[exception.severity]);
                return (
                  <li
                    className="rounded-lg border p-2"
                    key={exception.id}
                    style={{ borderColor: style.border, background: style.softBg }}
                  >
                    <button
                      className="w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
                      onClick={() => exception.roomId && setSelectedRoomId(exception.roomId)}
                      type="button"
                    >
                      <span className="block text-xs font-semibold text-[var(--dpf-text)]">
                        {exception.title}
                      </span>
                      <span className="text-dpf-caption mt-0.5 block text-[var(--dpf-muted)]">
                        {exception.detail}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
            <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Turnover workload</h3>
            <ul className="mt-2 space-y-2">
              {view.staffLoad.map((staff) => (
                <li className="flex items-center justify-between gap-3 text-xs" key={staff.id}>
                  <span className="font-medium text-[var(--dpf-text)]">{staff.label}</span>
                  <span className="text-[var(--dpf-muted)]">
                    {staff.remaining} remaining · {staff.assigned} assigned
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {selectedRoom ? (
        <section
          aria-label={`${selectedRoom.label} details`}
          className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-[var(--dpf-text)]">{selectedRoom.label}</h3>
              <p className="text-xs text-[var(--dpf-muted)]">
                {selectedRoom.zoneLabel} · {selectedRoom.roomType}
              </p>
            </div>
            <button
              className="dpf-tap-target rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-xs text-[var(--dpf-text)]"
              onClick={() => setSelectedRoomId(undefined)}
              type="button"
            >
              Close details
            </button>
          </div>
          <div className="mt-3"><RoomStatusAxes room={selectedRoom} /></div>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-[var(--dpf-muted)]">Occupancy</dt><dd>{occupancyLabel(selectedRoom.occupancy)}</dd></div>
            <div><dt className="text-xs text-[var(--dpf-muted)]">Readiness</dt><dd>{readinessLabel(selectedRoom.readiness)}</dd></div>
            <div><dt className="text-xs text-[var(--dpf-muted)]">Inventory</dt><dd>{inventoryLabel(selectedRoom.inventory)}</dd></div>
          </dl>
          <p className="mt-3 text-sm text-[var(--dpf-text)]">
            {selectedRoom.nextAction ?? "No immediate room action is recorded."}
          </p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            This view is read-only. Assignment and status changes require the governed room-operations command path.
          </p>
        </section>
      ) : null}
    </section>
  );
}
