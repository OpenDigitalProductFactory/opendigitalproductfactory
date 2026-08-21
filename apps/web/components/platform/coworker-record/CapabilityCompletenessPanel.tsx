import {
  capabilityCompletenessFor,
  orderedPlanes,
  type PlaneState,
} from "@/lib/coworker-lifecycle/capability-completeness";
import { Chip, EmptyState, Section, deepLink } from "./panels";

/**
 * Seven-plane completeness for one agent.
 *
 * Design: docs/architecture/2026-08-20-assurance-operating-loop-and-capability-completeness.md
 *
 * Why this panel renders ALL seven planes, always — including the ones that are
 * absent or capped by missing substrate: every gate that produced these gaps
 * iterated only what was present, so absence never surfaced. A panel that hid
 * the empty planes would repeat exactly that mistake on the surface built to
 * reveal it.
 *
 * Why two scores: `attainable` measures this agent against what the substrate
 * currently permits, `absolute` against the full design. A high attainable with
 * a low absolute is the honest signature of "this agent is done; the platform
 * is not" — and it stops a platform-level blocker reading as an agent defect.
 */
export function CapabilityCompletenessPanel({ agentId }: { agentId: string }) {
  const agent = capabilityCompletenessFor(agentId);

  if (!agent) {
    return (
      <Section title="Capability completeness">
        <EmptyState text="Not measured — this identity is not in the committed capability-completeness artifact. Regenerate with `pnpm measure:capability-completeness`." />
      </Section>
    );
  }

  const { score } = agent;
  const capped = agent.blockedPlanes.filter((b) => b.ceiling < 3);

  return (
    <Section
      title="Capability completeness"
      count={score.attainablePct}
      action={deepLink("/docs/maintenance/capability-completeness", "Full measure")}
    >
      <p className="mb-1 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{score.attainablePct}%</span> of what the
        platform allows today;{" "}
        <span className="font-medium text-foreground">{score.absolutePct}%</span> of the target.
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        {agent.identityClass}
        {agent.handles.length > 1 ? ` · answers to ${agent.handles.join(", ")}` : null}
      </p>

      <ul className="space-y-2">
        {orderedPlanes(agent).map(({ plane, label, asserts, state }) => (
          <li
            key={plane}
            className="rounded-md border border-border/60 px-3 py-2"
            data-testid={`plane-${plane}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{label}</span>
              <PlaneChip state={state} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{asserts}</p>
            {!state.atCeiling ? (
              <p className="mt-1 text-xs">
                {state.detail}
                {state.missingGrants && state.missingGrants.length > 0 ? (
                  <> <span className="font-mono">{state.missingGrants.join(", ")}</span></>
                ) : null}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {capped.length > 0 ? (
        <div className="mt-3 rounded-md border border-border/60 px-3 py-2">
          <p className="text-xs font-medium">Blocked by the platform, not this coworker</p>
          <ul className="mt-1 space-y-1">
            {capped.map((b) => (
              <li key={b.plane} className="text-xs text-muted-foreground">
                {b.blocker}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

function PlaneChip({ state }: { state: PlaneState }) {
  if (state.ceiling === 0) {
    return <Chip tone="muted">no substrate</Chip>;
  }
  const tone = state.atCeiling ? "success" : state.level === 0 ? "error" : "warning";
  return (
    <Chip tone={tone}>
      {state.levelKey} · {state.level}/{state.ceiling}
    </Chip>
  );
}
