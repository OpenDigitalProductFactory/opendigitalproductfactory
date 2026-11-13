# Portable Workroom policies

The pure policy implementation lives in
`packages/validators/src/workroom-policy`, alongside the existing Workroom kernel
in the same validators package. It does not own another Workroom engine,
scheduler, commitment store, budget ledger or authorization service.

The public policy entry contains existing trigger normalization, proactivity,
room-posture derivation/tightening, provenance, the stricter HITL join,
deadline/hold bookkeeping and a conjunction over resolved author/funding facts.
`policy-types.ts` owns the exact shared posture/verification type vocabulary;
`workroom-policy/clock-types.ts` owns structural operating-clock inputs. Existing
application type owners reexport these contracts so there is one vocabulary.

## Application composition

- `scheduling/scheduled-work-posture.server.ts` loads current room and user facts,
  then calls the pure policies. `actions/agent-task-scheduler.ts` consumes its
  resolved plan and retains current tool permissions and governed execution.
- `attention/sources/scheduled-task.ts` consumes the same proactivity resolver.
  Workroom stall attention consumes the same deadline/hold calculations as the
  drive. Attention projections, DPF addresses, recipient policy and delivery
  remain in their existing application modules.
- `work-management/author-stage-autonomy.ts` retains delivery/xlarge and coworker
  applicability, portfolio attribution and the canonical delivered/in-flight
  investment calculation. `author-stage-autonomy-live.ts` still reads the current
  operator record, checks its current authority and loads current budget facts.
  The portable conjunction returns a candidate role binding over those facts;
  it neither grants permission nor reserves funds.
- `work-management/drive-resolution-graph.ts` and the existing drive runners use
  the original marking kernel. Deadlines only add notice bookkeeping. They do
  not advance, cancel or complete tokens. Hold tracking retains its original
  identity, counter and notification rules.

Recorded trigger obligations and stage deadlines remain inputs from their
existing owners. Operating hours, CalendarEvent, ScheduledAgentTask,
PortfolioBudgetPeriod, BudgetReservation and Workroom state retain persistence
and mutation ownership. No portable helper reads those stores.

## Compatibility and qualification

The source extraction preserves incumbent behavior. A missing scheduled-room
posture falls back to the inherited plan; malformed trigger metadata does not
abort a job; generic dispatch retains its one-slot minimum under exhaustion;
delegated posture's legacy `executionAllowed: true` remains advisory metadata.
These compatibility behaviors do not establish current authority, capacity
admission or a qualified host. The author funding snapshot is not an atomic
reservation or a guarantee of prospective headroom.

Deadline notification remains at least once. The existing runner commits a
notice before delivery and acknowledges it after success; lost acknowledgment
can cause redelivery. Stall and deadline recipient rules remain distinct. Scan
caps in the attention adapters do not prove complete estate coverage.

The synthetic `examples/workroom-policies` consumer supplies explicit trusted
time and current facts to demonstrate the portable calculations and a bounded
host's holds for duplicate/cancelled wakes, revoked authority, missing/stale
funding, unavailable capacity, changed run/iteration and uncertain effects.
That host is a fixture, not a new production admission service. It cannot
authenticate facts or qualify runtime enforcement. Native governance, served
runtime, real concurrency and production acceptance remain separate checks.

## Maintenance

Change the canonical pure source, migrate actual callers and run the selected
policy/adapter tests plus both web TypeScript programs. The standalone consumer
records the exact copied source hashes and pinned build toolchain. Keep
time/authority/funding/effect uncertainty separate; no schedule, attention item
or favorable policy output widens current authority.

Revert policies and the import migration together. Persisted trigger, hold and
deadline formats retain their original semantics. The existing WK/GP/SJ
contracts remain compatible. No package publication or live installation change
is part of this extraction.
