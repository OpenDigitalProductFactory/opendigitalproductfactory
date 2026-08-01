import { intentStyle } from "@/components/ui/report-kit";
import {
  occupancyLabel,
  roomStatusIntent,
  type OperationalRoom,
  type RoomsOperationalView,
} from "@/lib/twin/rooms-operations";

import { RoomStatusAxes } from "./RoomStatusAxes";

export interface RoomsRackProps {
  view: RoomsOperationalView;
  selectedRoomId?: string;
  onSelectRoom: (roomId: string) => void;
}

function stayForDay(room: OperationalRoom, iso: string) {
  return room.stays.find(
    (stay) => stay.startsOn <= iso && stay.endsOn >= iso,
  );
}

export function RoomsRack({
  view,
  selectedRoomId,
  onSelectRoom,
}: RoomsRackProps) {
  const columns = `minmax(164px, 0.85fr) repeat(${view.days.length}, minmax(112px, 1fr))`;
  return (
    <div
      aria-label="Room rack"
      className="overflow-x-auto rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
      role="region"
      tabIndex={0}
    >
      <div className="min-w-[760px]">
        <div
          className="sticky top-0 z-10 grid border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]"
          style={{ gridTemplateColumns: columns }}
        >
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
            {view.vocabulary.roomPlural}
          </div>
          {view.days.map((day) => (
            <div
              className="border-l border-[var(--dpf-border)] px-3 py-2"
              key={day.iso}
            >
              <p className="text-xs font-semibold text-[var(--dpf-text)]">
                {day.shortLabel}
              </p>
              <p className="text-dpf-caption text-[var(--dpf-muted)]">{day.dayLabel}</p>
            </div>
          ))}
        </div>

        {view.rooms.map((room) => {
          const intent = intentStyle(roomStatusIntent(room));
          const selected = selectedRoomId === room.id;
          return (
            <div
              className="grid border-b border-[var(--dpf-border)] last:border-b-0"
              data-selected={selected || undefined}
              key={room.id}
              style={{
                gridTemplateColumns: columns,
                background: selected ? "var(--dpf-surface-2)" : undefined,
              }}
            >
              <button
                aria-label={`Open ${room.label} details`}
                className="dpf-tap-target min-w-0 border-l-4 px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--dpf-accent)]"
                onClick={() => onSelectRoom(room.id)}
                style={{ borderLeftColor: intent.border }}
                type="button"
              >
                <span className="block text-sm font-semibold text-[var(--dpf-text)]">
                  {room.label}
                </span>
                <span className="text-dpf-caption block text-[var(--dpf-muted)]">
                  {room.zoneLabel} · {room.roomType}
                </span>
                <span className="mt-1 block">
                  <RoomStatusAxes compact room={room} />
                </span>
              </button>
              {view.days.map((day, dayIndex) => {
                const stay = stayForDay(room, day.iso);
                return (
                  <div
                    className="min-h-20 border-l border-[var(--dpf-border)] p-2"
                    key={`${room.id}:${day.iso}`}
                  >
                    {stay ? (
                      <div
                        className="h-full rounded-md border px-2 py-1.5"
                        style={{
                          borderColor: intent.border,
                          background: intent.softBg,
                        }}
                      >
                        <p className="truncate text-xs font-semibold text-[var(--dpf-text)]">
                          {stay.reference}
                        </p>
                        <p className="text-dpf-caption" style={{ color: intent.fg }}>
                          {dayIndex === 0
                            ? occupancyLabel(room.occupancy)
                            : stay.status === "in-house"
                              ? "Stayover"
                              : "Confirmed"}
                          {stay.locked ? " · Locked" : ""}
                        </p>
                      </div>
                    ) : dayIndex === 0 ? (
                      <p className="text-xs text-[var(--dpf-muted)]">No stay assigned</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
