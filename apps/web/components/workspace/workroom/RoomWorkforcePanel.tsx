import { Surface } from "@/components/ui/Surface";
import type { EffectiveHumanAccountability } from "@/lib/work-management/human-accountability";
import type { WorkerGroup } from "@/lib/work-management/worker-rollup";

/**
 * Who is accountable for this room, and who is working in it (PWA-03, PWA-04, PWA-06).
 *
 * The panel keeps three things apart that are easy to collapse into one and
 * wrong to conflate:
 *
 * A human is accountable. That is a person answerable for the work, defaulting
 * to the organization's recorded owner and inherited down the responsibility
 * graph unless a room records its own. It is not a permission and it is not a
 * claim that the person is doing anything.
 *
 * AI coordinates and executes. A named worker is a teammate with one identity
 * across every surface it was reached through, and its subagents are grouped
 * under whoever delegated them. None of that transfers accountability.
 *
 * Where the platform recorded nothing, the panel says so. An unset owner reads
 * as setup required, not as the install's first administrator; an unrecorded
 * worker state reads as not recorded, not as idle; unrecorded delegation reads
 * as unknown parentage, not as a plausible parent.
 */

function AccountabilityStatement({
  accountability,
  displayName,
}: {
  accountability: EffectiveHumanAccountability;
  displayName: string | null;
}) {
  if (accountability.state === "setup-required") {
    return (
      <div>
        <p className="text-sm text-[var(--dpf-text)]">No accountable person is recorded.</p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">{accountability.message}</p>
      </div>
    );
  }

  const who = displayName ?? accountability.principalId;
  const depth = accountability.inheritedFrom.length;
  const provenance =
    accountability.source === "explicit-room"
      ? "Recorded on this Workroom."
      : accountability.source === "inherited-room"
        ? `Inherited from a Workroom ${depth} step${depth === 1 ? "" : "s"} up.`
        : "Inherited from the organization's recorded owner.";

  return (
    <div>
      <p className="text-sm font-medium text-[var(--dpf-text)]">{who}</p>
      <p className="mt-1 text-xs text-[var(--dpf-muted)]">{provenance}</p>
    </div>
  );
}

const WORKER_STATE_LABEL: Record<string, string> = {
  working: "working",
  waiting: "waiting",
  idle: "idle",
  unknown: "state not recorded",
};

function WorkerLine({ worker, delegated }: { worker: WorkerGroup["members"][number]; delegated: boolean }) {
  return (
    <li className={delegated ? "ml-6 py-1" : "py-1"}>
      <span className="text-sm text-[var(--dpf-text)]">{worker.displayName}</span>{" "}
      <span className="text-xs text-[var(--dpf-muted)]">
        {WORKER_STATE_LABEL[worker.state] ?? worker.state}
        {worker.currentTask ? ` · ${worker.currentTask}` : ""}
        {worker.subagentCount > 0
          ? ` · ${worker.subagentCount} subagent${worker.subagentCount === 1 ? "" : "s"}`
          : ""}
      </span>
    </li>
  );
}

export function RoomWorkforcePanel({
  accountability,
  accountableDisplayName,
  groups,
  matched,
  partial,
}: {
  accountability: EffectiveHumanAccountability;
  accountableDisplayName: string | null;
  groups: readonly WorkerGroup[];
  matched: number;
  partial: boolean;
}) {
  const shown = groups.reduce(
    (total, group) => total + group.members.length + (group.parent ? 1 : 0),
    0,
  );

  return (
    <Surface as="section" aria-label="Accountability and workers" rounded="xl">
      <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Accountable human</h2>
      <div className="mt-2">
        <AccountabilityStatement
          accountability={accountability}
          displayName={accountableDisplayName}
        />
      </div>
      <p className="mt-2 text-xs text-[var(--dpf-muted)]">
        Accountability is answerability for the work. It is separate from who coordinates it and
        from what any coworker is permitted to do.
      </p>

      <h3 className="mt-4 text-sm font-semibold text-[var(--dpf-text)]">Workers in this Workroom</h3>
      {groups.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--dpf-muted)]">No workers are recorded on this Workroom.</p>
      ) : (
        <>
          <ul className="mt-2">
            {groups.map((group) => (
              <li key={group.parent?.workerId ?? "unknown-parentage"} className="py-1">
                {group.parent ? (
                  <ul>
                    <WorkerLine worker={group.parent} delegated={false} />
                  </ul>
                ) : (
                  <p className="text-xs text-[var(--dpf-muted)]">
                    Delegation not recorded for these workers.
                  </p>
                )}
                {group.members.length > 0 ? (
                  <ul>
                    {group.members.map((member) => (
                      <WorkerLine key={member.workerId} worker={member} delegated={Boolean(group.parent)} />
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
          {partial ? (
            <p className="mt-2 text-xs text-[var(--dpf-muted)]">
              Showing {shown} of {matched} workers.
            </p>
          ) : null}
        </>
      )}
    </Surface>
  );
}
