# Stage permissions steer connected clients

Status: draft for independent review. Backlog: BI-6B610D94. Workroom: WC-E70788DE.
Scope: platform / WWMD. Delivery shape: large. This document grants no execution authority.

## Problem and observed baseline

The existing per-call consequence refiner correctly makes an ordinary duplicate merge ordinary. It does not connect a stage's admitting decision to the next call. On source commit `257e166d4109cea9e2e567fa4f6ae8fb8346b102`, runtime bindings accept only `alignment-approve` and `approved-envelope`; the compiler emits unused `stage-gate-admit` drafts. `mintShadowPermit` writes null stage identity, one capability and one use. The reference monitor verifies GPP after the authority gate. `AuthorizationDecisionLog` has no chain seal.

Live DEV `/ops/gate-efficacy`, 2026-10-28: M-1 coverage is 0/1,418 consequential calls; all bindings remain shadow. M-6 divergence is 89/1,418. M-2, M-5 and M-7 are unknown, not zero. The seven complete Chicago days October 21 through 27 contain 164 `CoworkerActionEnvelope` rows, 23.429/day. These denominators do not establish whether any particular card was unnecessary.

## Governing context and existing homes

The operator's direction on BI-6B610D94 is authoritative for this scope: a valid Gated Permission steers non-damaging work; actual damaging acts retain their human gate. Kernel retrieval confirms `principles/escalation-is-a-gate-not-a-trust-tier`, `principles/human-in-the-loop-at-phase-boundaries`, and `governance-approves-evidence-not-provenance`.

Reuse the normative [GPP contract](../../architecture/gated-permissions-process.md), the [model-to-execution design](2026-10-01-gpp-model-to-execution-design.md), and the [compiler design](2026-10-02-gpp-shape-notation-and-compiler-design.md). Extend `lib/gpp/{bindings,permit-claims,permit-store,permit-mint,permit-verdict}` and `shape-language/bindings-emit`; keep semantic consequence refinement in `lib/tool-consequence.ts`. Authority resolution stays in `lib/govern/authority`; stage lifecycle stays in work-management. No route-local policy, parallel permission store, new MCP tool, or client-specific authorization allowlist is introduced.

## Objectives

**OBJ-PERMIT:** A stage gate admits a bounded, auditable set of calls before execution, across clients.

**OBJ-DAMAGE:** Permission steering never removes an actual damaging-action gate or expands existing authority.

**OBJ-REPLAY:** Revocation, concurrent consumption and retries cannot create an extra effect.

**OBJ-EVIDENCE:** Decision lineage and client-specific observations make the change measurable.

## Proposed architecture

### Positive proof belongs at the reference monitor

WWMD assessment DI-C6A267176992 favors one canonical monitor verifier before escalation (high confidence; agent choice recorded). Its feature values are design estimates, not observed outcomes. Tool-family refiners keep proving the semantics of their own call. They do not each reimplement permit verification. An independent architecture reviewer must approve this placement before implementation; a kernel assessment is supporting evidence, not an approval or a grant.

The monitor first resolves current authentication, token and coworker grants, human capabilities, room admission, sensitivity and ordinary action preconditions. It then resolves the exact stage permission and semantic consequence. A server-only verified proof can supply `gpp-permit` steering to authority resolution. A model argument, an unsigned handle, an agent name, an OAuth client label, a refiner result, or an old audit row cannot construct that proof.

Damage remains first: the effective consequence after the existing narrow-only refiner, a consequential Work Case, restricted sensitivity, a crossed threshold or a regulated action retains the existing required human decision. Neither a valid permit nor a newer stage can turn that requirement off. Explicit `hitlPolicy: always` retains its existing effect. Unreadable damage facts retain the declaration.

### Stage admission and binding lifecycle

Promote compiler binding drafts into the existing runtime binding contract, including the immutable shape version, stage key, gate key, owning scope, explicit tool set and resolver. A binding can activate only when its gate resolver, writers, scope predicates and replay behavior exist and pass conformance. Do not promote both broad shadow seed bindings merely to raise coverage.

After an existing gate records admission, mint a signed stage permit through the existing store. Claims bind the acting human and optional acting coworker, exact room, shape/stage version, subject scope, tool capabilities and typed argument constraints, absolute validity, a finite use budget and optional parent permit. The model cannot choose a broader scope or replenish a budget. A gate denial, unresolved gate or missing signature key mints no steering permission.

Stage exit, replacement, cancellation and scope or grant changes revoke its remaining permission through the existing `revokeStagePermits` home. The stage transition must fence new reservations before completing. Historical exact-call permits retain their existing reader and enforcement semantics; they cannot be reinterpreted as stage permissions.

### General call refinement and uncovered calls

Keep the closed static consequence declaration and the narrow-only `consequenceForCall` contract. Generalize the positive proof plumbing shared by the monitor, authority resolver, approval classification and effect fence. A family may narrow its coarse declaration only from verified call semantics, such as releasing an actually owned resource within an unchanged mandate. A permit's existence alone is never evidence that an authority mutation is ordinary.

Observe ordinary writes as well as consequential calls. A valid permission for a non-damaging call supplies steering without a card. An uncovered non-damaging call records a coverage gap while shadow; it gains no grant or permission from shadow mode. If existing authority does not admit it, park it with a typed coverage repair action rather than create a new approval card. An enforced binding makes an uncovered call unreachable. A presented invalid or revoked permission is an invalid proof, not an uncovered-call fallback. Actual damaging calls retain their action-specific gate in either mode.

### Lineage, delegation and client identity

Extend `AuthorizationDecisionLog` with additive nullable chain identity, predecessor hash, entry hash and sealed time. Reuse the existing decision-chain hashing through an authority-payload adapter. Seal new admitting decisions in their writer transaction, with one serialized chain head and immutable action, subject, actor, authority scope and evidence digests. Verify the seal rather than treating a non-null hash as proof. Old unsealed decisions remain unsealed; no migration invents historical approval.

Carry the actual recorded delegation reference through authority decisions and child permissions. Effective delegated authority remains human intersect parent-delegable intersect target grants intersect stage binding. Missing or revoked delegation never becomes a larger scope. Existing valid direct authority does not acquire a fabricated delegation chain.

Use one known-client labeling registry with a generic fallback for audit. OAuth metadata and PAT authentication are interpreted by their existing transport owners. Client names never select grants or damage policy. A permission bound to a coworker must still match that coworker; a human-bound PAT does not impersonate an assistant.

### Consumption, effects and re-entrancy

Verify signature, lineage, actor, current room/stage/scope, constraints, validity and remaining uses before a reservation. Use the existing governed operation/command identity and exact immutable request digest. The same retry returns its recorded outcome or parks on unresolved execution; it never obtains another effect allowance. A changed request with the same identity refuses.

Reserve a use and its existing execution receipt atomically. Complete database effects under the applicable writer's canonical lock and fence contract. Inventory current lock order before extending it; no transaction may invert environment, room, subject or task locks. An admitted binding must prove its writer's idempotency behavior. A writer without a stable operation identity or an execution-uncertain predecessor cannot qualify for unattended replay.

For effects outside one database transaction, retain the existing execution fence and uncertainty state. Stage exit first prevents new reservations and waits for admitted effects to settle; it cannot report a completed revocation barrier while a late effect is possible. Cancellation or a lost acknowledgement records uncertainty and parks. It does not declare no effect, retry automatically, reset a deadline or create another permission. This design does not claim that an audit reservation makes an arbitrary external operation atomic.

## Data, rollout and compatibility

Use an expand-only migration for nullable chain columns and their required indexes. Preserve existing authorization-log confidentiality and retention ownership; include the generated data-impact manifest and data review. Existing installations with old unsealed rows must migrate without rewriting those rows. Deploy compatible issuer, transport, verifier and writer versions before activating a stage binding. Keep an explicit packaged capability floor for activation and rollback.

Roll out one declared, bounded housekeeping binding in DEV first. Preserve existing pending and denied cards; the new flow cannot approve, cancel or replay them implicitly. Record pre/post controlled-call envelope deltas, then report complete daily windows using the same Chicago boundaries and per-client denominators. Do not present a partial day as a daily improvement. Rollback disables new binding admission and retains compatible verification, receipts and revocation readers until outstanding permissions have expired or been settled.

## Acceptance

| ID | Objective | Statement |
|---|---|---|
| AC-01 | OBJ-PERMIT | Entering an admitted stage mints one scoped permission; ordinary covered calls from named and generic clients produce no card. |
| AC-02 | OBJ-DAMAGE | The conformance walk proves that actual outward, irreversible, authority, threshold, regulated, restricted and consequential-case acts retain their governing human gate. |
| AC-03 | OBJ-PERMIT | A call outside the declared tool, room, stage, actor, subject or argument scope gains no authority. Shadow gaps are observed; enforced gaps refuse without an approval card. |
| AC-04 | OBJ-EVIDENCE | Both decision-interaction and authorization-decision lineage are positively verified; live eligible observations report valid rather than lineage_unsealed. |
| AC-05 | OBJ-REPLAY | Concurrent calls cannot exceed the finite use budget, and exact retries return one outcome or park on uncertainty without another effect. |
| AC-06 | OBJ-REPLAY | Revocation, expiry, stage replacement and grant removal stop new effects; a stage cannot claim its barrier complete while a late effect remains possible. |
| AC-07 | OBJ-DAMAGE | Missing keys, invalid MACs, stale versions, absent lineage and failed authority lookups cannot create steering or widen authority. |
| AC-08 | OBJ-DAMAGE | The static declaration remains intact, refinement only narrows, and a refiner exception retains the declaration. |
| AC-09 | OBJ-EVIDENCE | Audit records name the real client with a generic fallback; effective, permitted and used capabilities are reported for the last 30 days with explicit unknowns. |
| AC-10 | OBJ-EVIDENCE | DEV records controlled-call card deltas and comparable complete-day CoworkerActionEnvelope counts before and after deployment. |
| AC-11 | OBJ-REPLAY | Existing pending, declined, failed and execution-uncertain requests remain preserved and are never implicitly replayed or approved. |
| AC-12 | OBJ-DAMAGE | Migration and rollback fixtures preserve legacy rows and refuse activation on an incompatible issuer, transport, verifier or writer. |

## Verification and delivery

Before code, obtain independent design/spec approval, architecture, security and data review through the server-issued reviewer packets, then a plan with live coverage and plan review. Implement in separately reviewable source changes only where the approved dependency sequence permits. Use meaningful unit and real-database concurrency tests, the generated C-2/C-9 conformance walks, package typechecks, the canonical gate, protected DCO PRs, checkpoint release and governed DEV upgrade. Functional evidence comes from the served DEV image and independently attributed review, not from this draft.

The implementation plan must map every acceptance row to an actual test and live check, name the real effect writers and lock order, reconcile overlapping delegation/identity work, and retain all uncertain execution state. The original closeout and BI-02C0877D are separate deliveries; this design neither replaces their evidence nor claims them complete.
