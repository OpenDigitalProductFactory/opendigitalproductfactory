"use client";

import {
  inventoryLabel,
  occupancyLabel,
  readinessLabel,
  type RoomsOperationalView,
} from "@/lib/twin/rooms-operations";
import { DataTable, type Column } from "@/components/ui/report-kit/DataTable";

export interface RoomsListProps {
  view: RoomsOperationalView;
  onSelectRoom: (roomId: string) => void;
}

type RoomRow = RoomsOperationalView["rooms"][number];

export function RoomsList({ view, onSelectRoom }: RoomsListProps) {
  const columns: Column<RoomRow>[] = [
    {
      key: "room",
      header: "Room",
      cell: (room) => (
        <div>
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
        </div>
      ),
    },
    {
      key: "occupancy",
      header: "Occupancy",
      cell: (room) => occupancyLabel(room.occupancy),
    },
    {
      key: "readiness",
      header: "Readiness",
      cell: (room) => readinessLabel(room.readiness),
    },
    {
      key: "inventory",
      header: "Inventory",
      cell: (room) => inventoryLabel(room.inventory),
    },
    {
      key: "privacy",
      header: "Privacy",
      cell: (room) =>
        room.privacy === "none"
          ? "No restriction"
          : room.privacy === "do-not-enter"
            ? "Do not enter"
            : "Restricted",
    },
    {
      key: "nextStay",
      header: "Next stay",
      cell: (room) => room.stays[0]?.reference ?? "None assigned",
    },
    {
      key: "owner",
      header: "Owner",
      cell: (room) => room.assignee ?? "Unassigned",
    },
  ];

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--dpf-border)]">
      <DataTable
        ariaLabel="Room operations"
        className="min-w-[760px] bg-[var(--dpf-surface-1)]"
        columns={columns}
        getRowKey={(room) => room.id}
        rows={view.rooms}
      />
    </div>
  );
}
