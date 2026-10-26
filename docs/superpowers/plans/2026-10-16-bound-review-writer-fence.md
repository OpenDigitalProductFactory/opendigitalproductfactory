---
status: active
backlog: BI-F646BC4E
---

# Bound canonical review writes to their admitted execution

Backlog: BI-F646BC4E. Historical parent: BI-7906C73E; umbrella BI-06AE6833.
Source baseline: d800c3d968ef1a32889c36c799b2f4cf07fe59dc, plus published parent design7008f45a20a9240db2f0d17c7531014065717d7c.
Workroom WC-A6F24B2D; branch fix/original-review-writer-fence.
Normal plan admission IRD-4039EEBDE400 and implementation admission IRD-C3C5D12FD426 allowed; research receipt initiative-a0c59719-7431-4d59-a84c-59ba46171f97. The server derived HIGH sensitivity and capped this fix at medium. Runtime verification remains pending.

## Boundary and acceptance criteria

This atomic repair protects new canonical review effects. It does not admit recovery, settle unknown execution, create a successor or complete the metrics feature. Parent historical-proof collection stays separately open. Native shape derived medium/low at current scope; re-evaluate any sensitivity raised by actual changes rather than treating this declaration as an exemption.

Quote the current item criteria verbatim:

- AC-WF-1: A newly appended canonical review receipt/baseline is refused under the same effect transaction when its bound task is held, uncertain, canceled or not in an eligible current execution state, including a race after preflight.
- AC-WF-2: Both canonical writers validate immutable accepted generation/authority against locked current task state at actual effect commit; stale callbacks/approval continuations cannot borrow a newer generation. Direct/public arguments cannot supply trusted generation. Compatibility for unversioned native sessions is explicit and fail closed.
- AC-WF-3: Existing genuine exact receipt readback still returns the original receipt for its true task/artifact/authority; it never appends another effect or revives execution. Unbound/manual writer paths retain their actual policy, independence and authorization checks.
- AC-WF-4: Real PostgreSQL race fixtures exercise each affected writer against hold/generation displacement/cancellation, including transaction winner ordering, plus normal valid write and genuine receipt replay. Source-local mocks alone are not atomicity proof. Run affected tests, typecheck, protected PR/queue and canonical live acceptance.
- AC-WF-5: No recovery admission, unknown clearing, replacement key/TaskRun, attempt reset, provider/model fallback or historical closure claim results from this repair. Metrics completion and parent7906 proof qualification remain separately open.

## Existing source and chosen contract

The shared lockBoundReviewEffect runs inside receipt-repository.ts and baseline-repository.ts transactions. It currently ignores progress generation and input-required/uncertainty. Both writers already read a genuine exact winner; preserve that readback before rejecting a new effect. Do not change the stable receipt key when adding ephemeral execution context: receipt identity stays original task+digest+writer+artifact, not generation.

Use one server-only typed execution-fence leaf in lib/shared/task-execution-fence.ts. Capture the immutable admitted reservation and dispatch identities plus relevant recorded execution-authority identity ONCE from mcp-task-execution's admitted run, before invoking the loop/provider. Initial null reservation/dispatch are explicit values for an admitted original execution; an absent or malformed fence is different. Preserve existing task, request digest, user/reviewer identity and original attempt budget. Do not resolve the current DB generation later and lend it to an old callback.

Carry this captured object through RunAgenticLoopParams, LoopToolContextInput and AdapterMcpSession; sign it into the native MCP session JWT and restore it only from verified transport auth into trusted ToolExecutionContext. Public tool params and JSON-RPC metadata cannot supply it. Preserve it in the existing server-owned approval context; missing legacy context cannot authorize a new effect. No new permission/configuration control, provider, account, API, table or migration.

The pack's internal bound-task resolver forwards only this trusted fence alongside its immutable request binding. Lock the original TaskRun before the subject in both canonical writers. Under that lock, revalidate immutable request/actor/current recorded authority and captured reservation/dispatch, current eligible execution state and absence of uncertainty/cancellation. Read a genuine exact existing receipt under the existing authority checks without writing. If no winner exists, require a valid current fence before any receipt/baseline/pin append. A writer that wins the task lock commits before a concurrent hold/fence update; a hold/displacement that wins first forces refusal. Include domain winner state in the proof snapshot; no audit-absence inference.

Unversioned native sessions fail closed for NEW task-bound canonical effects; they may obtain only a genuine qualified existing winner. Return a precise refusal without creating or retrying any TaskRun. Manual/unbound writers keep their actual existing authorization policy. New execution capture must have an end-to-end positive fixture; a metadata-only guard that prevents every valid write is not completion.

Rollback is a forward repair that disables the new admission/capture path while retaining the compatible transaction fence and readers for any admitted generation. Pre-fence binaries cannot serve unresolved new capabilities/effects. Canonical release/readiness must qualify compatible serving coverage; no mixed-version recovery admission or inferred historical settlement. This repair does not itself enable the parent recovery path.

## Phases: one atomic deliverable

### 1. Resolve scope and fail first

Normal claims currently cover writer helper/repositories, pack, shared leaf, session/transport, route, loop/context and tests plus this plan/runbook. E27 normally released mcp-task-execution.ts and this room claimed it. Its published but unmerged e86430c71462a9888481537915b060c1ffc7d174 has three engagement-only hunks: validation/reconciliation after admission, exact runtime agent/provider identity and exact tool intersection. Preserve these semantics at eventual actual integration; do not copy unrelated unmerged functionality or claim it is in main. Three required shared files await normal owner handoff: cli-adapter.ts+test (BI2ECA/WC01B) and mcp-tool-types.ts (BI3B3/WCDB3). Do not edit them until released and normally claimed. Integrate any already-merged owner changes before implementation and reconcile immutable coverage if scope/source changes.

Use dpf-tdd. Add failing behavioral tests for held/uncertain tasks, changed generations and public forged context. Exercise both actual canonical writers and genuine completed-receipt replay; retain reader/provenance/independence negatives. Add a real PostgreSQL fixture in a generated isolated schema or governed integration slot, never installed task/account rows. Pause each actual writer at lock/commit boundaries, race task hold/displacement/cancellation and verify both orderings. A skipped fixture is UNRUN, not atomicity evidence.

### 2. Implement the shared boundary

Keep the shared leaf small and pure. Reuse reservationIdentity/dispatchIdentity and existing execution-authority parser rather than duplicate JSON interpretation. Approximately one fifth of work consolidates that predicate and trusted context forwarding. Update canonical writer helpers/repositories and their call paths as one atomic change. Trace approval continuations to the saved trusted context; obtain any additional exact path claim before editing and update coverage if required. Preserve baseline/pin transactions, stable receipt IDs, existing authentic winner verification and review independence.

### 3. Verify and publish

Graph discovery was available/index ready. Run all linked tests for actual changed sources, including bound-review-effect, receipt-repository author/workroom, initiative-baseline, initiative pack/steward, session token/audience, transport auth, all13 linked agentic-loop tests, all16 adapter-types tests and all8 MCP route tests. New shared leaf has no existing graph links; cover it directly. Loop-tool-context has no linked tests; add a direct transport fixture and exercise loop/native/approval paths. Resolve graph links for the four handoff paths after normal claim; missing advice expands to exhaustive relevant verification. Record actual runner root and counts.

Run package production/test typechecks; real PostgreSQL writer-fence-pg-races; exact-tree governed integration/build where required; independent exact-source assessment/native review as current policy requires; protected DCO PR and merge queue. Scope guard obligations include prose-lint test/check and style-drift. Honor agentic-loop2593-line and route-test1525-line ratchets by extracting cohesive helpers or using dedicated new test modules. Do not increase baselines. Regenerate/check doc index, route manifest/audience/shell/purpose, diagram and capability artifacts only when their generator inputs changed; obtain exact generated-path claims before writes. CI remains authoritative.

Canonical release remains with the existing producer. Verify source containment first, then one normal task-bound valid writer and held/missing-fence refusal on the canonical served target using normal admitted fixtures. Record explicit native receipt result and no unknown/retry change. This internal transport/transaction repair has no new rendered UI; UX disposition must reflect that scope rather than invent a browser pass. Update the existing authorization runbook in this PR. Do not claim parent recovery or metrics acceptance.

## Backlog coverage

Decision: atomic. One independently shippable deliverable bound-writer-fence maps to BI-F646BC4E. Captured execution identity, signed transport, internal context, transactional writers, concurrency tests and compatibility documentation cannot ship independently without either blocking all legitimate writes or leaving a bypass. Parent design on this branch is evidence, not another implementation deliverable.

Requirement refs: AC-WF-1, AC-WF-2, AC-WF-3, AC-WF-4, AC-WF-5.
Contract ref: canonical-write-generation.
Flow ref: admitted-task-to-writer.
Verification ref: writer-fence-pg-races.
Initial immutable plan617b485bcf08b944521a7f8159184170dca0bcc0, blob6283a9e2af9dce6420497f2367a4ba80b780802a earned coverage. Latest scope reconciliation before this status update: cmvbfq7cp0xzc01o3x1bm2b89. Rebind this updated plan after publication; this paragraph is not a receipt.

## Evidence and stop conditions

Managed bootstrap qualified this worktree compile-ready. The assembled source passed1337 tests across97 suites;10 PostgreSQL race cases remain skipped, not passed. Production and test TypeScript7, prose/style checks and the module-size ratchet passed. These are source-local observations, not exact-tree integration, native independent review, historical settlement or served acceptance.

All required context paths were normally claimed after handoff. The CLI pair released only after its existing approval envelope cmvbfjrsp0vov01o3t07uczjs completed. The provider-readiness owner's bdc9160 head is local-only; remote19b9 and its unmerged quota-message delta remain distinct. Preserve actual owner changes at eventual integration. No forced claim, alternative provider or retry resulted.

Stop denied operations, unresolved scope conflicts, missing coverage or failed implementation admission. Do not treat an infrastructure result as product PASS/FAIL, broaden grants, mutate task data directly, replay755 or make another source head solely to evade an unresolved review.

## 2026-10-26 amendment: compose execution capture, signed sessions and writer effects

This amendment implements the repeatable integration-proof slice selected by WWMD decision DI-F93FF6507327 (`extend-shared-integration-proof`) under existing BI-F646BC4E and WC-A6F24B2D. Keep AC-WF-1, AC-WF-2, AC-WF-3, AC-WF-4 and AC-WF-5 above verbatim. This adds verification of the existing contract; it does not replace the separately owed native acceptance in AC-WF-4. Native acceptance remains **UNRUN**.

The original source head e3b18c4d36715f3281455bff4952fc69ed11edf5 and delivered PR #6498 squash 52fb5e227b778ebf816a8609616e2b82f101b244 have identical tree 17a136fdc9bf4dfc27e9b2f2ff83ea28ddf8953d. The squash is an ancestor of locally inspected main 7fedee279b8b5c2e0d86b68602522e0a96000c7f. Integrating that main preserves the delivered repair. Bind refreshed coverage and later evidence to the actual resulting source head; these historical identifiers do not constitute current coverage.

### Scope and admission

The exact three claimed paths are:

- `apps/web/lib/backlog/initiative-readiness/bound-review-effect.postgres.test.ts`
- `apps/web/test-support/review-execution-transport-fixture.ts`
- `docs/superpowers/plans/2026-10-16-bound-review-writer-fence.md`

Root retains the existing Workroom execution identity and publication responsibility. Publish the plan amendment through normal DCO hooks, reconcile the actual Workroom head, and obtain accepted immutable plan coverage and implementation admission before editing the two test paths. Do not regress the source head to satisfy an old receipt.

The accepted scope claim at Workroom sequence 206 returned a resolved change-impact contract. Its only test-impact entry was the new helper with `find_related_tests`. That lookup returned source-code graph available/index ready, no warnings and no linked tests. Cover the helper directly through the PostgreSQL composition suite and the existing executor/session/authentication suites below. This is an explicit coverage obligation.

The claim returned empty guard-obligation, ratchet, trailer, migration and route lists. Its new-helper module-size budget is 800 lines, with a 1000-line hard cap; keep the helper substantially smaller rather than treating either limit as a target. Its only derived artifact is the document index: check with `node scripts/gen-doc-index.mjs --check`. If regeneration changes the tracked index, obtain its exact path claim and refresh coverage before retaining that generated change; do not silently expand this three-path scope. Normal preflight, canonical verification and protected PR checks still apply.

### Test composition and fixture refactoring

Reuse `createReviewPostgresFixture` and the existing actual writer transactions, schema isolation, enum/check-constraint validation and row-lock races. Spend approximately 20% of this slice on fixture refactoring: factor the current seed setup so a composition case can start as `submitted`, let each existing writer factory receive its bound execution context, and consolidate bounded barrier/signing cleanup in the one test helper. Route the existing race and replay cases through the same captured context; preserve their assertions and separate fresh-subject state. Add only the missing positive capture/transport assertions and valid signed missing-fence case, rather than duplicating the current race matrix.

For each composition case, seed a fixture-owned immutable request/task binding, read its exact row version, and call real `reserveSubmittedTaskRunWorking`. Require its compare-and-set to succeed with explicit reservation and dispatch identities. Pass those expected identities to real `executeRemoteTaskAttempt`, which must read the actual fixture TaskRun and capture the fence before asynchronous preparation. Never construct the claimed executor capture by calling `captureTaskExecutionFence({}, requestDigest)` in the test, and never recapture after a hold or generation change.

Use the existing test seams to isolate ancillary preparation/routing, outcome-projection and message collaborators. Their fixture responses are not authority or review evidence. In particular, the executor's ancillary outcome lookup otherwise queries `ToolExecution`, which is outside the existing isolated table set; do not add production support tables or broaden this slice into outcome projection. Keep the real TaskRun CAS/read, execution capture, session signing/verification, transport authentication, writer locks and canonical receipt/baseline/pin transactions.

At the test-only autonomous-loop boundary, deep-copy the real executor parameters and pause on a release barrier without invoking a provider. Require exactly one loop invocation and configure external provider entry points to fail if called. Mint a session with real `createMcpSessionToken`, using that captured task/fence and an isolated test `AUTH_SECRET`. Authenticate an in-memory HTTPS request with real `authenticateMcpRequest`. Require successful session authentication and equality with the captured identity. Construct the writers' trusted execution context only from the returned authenticated task/fence, alongside the original immutable fixture request binding. Public tool arguments do not supply execution authority.

Race capture against early executor completion and a finite deadline so a failure before loop entry cannot hang the suite. Bound writer/lock waits using the existing fixture limits. In `finally`, release the loop, await the executor's bounded termination, clear timers and restore environment/mock state before truncation or schema teardown. A controlled test-loop termination is cleanup, never a successful reviewer result. Propagate cleanup failures rather than swallowing them.

### Composition verification cases

Cover all four cases independently, reusing the existing cases where they already supply that boundary, for both `recordInitiativeGateReceipt` at `design-spec` and `recordInitiativeSpecApproval` at `spec-approval`:

1. **Valid new effect:** a fresh subject with no winner uses the captured, authenticated execution context and commits one genuine receipt and the writer's expected baseline/pin effects. Read back the committed identities and counts.
2. **Hold before a new effect:** on a fresh subject with no winner, capture and authenticate first, then persist the hold before invoking the actual writer. Require `AUTHORIZATION_DENIED` and the specific held/uncertain/unversioned/displaced execution refusal. Assert zero receipts, baselines and pins. An unrelated setup or authorization error does not satisfy this case.
3. **Legacy session without a fence:** mint a valid signed task session omitting only the fence. Require authentication to succeed, then require the actual writer to refuse a new effect with the same execution-fence refusal and zero receipts, baselines and pins. An invalid signature or failed authentication is a different boundary.
4. **Genuine winner after hold:** first commit a real successful effect, then hold the task and replay the exact authenticated identity. Require the original receipt ID with `deduplicated: true`, unchanged effect counts and no task revival.

Retain both existing PostgreSQL lock orderings and the displacement/cancellation matrix. Any case using a captured identity continues to use that original identity after mutation. A previously committed winner must never stand in for the fresh-subject refusal case, because genuine winner readback intentionally precedes new-effect eligibility.

### Verification and publication sequence

Use only `DPF_SQL_TEST_DATABASE_URL` or the existing governed runner's `DPF_LOCAL_CI_TEST_DATABASE_URL`. Never fall back to installation `DATABASE_URL`, copy installation credentials, start a per-worktree runtime or acquire another owner's slot. A missing isolated SQL environment produces skipped/UNRUN database cases, never a composition pass.

From the admitted source worktree, run the focused suites through the existing resource runner:

```powershell
node scripts/host-resource-runner.mjs --class vitest -- pnpm --filter web exec vitest run lib/backlog/initiative-readiness/bound-review-effect.postgres.test.ts lib/backlog/initiative-readiness/bound-review-effect.test.ts lib/mcp-task-execution-fence.test.ts lib/shared/task-execution-fence.test.ts lib/mcp/session-token.test.ts lib/mcp/transport-auth.test.ts
node scripts/host-resource-runner.mjs --class typescript -- pnpm --filter web typecheck:all
node scripts/gen-doc-index.mjs --check
```

Extend the focused test list for any additional affected tests emitted by the actual impact contract or a concrete failure. Keep database-free results separate from executed PostgreSQL cases. Use the sanctioned dependency bootstrap when required; do not install dependencies manually into the topic worktree.

Freeze a clean DCO-signed source commit with truthful impact trailers. Run `pnpm run pregate` in the foreground, unpiped and as the sole command, through its normal host preflight and canonical shared lease/queue. Read `pnpm run pregate:status -- --json` and preserve its exact source/tree, execution receipt, command/test counts and limitations. Confirm that the admitted run actually executes this PostgreSQL file with its SQL environment; a gate that skips it does not discharge `writer-execution-session-composition`. Honor capacity/quiescence and bounded recovery without changing identity or manufacturing evidence.

Obtain independent assessment and the normal exact-source semantic review required by current publication policy. Preserve any native UNKNOWN/UNRUN result separately from client assessment and executed test evidence. Publish through normal hooks only when the actual predicates permit it.

Finalize the truthful PR body at `D:/DPF-temp/writer-composition-pr-body-20261026.md`, then run `pnpm pr:ready -- --pr-body-file D:/DPF-temp/writer-composition-pr-body-20261026.md --json`. Open a ready, non-draft PR from `fix/original-review-writer-fence` against `main`, attach it to this chat and follow normal protected review/checks and the merge queue. Run `pnpm pr:health <pr-number>` before claiming green and verify the merged source identity. Source delivery of these tests does not close the separately UNRUN native acceptance.

### Coverage and evidence limits

This remains one atomic test deliverable under BI-F646BC4E: the fixture refactoring and composed cases must ship together to demonstrate the existing writer-fence contract. Reuse the existing requirement refs `AC-WF-1`, `AC-WF-2`, `AC-WF-3`, `AC-WF-4`, `AC-WF-5`; contract ref `canonical-write-generation`; flow ref `admitted-task-to-writer`; and verification ref `writer-fence-pg-races`. Add explicit verification ref `writer-execution-session-composition`. Root records and checks fresh server-selected coverage against the published immutable amendment and current accepted scope. This Markdown is not a coverage receipt.

The resulting evidence proves fixture-backed generation reservation, actual executor capture, signed-session authentication helpers and both real PostgreSQL writer boundaries. The generation CAS is not full governed task-creation admission. Reviewer identity, provenance, authorization and ancillary ports remain explicitly fixture supplied. No production edits, new API, orchestration, migration, role/grant/provider/budget change, full admission proof, CLI/network route proof, provider result or live acceptance is introduced. Independent-review protections and permission intersection remain intact.

The source-test change needs no Portal deployment. Genuine native acceptance for BI-F646BC4E remains **UNRUN** until a normal admitted execution supplies the separate canonical proof; semantic capacity continuation under BI-7CCCA696 remains separate. Do not replay historical unknown tasks or infer acceptance from fixture output.

The main risks are a negative case accidentally reaching winner readback, an ancillary stub masking the claimed boundary, and an executor/barrier surviving teardown. The case separation, real-boundary assertions and bounded final cleanup address those risks. Rollback is a normal test-only source revert through protected delivery; it changes neither the deployed writer fence nor historical evidence.
