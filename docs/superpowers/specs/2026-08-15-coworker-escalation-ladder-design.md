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

## 4a. Rung 3 is clamped to the asking human's clearance (BI-154DAA7E)

Making convening the default path raises a disclosure question the ladder did
not create but did make routine: when a coworker brings a peer into a
conversation, what may that peer say to the human sitting in it?

**What was already enforced.** Every governed coworker *tool call* is already an
intersection of the asking human's clearance with the acting agent's data
sensitivity. `coworker-authority-decision.ts` denies `sensitivity-clearance-denied`
when `authContext.sensitivityClearance` does not include
`dataPolicy.sensitivity`, with `authContext` resolved from the requesting user
and `actingAgentId` set. That check is unconditional and in the main decision
path. An early reading of this gap as "nothing clamps a convened peer" was
wrong: the clamp lives one layer below `coworker-collaboration.ts`, at the gate
every governed call passes through.

**What that gate structurally cannot cover.** It inspects tool arguments and
results. It does not inspect *prose*. A peer convened into a thread composes its
reply from its own model context — system prompt, working notes, profession
corpus, its own earlier turns — and disclosure does not require a tool call:
*"you may want to hold off on that hire"* leaks without one.

**The fix is to refuse earlier, not to police the text.** An over-cleared peer
that is never admitted has no prose channel to inspect.
`decideConveneClearance` (`apps/web/lib/tak/convene-clearance.ts`) is called
from `resolveTargetOrThrow`, the shared chokepoint behind both
`request_coworker` and `summon_coworker`, so a future third convene path
inherits the clamp instead of forgetting it. The tool gate remains behind it as
defence in depth.

Three details are load-bearing:

- **Set membership, not rank.** The test mirrors the tool gate's `.includes()`
  exactly. A rank comparison would permit a human holding
  `{public, internal, restricted}` to convene a `confidential` peer, producing a
  convene that succeeds while every subsequent tool call is denied.
- **Fails closed.** An unlabelled or unrecognised agent sensitivity coerces to
  `restricted` via `coerceDataSensitivity`, so a misconfigured coworker is not
  convened by default.
- **The refusal must not disclose.** This is where the clamp collides with the
  limitation-response contract, which tells a blocked coworker to name the one
  enabler and ask for a yes/no. Here that instinct is the leak: *"ask an admin
  to grant you confidential clearance"* reveals that a restricted matter exists
  and hints at its class. `CONVENE_DENIED_MESSAGE` therefore names no peer,
  role, level, or subject and proposes no enabler — it is deliberately
  indistinguishable from "no such specialist is available". The specifics go to
  the `DelegationChain` audit row, which the asking human never sees.

Ordering matters: the clamp runs *after* the lifecycle gate, so an unsummonable
coworker still reports as unsummonable rather than as a clearance refusal —
otherwise the generic refusal would imply a restricted matter that does not
exist.

Still open, tracked on BI-154DAA7E: `authorizeWorkRoomAccess` returns the
requested level for a superuser *before* any clearance check, so no
route-fronted coworker may hold superuser; and the conversational channel
remains unpoliced for peers that are legitimately admitted.

## 4b. Fresh-install behaviour and how to diagnose a silent refusal

Written down because the clamp's correct-for-disclosure silence is
actively hostile during setup, and because the knowledge otherwise lives only in
the session that built it. A new install is where this bites first.

### Who can convene whom on a brand-new instance

| Principal | Clearance resolved | Can convene a seeded `internal` coworker | …a seeded `confidential` coworker |
| --- | --- | --- | --- |
| Installation owner (superuser) | `INSTALLATION_OWNER_SENSITIVITY_FLOOR` = `public`, `internal`, `confidential` | yes | yes |
| Employee with nothing explicit | `normalizePrincipalSensitivities(undefined)` → `["public"]` | **no** | **no** |
| Principal with corrupt stored clearance | `[]` (fails closed) | no | no |

`workforce-seed.ts` creates tier-2 coworkers at `sensitivity: "confidential"`,
and only superusers receive the owner floor. So on a new box a regular employee
cannot convene *any* seeded coworker — not merely the confidential ones — until
clearance is granted explicitly.

**Verify the escalation ladder as the installation owner first.** Verifying as an
ordinary employee reproduces a total convene failure that looks like a broken
feature and is in fact unseeded clearance.

### Diagnosing a refused convene

`CONVENE_DENIED_MESSAGE` is deliberately uninformative — it names no peer, role,
sensitivity level, or subject, because a refusal that explains itself discloses
the thing being protected (§4a). The unavoidable consequence is that a *setup
gap* and a *policy decision* are indistinguishable from the UI.

The reason exists in exactly one place: the `DelegationChain` audit row written
before the refusal is thrown.

```sql
SELECT "toAgentId", reason, "originUserId", "createdAt"
FROM "DelegationChain"
WHERE status = 'blocked'
ORDER BY "createdAt" DESC
LIMIT 20;
```

`reason` carries the target agent and the required sensitivity
(`conveneDenialAuditReason`). A blocked row naming a sensitivity the asking human
plainly should hold is a seeding problem, not a policy problem.

Note the same table also carries `delegatesTo`/`escalatesTo` refusals from
`enforceHandoffAuthority`, whose reason text names the *caller* agent. The two are
distinguishable by reason wording.

### A defaulting trap worth generalising

The first version of this clamp defaulted an unlinked user to
`["public", "internal"]`, copied from `workspace-room-access.ts`. That produced an
inversion: a properly **linked** employee with nothing explicit resolves to
`["public"]`, so being *linked* made a user more restricted than being *unknown* —
and the looser branch was the default.

The room-access default covers a **missing auth context**. The convene path reads
a **real principal row**. Same-shaped default, different meaning. Corrected by
delegating to `packages/db/src/principal-sensitivity.ts`, which owns clearance
normalization, rather than restating a default beside it.

The general rule: when a default already exists elsewhere, confirm it answers the
*same question* before copying it. Two defaults that look alike can encode
opposite assumptions about what an absent value means.

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
