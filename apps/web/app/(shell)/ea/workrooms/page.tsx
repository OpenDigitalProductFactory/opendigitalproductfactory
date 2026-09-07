import Link from "next/link";
import { prisma } from "@dpf/db";

import { EaTabNav } from "@/components/ea/EaTabNav";
import { Surface } from "@/components/ui/Surface";
import { EmptyState, StatCard, StatusBadge } from "@/components/ui/report-kit";
import { loadWorkroomArchitecture, loadWorkroomCoordination } from "@/lib/ea/workroom-architecture";

export const dynamic = "force-dynamic";

function HumanGateList({ triggers }: { triggers: Array<{ triggerPoint: string; requiredRole: string; escalationTimeoutMinutes: number }> }) {
  if (triggers.length === 0) return <p className="text-xs text-[var(--dpf-muted)]">No human checks are set.</p>;
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

export default async function WorkroomArchitecturePage({ searchParams }: { searchParams?: Promise<{ operation?: string }> } = {}) {
  const operation = (await searchParams)?.operation;
  const [bands, coordination] = await Promise.all([loadWorkroomArchitecture(prisma), loadWorkroomCoordination(prisma, new Date(), { teamId: operation === "unmapped" ? null : operation })]);
  const definitions = bands.flatMap((band) => band.definitions);
  const instanceCount = definitions.reduce((total, definition) => total + definition.instanceCount, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Enterprise Architecture</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-[var(--dpf-muted)]">
          Connect team plans to actual work.
        </p>
      </div>
      <EaTabNav />

      <Surface data-dpf-lead className="my-6" rounded="xl">
        <p className="text-sm font-medium text-[var(--dpf-text)]">
          {definitions.length === 0
            ? "No Workroom plans are set yet."
            : `${definitions.length} Workroom plan${definitions.length === 1 ? "" : "s"} guide work in ${bands.filter((band) => band.definitions.length > 0).length} portfolios.`}
        </p>
        <Link data-owner-first-next-action href={definitions.length > 0 ? `#portfolio-${bands.find((band) => band.definitions.length > 0)?.role ?? "foundational"}` : "/ea/value-streams"} className="mt-3 inline-block text-xs font-medium text-[var(--dpf-accent)] hover:underline">
          {definitions.length > 0 ? "Review Workroom plans" : "Review value streams"}
        </Link>
      </Surface>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Workroom plans" value={definitions.length} hint="Active value stream teams" />
        <StatCard label="Linked rooms" value={instanceCount} href="#coordination" hint="Includes completed work" />
        <StatCard label="Portfolios" value={`${bands.filter((band) => band.definitions.length > 0).length} / 4`} hint="All four stay in view" />
      </div>

      <Surface id="coordination" className="mb-6" rounded="xl">
        <details open={Boolean(operation)}>
          <summary className="min-h-11 cursor-pointer text-base font-semibold text-[var(--dpf-text)]">Coordination · {coordination.rooms.length}{coordination.truncated ? "+" : ""} open</summary>
          <p className="my-2 text-xs text-[var(--dpf-muted)]">Observed: {coordination.readAt}</p>
          {operation ? <Link href="/ea/workrooms#coordination" className="inline-flex min-h-11 items-center text-sm text-[var(--dpf-accent)]">All operations</Link> : null}
          {coordination.truncated ? <p className="text-sm text-[var(--dpf-muted)]">More rooms exist</p> : null}
          <ul className="divide-y divide-[var(--dpf-border)]">
            {coordination.rooms.map((room) => <li key={room.roomId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <Link href={room.href} className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--dpf-accent)] hover:underline">{room.title}</Link>
                <p className="text-xs text-[var(--dpf-muted)]">{definitions.find((definition) => definition.id === room.teamId)?.name ?? "No value stream linked"}</p>
              </div>
              <StatusBadge domain="workroom" status={room.status} size="md" uppercase={false} />
            </li>)}
          </ul>
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
              <StatusBadge intent={band.definitions.length > 0 ? "success" : "neutral"} label={`${band.definitions.length} definition${band.definitions.length === 1 ? "" : "s"}`} uppercase={false} />
            </div>
            {band.definitions.length === 0 ? (
              <EmptyState size="sm" title={`No ${band.label} Workroom plans yet`} description="Set up a value stream team to show its room here." />
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
