---
status: draft
---

# Build Studio large-lane independent reviews — implementation plan

| | |
|---|---|
| Date | 2026-10-02 |
| Design | [Build Studio large-lane independent reviews](../specs/2026-10-02-build-studio-large-lane-independent-reviews-design.md) §1–§5, OBJ-ROUTE / OBJ-BIND / OBJ-PRESERVE |
| Epic | EP-984E4124 |
| Backlog | BI-926A7E90 |
| Decision | DI-22C924C64147 (widen the server dispatcher to the pre-build gates) |
| Baseline | baseline-6ad344f0-a72f-470f-bf0a-decfe0aefc6a (spec revision 4719b3f4) |

## Outcome

A Build Studio build whose shape is `large` stops waiting on a human to request the reviews it
owes. The server reviewer dispatcher (`dispatchOwedIndependentReviews`) considers Build Studio
rooms whose build is in `plan`, binds each review to the build's accepted design revision, and
sends the request on a live connection of the room's requesting user. The dispatcher's existing
awaiting-acceptance behaviour is untouched.

Measured on the install on 2026-10-02: 122 Build Studio rooms in plan, every one bound to a
backlog item and holding an accepted `designDoc` revision, none carrying a head sha. That is why
§2 derives the dispatch identity from the revision digest rather than a branch head.

## Code substrate (read before each PR)

| Concern | Where it lives today |
|---|---|
| Dispatcher, candidates, cooldown, request key check | `apps/web/lib/backlog/initiative-readiness/server-reviewer-dispatch.ts` (`loadCandidates`, `defaultOwedRoutes`, `recentlyDispatched`, `record`) |
| Reviewer routing over a decision | `apps/web/lib/tak/initiative-readiness-tool-grants.ts` (`resolveInitiativeReviewerRecovery`, `InitiativeRecoveryCanonicalArtifact`, `InitiativeRecoveryDispatchContext`, `requestCoworkerPacket`, `IMMUTABLE_READER_TOOL`) |
| Design-phase decision filter | `apps/web/lib/backlog/initiative-readiness/design-phase-recovery.ts` (`designPhaseReviewDecision`, `routeDesignReviewsBeforeBaseline`) |
| Terminal recovery (rooms, baselines) | `apps/web/lib/backlog/initiative-readiness/terminal-recovery.ts` (`resolveTerminalInitiativeRecovery`, `defaultLoadLiveRooms`) |
| Receipt artifact ref already accepts `feature-build-revision` | `receipt-schema.ts`, `artifact-resolver.ts` (`locator.kind === "feature-build-revision"`), `baseline-repository.ts` |
| Immutable reader for repo blobs | `apps/web/lib/mcp/packs/version-history-pack.ts` (`read_source_at_version`, grant `file_read`) |
| Author connection | `apps/web/lib/mcp/standing-connection.ts` (`findStandingConnection(userId, agentId, toolName, callerClient)`) |
| Build Studio room coworkers | `apps/web/lib/work-capsules/build-studio-room-coworkers.ts` (`AGT-WS-BUILD`, BI-00588B51) |
| Readiness decisions per item | `get_backlog_item` → `readiness.decisions.{plan,implementation,completion}` (`backlog-pack-read-tools.ts`) |
| `BuildArtifactRevision` | columns `id, buildId (FeatureBuild.buildId), field, revisionNumber, value, valueDigest, status` |

## Scope and staging

Five PRs, each one clean revert, each passing the fast local gate and the merge queue on its own.
The order is a dependency order: PR-3 needs PR-1 and PR-2; PR-4 is independent of PR-3 but
nothing dispatches without it; PR-5 is proof.

| PR | Deliverable (spec §) | Shape | Changes dispatcher outcome? |
|---|---|---|---|
| PR-1 | `read_build_artifact_revision` reader + `feature-build-revision` binding in the recovery packet (§1) | small | no |
| PR-2 | Build Studio dispatch context on the room (§2) | small | no |
| PR-3 | Dispatcher candidates for builds in plan, implementation-target routing (§3) | medium | yes, for Build Studio rooms only |
| PR-4 | Connection selection for Build Studio rooms (§4) | small | yes, for Build Studio rooms only |
| PR-5 | Live proof and the Annex update (§5, AC-5) | small | no |

### PR-1 — reader and binding (OBJ-BIND)

1. `apps/web/lib/mcp/packs/version-history-pack.ts` (or a sibling pack if the module-size guard
   objects): add `read_build_artifact_revision { revisionId, expectedValueDigest? }`. Read-only,
   `requiredCapability: view_platform`, grant `file_read` (so the existing
   `IMMUTABLE_READER_GRANT` eligibility check in `resolveInitiativeReviewerRecovery` holds without
   a second grant). Returns `{ revisionId, buildId, field, revisionNumber, valueDigest, value }` and
   fails closed with `IMMUTABLE_SOURCE_UNAVAILABLE` when `expectedValueDigest` does not match.
   Test: `version-history-pack.test.ts` — digest match, digest mismatch, unknown revision.
2. `apps/web/lib/tak/initiative-readiness-tool-grants.ts`:
   - `InitiativeRecoveryCanonicalArtifact` gains
     `{ resolved: true; kind: "feature-build-revision"; revisionId; valueDigest; buildId }`. The
     existing shape gets an explicit `kind: "repo-blob-at-commit"` default so narrowing is by
     `kind`, not by field presence.
   - `requestCoworkerPacket` emits `artifactRef` by kind; for a revision the objective tells the
     reviewer to call `read_build_artifact_revision` with the digest, and `requiredToolNames` is
     `[writer, "read_build_artifact_revision"]`. The request key stays
     `initiative-readiness:<item>:<gate>:<headSha>` where `headSha` is the dispatch context's
     immutable identity (PR-2 defines it for Build Studio).
   - `formatInitiativeReviewObjective` renders the revision form.
   Tests: `initiative-readiness-tool-grants.test.ts` — packet shape for both artifact kinds; the
   repo-blob packet is byte-identical to today's (AC-3 guard).
3. Receipt side needs no change: `record_initiative_design_review` already accepts
   `artifactRef.kind: "feature-build-revision"` and `artifact-resolver.ts` loads the revision.
   Add one test in `receipt-validation.test.ts` asserting a binding with that kind and a
   `workroom-head` workroomRef validates.

### PR-2 — Build Studio dispatch context (OBJ-BIND)

1. New `apps/web/lib/backlog/initiative-readiness/build-studio-dispatch-context.ts`:
   `resolveBuildStudioDispatchContext({ capsuleId })` → loads the room (`executorKind ===
   "build-studio"`, `featureBuildId`), the build (`buildId`, `phase`, `originatingBacklogItemId`),
   and the latest accepted `designDoc` revision (`revisionNumber desc`). Returns
   `{ dispatchContext: { workroomId, repositoryFullName: <platform repo>, branchName:
   "build/<buildId>", headSha: <sandbox head if the room has one, else revision.valueDigest> },
   canonicalArtifact: { resolved: true, kind: "feature-build-revision", ... } }` or a typed
   `{ unavailable: reason }` (`no-build`, `not-in-plan`, `no-accepted-design`).
   The platform repository name comes from the existing `repositoryFullName` the room already
   carries when set, else the install's configured repository (same source `adopt_worktree` uses).
2. Plan artifact: the accepted `buildPlan` revision of the same build, same shape, exposed as
   `planArtifact` for `plan-review`.
3. Pure, no dispatcher wiring yet. Tests with an in-memory db stub: happy path, each unavailable
   reason, digest used as identity when no head.

### PR-3 — dispatcher candidates for builds in plan (OBJ-ROUTE)

1. `server-reviewer-dispatch.ts`:
   - `loadCandidates` gains a second source after the awaiting-acceptance set: rooms with
     `executorKind = "build-studio"`, `archivedAt null`, build `phase = "plan"`, item status
     `open | in-progress`. Each candidate carries `target: "completion" | "implementation"`.
     The per-call `limit` applies to the union, shuffled as today.
   - `defaultOwedRoutes(itemId, authorAgentId, candidate)`: for `implementation` read
     `readiness.decisions.implementation`, keep only routable unmet codes via
     `designPhaseReviewDecision`, resolve the context with PR-2, and call
     `resolveInitiativeReviewerRecovery` directly with that context and artifact (not the terminal
     recovery, which requires a live room head). `expectedCurrentBaselineId` is the item's current
     baseline when one exists (same loader terminal recovery uses).
   - The room author for a Build Studio room is `requestedByPrincipalId` → user, assistant
     `AGT-WS-BUILD`; `loadRoomAuthors` learns that mapping.
   - Cooldown, `recentlyDispatched`, `record`, outcomes: unchanged code paths.
   Module size: the file is 221 lines today; the budget is 800. If the second candidate source
   pushes past clarity, the Build Studio candidate loader lives in
   `build-studio-dispatch-candidates.ts` and the dispatcher imports it.
2. Tests (`server-reviewer-dispatch.test.ts`): existing cases unchanged and green (AC-3); a
   Build Studio candidate dispatches with the revision binding (AC-1); a changed revision yields a
   new request key and a repeat inside the cooldown records `cooling-down` (AC-4); a room with no
   accepted design records `readiness-unavailable`.

### PR-4 — connection selection for Build Studio rooms (OBJ-ROUTE)

1. `standing-connection.ts`: add `findStandingConnectionForUser(userId, toolName, callerClient,
   { preferAgentIds? })` — any live `oauth_access` token of that user whose token admits the tool,
   newest first, preferring the given agent ids. The existing `(user, agent)` function is
   unchanged and still used for awaiting-acceptance candidates.
2. `server-reviewer-dispatch.ts`: for a Build Studio candidate use the per-user selector with
   `preferAgentIds: ["AGT-EXT-CLAUDE", "AGT-EXT-CODEX"]`; the recorded outcome payload names the
   `agentId` of the connection that carried the request (the audit trail the spec §4 promises).
   No grant is widened: `request_coworker` still intersects the reviewer's grants with the user's
   capabilities at execution.
3. Tests: selector prefers the listed agent, falls back to any admitting connection, returns null
   when none admits the tool; dispatcher records the carrying connection.

### PR-5 — live proof and Annex (AC-5)

1. After PR-1..4 reach the install via `/ops/self-upgrade`, let one reconciliation tick run and
   read `WorkroomActivity kind='reviewer-dispatch'` for a Build Studio room: expect `dispatched`
   rows for design-spec, spec-approval, architecture-review and plan-review, then receipts, then
   `CANONICAL_DESIGN_REQUIRED`, `SPEC_APPROVAL_REQUIRED`, `ARTIFACT_AUTHOR_REQUIRED`,
   `OBJECTIVE_BASELINE_REQUIRED` cleared on the implementation decision, then the build crossing
   plan→build on the next resume with no click.
2. `docs/architecture/failure-analysis-and-recovery.md`: Annex row for the Build Studio pre-build
   review lane (who requests, on whose connection, what it binds to, what still escalates).
3. Record the proof as execution evidence on BI-926A7E90 and move the item.

## Traceability

Contracts are the stable surfaces each PR changes or relies on; flows are the runtime paths a
reviewer can follow end to end. Every id below appears in the plan-coverage receipt.

| Contract | Meaning |
|---|---|
| CT-REVIEW-BINDING | `initiativeReviewBinding` + `artifactRef` as the receipt writer and `request_coworker` adapter accept them |
| CT-IMMUTABLE-READER | the read-only reader a reviewer is handed alongside the writer (`read_source_at_version`, `read_build_artifact_revision`) |
| CT-DISPATCH-CONTEXT | `InitiativeRecoveryDispatchContext` (workroomId, repositoryFullName, branchName, headSha) |
| CT-DISPATCHER | `dispatchOwedIndependentReviews` candidates, cooldown, request keys, recorded outcomes |
| CT-STANDING-CONNECTION | `findStandingConnection` and its per-user variant |
| CT-ANNEX | the failure-analysis Annex row and the execution evidence on the item |

| Flow | Meaning |
|---|---|
| FL-REVIEW-READS-REVISION | reviewer receives the packet, reads the revision by digest, records the receipt bound to the same revision id |
| FL-ROOM-TO-CONTEXT | a Build Studio room in plan resolves to a dispatch context and canonical artifact, or a typed unavailable reason |
| FL-DISPATCH-TICK | reconciliation tick → candidates → owed routes → cooldown → request on a connection → room-recorded outcome |
| FL-CONNECTION-SELECT | Build Studio room → requesting user → preferred live connection that admits `request_coworker` |
| FL-LIVE-PROOF | one blocked large build receives its reviews and crosses plan→build with no click |

| PR | Requirements | Contracts | Flows | Verification |
|---|---|---|---|---|
| PR-1 | OBJ-BIND | CT-REVIEW-BINDING, CT-IMMUTABLE-READER | FL-REVIEW-READS-REVISION | AC-2 |
| PR-2 | OBJ-BIND | CT-DISPATCH-CONTEXT | FL-ROOM-TO-CONTEXT | AC-2, AC-4 |
| PR-3 | OBJ-ROUTE, OBJ-PRESERVE | CT-DISPATCHER | FL-DISPATCH-TICK | AC-1, AC-3, AC-4 |
| PR-4 | OBJ-ROUTE | CT-STANDING-CONNECTION | FL-CONNECTION-SELECT | AC-1 |
| PR-5 | OBJ-ROUTE, OBJ-PRESERVE | CT-ANNEX | FL-LIVE-PROOF | AC-5, AC-6 |

## What stays a human decision

A reviewer that fails the design, an accepted or deferred residual risk, and any `xlarge` build
still escalate to the owner. Nothing here mints a receipt from the executing surface.

## Verification per PR

Unit tests for the touched files; `pnpm --filter web typecheck`; module-size, application-boundary
and import-cycle guards; the heavy build runs once in the merge queue. PR-5 is the only
runtime-bound gate and runs on the canonical runtime, never a hand-built image.
