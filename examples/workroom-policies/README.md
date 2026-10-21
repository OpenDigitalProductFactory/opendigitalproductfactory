# Isolated Workroom policy consumer

This fixed synthetic consumer uses the extracted Workroom policy entry and the
existing marking/receipt kernel. It exercises a proposed recurring wake against
current supplied authority and funding, then records one exact local observation.
It is not a scheduler, authorization service, financial ledger or tool executor.
There are no real principals, private doctrine, business records or external effects.

## Isolated build

The verification entry is `node examples/workroom-policies/run.mjs`. It requires
Node **24.16.0** and the managed external TypeScript **6.0.3** compiler.
`WORKROOM_POLICIES_NODE24` can select another installed executable of that exact
Node version. The runner downloads and installs nothing.

The runner copies only `closure.json`'s producer files, this fixture, its compiler
configuration, license and notice into a new temporary directory outside the
checkout. It creates a standalone ESM package manifest and empty dependency lock,
clears `NODE_PATH` and `NODE_OPTIONS`, rejects symlinked source files, and checks
actual TypeScript import/export syntax for relative `.js` addresses. It verifies
that the public policy entry and Workroom entry have a complete copied closure.
It compiles strict NodeNext with `lib: ["ES2022"]`, `types: []`, declarations and
no skipped declaration checks, then runs the emitted JavaScript. The temporary
directory is removed after success or failure.

The closure has **zero third-party runtime dependencies**. The compiler is an
external build tool; no compiler or producer dependency links are copied. The
output records SHA-256 hashes of every copied producer and fixture source file.
`sourceBaseline` identifies the pre-extraction base; hashes identify the actual
working source tested, not a future commit or production runtime.

## Checked boundaries

- Existing trigger kinds and malformed-trigger behavior; a supplied obligation's
  due date outranks the business clock without granting authority.
- Tighten-only posture, hard verification floors, stricter HITL join, provenance
  and delegated posture. A proposed author role binding is kept separate from
  current host admission and funding.
- Recurring occurrences and duplicate wakes, identical replay after a lost
  acknowledgment, same-occurrence changed-payload conflicts, and rejection of old
  run/iteration observations.
- Prepared and replay results are deep snapshots: changing their state, nested
  marking, authority or funding cannot mutate the host's private custody.
- Cancellation and current authority revocation before replay and completion;
  stale task and authority revisions; missing/stale funding and empty budget.
- Unavailable capacity independently of funding. A pending uncertain attempt
  remains held; more capacity or a bare observation does not settle or replay it.
- Deadline boundary and run/stage/iteration identity; token immutability;
  duplicate-notice suppression and acknowledgment loss permitting an at-least-once
  resend. Stall attention uses the shared threshold and resets after advancement.

`src/host.ts` trusts fixture-owned current facts. Distinct revision/digest snapshots
and exact observations are local equality checks, not signatures or authentication.
Its one in-memory occurrence map and slot count demonstrate the fixed protocol;
they are not durable transactions, a second production commitment store, a budget
reservation or qualification for concurrent writers. Iteration checks cover the
supplied current marking identity, not a new rework implementation.

The host supplies the current applicability, authorizing principal, budget facts,
capacity and admission. The portable funded-author function returns a candidate
binding over those facts; it does not load or certify them. Real deployments keep
their canonical portfolio/budget/commitment, grants, protected evidence, current
authorization, cancellation, scheduling and transaction owners.

DPF2 currently defers this slice: its small `Room.posture` overlap does not justify
the full policy closure. Reconsider when a real composed-posture or persistent
attention consumer owns the supplied facts and retires displaced behavior. Role
or posture cannot supply missing work-case decision-mode facts. Keep DPF2's
practice/context compiler, strict calendar source policy and protected evidence
acceptance with their current owners.

## Incumbent limits and maintenance

Missing room context still falls back to the inherited DPF plan. The dispatcher
still floors capacity at one slot; this fixture's zero-capacity hold is an explicit
test-host boundary, not a correction or qualification of that dispatcher.
Delegated `executionAllowed: true` remains advisory metadata. Timers and attention
do not advance work, and the pure policies supply no current-authority revocation
or funding-freshness guarantee by themselves.

The platform maintainer owns the producer policy entry and this example. Upgrade
the explicit source manifest and rerun the isolated build/smoke together with the
actual DPF scheduler, attention and funding adapter tests. The repository's
Apache-2.0 `LICENSE` and `NOTICE` travel with the copied internal source. No
third-party runtime source is redistributed here; this is not a complete rights
or supply-chain audit. Roll back moved implementations and their caller migrations
together. Native gates, live/runtime acceptance, browser behavior, production
authorization, financial reservations and uncertain-effect settlement remain
unqualified and unrun under the recorded local refactor exception.
