"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { LocalTime } from "@/components/ui/LocalTime";
import { InlineBusy } from "@/components/ui/InlineBusy";
import { DataTable, type Column } from "@/components/ui/report-kit/DataTable";
import { Notice } from "@/components/ui/report-kit/Notice";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import {
  intentStyle,
  resolveIntent,
  type Intent,
} from "@/components/ui/report-kit/statusColors";
import { CartesianSceneCanvas } from "@/components/twin/cartesian/CartesianSceneCanvas";
import { createClientOperationId } from "@/lib/client-operation-id";
import type { HospitalityServiceTurnStage } from "@/lib/storefront/hospitality-service-turn";
import {
  advanceRestaurantServiceTurn,
  executeRestaurantFloorCommand,
  moveRestaurantParty,
} from "@/lib/twin/restaurant-floor-actions";
import type {
  RestaurantFloorCommandDemand,
  RestaurantFloorCommandOption,
  RestaurantFloorOperationalView,
} from "@/lib/twin/restaurant-floor-loader.server";
import type { RestaurantFloorTable } from "@/lib/twin/restaurant-floor-projection";
import {
  deriveRestaurantHostPulse,
  deriveRestaurantHostTurns,
  deriveRestaurantServerLoad,
  rankRestaurantDemand,
} from "@/lib/twin/restaurant-host-console";
import type { RestaurantOperationalScene } from "@/lib/twin/restaurant-scene-layout";
import type { OperationalCommandResult } from "@/lib/twin/operations-command";

export interface RestaurantFloorOperationsProps {
  view: RestaurantFloorOperationalView;
  scene: RestaurantOperationalScene | null;
  /** Parent-owned cross-channel attention; rendered as an in-console overlay. */
  serviceAttention?: ReactNode;
}

type QueueFilter = "all" | "walk-in" | "reservation";
type CenterView = "floor" | "list";

function commandFor(
  commands: readonly RestaurantFloorCommandDemand[],
  demandId: string | null,
): RestaurantFloorCommandDemand | null {
  return commands.find((command) => command.demandId === demandId) ?? null;
}

function recommendedOption(
  view: RestaurantFloorOperationalView,
  demandId: string | null,
): RestaurantFloorCommandOption | null {
  const demand = view.floor.demand.find((candidate) => candidate.id === demandId);
  const command = commandFor(view.commands, demandId);
  if (!command) return null;
  return command.options.find((option) =>
    demand?.recommendation?.tableIds.every((id) => option.resourceIds.includes(id))
  ) ?? command.options[0] ?? null;
}

function resultNotice(result: OperationalCommandResult | null) {
  if (!result) return null;
  if (result.status === "confirmed") {
    const stageChanged = result.changedFacts.some((fact) => fact.field === "stage");
    const resourcesChanged = result.changedFacts.some(
      (fact) => fact.field === "resourceIds",
    );
    const partySeated = result.changedFacts.some(
      (fact) => fact.field === "status" && fact.value === "seated",
    );
    return (
      <Notice
        variant="success"
        title={stageChanged ? "Table status updated" : partySeated ? "Party seated" : resourcesChanged ? "Party moved" : "Party seated"}
      >
        The change is confirmed and the live floor is refreshing.
      </Notice>
    );
  }
  if (result.status === "conflict") {
    return (
      <Notice variant="warn" title="Floor changed before confirmation">
        Nothing changed. Review the refreshed choices and confirm again.
      </Notice>
    );
  }
  return (
    <Notice variant="warn" title="Change not made">
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

function pulseIntent(
  value: number,
  kind: "waiting" | "action" | "positive",
): Intent {
  if (kind === "positive") return value > 0 ? "success" : "neutral";
  return value > 0 ? (kind === "action" ? "warning" : "info") : "neutral";
}

export function RestaurantFloorOperations({
  view,
  scene,
  serviceAttention,
}: RestaurantFloorOperationsProps) {
  const router = useRouter();
  const rankedDemand = useMemo(() => rankRestaurantDemand(view.floor), [view.floor]);
  const initialDemandId = rankedDemand[0]?.id ?? null;
  const [selectedDemandId, setSelectedDemandId] = useState<string | null>(
    initialDemandId,
  );
  const [selectedOption, setSelectedOption] =
    useState<RestaurantFloorCommandOption | null>(() =>
      recommendedOption(view, initialDemandId)
    );
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [centerView, setCenterView] = useState<CenterView>("floor");
  const [result, setResult] = useState<OperationalCommandResult | null>(null);
  const conflictNoticeRef = useRef<HTMLDivElement>(null);
  const [selectedMoveTurnId, setSelectedMoveTurnId] = useState<string | null>(null);
  const [selectedMoveOption, setSelectedMoveOption] =
    useState<RestaurantFloorCommandOption | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedDemand = view.floor.demand.find(
    (demand) => demand.id === selectedDemandId,
  ) ?? null;
  const availableCommand = commandFor(view.commands, selectedDemandId);
  const selectedMoveCommand = (view.moves ?? []).find(
    (move) => move.serviceTurnId === selectedMoveTurnId,
  ) ?? null;
  const pulse = useMemo(() => deriveRestaurantHostPulse(view.floor), [view.floor]);
  const reservationWatch = view.reservationWatch ?? [];
  const lateReservationCount = reservationWatch.filter(
    (reservation) => reservation.state === "late",
  ).length;
  const actionsNow = pulse.needsAction + lateReservationCount;
  const servers = useMemo(
    () => deriveRestaurantServerLoad(view.floor.tables),
    [view.floor.tables],
  );
  const activeTurns = useMemo(
    () => deriveRestaurantHostTurns(view.floor.tables),
    [view.floor.tables],
  );
  const selectedMoveTurn = activeTurns.find(
    (turn) => turn.id === selectedMoveTurnId,
  ) ?? null;
  const filteredDemand = rankedDemand.filter(
    (demand) => queueFilter === "all" || demand.kind === queueFilter,
  );

  const chooseDemand = (demandId: string) => {
    setSelectedDemandId(demandId);
    setSelectedOption(recommendedOption(view, demandId));
    setResult(null);
  };

  const chooseTable = (resourceId: string) => {
    const option = availableCommand?.options.find((candidate) =>
      candidate.resourceIds.includes(resourceId)
    );
    if (option) {
      setSelectedOption(option);
      setResult(null);
    }
  };

  const refreshAfterConflict = () => {
    setSelectedDemandId(null);
    setSelectedOption(null);
    setSelectedMoveTurnId(null);
    setSelectedMoveOption(null);
    router.refresh();
  };

  useEffect(() => {
    if (result?.status === "conflict") conflictNoticeRef.current?.focus();
  }, [result]);

  const bindings = useMemo(
    () => Object.fromEntries(view.floor.tables.map((table) => [
      `table:${table.id}`,
      {
        label: table.label,
        statusLabel: table.statusLabel,
        sublabel: `${table.capacity} seats · ${table.server?.name ?? "Unassigned"}`,
        intent: resolveIntent("restaurantFloor", table.state),
        cogSuggested: selectedOption?.resourceIds.includes(table.id) ?? false,
      },
    ])),
    [selectedOption, view.floor.tables],
  );

  const tableColumns = useMemo<Column<RestaurantFloorTable>[]>(() => [
    {
      key: "table",
      header: "Table",
      cell: (table) => (
        <span>
          <span className="block font-dpf-medium">{table.label}</span>
          <span className="text-dpf-caption text-dpf-muted">
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
    },
    {
      key: "server",
      header: "Server",
      cell: (table) => table.server?.name ?? "Not assigned",
    },
    {
      key: "availability",
      header: "Ready",
      cell: (table) => table.availability.reason,
    },
    {
      key: "action",
      header: "Seat here",
      cell: (table) => {
        const option = availableCommand?.options.find((candidate) =>
          candidate.resourceIds.includes(table.id)
        );
        return option ? (
          <button
            type="button"
            aria-pressed={selectedOption?.resourceIds.includes(table.id)}
            className="dpf-tap-target rounded-dpf-md border border-dpf-border px-dpf-sm text-dpf-body font-dpf-medium hover:bg-dpf-surface-2"
            disabled={pending}
            onClick={() => chooseTable(table.id)}
          >
            {selectedOption?.resourceIds.includes(table.id) ? "Selected" : "Choose"}
          </button>
        ) : (
          <span className="text-dpf-caption text-dpf-muted">Not compatible</span>
        );
      },
    },
  ], [availableCommand, pending, selectedOption]);

  const confirm = () => {
    if (!selectedDemand || !selectedOption) return;
    startTransition(async () => {
      const next = await executeRestaurantFloorCommand({
        kind: "assign",
        idempotencyKey: `seat:${selectedDemand.id}:${Date.now()}:${createClientOperationId()}`,
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
      } else if (next.status === "conflict") {
        refreshAfterConflict();
      }
    });
  };

  const advanceTurn = (
    turn: (typeof activeTurns)[number],
    next: { stage: HospitalityServiceTurnStage; label: string },
  ) => {
    startTransition(async () => {
      const nextResult = await advanceRestaurantServiceTurn({
        idempotencyKey: `turn:${turn.id}:${next.stage}:${turn.version}:${createClientOperationId()}`,
        serviceTurnId: turn.id,
        expectedVersion: turn.version,
        stage: next.stage,
      });
      setResult(nextResult);
      if (nextResult.status === "confirmed") router.refresh();
      else if (nextResult.status === "conflict") refreshAfterConflict();
    });
  };

  const confirmMove = () => {
    if (!selectedMoveCommand || !selectedMoveOption) return;
    startTransition(async () => {
      const nextResult = await moveRestaurantParty({
        idempotencyKey: `move:${selectedMoveCommand.serviceTurnId}:${selectedMoveCommand.expectedTurnVersion}:${createClientOperationId()}`,
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
      } else if (nextResult.status === "conflict") {
        refreshAfterConflict();
      }
    });
  };

  return (
    <section
      aria-labelledby="restaurant-host-heading"
      className="flex min-w-0 flex-col gap-dpf-sm overflow-visible rounded-dpf-xl border border-dpf-border bg-dpf-bg p-dpf-sm shadow-dpf-sm lg:h-[clamp(38rem,calc(100dvh-8rem),64rem)] lg:overflow-hidden"
      data-testid="restaurant-host-command-center"
      data-dpf-density="compact"
    >
      <header className="grid shrink-0 gap-dpf-sm rounded-dpf-lg bg-dpf-surface-1 px-dpf-md py-dpf-sm lg:grid-cols-[minmax(15rem,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-dpf-sm">
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-dpf-accent-soft text-dpf-accent" aria-hidden="true">✦</span>
            <div>
              <h2 id="restaurant-host-heading" className="text-dpf-title font-dpf-semibold text-dpf-text">Host stand</h2>
              <p className="text-dpf-caption text-dpf-muted">
                AI-ranked service decisions · updated <LocalTime value={view.floor.asOf} mode="time" />
              </p>
              {serviceAttention ? (
                <details className="relative mt-1">
                  <summary className="dpf-tap-target cursor-pointer text-dpf-caption font-dpf-semibold text-dpf-accent hover:underline">
                    Orders, calls and messages
                  </summary>
                  <div className="absolute left-0 top-full z-30 mt-dpf-xs max-h-[min(32rem,70dvh)] w-[min(36rem,82vw)] overflow-y-auto rounded-dpf-lg border border-dpf-border bg-dpf-surface-1 p-dpf-md shadow-dpf-lg">
                    {serviceAttention}
                  </div>
                </details>
              ) : null}
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-4 gap-dpf-xs" aria-label="Restaurant pulse">
          {[
            ["Waiting", pulse.waiting, pulseIntent(pulse.waiting, "waiting")],
            ["Open now", pulse.availableNow, pulseIntent(pulse.availableNow, "positive")],
            ["Turning", pulse.turningSoon, "info"],
            ["Act now", actionsNow, pulseIntent(actionsNow, "action")],
          ].map(([label, value, intent]) => (
            <div
              key={label}
              className="min-w-[5.25rem] rounded-dpf-md border bg-dpf-bg px-dpf-sm py-dpf-xs text-center"
              data-intent={intent}
              style={{
                borderColor: intentStyle(intent as Intent).border,
                backgroundColor: intentStyle(intent as Intent).softBg,
              }}
            >
              <dt className="text-dpf-caption text-dpf-muted">{label}</dt>
              <dd className="text-dpf-title font-dpf-semibold text-dpf-text">{value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div
        ref={conflictNoticeRef}
        role={result?.status === "conflict" ? "alert" : "status"}
        aria-live={result?.status === "conflict" ? "assertive" : "polite"}
        aria-atomic="true"
        tabIndex={result?.status === "conflict" ? -1 : undefined}
      >
        {resultNotice(result)}
      </div>

      <div
        className="grid min-h-0 gap-dpf-sm lg:flex-1"
        data-testid="restaurant-host-workspace"
        style={{
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 28rem), 1fr))",
        }}
      >
        <section aria-labelledby="waiting-now-heading" className="flex min-h-[18rem] max-h-[28rem] flex-col overflow-hidden rounded-dpf-lg border border-dpf-border bg-dpf-surface-1 lg:min-h-0 lg:max-h-none">
          <div className="shrink-0 border-b border-dpf-border p-dpf-sm">
            <div className="flex items-center justify-between gap-dpf-sm">
              <h3 id="waiting-now-heading" className="text-dpf-body font-dpf-semibold text-dpf-text">Waiting now</h3>
              <span className="text-dpf-caption text-dpf-muted">Priority order</span>
            </div>
            <div className="mt-dpf-xs flex gap-1" aria-label="Filter waiting parties">
              {(["all", "walk-in", "reservation"] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  aria-pressed={queueFilter === filter}
                  className="dpf-tap-target rounded-dpf-md border border-dpf-border px-dpf-xs text-dpf-caption font-dpf-medium text-dpf-text aria-pressed:bg-dpf-accent-soft aria-pressed:text-dpf-accent"
                  onClick={() => setQueueFilter(filter)}
                >
                  {filter === "all" ? "All" : filter === "walk-in" ? "Walk-ins" : "Reservations"}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-dpf-xs">
            {filteredDemand.length === 0 ? (
              <p className="p-dpf-sm text-dpf-body text-dpf-muted">No party is waiting.</p>
            ) : (
              <ol className="grid gap-1">
                {filteredDemand.map((demand, index) => (
                  <li key={demand.id}>
                    <button
                      type="button"
                      aria-pressed={selectedDemandId === demand.id}
                      className="dpf-tap-target grid min-h-14 w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-dpf-xs rounded-dpf-md border border-transparent px-dpf-xs py-dpf-xs text-left text-dpf-text hover:bg-dpf-surface-2 aria-pressed:border-dpf-accent aria-pressed:bg-dpf-accent-soft"
                      onClick={() => chooseDemand(demand.id)}
                    >
                      <span className="text-center text-dpf-caption font-dpf-semibold text-dpf-muted">{index + 1}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-dpf-body font-dpf-semibold">{demand.name}</span>
                        <span className="block truncate text-dpf-caption text-dpf-muted">
                          {demand.covers} guests · {demand.waitedMinutes != null ? `waiting ${demand.waitedMinutes} min` : demand.scheduledAt ? <>due <LocalTime value={demand.scheduledAt} mode="time" /></> : "reserved"}
                          {demand.hasDietaryNote ? " · dietary note" : ""}
                        </span>
                      </span>
                      <StatusBadge
                        intent={demand.waitedMinutes != null && demand.waitedMinutes >= 15 ? "warning" : "info"}
                        label={demand.kind === "walk-in" ? "Walk-in" : "Reserved"}
                        variant="soft"
                      />
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        <section aria-label="Floor and tables" className="flex min-h-[30rem] min-w-0 flex-col overflow-hidden rounded-dpf-lg border border-dpf-border bg-dpf-surface-1 lg:min-h-0">
          <div className="flex shrink-0 items-center justify-between gap-dpf-sm border-b border-dpf-border p-dpf-xs">
            <div className="flex gap-1" aria-label="Floor view">
              <button type="button" aria-pressed={centerView === "floor"} className="dpf-tap-target rounded-dpf-md px-dpf-sm text-dpf-body font-dpf-semibold text-dpf-text aria-pressed:bg-dpf-accent-soft aria-pressed:text-dpf-accent" onClick={() => setCenterView("floor")}>Floor</button>
              <button type="button" aria-pressed={centerView === "list"} className="dpf-tap-target rounded-dpf-md px-dpf-sm text-dpf-body font-dpf-semibold text-dpf-text aria-pressed:bg-dpf-accent-soft aria-pressed:text-dpf-accent" onClick={() => setCenterView("list")}>Table list</button>
            </div>
            <p className="text-dpf-caption text-dpf-muted">Tap a table to change the suggestion</p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-dpf-xs">
            {centerView === "floor" ? scene ? (
              <CartesianSceneCanvas
                ariaLabel="Live restaurant floor"
                scene={scene.layout}
                bindings={bindings}
                mode="operate"
                chrome="embedded"
                navigation="locked"
                onActivate={(_placementId, entityRef) => {
                  if (entityRef.kind === "table") chooseTable(entityRef.id);
                }}
                height={500}
                className="h-full"
              />
            ) : (
              <Notice variant="warn" title="Floor drawing unavailable">Use the equivalent table list while the saved layout is repaired.</Notice>
            ) : (
              <DataTable columns={tableColumns} rows={view.floor.tables} getRowKey={(table) => table.id} empty="No tables are configured." dense />
            )}
          </div>
        </section>

        <aside className="grid min-h-0 content-start gap-dpf-sm overflow-visible lg:overflow-y-auto">
          <section aria-labelledby="ai-host-heading" className="rounded-dpf-lg border border-dpf-accent bg-dpf-accent-soft p-dpf-sm">
            <div className="flex items-center gap-dpf-xs">
              <span aria-hidden="true">✦</span>
              <h3 id="ai-host-heading" className="text-dpf-body font-dpf-semibold text-dpf-text">AI host recommends</h3>
            </div>
            {selectedDemand?.recommendation && selectedOption ? (
              <>
                <p className="mt-dpf-sm text-dpf-body font-dpf-semibold text-dpf-text">{selectedDemand.recommendation.reason}</p>
                {selectedDemand.recommendation.warning ? (
                  <p className="mt-dpf-xs text-dpf-caption text-dpf-warning">Check: {selectedDemand.recommendation.warning}</p>
                ) : (
                  <p className="mt-dpf-xs text-dpf-caption text-dpf-muted">Best safe fit from live capacity, timing, and server load.</p>
                )}
                <p className="mt-dpf-sm text-dpf-body text-dpf-text">Seat {selectedDemand.name} ({selectedDemand.covers}) at {selectedOption.label}.</p>
                <button aria-busy={pending} type="button" className="dpf-tap-target mt-dpf-sm w-full rounded-dpf-md bg-dpf-accent px-dpf-md font-dpf-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] disabled:opacity-60" data-dpf-primary-action="true" data-owner-first-next-action="restaurant-confirm-seating" disabled={pending} onClick={confirm}>{pending ? <InlineBusy label="Confirming…" tone="current" /> : "Confirm seating"}</button>
              </>
            ) : (
              <p className="mt-dpf-sm text-dpf-body text-dpf-muted">Choose a party to see the safest live seating choice.</p>
            )}
          </section>

          {reservationWatch.length > 0 ? (
            <section
              aria-labelledby="reservation-watch-heading"
              className="rounded-dpf-lg border border-dpf-border bg-dpf-surface-1 p-dpf-sm"
            >
              <div className="flex items-center justify-between gap-dpf-sm">
                <h3
                  id="reservation-watch-heading"
                  className="text-dpf-body font-dpf-semibold text-dpf-text"
                >
                  Reservations to watch
                </h3>
                {lateReservationCount > 0 ? (
                  <StatusBadge
                    intent="warning"
                    label={`${lateReservationCount} late`}
                    variant="soft"
                  />
                ) : null}
              </div>
              <ul className="mt-dpf-xs grid gap-1">
                {reservationWatch.map((reservation) => (
                  <li
                    key={reservation.id}
                    className="rounded-dpf-md border border-dpf-border px-dpf-xs py-1"
                  >
                    <div className="flex items-center justify-between gap-dpf-xs">
                      <span className="min-w-0">
                        <span className="block truncate text-dpf-caption font-dpf-semibold text-dpf-text">
                          {reservation.name} · {reservation.covers} guests
                        </span>
                        <span className="block truncate text-dpf-caption text-dpf-muted">
                          <LocalTime value={reservation.scheduledAt} mode="time" />
                          {reservation.tableLabels.length > 0
                            ? ` · holding ${reservation.tableLabels.join(" + ")}`
                            : " · table not held"}
                        </span>
                      </span>
                      <StatusBadge
                        intent={reservation.state === "late" ? "warning" : "info"}
                        label={reservation.lateMinutes != null ? `${reservation.lateMinutes} min late` : "Upcoming"}
                        variant="soft"
                      />
                    </div>
                  </li>
                ))}
              </ul>
              {lateReservationCount > 0 ? (
                <p className="mt-dpf-xs text-dpf-caption text-dpf-warning">
                  Confirm guest status before releasing held capacity.
                </p>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby="turns-heading" className="rounded-dpf-lg border border-dpf-border bg-dpf-surface-1 p-dpf-sm">
            <div className="flex items-center justify-between gap-dpf-sm">
              <h3 id="turns-heading" className="text-dpf-body font-dpf-semibold text-dpf-text">Turns needing action</h3>
              <span className="text-dpf-caption text-dpf-muted">{activeTurns.length} active</span>
            </div>
            {activeTurns.length === 0 ? <p className="mt-dpf-xs text-dpf-caption text-dpf-muted">No active tables.</p> : (
              <ul className="mt-dpf-xs grid gap-1">
                {activeTurns.map((turn) => {
                  const next = nextTurnAction(turn.stage);
                  const move = (view.moves ?? []).find((candidate) => candidate.serviceTurnId === turn.id);
                  const choosingMove = selectedMoveTurnId === turn.id;
                  return (
                    <li key={turn.id} className="rounded-dpf-md border border-dpf-border p-dpf-xs">
                      <div className="flex items-center justify-between gap-dpf-xs">
                        <span className="min-w-0"><span className="block truncate text-dpf-body font-dpf-semibold text-dpf-text">{turn.tableLabels.join(" + ")}</span><span className="block truncate text-dpf-caption text-dpf-muted">{turn.party?.name ?? "Party"} · {turn.party?.covers ?? "?"} guests</span></span>
                        <StatusBadge intent={resolveIntent("restaurantFloor", turn.stage)} label={turn.stage === "dirty" ? "Needs clearing" : turn.stage} variant="soft" />
                      </div>
                      <div className="mt-dpf-xs flex gap-1">
                        {next ? <button type="button" className="dpf-tap-target flex-1 rounded-dpf-md border border-dpf-border px-dpf-xs text-dpf-caption font-dpf-semibold text-dpf-text" disabled={pending} onClick={() => advanceTurn(turn, next)}>{next.label}</button> : null}
                        {move?.options.length ? <button type="button" aria-expanded={choosingMove} className="dpf-tap-target rounded-dpf-md border border-dpf-border px-dpf-xs text-dpf-caption font-dpf-semibold text-dpf-text" disabled={pending} onClick={() => { setSelectedMoveTurnId(choosingMove ? null : turn.id); setSelectedMoveOption(null); }}>Move party</button> : null}
                      </div>
                      {choosingMove && move ? <div className="mt-dpf-xs grid gap-1">{move.options.map((option) => <button key={option.resourceIds.join(",")} type="button" aria-pressed={selectedMoveOption?.resourceIds.join(",") === option.resourceIds.join(",")} className="dpf-tap-target rounded-dpf-md bg-dpf-surface-2 px-dpf-xs text-left text-dpf-caption text-dpf-text aria-pressed:outline-2 aria-pressed:outline-dpf-accent" disabled={pending} onClick={() => setSelectedMoveOption(option)}>Move to {option.label}</button>)}</div> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {selectedMoveCommand && selectedMoveTurn && selectedMoveOption ? (
            <section aria-labelledby="move-preview-heading" className="rounded-dpf-lg border border-dpf-accent bg-dpf-surface-1 p-dpf-sm">
              <h3 id="move-preview-heading" className="text-dpf-body font-dpf-semibold text-dpf-text">Confirm table move</h3>
              <p className="mt-dpf-xs text-dpf-caption text-dpf-muted">Move {selectedMoveTurn.party?.name ?? "this party"} to {selectedMoveOption.label}. The current table releases only after confirmation.</p>
              <button aria-busy={pending} type="button" className="dpf-tap-target mt-dpf-sm w-full rounded-dpf-md bg-dpf-accent px-dpf-sm font-dpf-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))]" disabled={pending} onClick={confirmMove}>{pending ? <InlineBusy label="Moving…" tone="current" /> : "Confirm move"}</button>
            </section>
          ) : null}

          <section aria-labelledby="server-load-heading" className="rounded-dpf-lg border border-dpf-border bg-dpf-surface-1 p-dpf-sm">
            <h3 id="server-load-heading" className="text-dpf-body font-dpf-semibold text-dpf-text">Server load</h3>
            {servers.length === 0 ? <p className="mt-dpf-xs text-dpf-caption text-dpf-muted">Server not assigned.</p> : (
              <ul className="mt-dpf-xs grid gap-1">{servers.map((server) => <li key={server.id} className="flex items-center justify-between gap-dpf-sm rounded-dpf-md bg-dpf-surface-2 px-dpf-xs py-1"><span className="min-w-0"><span className="block truncate text-dpf-caption font-dpf-semibold text-dpf-text">{server.name}</span><span className="block truncate text-dpf-caption text-dpf-muted">{server.sectionLabel}</span></span><span className="text-dpf-caption font-dpf-semibold text-dpf-text">{server.tableCount} tables</span></li>)}</ul>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
