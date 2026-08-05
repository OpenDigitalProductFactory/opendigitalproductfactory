import type {
  RestaurantFloorDemand,
  RestaurantFloorProjection,
  RestaurantFloorTable,
} from "./restaurant-floor-projection";

export interface RestaurantHostPulse {
  waiting: number;
  availableNow: number;
  turningSoon: number;
  needsAction: number;
}

export interface RestaurantHostTurn
  extends NonNullable<RestaurantFloorTable["turn"]> {
  party: RestaurantFloorTable["party"];
  tableLabels: string[];
}

function urgencyScore(demand: RestaurantFloorDemand, asOf: string): number {
  const waited = demand.waitedMinutes ?? 0;
  const scheduled = demand.scheduledAt
    ? Math.max(
        0,
        Math.round(
          (Date.parse(asOf) - Date.parse(demand.scheduledAt)) / 60_000,
        ),
      )
    : 0;
  return waited + scheduled * 2 + (demand.vip ? 30 : 0) +
    (demand.hasDietaryNote ? 1 : 0);
}

export function rankRestaurantDemand(
  floor: RestaurantFloorProjection,
): RestaurantFloorDemand[] {
  return [...floor.demand].sort((left, right) => {
    const urgency = urgencyScore(right, floor.asOf) -
      urgencyScore(left, floor.asOf);
    if (urgency !== 0) return urgency;
    return left.name.localeCompare(right.name);
  });
}

export function deriveRestaurantHostPulse(
  floor: RestaurantFloorProjection,
): RestaurantHostPulse {
  return {
    waiting: floor.demand.length,
    availableNow: floor.tables.filter((table) => table.state === "available")
      .length,
    turningSoon: floor.tables.filter(
      (table) => table.timing?.kind === "turning",
    ).length,
    needsAction: floor.tables.filter((table) =>
      table.state === "dirty" || table.state === "late-turn" ||
      table.state === "blocked"
    ).length,
  };
}

export function deriveRestaurantHostTurns(
  tables: readonly RestaurantFloorTable[],
): RestaurantHostTurn[] {
  return [
    ...new Map(
      tables.flatMap((table) =>
        table.turn
          ? [[
              table.turn.id,
              {
                ...table.turn,
                party: table.party,
                tableLabels: tables
                  .filter((candidate) => candidate.turn?.id === table.turn?.id)
                  .map((candidate) => candidate.label),
              },
            ] as const]
          : []
      ),
    ).values(),
  ];
}

export function deriveRestaurantServerLoad(
  tables: readonly RestaurantFloorTable[],
): Array<NonNullable<RestaurantFloorTable["server"]>> {
  return [
    ...new Map(
      tables.flatMap((table) =>
        table.server ? [[table.server.id, table.server] as const] : []
      ),
    ).values(),
  ].sort((left, right) => right.tableCount - left.tableCount ||
    left.name.localeCompare(right.name));
}
