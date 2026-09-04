import Link from "next/link";
import { redirect } from "next/navigation";
import { PawPrint, TriangleAlert } from "lucide-react";
import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { OWNER_FIRST_NEXT_ACTION_ATTR } from "@/lib/owner-first/ux-audit";
import { Surface } from "@/components/ui/Surface";
import { WardList, type WardListRow } from "@/components/ward/WardList";
import {
  WardOperations,
  type WardOperationAnimal,
  type WardOperationResource,
} from "@/components/ward/WardOperations";
import { loadWardBoard, type WardStoreClient } from "@/lib/ward/ward-store";
import { summarizeKennelCapacity, type WardUnit } from "@/lib/ward/ward-occupancy";

type Props = { searchParams: Promise<{ view?: string }> };

/**
 * The ward board. A shelter's operators asked two questions all day that the
 * product could not answer — where is this animal, and how many kennels are
 * free — so those are the two things this page says first.
 *
 * Occupied and free are drawn, not counted: a free run is a gap you can see
 * from the doorway, which is how a capacity conversation actually happens.
 */
export default async function WardPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const asList = (await searchParams).view === "list";

  const config = await prisma.storefrontConfig.findFirst({
    select: { organizationId: true },
  });
  const board = config
    ? await loadWardBoard({
        organizationId: config.organizationId,
        db: prisma as unknown as WardStoreClient,
      })
    : null;
  const capacity = summarizeKennelCapacity(board);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        {/* Lead band: the worker's marked place to start. Short sentences keep the
            readability budget met with workspace chrome in the measured HTML. */}
        <div data-dpf-lead>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
            Operations
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--dpf-text)]">Ward</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">
            Where every animal is, and what is free.
          </p>
        </div>

        {capacity ? (
          <div className="flex items-end gap-5">
            <div>
              <p className="text-2xl font-semibold tabular-nums text-[var(--dpf-text)]">
                {capacity.occupied}
                <span className="text-sm font-normal text-[var(--dpf-muted)]"> of {capacity.total} occupied</span>
              </p>
              <p className="text-xs text-[var(--dpf-muted)]">
                <span className="font-medium text-[var(--dpf-accent)]">{capacity.free} free</span>
                {capacity.outOfService > 0 ? ` · ${capacity.outOfService} out of service` : ""}
              </p>
            </div>
            <div className="flex rounded-md border border-[var(--dpf-border)] p-0.5">
              <ViewTab href="/workspace/ward" label="Map" active={!asList} />
              <ViewTab href="/workspace/ward?view=list" label="List" active={asList} />
            </div>
          </div>
        ) : null}
      </div>

      {board == null ? (
        <>
          <Surface padding="lg">
            <p className="text-sm font-medium text-[var(--dpf-text)]">No housing recorded yet</p>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--dpf-muted)]">
              Not the same as having no room. Add a kennel or foster home below.
            </p>
          </Surface>
          <Surface padding="lg">
            <WardOperations animals={[]} resources={[]} />
          </Surface>
        </>
      ) : (
        <>
          {board.unplaced.length > 0 ? (
            <Surface className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--dpf-muted)]" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-[var(--dpf-text)]">
                  {board.unplaced.length} in care with no kennel recorded
                </p>
                <p className="mt-1 text-sm text-[var(--dpf-muted)]">
                  {board.unplaced.map((animal) => animal.name).join(" · ")}. The free count covers
                  only the animals the board can place.
                </p>
              </div>
            </Surface>
          ) : null}

          {asList ? <WardList rows={wardListRows(board)} /> : <WardMap board={board} />}
          <Surface padding="lg">
            <WardOperations {...wardOperationData(board)} />
          </Surface>
        </>
      )}
    </div>
  );
}

function wardOperationData(
  board: NonNullable<Awaited<ReturnType<typeof loadWardBoard>>>,
): { animals: WardOperationAnimal[]; resources: WardOperationResource[] } {
  const resources: WardOperationResource[] = board.zones.flatMap((zone) =>
    zone.units.map((unit) => ({
      id: unit.kennelId,
      label: unit.label,
      kindSlug: unit.kindSlug,
      capacity: unit.capacity,
      occupied: unit.occupants.length,
      available: unit.blockedReason ? 0 : Math.max(unit.capacity - unit.occupants.length, 0),
      blockedReason: unit.blockedReason,
      version: unit.version,
    })),
  );
  const placed: WardOperationAnimal[] = board.zones.flatMap((zone) =>
    zone.units.flatMap((unit) =>
      unit.occupants.map((occupant) => ({
        animalRef: occupant.animalRef,
        name: occupant.animalName,
        allocationId: occupant.allocationId,
        resourceId: unit.kennelId,
      })),
    ),
  );
  return {
    resources,
    animals: [
      ...placed,
      ...board.unplaced.map((animal) => ({ ...animal, allocationId: null, resourceId: null })),
    ].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function ViewTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      // The board is read-only, so the view the worker is NOT on is the honest
      // next step on this page — not a write it cannot yet perform.
      {...(active ? {} : { [OWNER_FIRST_NEXT_ACTION_ATTR]: "true" })}
      aria-current={active ? "page" : undefined}
      className={[
        "rounded px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
          : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

/** A free run is drawn as an outline so it reads as a gap, not as a card. */
function isDrawnAsCard(state: WardUnit["state"]): boolean {
  return state !== "free";
}

function WardMap({ board }: { board: NonNullable<Awaited<ReturnType<typeof loadWardBoard>>> }) {
  return (
    <div className="space-y-4">
      {board.zones.map((zone) => (
        <Surface as="section" key={zone.area}>
          <div className="mb-3 flex flex-wrap items-baseline gap-3">
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">{zone.area}</h2>
            <span className="text-xs text-[var(--dpf-muted)]">
              {zone.free} free of {zone.units.length}
              {zone.outOfService > 0 ? ` · ${zone.outOfService} out of service` : ""}
            </span>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
            {zone.units.map((unit) => (
              <UnitCell key={unit.kennelId} unit={unit} />
            ))}
          </ul>
        </Surface>
      ))}
    </div>
  );
}

function UnitCell({ unit }: { unit: WardUnit }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium tabular-nums text-[var(--dpf-muted)]">{unit.label}</span>
        {unit.state === "occupied" ? (
          <PawPrint className="h-3.5 w-3.5 shrink-0 text-[var(--dpf-accent)]" aria-hidden="true" />
        ) : null}
      </div>
      {unit.animalName ? (
        <p className="mt-1.5 text-sm font-medium leading-tight text-[var(--dpf-text)]">
          {unit.animalName}
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-[var(--dpf-muted)]">{unit.blockedReason ?? "Free"}</p>
      )}
    </>
  );

  if (isDrawnAsCard(unit.state)) {
    return (
      <Surface
        as="li"
        padding="sm"
        rounded="md"
        level={unit.state === "out-of-service" ? 2 : 1}
        className="min-h-[74px]"
      >
        {body}
      </Surface>
    );
  }

  return (
    <li className="min-h-[74px] rounded-md border border-dashed border-[var(--dpf-border)] p-3">
      {body}
    </li>
  );
}

function wardListRows(
  board: NonNullable<Awaited<ReturnType<typeof loadWardBoard>>>,
): WardListRow[] {
  return board.zones.flatMap((zone) =>
    zone.units.map((unit) => ({
      kennelId: unit.kennelId,
      label: unit.label,
      area: zone.area,
      animalName: unit.animalName,
      state: unit.state,
      blockedReason: unit.blockedReason,
    })),
  );
}
