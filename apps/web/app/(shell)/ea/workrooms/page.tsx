import Link from "next/link";
import { prisma } from "@dpf/db";

import { EaTabNav } from "@/components/ea/EaTabNav";
import { WorkroomCoordinationContext } from "@/components/ea/WorkroomCoordinationContext";
import { Surface } from "@/components/ui/Surface";
import { EmptyState, FilterBar, StatCard, StatusBadge } from "@/components/ui/report-kit";
import { WORK_CAPSULE_STATUSES } from "@/lib/work-capsules";
import { TERMINAL_CAPSULE_STATUSES } from "@/lib/work-capsules/work-capsule-branch-identity";
import { loadRoomInventory, loadWorkroomArchitecture, loadWorkroomCoordination } from "@/lib/ea/workroom-architecture";

export const dynamic = "force-dynamic";

function HumanGateList({ triggers }: { triggers: Array<{ triggerPoint: string; requiredRole: string; escalationTimeoutMinutes: number }> }) {
  if (triggers.length === 0) return <p className="text-xs text-[var(--dpf-muted)]">No checks set.</p>;
  return (
    <ul className="space-y-1 text-xs text-[var(--dpf-muted)]">
      {triggers.map((trigger, index) => (
        <li key={`${trigger.triggerPoint}-${trigger.requiredRole}-${index}`}>
          <span className="font-medium text-[var(--dpf-text)]">{trigger.triggerPoint.replaceAll("-", " ")}</span>
          {` → ${trigger.requiredRole} · escalate after ${trigger.escalationTimeoutMinutes}m`}
        </li>
      ))}
    </ul>
  );
}

export default async function WorkroomArchitecturePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const params = await searchParams ?? {};
  const value = (key: string) => typeof params[key] === "string" ? params[key] : "";
  const operation = value("operation");
  const query = value("coordinationQuery").trim().slice(0, 200);
  const status = value("coordinationStatus");
  const after = value("coordinationAfter");
  const filters = { operation: operation === "all" ? "" : operation, coordinationQuery: query, coordinationStatus: status };
  const coordinationHref = (cursor: string | null) => {
    const context = new URLSearchParams(Object.entries(filters).filter(([, entry]) => entry));
    if (cursor) context.set("coordinationAfter", cursor);
    return `/ea/workrooms?${context}#coordination`;
  };
  const [architecture, coordination, inventory] = await Promise.all([
    loadWorkroomArchitecture(prisma),
    loadWorkroomCoordination(prisma, new Date(), {
      teamId: operation === "unmapped" ? null : !operation || operation === "all" ? undefined : operation,
      query, status, after,
    }),
    loadRoomInventory(prisma),
  ]);
  const { bands, unplaced, truncated: architectureTruncated } = architecture;
  const definitions = bands.flatMap((band) => band.definitions);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Enterprise Architecture</h1>
      </div>
      <EaTabNav />

      <Surface data-dpf-lead className="my-6" rounded="xl">
        {/* Lead with the rooms that EXIST. The plan count is a different
            question, and it is zero on every install because nothing can create
            a team plan — leading with it read as "you have no rooms" while
            hundreds were running (BI-0EB855CC, decision DI-66AC55277576). */}
        <p className="text-sm font-medium text-[var(--dpf-text)]">
          {inventory.openTotal === 0
            ? "No rooms are open."
            : `${inventory.openTotal} room${inventory.openTotal === 1 ? " is" : "s are"} open.`}
        </p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          {inventory.unclassified > 0
            ? `${inventory.unclassified} of them ${inventory.unclassified === 1 ? "has" : "have"} no portfolio recorded. `
            : ""}
          {definitions.length === 0
            ? "No team plans are configured on this install."
            : `${definitions.length} team plan${definitions.length === 1 ? "" : "s"} guide work here.`}
        </p>

        <Link data-owner-first-next-action href="#coordination" className="mt-3 inline-block text-xs font-medium text-[var(--dpf-accent)] hover:underline">
          Review open rooms
        </Link>
      </Surface>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Open rooms" value={inventory.openTotal} href="#coordination" hint="Open only" />
        <StatCard label="No portfolio recorded" value={inventory.unclassified} hint="Never defaulted" />
        <StatCard label="Team plans" value={definitions.length} hint={definitions.length === 0 ? "Not configured on this install" : "Active value stream teams"} />
      </div>

      {architectureTruncated ? (
        <p className="mb-6 text-xs text-[var(--dpf-muted)]">More plans exist.</p>
      ) : null}

      {unplaced.length > 0 ? (
        <Surface id="portfolio-unplaced" className="mb-6" rounded="xl">
          <h2 className="text-base font-semibold text-[var(--dpf-text)]">Not placed in a portfolio · {unplaced.length}</h2>
          <p className="my-2 text-xs text-[var(--dpf-muted)]">Placement needs review.</p>
          <ul className="divide-y divide-[var(--dpf-border)]">
            {unplaced.map((definition) => (
              <li key={definition.id} className="py-3">
                <p className="text-sm font-medium text-[var(--dpf-text)]">{definition.name}</p>
                <p className="text-xs text-[var(--dpf-muted)]">
                  {definition.placement.role === null ? definition.placement.reason : null}
                </p>
              </li>
            ))}
          </ul>
        </Surface>
      ) : null}

      <Surface id="coordination" className="mb-6" rounded="xl">
        <details open={Boolean(operation || query || status || after)}>
          <summary className="min-h-11 cursor-pointer text-base font-semibold text-[var(--dpf-text)]">Coordination · {coordination.rooms.length} shown</summary>
          <p className="my-2 text-xs text-[var(--dpf-muted)]">Open rooms · observed {coordination.readAt}</p>
          <details open={Boolean(query || status)}>
          <summary className="min-h-11 cursor-pointer py-3 text-sm">Find a room</summary>
          <FilterBar mode="url" basePath="/ea/workrooms" value={filters}
            className="my-3 [&_input]:min-h-11 [&_select]:min-h-11 [&_button]:min-h-11 [&_input]:text-sm [&_select]:text-sm [&_button]:text-sm"
            facets={[
              { kind: "search", key: "coordinationQuery", placeholder: "Search room title or ID" },
              { kind: "select", key: "operation", label: "Operation", options: [{ value: "unmapped", label: "No value stream linked" }, ...definitions.map((definition) => ({ value: definition.id, label: definition.name }))] },
              { kind: "select", key: "coordinationStatus", label: "Room status", options: WORK_CAPSULE_STATUSES.filter((candidate) => !TERMINAL_CAPSULE_STATUSES.includes(candidate)).map((candidate) => ({ value: candidate, label: candidate.replaceAll("-", " ") })) },
            ]} />
          </details>
          {!coordination.rooms.length ? <EmptyState size="sm" title="No matching open rooms" description="Change search or filters." /> : null}
          <ul className="divide-y divide-[var(--dpf-border)]">
            {coordination.rooms.map((room) => <li key={room.roomId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <Link href={room.href} className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--dpf-accent)] hover:underline">{room.title}</Link>
                <p className="text-xs text-[var(--dpf-muted)]">{definitions.find((definition) => definition.id === room.teamId)?.name ?? "No value stream linked"}</p>
                <p className="text-xs text-[var(--dpf-muted)]">{room.roomId}</p>
                {room.waitReason ? <p className="mt-1 text-sm text-[var(--dpf-text)]">{room.waitReason}</p> : null}
                <WorkroomCoordinationContext accountability={room.accountability} accountableName={room.accountableName}
                  relationships={room.relationships} partial={coordination.contextPartial} />
              </div>
              <StatusBadge domain="workroom" status={room.status} size="md" uppercase={false} />
            </li>)}
          </ul>
          <nav aria-label="Coordination pages" className="mt-3 flex flex-wrap gap-4 text-sm text-[var(--dpf-accent)]">
            {after ? <Link className="inline-flex min-h-11 items-center" href={coordinationHref(null)}>First page</Link> : null}
            {coordination.nextCursor ? <Link className="inline-flex min-h-11 items-center" href={coordinationHref(coordination.nextCursor)}>Next rooms</Link> : null}
          </nav>
        </details>
      </Surface>

      <div className="space-y-8">
        {bands.map((band) => (
          <section key={band.role} aria-labelledby={`portfolio-${band.role}`} className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[var(--dpf-border)] pb-2">
              <div>
                <p className="text-dpf-caption uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Portfolio</p>
                <h2 id={`portfolio-${band.role}`} className="text-lg font-semibold text-[var(--dpf-text)]">{band.label}</h2>
              </div>
              <StatusBadge intent={inventory.byRole[band.role] > 0 ? "success" : "neutral"} label={`${inventory.byRole[band.role]} open room${inventory.byRole[band.role] === 1 ? "" : "s"}`} uppercase={false} />
            </div>
            {band.definitions.length === 0 ? (
              <EmptyState
                size="sm"
                title={inventory.byRole[band.role] > 0
                  ? `${inventory.byRole[band.role]} open room${inventory.byRole[band.role] === 1 ? "" : "s"} here, none linked to a team plan`
                  : `No open rooms in ${band.label}`}
                description="See Coordination for open rooms."
              />
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {band.definitions.map((definition) => (
                  <Surface as="article" key={definition.id} rounded="xl">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-dpf-caption uppercase tracking-[0.14em] text-[var(--dpf-muted)]">{definition.valueStream.replaceAll("-", " ")}</p>
                        <h3 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">{definition.name}</h3>
                      </div>
                      <StatusBadge intent="info" label={definition.shape.replaceAll("-", " ")} uppercase={false} />
                    </div>

                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <div>
                        <h4 className="text-xs font-semibold text-[var(--dpf-text)]">People</h4>
                        <ul className="mt-1 space-y-1 text-xs text-[var(--dpf-muted)]">
                          {definition.participants.map((participant) => <li key={participant.roleName}>{participant.roleName} · {participant.workerType}</li>)}
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-[var(--dpf-text)]">Queues</h4>
                        <ul className="mt-1 space-y-1 text-xs text-[var(--dpf-muted)]">
                          {definition.queues.map((queue) => <li key={queue.queueId}>{queue.name} · {queue.queueType}</li>)}
                        </ul>
                      </div>
                    </div>

                    <div className="mt-4 border-t border-[var(--dpf-border)] pt-3">
                      <h4 className="text-xs font-semibold text-[var(--dpf-text)]">Human checks</h4>
                      <div className="mt-1"><HumanGateList triggers={definition.triggers} /></div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
                      <Link href={`/ea/workrooms?operation=${encodeURIComponent(definition.id)}#coordination`} className="font-medium text-[var(--dpf-accent)] hover:underline">{definition.instanceCount} linked room{definition.instanceCount === 1 ? "" : "s"}</Link>
                      {definition.eaViewId ? <Link href={`/ea/views/${definition.eaViewId}`} className="font-medium text-[var(--dpf-accent)] hover:underline">Open process view</Link> : <span className="text-[var(--dpf-muted)]">No process view linked</span>}
                      {definition.eaProcessId ? <span className="font-mono text-dpf-caption text-[var(--dpf-muted)]">{definition.eaProcessId}</span> : null}
                    </div>
                  </Surface>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
