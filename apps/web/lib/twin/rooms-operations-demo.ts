import {
  roomsVocabularyForDomain,
  type OperationalRoom,
  type RoomInventory,
  type RoomOccupancy,
  type RoomReadiness,
  type RoomsDomain,
  type RoomsOperationalView,
} from "@/lib/twin/rooms-operations";

function isoDay(offset: number): string {
  return `2026-08-${String(offset + 1).padStart(2, "0")}`;
}

function roomLabel(domain: RoomsDomain, number: number): string {
  return domain === "boarding" ? `Kennel ${number}` : `Room ${number}`;
}

function safeReference(domain: RoomsDomain, index: number): string {
  const prefix =
    domain === "boarding" ? "Stay B" : domain === "care" ? "Visit C" : "Reservation H";
  return `${prefix}-${String(204 + index).padStart(3, "0")}`;
}

export function buildDemoRoomsOperationalView(options: {
  domain: RoomsDomain;
  roomCount?: number;
}): RoomsOperationalView {
  const roomCount = Math.max(1, Math.min(options.roomCount ?? 12, 80));
  const days = [0, 1, 2, 3, 4].map((offset) => ({
    iso: isoDay(offset),
    shortLabel:
      offset === 0 ? "Today" : ["Tomorrow", "Sun", "Mon", "Tue"][offset - 1]!,
    dayLabel: `Aug ${offset + 1}`,
  }));
  const rooms: OperationalRoom[] = Array.from({ length: roomCount }, (_, index) => {
    const number = 101 + index;
    const zoneId = index % 2 === 0 ? "north" : "south";
    const occupancyCycle: RoomOccupancy[] = [
      "vacant",
      "reserved",
      "occupied",
      "departure-due",
      "vacant",
      "occupied",
    ];
    const readinessCycle: RoomReadiness[] = [
      "inspected",
      "clean",
      "dirty",
      "dirty",
      "cleaning",
      "dirty",
    ];
    const occupancy = occupancyCycle[index % occupancyCycle.length]!;
    const readiness = readinessCycle[index % readinessCycle.length]!;
    const inventory: RoomInventory =
      index === 3 ? "out-of-service" : index === 10 ? "blocked" : "sellable";
    const startsOn = isoDay(index % 3);
    const endsOn = isoDay((index % 3) + 2);
    return {
      id: `room-${number}`,
      label: roomLabel(options.domain, number),
      zoneId,
      zoneLabel: zoneId === "north" ? "North wing" : "South wing",
      roomType:
        index % 4 === 0 ? "Accessible king" : index % 3 === 0 ? "Twin" : "Queen",
      occupancy,
      readiness,
      inventory,
      privacy:
        index === 5
          ? "do-not-enter"
          : index === 8 && options.domain === "care"
            ? "restricted"
            : "none",
      ...(readiness === "dirty" || readiness === "cleaning"
        ? { assignee: index % 2 === 0 ? "Alex" : "Sam" }
        : {}),
      ...(inventory !== "sellable"
        ? { nextAction: "Resolve the inventory block before assignment" }
        : readiness === "dirty"
          ? { nextAction: "Clean and inspect before the next arrival" }
          : {}),
      stays:
        occupancy === "vacant" && index % 5 !== 0
          ? []
          : [
              {
                id: `stay-${index + 1}`,
                reference: safeReference(options.domain, index),
                startsOn,
                endsOn,
                status:
                  occupancy === "occupied"
                    ? "in-house"
                    : occupancy === "departure-due"
                      ? "departure-due"
                      : "confirmed",
                locked: index % 7 === 0,
              },
            ],
    };
  });
  const vocabulary = roomsVocabularyForDomain(options.domain);
  return {
    asOf: "2026-08-01T09:15:00.000Z",
    domain: options.domain,
    vocabulary,
    days,
    rooms,
    unassignedDemand: [
      {
        id: "demand-unassigned-1",
        reference: safeReference(options.domain, 90),
        roomType: "Queen",
        startsOn: isoDay(0),
        endsOn: isoDay(2),
        reason: "No continuously available compatible room",
      },
    ],
    exceptions: [
      {
        id: "exception-arrival-risk",
        kind: "arrival-risk",
        severity: "critical",
        title: `${roomLabel(options.domain, 104)} is out of service before today's ${vocabulary.arrivalSingular}`,
        detail: "Reassign the stay or resolve the maintenance block before 3:00 PM.",
        roomId: "room-104",
        dueAt: "2026-08-01T15:00:00.000Z",
      },
      {
        id: "exception-unassigned",
        kind: "unassigned",
        severity: "warning",
        title: `1 ${vocabulary.arrivalSingular} is unassigned`,
        detail: "No room is continuously available for the full stay.",
        dueAt: "2026-08-01T15:00:00.000Z",
      },
      {
        id: "exception-turnover",
        kind: "turnover",
        severity: "warning",
        title: `${roomLabel(options.domain, 103)} still needs inspection`,
        detail: "Cleaning is assigned; inspection remains before the next arrival.",
        roomId: "room-103",
        dueAt: "2026-08-01T14:30:00.000Z",
      },
      {
        id: "exception-privacy",
        kind: "privacy",
        severity: "info",
        title: `${roomLabel(options.domain, 106)} has a privacy restriction`,
        detail: "Confirm the restriction before entering; no sensitive note is shown here.",
        roomId: "room-106",
      },
    ],
    staffLoad: [
      { id: "staff-alex", label: "Alex", assigned: 7, remaining: 3 },
      { id: "staff-sam", label: "Sam", assigned: 6, remaining: 2 },
      { id: "staff-jordan", label: "Jordan", assigned: 5, remaining: 1 },
    ],
  };
}
