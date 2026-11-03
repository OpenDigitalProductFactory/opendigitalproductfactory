# Scoped MCP Tool Packs

Status: standard, migration COMPLETE (BI-ARCH-TOOLPACKS, EP-PLATFORM-CONSOLIDATION; final consolidation W9 BI-0E7B0953, 2026-08-18)
Spec: [`docs/superpowers/specs/2026-06-25-platform-consolidation-spine-design.md`](../superpowers/specs/2026-06-25-platform-consolidation-spine-design.md) §6.2

`apps/web/lib/mcp-tools.ts` was once a ~17k-line mega-module declaring the entire
`PLATFORM_TOOLS` registry inline and dispatching through one giant `executeTool`
switch. As of W9 (BI-0E7B0953) the migration is COMPLETE: every tool lives in a
domain-owned pack, `mcp-tools.ts` is a ~700-line composition layer whose
`PLATFORM_TOOLS` is purely the pack-registry spread, the legacy `lib/mcp-handlers/`
directory is deleted, and `check-mcp-tool-pack.mjs` refuses any new inline case,
inline ToolDefinition, or handler outside packs (the inline baseline is frozen at
zero). The historical motivation stands: the local-model path can only carry ~15
tools (`LOCAL_FALLBACK_MAX_TOOLS`), so the registry composes from scoped packs
rather than one unbounded surface.

`surface-pack.ts` is the cross-domain projection pack for the Authorized Surface Contract. Its six generic tools (`surface_list`, `surface_open`, `surface_snapshot`, `surface_query`, `surface_act`, and `surface_close`) stay together; domain packs continue to own the underlying business actions, and persistent surface actions dispatch back through the governed executor. This avoids both an unbounded page-specific tool inventory and a parallel execution path.

## The shape

A [`ToolPack`](../../apps/web/lib/mcp/tool-pack.ts) bundles the three things that used to
live in three places:

- **definitions** — the `ToolDefinition[]` (was inline in `mcp-tools.ts`),
- **handlers** — `name -> handler` (was a sibling module + a switch case),
- **grants** — agent-grant categories per tool (was only in `agent-grants.ts`).

[`composeToolPacks`](../../apps/web/lib/mcp/tool-registry.ts) merges packs into the flat
surfaces `mcp-tools.ts` consumes (the combined definition list + a `name -> handler`
lookup) and throws on a duplicate tool name across packs.

The contract types a pack, a handler or a coworker surface names (`ToolDefinition`,
`ToolResult`, `ToolExecutionContext`, `ToolAnnotations`, `BuildPhaseTag`) live in the leaf
module [`lib/mcp-tool-types.ts`](../../apps/web/lib/mcp-tool-types.ts), not in `mcp-tools.ts`.
Import them from there. While they lived in `mcp-tools.ts`, every pack's `import type` closed
a loop through the registry, and apps/web's all-imports cycle, which TypeScript project
references need acyclic, reached several hundred files.
[`scripts/check-no-web-import-cycle-growth.mjs`](../../scripts/check-no-web-import-cycle-growth.mjs)
keeps that cycle from growing back (dependency-diet plan M11 step 2).
The governed executor follows the same rule: `GovernedExecuteArgs`, `GovernedExecuteContext`,
`GovernedExecuteResult`, `GovernedExecuteRejection` and the `ToolLifecycle*` hook types live in
[`lib/mcp-governed-execute-types.ts`](../../apps/web/lib/mcp-governed-execute-types.ts), and the
precondition verdict types in
[`lib/tak/precondition-ordering-types.ts`](../../apps/web/lib/tak/precondition-ordering-types.ts),
so a gate, hook, receipt or audit writer names them without an edge back into
`lib/mcp-governed-execute.ts`.
The remote coworker task submitter does the same: `RemoteTaskSubmitAuth`, `RemoteTaskSubmitOutcome`
and `ExistingRemoteTask` live in
[`lib/mcp-task-submit-types.ts`](../../apps/web/lib/mcp-task-submit-types.ts). The inference
message shapes every adapter and agent loop passes around (`ChatMessage`, `ContentBlock`,
`ToolCallEntry`) live in
[`lib/routing/chat-message-types.ts`](../../apps/web/lib/routing/chat-message-types.ts)
(routing is the innermost application context, so every layer may import it),
not in the inference runtime or the adapter contract.
Readers outside the MCP layer that sat on the same loop follow suit: the approved-request
outcome (`ApprovedRequestRun`) lives in
[`lib/coworker/approved-request-run-types.ts`](../../apps/web/lib/coworker/approved-request-run-types.ts),
the AI readiness summary shapes in
[`lib/ai-readiness/readiness-summary-types.ts`](../../apps/web/lib/ai-readiness/readiness-summary-types.ts),
and `QuiescenceBlockerLine` once, in
[`lib/self-upgrade/run-types.ts`](../../apps/web/lib/self-upgrade/run-types.ts), so the
approval store, the attention projection and admission observability name them without an
edge into the runner, the readiness composer or `lib/self-upgrade/quiescence.ts`.

A definition also declares its reach. `sideEffect` plus `consequence` (`outward` | `irreversible` | `authority`) is what puts a tool behind the consult-before-consequential-act gate, and an `outward` tool additionally names whose stance governs it with `consequenceScope`: `business` (default, WWWD-alignment-gated) or `platform` (platform development or operations that leave the install, such as `create_portal_pr` or `contribute_to_hive`; receipted and outward-reviewed, never scored against the customer business stance). Declare both on the tool; never infer them from the pack name (BI-63B14D4B).

### Per-call effects under existing policy

`consequenceForCall` may narrow a declared consequence when the exact call proves
an ordinary effect. It does not grant permission: the governed executor still
intersects user capabilities, assistant grants, current delegation and scope.
Unavailable evidence retains the declared consequence.

For `release_workroom_scope` and its alias, the declaration stays `authority`.
The existing resolver narrows only an exact active Workroom with the caller's
live lease and scope recorded by that principal. Mixed or foreign claims,
unknown ownership, archived rooms and expired leases retain authority routing.
The handler reads the current monitor-bound authorization decision, checks the
human, assistant and action, then rechecks eligibility inside the existing write
transaction before the scope snapshot CAS. Transaction admission cannot extend
a lease. Genuine approved authority operations retain their established path.

Release requests carry `expectedRoomId` and the complete original targets,
including the server-owned `releaseEpoch`, owner and intent. Claim aliases share
one acquisition receipt path; release aliases share one release receipt path.
A keyed exact replay returns the original settled outcome, even after later
reacquisition, and cannot execute again. Unavailable receipt lookup is not proof
of absence. Invalid or stale targets stop before policy projection or a new
approval envelope. Genuine approved authority actions still require the same
original targets at execution.

Epoch enrollment waits for verified canonical writer compatibility and retirement
of older executors. Settings writers preserve ownership fields, and full-array
updates compare the original snapshot. The compatibility floor also applies to
later canonical updates; an empty claim list does not relax it.

No new approval store or trust exception is involved. Permission to perform an
action remains separate from independent review or attestation of test results.
The design and acceptance bounds are in
[owned Workroom scope release](../superpowers/specs/2026-10-14-owned-workroom-scope-release-design.md).

## Read packs for standing stages

Some packs exist so a standing Workroom stage can read the record it reports on.
They are read-only (`sideEffect: false`, `readOnlyHint: true`), each sits behind
its own narrow grant held only by the stage's accountable agent, and each
reports an empty or unconfigured source as unknown rather than as an empty
queue:

| Pack | Tools | Grant | Reads |
|---|---|---|---|
| [`contributor-inventory-pack.ts`](../../apps/web/lib/mcp/packs/contributor-inventory-pack.ts) | `list_pull_requests`, `read_contributor_inventory` | `contributor_inventory_read` | `ContributorInventorySnapshot`, through the change-lanes read model's `loadContributorInventorySource` |
| [`payables-pack.ts`](../../apps/web/lib/mcp/packs/payables-pack.ts) | `list_bills`, `list_supplier_contracts` | `payables_read` | `Bill`, `SupplierContract`, `Supplier` |

Stage bindings and the gap list they shrank are in
[work shapes and the decision gate](work-shapes-and-the-decision-gate.md).

## Migration discipline (parity first)

Extraction is incremental and **parity-preserving** — never a behavior change:

1. **Definitions first.** A pack owns the definitions; `mcp-tools.ts` spreads
   `pack.definitions` into `PLATFORM_TOOLS`. The resulting array is identical, so tool
   discovery, grant filtering, phase/route exposure, and the local-fallback budget are
   unchanged.
2. **Dispatch next.** The `executeTool` switch migrates onto `registry.getHandler(name)`
   pack by pack. Until a pack's dispatch is migrated, its handlers stay wired in the switch.
3. **Authority travels with the handler (R3).** Grant gating still resolves through
   `agent-grants.ts` `TOOL_TO_GRANTS` (the single gating source). The pack mirrors those
   entries so the metadata lives with the pack, and `tool-registry.test.ts` asserts the two
   never drift. Tool definitions carry their own `requiredCapability`, so moving a
   definition into a pack moves its capability gate with it.

## First pack

[`deliberation-siem-pack`](../../apps/web/lib/mcp/packs/deliberation-siem-pack.ts) — the
Deliberation + SIEM tools were the cleanest first extraction (already self-contained
sibling modules with their own handlers). `mcp-tools.ts` now **fully** owns them through the
pack: their definitions compose into `PLATFORM_TOOLS` via the registry, and their dispatch
routes through `registry.getHandler(...)` (run right after the kernel gate, before the
switch) — the eight inline switch cases and their handler imports are gone. The behaviour is
identical: the kernel/commandment gate still runs first, the handlers are the same functions
called with the same arguments, and grant gating is unchanged. `tool-registry.test.ts`
proves the pack bundles exactly those definitions, a handler exists per definition, the
grant metadata matches `TOOL_TO_GRANTS`, and every pack tool is still present in the live
`PLATFORM_TOOLS`; `mcp-tools-{siem,deliberation}.test.ts` + `mcp-governed-execute.test.ts`
keep the dispatch path honest.

## Second pack — lazy handlers

[`runtime-coordination-pack`](../../apps/web/lib/mcp/packs/runtime-coordination-pack.ts)
proves the pattern handles **lazy** handlers. Unlike Deliberation/SIEM (static imports), the
runtime handlers live in a sibling module that the switch cases `await import(...)`-ed per
call. The pack preserves that: each handler is a thin wrapper that lazy-imports the module
only when the tool is invoked (passing the same arguments the switch case did, including the
mixed arities). Its five definitions were moved verbatim out of the inline `PLATFORM_TOOLS`
array (and the now-unused `RUNTIME_COORDINATION_TOOL_ENUMS` plumbing removed); they compose
back through the registry, dispatch through `registry.getHandler(...)`, and the five switch
cases are gone. `tool-registry.test.ts` + `mcp-tools-runtime-coordination.test.ts` prove
parity.
[`work-capsules-pack`](../../apps/web/lib/mcp/packs/work-capsules-pack.ts) (10 tools, mixed
arities) and [`workbooks-pack`](../../apps/web/lib/mcp/packs/workbooks-pack.ts) (5 tools)
followed on the same lazy pattern as the third and fourth packs — **every sibling-module
domain (static + lazy) is now extracted.**

`rebind_workroom_shape` (BI-CB5C0DCE) lives in this pack, but its handler is
its own lazy module (`work-capsules/workroom-shape-rebind-handler.ts`), so
`mcp-handlers.ts` does not grow. It is the governed way to move a room's
`workShape` pin to a newer version. The rule it carries is in
[work shapes and the decision gate](work-shapes-and-the-decision-gate.md).

The pack also owns bounded classification recovery. `review_workroom_sensitivity`
requires `manage_platform` and `admin_read`, returning only classification state
and an exact revision digest, never room contents or historical prose.
`correct_workroom_sensitivity` requires `manage_platform` and `admin_write`,
declares an authority consequence and proposal execution, and uses the existing
governed approval path. Its lazy handler rechecks administration permission,
refuses stale digests or already valid classifications, and commits the correction
with an audit retaining the original declaration and trusted approval reference.
It changes no principal clearance or membership. The operator workflow is in
[Work rooms](../user-guide/workspace/work-rooms.md).

`list_workrooms(view="definitions")` returns a bounded catalogue from the
canonical source registry and review-profile composer. Omitting `view` retains
instance observations. Definition pages include sparse sources and canonical
aliases, with profile composition status, fingerprints and canonical conflict reasons. They report
`not-exercised` occurrence assessment and `unknown` organization applicability;
definition counts never stand in for successful execution or coverage.

The view keeps `view_platform`, `work_capsule_read` and native user context.
It reads no room records. Instance filters and cursors are refused, and a
changed definition inventory requires a fresh traversal. Whole pages fit the
existing result budget; a refusal never advances past unseen definitions.
The full contract is in [Workroom review profiles](workroom-review-profile-contract.md).

`get_workroom` also supports `continuationMode: "bounded"` under fresh room
content admission. Use `continuationTaskId` for an exact scheduled task or
`continuationStageKey` for a current manual branch; the selectors are mutually
exclusive. Task reads check the task's own checkpoint against the current room,
branch, source and lease. They do not substitute the room's latest checkpoint.
Pass the returned `continuationVersion` on a later read to detect changed facts
or authority. A stale version, mismatched task binding or oversized mandatory
brief returns a refusal; none authorizes replay. Read this mode separately from
activity, review and cursor queries. The response shares native assignment facts,
excludes the originating transcript and grants no execution authority. Manual
reads can include `advisoryCheckpoint`, retaining the saved next action and risks
with provenance. Its `head-matches` status checks only the recorded commit head;
the existing carrier has no repository snapshot. It remains room-scoped and
unbound to any graph stage. Scheduled-task reads exclude it, and stale manual
notes require reconciliation. See
[bounded assignment and continuation briefs](workroom-cycle-continuity.md#bounded-assignment-and-continuation-briefs).

`list_workrooms` accepts `headBranch` and `pullRequestNumber` so an assistant
asked to take over a PR can find its room (BI-679D2BF6). For an OAuth
assistant, a lookup also matches the person's rooms that another assistant
created. Those rows carry only the fields `workroom_assistant_not_admitted`
already discloses, plus the `reassign_workroom_executor` call. An unfiltered
listing keeps the person-and-assistant scope. The design is the executor
takeover design under BI-E2871BDE.

`workroom_assistant_not_admitted` also returns the room's stored executor
`checkpoint`, its bound `pullRequest` and `leaseExpiresAt`, so the assistant
can decide on a takeover without reading the room's history (BI-D4144471).
`reassign_workroom_executor` accepts `capsuleIds` (1 to 20) instead of
`capsuleId` to hand over a set of rooms. The call is a dry run by default: it
returns each room's executor, lease holder and checkpoint, plus a `planDigest`
over the sorted (room, executor, lease holder) tuples. A dry run changes
nothing, so it needs no approval. Applying (`dryRun: false`) needs that digest,
and the approval fingerprint covers the set and the digest. If any room changed
since the dry run, the whole call is refused. Otherwise each room goes through
the single-room handover with its planned lease holder. A room taken in between
is skipped and reported, and each handed-over room records its own
`executor-changed` activity with its checkpoint. The governed OAuth check
applies the single-room handover rule to every listed room and refuses the
whole call if any room fails it.

`work-capsules-pack` shares one `scopeProperties` block across `create_workroom` and
`adopt_worktree`, so a field added there reaches both convene paths at once. That is how
`workroomShape` landed ⟦runtime: 2026-08-23⟧ — the room's collaboration
shape is part of the scope it is convened with, validated against `WORK_CAPSULE_WORKROOM_SHAPES`
and **rejected** rather than dropped when unknown, because a silently dropped shape convenes
a room the caller believes is shaped. Its enum is mirrored from `room-shapes.ts` (the lower
layer must not import from `work-management`) and `shape-key-parity.test.ts` is what keeps
the mirror honest.

`workShape` joined the same block ⟦runtime: 2026-09-02, `BI-A967717A`⟧ and is the second,
separate shape a room can be convened with: `workroomShape` says who must be in the room for
one consequential act, `workShape` says what wakes the room at all. It is a `key@version`
reference into the declared work-shape registry rather than an enum, so the pack validates its
*form* and leaves the registry lookup to the drive — the lower layer stays free of a runtime
dependency on `work-management`, exactly as the mirrored enum above does. A malformed
reference is **rejected** on the same reasoning: a claim the drive can never resolve leaves a
room that looks declared and behaves inert, which is worse than an undeclared room, because
nobody goes looking for it.

Not every field belongs in that shared block. `sessionRef` was added to `adopt_worktree` **alone** ⟦runtime: PR #4789, 2026-08-28⟧ because it answers a question only the adopt path had left unanswered: *whose* claim this is. `claim_backlog_item_for_work` had required a `sessionRef` all along and stored it as `WorkCapsule.executorRef`; `adopt_worktree` omitted it, so every worktree adopted through it stored `executorRef: null` and a claim guard could prove a live claim **covered** a branch but not that it belonged to the session asking. It is optional rather than required, unlike its sibling: making it required would break existing callers and refuse claims outright, and an unattributed claim is better than none.

`backlogItemId` was added to `adopt_worktree` alone for the same kind of reason ⟦runtime: PR #4837, 2026-08-28⟧. The handler had always bound a backlog item — but only from `outcomeAnchor`, and the schema advertised no `backlogItemId`, so the name every caller reaches for (the one `claim_backlog_item_for_work` binds, and the one the returned Workroom reports) was accepted and dropped while the call answered `success: true`. The unbound Workroom then held the branch permanently: unclaimable, because it matched no subject, and unreleasable, because resuming a terminal Workroom needed a backlog item it did not have.

Three properties make the binding honest rather than merely present. The id is **resolved** against the live `BacklogItem`, so an unknown one returns `unknown_backlog_item` instead of adopting unbound. The binding is **read back from the stored record**, because reporting the request rather than the result is exactly what hid the original defect. And a terminal Workroom carrying **no** backlog item is resumed and rebound rather than refusing — one bound to a *different* item still refuses, so branch provenance cannot be overwritten by a re-adopt.

`claim_workroom_scope` also accepts the server-issued `qualificationAdmissionToken` returned by initiative-readiness recovery. The token is opaque to the caller and signed over an exact one-start qualification binding. The Workroom handler verifies its item, room, source identity, protocol blob, installation, accountable principal, authority decision, shape/stage, allowed test paths, allowed tools, expiry and duration before atomically storing the issued state. A second or changed token cannot rearm a started or settled admission.

This adds no approval store and grants no implementation authority. The ordinary stage tool set is intersected with the phase's narrower set: Prepare may edit only the named test/helper paths and cannot run tests; Verify may run the exact qualification and cannot edit or auto-fix. Candidate and verification evidence must carry the binding digest and phase-specific immutable results. Settlement records the evidence id on the same Workroom state, so terminal recovery can advance from a settled Prepare only after independent review of its exact candidate, and can use only a settled positive Verify result when constructing the ordinary research writer path.

Verify remains fail-closed for caller-authored executor evidence. A valid
qualification claim can derive lease purpose, Workroom, source head, platform
and command from a signed token, but those bindings prove admission rather
than child execution. Historical `workroom-host` rows therefore remain
audit-only even when every stored field matches; sandbox-labelled and other
caller-authored rows likewise contribute no evidence. Terminal qualification
can settle only through the machine-authenticated native Edge result path,
which validates the exact immutable action and phase binding. Its capability
is closed and bounded rather than an arbitrary command surface. A valid Edge
result is still qualification evidence, not a research PASS: the separately
governed research writer must persist the normal research receipt.

The carrier and state machine are defined in [qualification research admission](../../apps/web/lib/backlog/initiative-readiness/qualification-research-admission.ts), enforced by [Workroom storage](../../apps/web/lib/work-capsules/work-capsule-store.ts), and described in the [initiative-readiness runbook](initiative-readiness-runbook.md#bounded-qualification-research-admission).

## Fifth pack — first inline extraction

[`feedback-pack`](../../apps/web/lib/mcp/packs/feedback-pack.ts) is the first pack whose
handlers came from **inline** `case` bodies rather than a sibling handler module. It owns the
three platform-feedback tools — `report_quality_issue` (→ `createPlatformIssueReport`),
`escalate_feedback_upstream` (→ `escalateReportUpstream`), and `register_tech_debt`
(`createTechDebtItem` + a direct `prisma` write). `register_tech_debt` takes an optional
`outcome` and `howWeKnow`; without an outcome the item records that the shortcut is replaced
by the intended design (BI-458CCA8D). Each handler lazy-imports its dependency and
reproduces the former switch case verbatim; the three definitions and switch cases (and the
now-unused helper imports) are gone from `mcp-tools.ts`.

`register_tech_debt` reads `context.agentId`, which the original pack-handler context
(`{ routeContext, threadId }`) didn't expose — even though the registry already forwards the
full runtime `ToolExecutionContext` to every handler. So `ToolPackHandler`'s context type was
widened to `{ routeContext?, threadId?, agentId? }` (a purely additive, type-only change). The
two thin-delegation tools plus the one prisma-writing tool prove the inline path across both
shapes before the larger clusters.

## Next packs

The remaining tools have **inline handler bodies with real logic** (not thin delegations) in
`mcp-tools.ts` — a larger extraction than the five packs done so far. The highest-value
clusters are `backlog` + `build-evidence`, `sandbox`, then `wiki/knowledge`: extract each
handler body into a domain module first, then pack it the same parity-first way, keeping the
existing MCP-route, grant-filter, and `mcp-governed-execute` tests green.

## Enforcement — the inline-case ratchet (BI-OPT-RATCHETS)

Migration discipline only holds if nothing can quietly add a **new** inline `case` while the
extraction is in flight. [`scripts/check-mcp-tool-pack.mjs`](../../scripts/check-mcp-tool-pack.mjs)
is that ratchet: it extracts the set of tool names dispatched by the top-level `case` arms of
`executeTool`'s `switch (toolName)` and compares it against the frozen
[`scripts/mcp-tool-pack-baseline.json`](../../scripts/mcp-tool-pack-baseline.json). The set may
only **shrink** — a new inline case fails CI (`MCP Tool Pack Guard` in `ci.yml`), so a new MCP
tool must register in a pack, not the switch. Extracting a tool removes its case; re-run
`node scripts/check-mcp-tool-pack.mjs --update` in the same PR to retighten the baseline. The
extractor is exported and reused by `tool-registry.test.ts` (the unit suite asserts the same
no-new-case invariant), so the guard and the test can never disagree. The baseline froze at the
231 inline cases that remained after the five packs above.

This composes with a companion **module-size ratchet** from the same BI
([`scripts/check-module-size.mjs`](../../scripts/check-module-size.mjs) + `Module Size Guard`):
new files are held to an 800-LOC ceiling (1000 hard cap) and the already-large files are frozen
in [`scripts/module-size-baseline.txt`](../../scripts/module-size-baseline.txt) and may only
shrink. No size guard existed before, which is how this very module grew past 15k LOC unnoticed —
the two ratchets together keep the consolidation gains from being silently undone.
