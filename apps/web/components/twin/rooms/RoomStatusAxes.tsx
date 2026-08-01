import { StatusBadge } from "@/components/ui/report-kit";
import {
  inventoryLabel,
  occupancyLabel,
  readinessLabel,
  type OperationalRoom,
} from "@/lib/twin/rooms-operations";

export interface RoomStatusAxesProps {
  room: OperationalRoom;
  compact?: boolean;
}

export function RoomStatusAxes({ room, compact = false }: RoomStatusAxesProps) {
  const size = compact ? "sm" : "md";
  return (
    <div
      aria-label={`${room.label} status`}
      className="flex flex-wrap items-center gap-1.5"
    >
      <StatusBadge
        domain="roomsOccupancy"
        status={room.occupancy}
        label={occupancyLabel(room.occupancy)}
        size={size}
        uppercase={false}
      />
      <StatusBadge
        domain="roomsReadiness"
        status={room.readiness}
        label={readinessLabel(room.readiness)}
        size={size}
        uppercase={false}
      />
      <StatusBadge
        domain="roomsInventory"
        status={room.inventory}
        label={inventoryLabel(room.inventory)}
        size={size}
        uppercase={false}
      />
      {room.privacy !== "none" ? (
        <StatusBadge
          domain="roomsPrivacy"
          status={room.privacy}
          label={room.privacy === "do-not-enter" ? "Do not enter" : "Restricted"}
          size={size}
          uppercase={false}
        />
      ) : null}
    </div>
  );
}
