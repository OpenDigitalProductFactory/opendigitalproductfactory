"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  DataTable,
  type Column,
} from "@/components/ui/report-kit/DataTable";
import { Notice } from "@/components/ui/report-kit/Notice";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import { resolveIntent } from "@/components/ui/report-kit/statusColors";
import { CartesianSceneCanvas } from "@/components/twin/cartesian/CartesianSceneCanvas";
import type {
  RestaurantFloorCommandDemand,
  RestaurantFloorCommandOption,
  RestaurantFloorOperationalView,
} from "@/lib/twin/restaurant-floor-loader.server";
import {
  advanceRestaurantServiceTurn,
  executeRestaurantFloorCommand,
  moveRestaurantParty,
} from "@/lib/twin/restaurant-floor-actions";
import type { HospitalityServiceTurnStage } from "@/lib/storefront/hospitality-service-turn";
import type { RestaurantOperationalScene } from "@/lib/twin/restaurant-scene-layout";
import type { RestaurantFloorTable } from "@/lib/twin/restaurant-floor-projection";
import type { OperationalCommandResult } from "@/lib/twin/operations-command";

export interface RestaurantFloorOperationsProps {
  view: RestaurantFloorOperationalView;
  scene: RestaurantOperationalScene | null;
}

function commandFor(
  commands: readonly RestaurantFloorCommandDemand[],
  demandId: string | null,
): RestaurantFloorCommandDemand | null {
  return commands.find((command) => command.demandId === demandId) ?? null;
}

function resultNotice(result: OperationalCommandResult | null) {
  if (!result) return null;
  if (result.status === "confirmed") {
    const stageChanged = result.changedFacts.some(
      (fact) => fact.field === "stage",
    );
    const resourcesChanged = result.changedFacts.some(
      (fact) => fact.field === "resourceIds",
    );
    const partySeated = result.changedFacts.some(
      (fact) => fact.field === "status" && fact.value === "seated",
    );
    return (
      <Notice
        variant="success"
        title={
          stageChanged
            ? "Table status updated"
            : partySeated
              ? "Party seated"
              : resourcesChanged
              ? "Party moved"
                : "Party seated"
        }
      >
        {stageChanged
          ? "The service stage is confirmed and the live floor is refreshing."
          : partySeated
            ? "The table assignment is confirmed and the live floor is refreshing."
            : resourcesChanged
            ? "The new table assignment is confirmed and the live floor is refreshing."
              : "The table assignment is confirmed and the live floor is refreshing."}
      </Notice>
    );
  }
  if (result.status === "conflict") {
    return (
      <Notice variant="warn" title="Floor changed before confirmation">
        <span>
          Nothing changed.{" "}
          {result.alternatives.length > 0
            ? `Available alternatives: ${result.alternatives
                .map((alternative) => alternative.label)
                .join(", ")}.`
            : "Review the refreshed table choices and confirm again."}
        </span>
      </Notice>
    );
  }
  return (
    <Notice variant="warn" title="Assignment not made">
      {result.message}
    </Notice>
  );
}

function nextTurnAction(
  stage: HospitalityServiceTurnStage,
): { stage: HospitalityServiceTurnStage; label: string } | null {
  switch (stage) {
    case "seated":
      return { stage: "ordered", label: "Mark ordered" };
    case "ordered":
      return { stage: "paid", label: "Mark paid" };
    case "paid":
      return { stage: "dirty", label: "Mark needs clearing" };
    case "dirty":
      return { stage: "closed", label: "Mark cleared" };
    default:
      return null;
  }
}

export function RestaurantFloorOperations({
  view,
  scene,
}: RestaurantFloorOperationsProps) {
  const router = useRouter();
  const [selectedDemandId, setSelectedDemandId] = useState<string | null>(null);
  const [selectedOption, setSelectedOption] =
    useState<RestaurantFloorCommandOption | null>(null);
  const [result, setResult] = useState<OperationalCommandResult | null>(null);
  const [selectedMoveTurnId, setSelectedMoveTurnId] =
    useState<string | null>(null);
  const [selectedMoveOption, setSelectedMoveOption] =
    useState<RestaurantFloorCommandOption | null>(null);
  const [pending, startTransition] = useTransition();
  const selectedDemand = view.floor.demand.find(
    (demand) => demand.id === selectedDemandId,
  ) ?? null;
  const availableCommand = commandFor(view.commands, selectedDemandId);
  const selectedMoveCommand =
    (view.moves ?? []).find(
      (move) => move.serviceTurnId === selectedMoveTurnId,
    ) ?? null;

  const bindings = useMemo(
    () =>
      Object.fromEntries(
        view.floor.tables.map((table) => [
          `table:${table.id}`,
          {
            label: table.label,
            statusLabel: table.statusLabel,
            sublabel: [
              `${table.capacity} seats`,
              table.server?.name ?? "Server not assigned",
              table.availability.minutes != null
                ? `${table.availability.minutes} min`
                : null,
            ]
              .filter((value): value is string => value !== null)
              .join(" · "),
            intent: resolveIntent("restaurantFloor", table.state),
          },
        ]),
      ),
    [view.floor.tables],
  );

  const chooseDemand = (demandId: string) => {
    setSelectedDemandId(demandId);
    setSelectedOption(null);
    setResult(null);
  };
  const chooseTable = (resourceId: string) => {
    if (!availableCommand) return;
    const option = availableCommand.options.find((candidate) =>
      candidate.resourceIds.includes(resourceId)
    );
    if (option) {
      setSelectedOption(option);
      setResult(null);
    }
  };

  const tableColumns = useMemo<Column<RestaurantFloorTable>[]>(
    () => [
      {
        key: "table",
        header: "Table",
        cell: (table) => (
          <span>
            <span className="block font-medium">{table.label}</span>
            <span className="text-xs text-[var(--dpf-muted)]">
              {table.capacity} seats · {table.serviceArea}
            </span>
          </span>
        ),
        sortAccessor: (table) => table.label,
      },
      {
        key: "state",
        header: "State",
        cell: (table) => (
          <StatusBadge
            intent={resolveIntent("restaurantFloor", table.state)}
            label={table.statusLabel}
            variant="soft"
          />
        ),
        sortAccessor: (table) => table.statusLabel,
      },
      {
        key: "server",
        header: "Server",
        cell: (table) => table.server?.name ?? "Not assigned",
      },
      {
        key: "availability",
        header: "Next availability",
        cell: (table) => table.availability.reason,
      },
      {
        key: "action",
        header: "Assignment",
        cell: (table) => {
          const option = availableCommand?.options.find((candidate) =>
            candidate.resourceIds.includes(table.id)
          );
          const selected = selectedOption?.resourceIds.includes(table.id);
          return option ? (
            <button
              type="button"
              aria-pressed={selected}
              className="min-h-11 rounded-md border border-[var(--dpf-border)] px-3 text-sm font-medium hover:bg-[var(--dpf-surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={pending}
              onClick={() => chooseTable(table.id)}
            >
              {selected ? "Selected" : "Choose"}
            </button>
          ) : (
            <span className="text-xs text-[var(--dpf-muted)]">
              {selectedDemand ? "Not compatible" : "Choose a party first"}
            </span>
          );
        },
      },
    ],
    [availableCommand, pending, selectedDemand, selectedOption],
  );

  const servers = [
    ...new Map(
      view.floor.tables.flatMap((table) =>
        table.server ? [[table.server.id, table.server] as const] : []
      ),
    ).values(),
  ];
  const activeTurns = [
    ...new Map(
      view.floor.tables.flatMap((table) =>
        table.turn
          ? [[
              table.turn.id,
              {
                ...table.turn,
                party: table.party,
                tableLabels: view.floor.tables
                  .filter(
                    (candidate) => candidate.turn?.id === table.turn?.id,
                  )
                  .map((candidate) => candidate.label),
              },
            ] as const]
          : []
      ),
    ).values(),
  ];
  const selectedMoveTurn =
    activeTurns.find((turn) => turn.id === selectedMoveTurnId) ?? null;

  const confirm = () => {
    if (!selectedDemand || !selectedOption) return;
    const idempotencyKey =
      `seat:${selectedDemand.id}:${Date.now()}:${crypto.randomUUID()}`;
    startTransition(async () => {
      const next = await executeRestaurantFloorCommand({
        kind: "assign",
        idempotencyKey,
        expectedVersion: selectedOption.expectedVersion,
        interval: selectedOption.interval,
        entityRefs: {
          demandId: selectedDemand.id,
          resourceIds: selectedOption.resourceIds,
        },
      });
      setResult(next);
      if (next.status === "confirmed") {
        setSelectedDemandId(null);
        setSelectedOption(null);
        router.refresh();
      }
    });
  };

  const advanceTurn = (
    turn: (typeof activeTurns)[number],
    next: { stage: HospitalityServiceTurnStage; label: string },
  ) => {
    const idempotencyKey =
      `turn:${turn.id}:${next.stage}:${turn.version}:${crypto.randomUUID()}`;
    startTransition(async () => {
      const nextResult = await advanceRestaurantServiceTurn({
        idempotencyKey,
        serviceTurnId: turn.id,
        expectedVersion: turn.version,
        stage: next.stage,
      });
      setResult(nextResult);
      if (nextResult.status === "confirmed") router.refresh();
    });
  };

  const confirmMove = () => {
    if (!selectedMoveCommand || !selectedMoveOption) return;
    const idempotencyKey =
      `move:${selectedMoveCommand.serviceTurnId}:${selectedMoveCommand.expectedTurnVersion}:${crypto.randomUUID()}`;
    startTransition(async () => {
      const nextResult = await moveRestaurantParty({
        idempotencyKey,
        serviceTurnId: selectedMoveCommand.serviceTurnId,
        expectedTurnVersion: selectedMoveCommand.expectedTurnVersion,
        expectedSeatingVersion: selectedMoveOption.expectedVersion,
        interval: selectedMoveOption.interval,
        resourceIds: selectedMoveOption.resourceIds,
      });
      setResult(nextResult);
      if (nextResult.status === "confirmed") {
        setSelectedMoveTurnId(null);
        setSelectedMoveOption(null);
        router.refresh();
      }
    });
  };

  return (
    <section
      aria-labelledby="restaurant-floor-heading"
      className="grid gap-4"
      data-testid="restaurant-floor-operations"
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="restaurant-floor-heading" className="text-lg font-semibold">
            Floor right now
          </h2>
          <p className="text-sm text-[var(--dpf-muted)]">
            Choose a waiting party, review compatible tables, then confirm.
          </p>
        </div>
        <p className="text-xs text-[var(--dpf-muted)]">
          Updated {new Date(view.floor.asOf).toLocaleTimeString()}
        </p>
      </header>

      {resultNotice(result)}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 gap-4">
          {scene ? (
            <CartesianSceneCanvas
              ariaLabel="Live restaurant floor"
              scene={scene.layout}
              bindings={bindings}
              mode="operate"
              onActivate={(_placementId, entityRef) => {
                if (entityRef.kind === "table") chooseTable(entityRef.id);
              }}
              height={500}
            />
          ) : (
            <Notice variant="warn" title="Floor drawing unavailable">
              Use the equivalent table list below while the saved layout is
              repaired.
            </Notice>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold">
              All tables
            </h3>
            <DataTable
              columns={tableColumns}
              rows={view.floor.tables}
              getRowKey={(table) => table.id}
              empty="No tables are configured."
              dense
            />
          </div>
        </div>

        <aside className="grid content-start gap-4">
          {activeTurns.length > 0 ? (
            <section
              aria-labelledby="active-tables-heading"
              className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
            >
              <h3 id="active-tables-heading" className="text-sm font-semibold">
                Active tables
              </h3>
              <ul className="mt-2 grid gap-2">
                {activeTurns.map((turn) => {
                  const next = nextTurnAction(turn.stage);
                  const move = (view.moves ?? []).find(
                    (candidate) => candidate.serviceTurnId === turn.id,
                  );
                  const choosingMove = selectedMoveTurnId === turn.id;
                  return (
                    <li
                      key={turn.id}
                      className="rounded-md border border-[var(--dpf-border)] p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span>
                          <span className="block font-medium">
                            {turn.tableLabels.join(" + ")}
                          </span>
                          <span className="text-xs text-[var(--dpf-muted)]">
                            {turn.party
                              ? `${turn.party.name} · ${turn.party.covers} guests`
                              : "Party details unavailable"}
                          </span>
                        </span>
                        <StatusBadge
                          intent={resolveIntent(
                            "restaurantFloor",
                            turn.stage,
                          )}
                          label={
                            turn.stage === "dirty"
                              ? "Needs clearing"
                              : turn.stage.charAt(0).toUpperCase() +
                                turn.stage.slice(1)
                          }
                          variant="soft"
                        />
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {next ? (
                          <button
                            type="button"
                            className="min-h-11 rounded-md border border-[var(--dpf-border)] px-3 text-sm font-semibold hover:bg-[var(--dpf-surface-2)] disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={pending}
                            onClick={() => advanceTurn(turn, next)}
                          >
                            {pending ? "Updating…" : next.label}
                          </button>
                        ) : null}
                        {move && move.options.length > 0 ? (
                          <button
                            type="button"
                            aria-expanded={choosingMove}
                            className="min-h-11 rounded-md border border-[var(--dpf-border)] px-3 text-sm font-semibold hover:bg-[var(--dpf-surface-2)] disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={pending}
                            onClick={() => {
                              setSelectedMoveTurnId(
                                choosingMove ? null : turn.id,
                              );
                              setSelectedMoveOption(null);
                              setResult(null);
                            }}
                          >
                            Move party
                          </button>
                        ) : null}
                      </div>
                      {choosingMove && move ? (
                        <div className="mt-2 grid gap-2">
                          <p className="text-xs text-[var(--dpf-muted)]">
                            Choose a compatible destination:
                          </p>
                          {move.options.map((option) => (
                            <button
                              key={option.resourceIds.join(",")}
                              type="button"
                              className="min-h-11 rounded-md border border-[var(--dpf-border)] px-3 text-left text-sm hover:bg-[var(--dpf-surface-2)]"
                              onClick={() => setSelectedMoveOption(option)}
                            >
                              Move to {option.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {selectedMoveCommand &&
          selectedMoveTurn &&
          selectedMoveOption ? (
            <section
              aria-labelledby="move-preview-heading"
              className="rounded-lg border border-[var(--dpf-accent)] bg-[var(--dpf-surface-1)] p-3"
            >
              <h3 id="move-preview-heading" className="text-sm font-semibold">
                Confirm table move
              </h3>
              <p className="mt-2 text-sm">
                Move {selectedMoveTurn.party?.name ?? "this party"} to{" "}
                {selectedMoveOption.label}.
              </p>
              <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                Their current table will be released only after the new
                assignment commits.
              </p>
              <button
                type="button"
                className="mt-3 min-h-11 w-full rounded-md bg-[var(--dpf-accent)] px-4 font-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={pending}
                onClick={confirmMove}
              >
                {pending ? "Moving…" : "Confirm move"}
              </button>
            </section>
          ) : null}

          <section
            aria-labelledby="waiting-parties-heading"
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
          >
            <h3 id="waiting-parties-heading" className="text-sm font-semibold">
              Waiting parties
            </h3>
            {view.floor.demand.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--dpf-muted)]">
                No party is waiting.
              </p>
            ) : (
              <ul className="mt-2 grid gap-2">
                {view.floor.demand.map((demand) => (
                  <li key={demand.id}>
                    <button
                      type="button"
                      aria-pressed={selectedDemandId === demand.id}
                      className="flex min-h-12 w-full items-center justify-between gap-3 rounded-md border border-[var(--dpf-border)] px-3 py-2 text-left hover:bg-[var(--dpf-surface-2)]"
                      onClick={() => chooseDemand(demand.id)}
                    >
                      <span>
                        <span className="block font-medium">{demand.name}</span>
                        <span className="text-xs text-[var(--dpf-muted)]">
                          {demand.covers} guests
                          {demand.waitedMinutes != null
                            ? ` · waiting ${demand.waitedMinutes} min`
                            : ""}
                          {demand.hasDietaryNote
                            ? " · dietary note"
                            : ""}
                        </span>
                      </span>
                      <StatusBadge
                        intent={
                          demand.waitedMinutes != null &&
                            demand.waitedMinutes >= 15
                            ? "warning"
                            : "info"
                        }
                        label={demand.kind === "walk-in" ? "Walk-in" : "Reserved"}
                        variant="soft"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            aria-labelledby="server-load-heading"
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
          >
            <h3 id="server-load-heading" className="text-sm font-semibold">
              Server load
            </h3>
            {servers.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--dpf-muted)]">
                Server not assigned.
              </p>
            ) : (
              <ul className="mt-2 grid gap-2">
                {servers.map((server) => (
                  <li
                    key={server.id}
                    className="flex min-h-11 items-center justify-between rounded-md border border-[var(--dpf-border)] px-3"
                  >
                    <span>
                      <span className="block font-medium">{server.name}</span>
                      <span className="text-xs text-[var(--dpf-muted)]">
                        {server.sectionLabel}
                      </span>
                    </span>
                    <span className="text-sm">{server.tableCount} tables</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {selectedDemand && selectedOption ? (
            <section
              aria-labelledby="assignment-preview-heading"
              className="rounded-lg border border-[var(--dpf-accent)] bg-[var(--dpf-surface-1)] p-3"
            >
              <h3
                id="assignment-preview-heading"
                className="text-sm font-semibold"
              >
                Confirm assignment
              </h3>
              <p className="mt-2 text-sm">
                Seat {selectedDemand.name} ({selectedDemand.covers}) at{" "}
                {selectedOption.label}.
              </p>
              <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                This starts the table turn and removes the party from the
                waiting queue.
              </p>
              <button
                type="button"
                className="mt-3 min-h-11 w-full rounded-md bg-[var(--dpf-accent)] px-4 font-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={pending}
                onClick={confirm}
              >
                {pending ? "Confirming…" : "Confirm seating"}
              </button>
            </section>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
