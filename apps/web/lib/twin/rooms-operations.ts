import type { CartesianSceneLayout } from "@dpf/storefront-templates";

import type { Intent } from "@/components/ui/report-kit";
import type { CartesianScenePresentationMap } from "@/lib/twin/cartesian-scene";

export type RoomsDomain = "lodging" | "boarding" | "care";
export type RoomOccupancy =
  | "vacant"
  | "reserved"
  | "occupied"
  | "departure-due"
  | "unknown";
export type RoomReadiness =
  | "ready"
  | "clean"
  | "dirty"
  | "cleaning"
  | "inspected"
  | "unknown";
export type RoomInventory =
  | "sellable"
  | "blocked"
  | "out-of-service"
  | "unknown";
export type RoomPrivacy = "none" | "do-not-enter" | "restricted";
export type RoomExceptionSeverity = "critical" | "warning" | "info";

export interface RoomsVocabulary {
  heading: string;
  roomSingular: string;
  roomPlural: string;
  occupantSingular: string;
  occupantPlural: string;
  arrivalSingular: string;
  arrivalPlural: string;
  departureSingular: string;
  departurePlural: string;
}

export interface RoomStayBlock {
  id: string;
  reference: string;
  startsOn: string;
  endsOn: string;
  status: "confirmed" | "in-house" | "departure-due" | "hold";
  locked?: boolean;
}

export interface OperationalRoom {
  id: string;
  label: string;
  zoneId: string;
  zoneLabel: string;
  roomType: string;
  occupancy: RoomOccupancy;
  readiness: RoomReadiness;
  inventory: RoomInventory;
  privacy: RoomPrivacy;
  assignee?: string;
  nextAction?: string;
  stays: RoomStayBlock[];
}

export interface RoomDemand {
  id: string;
  reference: string;
  roomType: string;
  startsOn: string;
  endsOn: string;
  reason: string;
}

export interface RoomOperationsException {
  id: string;
  kind:
    | "arrival-risk"
    | "unassigned"
    | "maintenance"
    | "turnover"
    | "privacy";
  severity: RoomExceptionSeverity;
  title: string;
  detail: string;
  roomId?: string;
  dueAt?: string;
}

export interface RoomStaffLoad {
  id: string;
  label: string;
  assigned: number;
  remaining: number;
}

export interface RoomsOperationalView {
  asOf: string;
  domain: RoomsDomain;
  vocabulary: RoomsVocabulary;
  days: Array<{ iso: string; shortLabel: string; dayLabel: string }>;
  rooms: OperationalRoom[];
  unassignedDemand: RoomDemand[];
  exceptions: RoomOperationsException[];
  staffLoad: RoomStaffLoad[];
}

export interface RoomsSummary {
  total: number;
  occupied: number;
  arriving: number;
  departing: number;
  ready: number;
  unassigned: number;
  blocked: number;
}

const OCCUPANCY_LABEL: Record<RoomOccupancy, string> = {
  vacant: "Vacant",
  reserved: "Reserved",
  occupied: "Occupied",
  "departure-due": "Departure due",
  unknown: "Occupancy unavailable",
};

const READINESS_LABEL: Record<RoomReadiness, string> = {
  ready: "Ready",
  clean: "Clean",
  dirty: "Dirty",
  cleaning: "Cleaning",
  inspected: "Inspected",
  unknown: "Readiness unavailable",
};

const INVENTORY_LABEL: Record<RoomInventory, string> = {
  sellable: "Sellable",
  blocked: "Blocked",
  "out-of-service": "Out of service",
  unknown: "Inventory unavailable",
};

const VOCABULARY: Record<RoomsDomain, RoomsVocabulary> = {
  lodging: {
    heading: "Rooms now",
    roomSingular: "room",
    roomPlural: "rooms",
    occupantSingular: "guest",
    occupantPlural: "guests",
    arrivalSingular: "arrival",
    arrivalPlural: "arrivals",
    departureSingular: "departure",
    departurePlural: "departures",
  },
  boarding: {
    heading: "Boarding spaces now",
    roomSingular: "kennel",
    roomPlural: "kennels",
    occupantSingular: "animal",
    occupantPlural: "animals",
    arrivalSingular: "drop-off",
    arrivalPlural: "drop-offs",
    departureSingular: "pickup",
    departurePlural: "pickups",
  },
  care: {
    heading: "Care rooms now",
    roomSingular: "room",
    roomPlural: "rooms",
    occupantSingular: "occupant",
    occupantPlural: "occupants",
    arrivalSingular: "admission",
    arrivalPlural: "admissions",
    departureSingular: "discharge",
    departurePlural: "discharges",
  },
};

export function roomsVocabularyForDomain(domain: RoomsDomain): RoomsVocabulary {
  return VOCABULARY[domain];
}

export function occupancyLabel(value: RoomOccupancy): string {
  return OCCUPANCY_LABEL[value];
}

export function readinessLabel(value: RoomReadiness): string {
  return READINESS_LABEL[value];
}

export function inventoryLabel(value: RoomInventory): string {
  return INVENTORY_LABEL[value];
}

export function summarizeRooms(view: RoomsOperationalView): RoomsSummary {
  const today = view.days[0]?.iso;
  return {
    total: view.rooms.length,
    occupied: view.rooms.filter((room) =>
      room.occupancy === "occupied" || room.occupancy === "departure-due"
    ).length,
    arriving: view.rooms.filter((room) =>
      room.stays.some((stay) => stay.startsOn === today),
    ).length,
    departing: view.rooms.filter((room) =>
      room.stays.some((stay) => stay.endsOn === today),
    ).length,
    ready: view.rooms.filter(
      (room) =>
        (room.readiness === "ready" || room.readiness === "inspected") &&
        room.inventory === "sellable",
    ).length,
    unassigned: view.unassignedDemand.length,
    blocked: view.rooms.filter((room) => room.inventory !== "sellable").length,
  };
}
const SEVERITY_ORDER: Record<RoomExceptionSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function rankRoomExceptions(
  view: RoomsOperationalView,
): RoomOperationsException[] {
  return [...view.exceptions].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") ||
      a.title.localeCompare(b.title),
  );
}

export function roomStatusIntent(room: OperationalRoom): Intent {
  if (room.inventory === "out-of-service" || room.inventory === "blocked") {
    return "danger";
  }
  if (
    room.readiness === "dirty" ||
    room.readiness === "cleaning" ||
    room.occupancy === "departure-due"
  ) {
    return "warning";
  }
  if (room.occupancy === "occupied" || room.occupancy === "reserved") {
    return "info";
  }
  if (room.readiness === "ready" || room.readiness === "inspected") {
    return "success";
  }
  return "neutral";
}

export function buildRoomsSceneBindings(
  view: RoomsOperationalView,
): CartesianScenePresentationMap {
  return Object.fromEntries(
    view.rooms.map((room) => [
      `room:${room.id}`,
      {
        label: room.label,
        statusLabel: occupancyLabel(room.occupancy),
        sublabel: `${readinessLabel(room.readiness)} · ${inventoryLabel(room.inventory)}`,
        intent: roomStatusIntent(room),
      },
    ]),
  );
}

export function buildRoomsScene(view: RoomsOperationalView): CartesianSceneLayout {
  const zoneOrder = Array.from(
    new Map(view.rooms.map((room) => [room.zoneId, room.zoneLabel])),
  );
  const zoneWidth = 560;
  const zoneHeight = Math.max(
    240,
    Math.ceil(view.rooms.length / Math.max(1, zoneOrder.length) / 4) * 96 + 80,
  );
  const zones = zoneOrder.map(([id, label], zoneIndex) => ({
    id,
    label,
    geometry: {
      kind: "rectangle" as const,
      x: zoneIndex * (zoneWidth + 32),
      y: 0,
      width: zoneWidth,
      height: zoneHeight,
    },
  }));
  const indexWithinZone = new Map<string, number>();
  const zoneIndex = new Map(zoneOrder.map(([id], index) => [id, index]));
  const placements = view.rooms.map((room) => {
    const index = indexWithinZone.get(room.zoneId) ?? 0;
    indexWithinZone.set(room.zoneId, index + 1);
    const column = index % 4;
    const row = Math.floor(index / 4);
    return {
      id: room.id,
      label: room.label,
      entityRef: { kind: "room", id: room.id },
      geometry: {
        x: (zoneIndex.get(room.zoneId) ?? 0) * (zoneWidth + 32) + 36 + column * 126,
        y: 56 + row * 96,
        width: 108,
        height: 72,
        rotation: 0,
        shapeKind: "room",
      },
    };
  });
  return {
    schemaVersion: 1,
    spaceKind: "cartesian-interior",
    viewport: { x: 0, y: 0, zoom: 0.82 },
    zones,
    placements,
  };
}
