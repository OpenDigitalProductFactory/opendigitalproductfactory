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
