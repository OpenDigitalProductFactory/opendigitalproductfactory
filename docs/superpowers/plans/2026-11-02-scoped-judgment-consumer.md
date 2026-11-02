# Adopt scoped judgment in the DPF receiving product

Status: implementation plan draft; source changes require live coverage and admission.
Backlog: BI-BDF358CB. Workroom: WC-F5E15A53.
Base: `36b46866870694dab1763e691862da38dc577e76`.
Related: completed Workroom pilot BI-FCDCAE98 / PR6821; component qualification
BI-076F22CC; later GPP receiving cutover BI-2D3F986C.

For agentic workers: execute one independently reviewable backlog item at a time,
with affected characterization and package typechecks, governed shared integration,
independent exact-source review and a regular DCO PR. Never credit an unrun gate.

## Objective and unchanged acceptance

**OBJ-JC:** DPF decision callers use the same qualified scoped-judgment body as
independent receivers; host authority and existing records retain their owners.

- AC-JC-01: At least one real DPF decision caller imports the qualified scoped-judgment artifact and the former receiving bodies no longer contain an independently evolving implementation.
- AC-JC-02: Exact pinned artifact, dependency closure, notices, runtime/declaration exports and clean receiving loaders preserve existing scopes, canonical bytes, diagnostics, option identities and uncertainty behavior.
- AC-JC-03: Every retained compatibility export has real callers, a named canonical owner, tracking anchor and explicit removal condition; generated guard runtime and host-independent consumer parity remain verified.
- AC-JC-04: Affected decision/guard tests and typechecks, protected merged-code checks and relevant governed served ordinary/adverse/recovery observations pass with exact source attribution; unrun checks remain unrun.
- AC-JC-05: WWMD/WWWD/WSID corpus and authority ownership, authenticated admission/revocation and effect custody remain host-owned; source-only rollback restores the coupled dependency/import set without rewriting records.

## Existing design and research

Reuse the accepted ownership and immutable-artifact decisions in
[the cutover design](../specs/2026-10-31-component-consumer-cutover-design.md)
and [its plan](2026-10-31-component-consumer-cutover.md), DI-7AF2A4D33ED0 and
DI-7E68467A7AD0. This is a receiving refactor, not a new architecture or service.
Native research receipt `initiative-952fd97f-35ad-4607-9fdb-73a212134688`
binds the current validators manifest; plan admission IRD-7D4749E49A47 is allowed.
Neither is implementation or final acceptance evidence.

Chosen: receive the qualified artifact and retire duplicated bodies atomically.
Rejected: independently evolving source snapshots; combining all seven families
or adding an eighth facade without an actual receiving requirement. Workroom,
GPP and Workroom policy retain separate responsibilities and a downward package
dependency graph. No package is created merely to mirror an audit heading.

Candidate: `@opendigitalproductfactory/dpf-scoped-judgment@0.1.0-candidate.2`,
source `79bfff540fa8a11c5f725cf60d46764e600868fe`, archive SHA256
`cf79f4ee40c72706439af9e51155b2a12c9b14c5029a6253d14f8a6848a87af9`.
Existing standalone CI and strict Node24.22.0/24.22.1 TS7 receiver proofs qualify
the candidate only. They do not prove this receiving implementation.
Connected GitHub PR creation for its repository remains403; do not bypass it.

## Contracts, flow and source ownership

Contract references: CONTRACT-JC-SHARED-BODY, CONTRACT-JC-SCOPE,
CONTRACT-JC-TRANSPORT, CONTRACT-JC-GUARD, CONTRACT-JC-HOST.
Flow references: FLOW-JC-CHARACTERIZE, FLOW-JC-RECEIVE,
FLOW-JC-VERIFY, FLOW-JC-ROLLBACK.

The component maintainer owns the portable implementation. DPF maintainers own
receiving callers, dependency transport and compatibility bridges. The existing
source bodies are decision-scopes.ts, bounded-trusted-json.ts, and judgment/
index.ts, scopes.ts, option-scoring.ts, mcda-quality-gates.ts,
option-identities.ts, uncertain-retry.ts and scoped-advice.ts under
packages/validators/src. Their nine upstream source bodies match provenance at
the named DPF base. Preserve Apache notices and exact public type/value exports.

Real consumers include decision-perspective/option-recommendation.ts and wiki/
principle-decide.ts. Inventory all references before editing, including dynamic
imports, GPP and other package consumers, mobile, offline scripts and examples.
Do not substitute an example for a migrated real caller.

Compatibility exports contain no second implementation. Record the real caller
set, owner, BI-BDF358CB tracking anchor and removal condition: remove a bridge
only after every current consumer imports the canonical package contract and
required downstream loader parity is proven. No copied body is maintained as a
second canonical scorer, JSON validator or vocabulary.

## Phase 1 — characterize and resolve impact

FLOW-JC-CHARACTERIZE; AC-JC-01 through AC-JC-05; VER-JC-PARITY.

1. Refresh current main, preserve the completed Workroom package cutover, and
   recheck candidate source/closure against current consumers. Refuse unexplained
   semantic drift; do not silently overwrite a newer host fix with a seed.
2. Claim exact implementation paths and consume every returned testImpact,
   guardObligation and derived-artifact requirement. A missing/unresolved impact
   contract expands verification. The present claim covers this plan only.
3. Provision compile readiness through the managed worktree installer; the new
   worktree is source-only with no node_modules or generated Prisma client.
   Do not interpret failures from unavailable runners as product defects.
4. Characterize scorer quality/uncertainty, option identities, scope isolation,
   bounded hostile JSON, and public type/value identity before replacement.
   Reuse existing scoped-advice, guard-runtime-parity, principle-decide and
   option-recommendation coverage; add only meaningful gaps in behavior.

## Phase 2 — one coupled receiving change

FLOW-JC-RECEIVE; CONTRACT-JC-SHARED-BODY; CONTRACT-JC-TRANSPORT;
CONTRACT-JC-GUARD; AC-JC-01, AC-JC-02, AC-JC-03.

1. Pin and integrity-verify the exact archive in root, validators and actual
   direct receiving manifests. Update normal root/mobile locks, vendor inventory
   and every applicable filtered image context before frozen installation.
   Enumerate actual context requirements; do not assume Workroom coverage
   automatically transports a second package.
2. Migrate at least the real option-recommendation/scorer caller. Replace the
   nine displaced source bodies with exact package exports, using existing public
   subpaths. Do not rewrite values, scopes, serialized bytes or authority logic.
3. Resolve the Node20 golden guard explicitly. Current
   scripts/build-judgment-guard-runtime.mjs transpiles two local TS bodies into a
   dependency-free committed ES2022 distribution. Thin exports would break its
   existing dependency check. Candidate emitted scorer/quality-gate files differ
   from current generated JS only by the existing generated-header line, as
   observed by source diff; this is not a runtime compatibility proof.
4. Generate the guard distribution from the exact verified candidate's emitted
   two-file closure, retaining deterministic headers and recording archive,
   component source, file hashes and builder provenance in its manifest. Keep
   Node20 guard execution dependency-free: never import the Node24 package at
   guard runtime, invoke a registry, or hand-edit generated JS. Verify current
   output byte parity before accepting the generator change. Expand its strict
   explicit closure and derived-artifact registry deliberately; no wildcard
   dependency allowance or security/approval guard weakening is permitted.
5. Keep the prior candidate immutable. If an unsupported export/loader blocks
   receiving, request a separately qualified immutable candidate; do not change
   its engine declaration or claim an untested Node/CommonJS profile.

## Phase 3 — qualify receiving behavior

FLOW-JC-VERIFY; CONTRACT-JC-SCOPE; CONTRACT-JC-HOST; AC-JC-02 through
AC-JC-05. Verification references: VER-JC-PARITY, VER-JC-LOADER,
VER-JC-GUARD, VER-JC-INTEGRATION, VER-JC-SERVED, VER-JC-ROLLBACK.

- VER-JC-PARITY: incumbent decision/advice/identity/hostile-JSON results and
  byte contracts, plus real caller and bridge identity checks at exact source.
- VER-JC-LOADER: clean strict installations, public exports/declarations,
  browser/server/mobile and source/emitted loaders where actually used; exact
  artifact hashes and filtered Docker transport with no global config leakage.
- VER-JC-GUARD: actual supported Node20 golden guard and freshness checks;
  deterministic generated byte parity and an exact dependency-free closure.
- VER-JC-INTEGRATION: affected validators/web and package typechecks, mobile
  only when closure requires it, host guards, governed merged-code integration
  and protected build/merge-queue CI. Reuse evidence only for its bound identity.
- VER-JC-SERVED: normal, missing/stale context and bounded uncertain/recovery
  behavior through a real receiving decision path in an admitted shared preview,
  with synthetic facts. Preserve scoped advice versus host authorization.
  Verify source/archive identity first, clean owned fixtures before release and
  release only this chat's exact lease. Never revive a terminal preview.
- VER-JC-ROLLBACK: demonstrate restoration of the prior coupled dependency,
  lock, import/body and generated-distribution set without persisted-record edits.

No runtime gates have run on this new receiving slice. Native uncertainty from
the old pilot is not a review receipt for it. Freeze the DCO head, obtain the
required independent review and satisfy current publication policy. Open one
regular receiving PR when ready; merge through protection only. No deployment.

## Delivery shape and coverage

This is one atomic receiving deliverable mapped to BI-BDF358CB: the dependency
pin, real caller, nine body retirements and derived guard distribution must move
together to preserve one scorer. Internal phases are not independent releases.
The operator's original instruction requires same-slice retirement and one
supported integrated DPF product; it supplies the substantive atomic rationale.
The GPP receiving slice BI-2D3F986C remains independently reviewable afterward.

Coverage status: pending immutable plan commit and native coverage recording.
Required coverage references are AC-JC-01 through AC-JC-05, OBJ-JC,
CONTRACT-JC-SHARED-BODY/CONTRACT-JC-SCOPE/CONTRACT-JC-TRANSPORT/
CONTRACT-JC-GUARD/CONTRACT-JC-HOST, FLOW-JC-CHARACTERIZE/FLOW-JC-RECEIVE/
FLOW-JC-VERIFY/FLOW-JC-ROLLBACK and VER-JC-PARITY/VER-JC-LOADER/
VER-JC-GUARD/VER-JC-INTEGRATION/VER-JC-SERVED/VER-JC-ROLLBACK.
Do not claim implementation admission until the server accepts exact coverage.

No DPF2 edits, private corpus export, new service/store, credentials/grants,
production business-data changes, public npm release or installation advance.
