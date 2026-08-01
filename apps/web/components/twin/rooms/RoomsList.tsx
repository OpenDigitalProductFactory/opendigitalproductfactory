import {
  inventoryLabel,
  occupancyLabel,
  readinessLabel,
  type RoomsOperationalView,
} from "@/lib/twin/rooms-operations";

export interface RoomsListProps {
  view: RoomsOperationalView;
  onSelectRoom: (roomId: string) => void;
}

export function RoomsList({ view, onSelectRoom }: RoomsListProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--dpf-border)]">
      <table
        aria-label="Room operations"
        className="w-full min-w-[760px] border-collapse bg-[var(--dpf-surface-1)] text-left text-sm"
      >
        <thead className="bg-[var(--dpf-surface-2)] text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
          <tr>
            <th className="px-3 py-2" scope="col">Room</th>
            <th className="px-3 py-2" scope="col">Occupancy</th>
            <th className="px-3 py-2" scope="col">Readiness</th>
            <th className="px-3 py-2" scope="col">Inventory</th>
            <th className="px-3 py-2" scope="col">Privacy</th>
            <th className="px-3 py-2" scope="col">Next stay</th>
            <th className="px-3 py-2" scope="col">Owner</th>
          </tr>
        </thead>
        <tbody>
          {view.rooms.map((room) => (
            <tr className="border-t border-[var(--dpf-border)]" key={room.id}>
              <th className="px-3 py-2" scope="row">
                <button
                  aria-label={`Open ${room.label} details`}
                  className="dpf-tap-target font-semibold text-[var(--dpf-accent)] underline-offset-4 hover:underline"
                  onClick={() => onSelectRoom(room.id)}
                  type="button"
                >
                  {room.label}
                </button>
                <span className="block text-xs font-normal text-[var(--dpf-muted)]">
                  {room.zoneLabel} · {room.roomType}
                </span>
              </th>
              <td className="px-3 py-2">{occupancyLabel(room.occupancy)}</td>
              <td className="px-3 py-2">{readinessLabel(room.readiness)}</td>
              <td className="px-3 py-2">{inventoryLabel(room.inventory)}</td>
              <td className="px-3 py-2">
                {room.privacy === "none"
                  ? "No restriction"
                  : room.privacy === "do-not-enter"
                    ? "Do not enter"
                    : "Restricted"}
              </td>
              <td className="px-3 py-2">
                {room.stays[0]?.reference ?? "None assigned"}
              </td>
              <td className="px-3 py-2">{room.assignee ?? "Unassigned"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
