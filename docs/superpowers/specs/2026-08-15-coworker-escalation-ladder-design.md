# Coworker Escalation Ladder — design

- **Epic:** EP-COWORKER-INTERACTIVITY
- **Status:** Implemented (rungs 1-4 prompt contract + turn guard); front-door/router split staged
- **Date:** 2026-08-15

## 1. Problem

A coworker that cannot answer a question files a backlog item. That is its only
exit. The observed incident: an operator asked the delivery-process coworker on
a platform surface to help fix a failed self-upgrade. The coworker filed
BI-FBDF739F and advised "if it's a transient error, re-run the deployment
trigger." The failure was not transient (see §5), the coworker was not the right
specialist, and the peer who could have diagnosed it was never asked.

Two independent defects produced that turn.

### 1a. Filing was the only rung the prompt described

The instruction to file appears four times in the mandatory prompt every
coworker inherits:

| Location | Text |
|---|---|
| `prompt-assembler.ts` principle 1 | *"If you lack a tool for a task, say 'I can't do that directly — I'll create a backlog item for it' and ACTUALLY call create_backlog_item."* |
| `prompt-assembler.ts` principle 7 | *"…be honest and create a backlog item to track the gap."* |
| `prompt-assembler.ts` principle 15 | *"If you lack the right tool, say so and create a backlog item."* |
| `agent-routing.ts` MANDATORY BEHAVIORS | *"You HAVE create_backlog_item — always use it when issues are reported."* |

Meanwhile `find_coworker`, `request_coworker` and `summon_coworker` — all
granted (`agent-grants.ts:193,339,340`), all implemented in
`coworker-collaboration.ts` with delegation-authority enforcement, all rendered
on the panel as visible `collaboration:*` events — appeared **zero times** in
the shared operating principles. The only coworkers told the peer door exists
were the two COO routes (`agent-routing.ts:605,688`), which use
`request_coworker` to consult AGT-902 and answer in the COO's voice.

The coworker did exactly what it was told. This is a prompt defect, not a model
defect.

### 1b. Route binding ignores question content

`resolveSelectedCoworkerForRoute` plus `ROUTE_AGENT_MAP`/`FALLBACK_ENTRY` bind
one specialist per **route**. Nothing matches against the **content** of the
question. `find_coworker` is read-only discovery *by intent* and is exactly the
missing step, but no panel path calls it.

Compounding both: that turn ran on the bundled local model, so it was a degraded
turn as well as a misrouted one.

## 2. Substrate that already exists (fuse, do not build)

- **Peer doors** — `request_coworker` (delegate a bounded sub-task) and
  `summon_coworker` (bring a peer into the conversation) in
  `apps/web/lib/tak/coworker-collaboration.ts`. Both coworker-initiated by
  contract; the human never picks or tasks peers. Depth/fan-out caps inherited
  from `spawnWorkThread`.
- **Roster discovery** — `find_coworker`, read-only discovery-by-intent.
- **Work rooms** — participation, cycles, channel ingress, read-model and
  outcome packets under `apps/web/lib/work-management/room-*.ts`, surfaced by
  `WorkRoomParticipants.tsx`. Spec: `2026-07-26-work-rooms-collaboration-design.md`.
- **Front-door pattern** — already shipping, hardcoded for one consultation in
  the COO route prompt and in `2026-03-21-coo-led-onboarding-design.md`.
- **Turn-guard idiom** — `backlog-create-claim-guard.ts`, applied at the agentic
  loop's return points.

Nothing new was needed at the substrate layer. The gap was that no coworker was
told any of it existed.

## 3. The contract

Four rungs, cheapest first, in `apps/web/lib/tak/escalation-ladder.ts`:

| Rung | Tools | When |
|---|---|---|
| 1 — re-route | `find_coworker` | Question belongs to another specialist's area. Silent, costs the user nothing. |
| 2 — consult | `request_coworker` | You own the surface, need one bounded answer from a peer. |
| 3 — convene | `summon_coworker`, `invite_room_participant`, `post_room_message`, `spawn_work_thread`, `start_deliberation` | More than one party, more than one turn, or a human decision. |
| 4 — file | `create_backlog_item`, `report_quality_issue` | No path forward in this conversation. Must say which peers were tried. |

`ESCALATION_LADDER_BLOCK` is registered as its own DB-overridable
`platform-identity/escalation-ladder` block **rather than folded into the
identity block** — the identity block is itself DB-overridable
(`prompts/platform-identity/identity-block.prompt.md`), so folding the ladder in
would let an identity override silently drop the contract. It sits in the static
(cacheable) region of the assembled prompt, so it costs no per-turn cache
invalidation.

Principles 1, 7 and 15 and the `agent-routing.ts` behaviors now point at the
ladder instead of naming the backlog as the fallback.

### 3a. Guard shape — an offer, not a correction

`applyEscalationLadderGuard` runs at both agentic-loop return points. When a
turn files with **no** rung 1-3 attempt, it appends a one-line offer to bring in
a specialist and emits a `console.warn` so the reflex rate is measurable.

It deliberately does **not** scold. The existing create-claim guard annotates
because the model made a false claim; here the model did something real but
incomplete, and correcting the user for the coworker's shortfall would be worse
than the shortfall. Converting a dead end into an offer keeps the thread alive,
which is the point of the ladder.

A **denied** handoff counts as an attempt — trying the peer door and being
refused by delegation authority is not the failure mode being guarded. Only the
FILE rung requires success, since an unsuccessful create is not a dead end.

## 4. Staged, not built here

**Front door / router split.** Making the COO the accountable front door on
every surface — COO owns the byline and the routing decision, the assigned
specialist does the work and speaks in-thread under attribution — is the natural
next slice. It is **blocked on `2026-07-18-coo-persona-attribution-contract-design.md`**,
still "Draft for deliberation", which documents three contradictory overseer
identities live in the codebase (prompt file "Jiminy", in-code un-named
executor, DB label "COO"). That contract must resolve before a COO is placed on
every surface, or the platform ships three COOs.

**Content-aware route binding.** Calling `find_coworker` on the panel path when
the question's intent does not match the route-bound specialist's area, rather
than relying on the coworker to notice. Follow-on.

## 5. The triggering incident is not a ladder bug

For the record, so the BI is not miscategorised: the upgrade failure itself was
a Dockerfile gap. PR #4321 added `patchedDependencies: image-size@1.2.1` to
`pnpm-workspace.yaml:230`; `Dockerfile:23` COPYs `pnpm-workspace.yaml` but never
COPYs `patches/` before `RUN pnpm install --frozen-lockfile` at `Dockerfile:44`,
so pnpm exits 254 on ENOENT for `/app/patches/image-size@1.2.1.patch`. Every
image build since #4321 fails identically. The "re-run it, it may be transient"
advice could never have worked — which is precisely what a consulted platform
specialist would have known.

## 6. Verification

`apps/web/lib/tak/escalation-ladder.test.ts` — 15 cases covering the observed
failure shape, denied-handoff-counts-as-attempt, unsuccessful-create,
ladder-order reporting, guard idempotence across both loop return points, and
prompt-contract assertions (every peer door named; filing stated as last;
operating-principle 5 preserved so peers are described to users by role, never
by tool name or agent id).
