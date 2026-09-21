import Link from "next/link";
import type { loadWorkroomCoordination } from "@/lib/ea/workroom-architecture";

type Room = Awaited<ReturnType<typeof loadWorkroomCoordination>>["rooms"][number];
const labels: Record<string, readonly [string, string]> = {
  contains: ["Contains", "Within"], "spawned-from": ["Spawned", "Spawned from"],
  "depends-on": ["Requires", "Required by"], blocks: ["Blocks", "Blocked by"],
  "contributes-to": ["Contributes to", "Receives contribution from"],
};

/** Recorded relationships are context, not a conclusion that work is blocked. */
export function WorkroomCoordinationContext({ accountability, accountableName, relationships, partial }:
  Pick<Room, "accountability" | "accountableName" | "relationships"> & { partial: boolean }) {
  return <details className="mt-2 text-sm text-[var(--dpf-text)]">
    <summary className="min-h-11 cursor-pointer py-3">Owner and links</summary>
    {accountability?.state === "resolved"
      ? <p>{accountableName} · {accountability.source.replaceAll("-", " ")}</p>
      : <p>{accountability?.message ?? "Owner unknown."}</p>}
    {partial ? <p className="text-[var(--dpf-muted)]">Incomplete read. Inspect the room before acting.</p> : null}
    {relationships.length ? <ul className="mt-2 space-y-1">{relationships.map(edge => <li key={edge.id}>
      {labels[edge.relation]?.[edge.direction === "outgoing" ? 0 : 1] ?? `${edge.direction} ${edge.relation}`}:{" "}
      <Link className="inline-flex min-h-11 items-center text-[var(--dpf-accent)] hover:underline" href={edge.href}>{edge.title} · {edge.roomId}</Link>
    </li>)}</ul> : <p>No links observed.</p>}
  </details>;
}
