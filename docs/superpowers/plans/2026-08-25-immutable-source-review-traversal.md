---
status: active
---

# Immutable Source Review Traversal Implementation Plan

**Backlog item:** BI-SIG-463E478D  
**Workroom:** WC-C4836AC0  
**Design:** `docs/superpowers/specs/2026-08-25-immutable-source-review-traversal-design.md`  
**Decision:** DI-5B59E245E250

## Backlog coverage

- Decision: atomic
- Parent: `BI-SIG-463E478D`
- Receipt: `cmt9cs00e01fu01qvllposf59`
- Rationale: Bounded immutable traversal and terminal writer reservation form one deployable contract; shipping either half alone leaves the reviewer unable to finish safely.
- Dependencies: `BI-FFBDDD96` consumes the repair; downstream WordPress work remains isolated in `BI-A45D744A`.

The receipt is the immutable Workroom evidence for the attempted canonical `record_plan_backlog_coverage` call. That call failed `gate-not-authorized` because this bootstrap repair enables the research receipt required by its own plan gate. It is not represented as a coverage approval; implementation proceeds under the operator-authorized bootstrap exception while retaining TDD, semantic review, preflight, exact-tree CI, GitHub CI, and protected merge.

## Delivery shape

One atomic fix: pageable immutable evidence tools plus the server-owned transition that reserves a terminal writer call. Splitting the tool contract from the transition would leave either an unreadable artifact or a reviewer that can still exhaust its reads, so both parts ship and roll back together.

## Phase 1 — Prove the tool contract red

1. Extend `apps/web/lib/mcp/packs/version-history-pack.test.ts` with failing cases for:
   - a bounded first page with concise `message` and a single content copy;
   - cursor continuation, including a line longer than the character ceiling;
   - malformed and cross-artifact cursor replay refusal;
   - `startLine` jumps and terminal-page metadata;
   - search `offset`, `hasMore`, and `nextOffset`;
   - exact blob-id success and mismatch refusal.
2. Add focused git-helper coverage in `apps/web/lib/build/git-utils.test.ts` if blob resolution requires a new exported helper.
3. Run only the affected tests and capture the expected failures before implementation.

## Phase 2 — Implement bounded immutable traversal

1. Add the smallest git helper needed to resolve `version:path` to its blob id, reusing current ref/path validation and Node execution.
2. Add pure page/cursor parsing and slicing helpers next to the version-history pack.
3. Extend the public read/search schemas and handlers with bounded inputs and explicit continuation metadata.
4. Keep source/search bytes only in structured `data`; make `message` a concise summary.
5. Run the Phase 1 tests to green, then refactor duplicated bound parsing.

## Phase 3 — Prove the terminal-writer policy red

1. Create `apps/web/lib/tak/terminal-tool-policy.test.ts` first.
2. Cover:
   - writer blocked before successful evidence;
   - successful read opens the writer;
   - six reader attempts close readers and retain only the writer;
   - excess calls in the same tool-call batch are refused without execution;
   - one text-only nudge followed by fail-closed completion;
   - any governed writer attempt satisfies the terminal transition without declaring the receipt valid.
3. Extend `mcp-task-submit.test.ts` with failing assertions for exact blob-bound pageable schemas and policy derivation.
4. Extend `autonomous-work-run.test.ts` with a failing forwarding assertion.
5. Add the smallest agent-loop integration case to the focused `terminal-tool-policy.test.ts` module; reproduce the local review spin and expect a writer attempt instead of the generic diagnostic without expanding the baselined agent-loop test module.

## Phase 4 — Implement and refactor the execution policy

1. Implement the pure transition module in `apps/web/lib/tak/terminal-tool-policy.ts` with typed dispositions that map into the existing loop result contract.
2. Derive the policy only from a validated `initiativeReviewBinding` in `mcp-task-submit.ts`.
3. Forward it through `autonomous-work-run.ts`.
4. Integrate it at the existing agent-loop seams:
   - before provider dispatch, select the current provider tool surface and append an ephemeral policy notice;
   - before governed execution, refuse out-of-order or over-budget calls;
   - before accepting text-only completion, nudge once or fail closed while the writer is pending.
5. Extract/condense existing local-spin guard code as needed so `agentic-loop.ts` does not grow past its ratcheted line baseline.
6. Run the Phase 3 tests to green and then the full affected unit set.

## Phase 5 — Functional and architectural verification

1. Create a long immutable fixture whose required finding is beyond the first model-facing page.
2. Prove the bound reviewer reaches that page and emits the writer tool call with the exact server-issued artifact identity.
3. Prove incomplete traversal or a missing writer fails closed and persists no receipt.
4. Run an advisory architecture pass against the design and fold concrete findings back into both documents.
5. Run blast-radius discovery for every changed contract and expand tests for any unrepresented caller.
6. Regenerate the doc index and capability-completeness artifacts required by the Workroom change-impact contract.

## Phase 6 — Ship

1. Commit a stable DCO-signed tree and obtain independent semantic review of that exact commit.
2. Run `pnpm run pregate:preflight`.
3. Run the governed exact-tree local integration gate and record its evidence on WC-C4836AC0.
4. Push the branch, open a non-draft PR with BI/Workroom/decision anchors and the design-grounding section, and arm protected merge.
5. Monitor `pnpm pr:health` and review bot findings through protected merge.
6. Notify task `019fe344-e9d3-7a13-8268-d4639f5e6f86` at protected merge/deploy so it can run one fresh BI-FFBDDD96 reviewer. Do not replay or alter its Workroom.
7. After the official Docker release is live and the readiness owner confirms the dependency receipt, resume BI-A45D744A in its separate WordPress Workroom and branch.

## Verification commands

```powershell
pnpm --filter web exec vitest run lib/mcp/packs/version-history-pack.test.ts lib/build/git-utils.test.ts lib/tak/terminal-tool-policy.test.ts lib/mcp-task-submit.test.ts lib/tak/autonomous-work-run.test.ts lib/tak/agentic-loop.test.ts lib/skills/skill-telemetry.test.ts lib/tak/hard-completion-claim.test.ts app/api/mcp/v1/route.test.ts
pnpm --filter web typecheck
pnpm run pregate:preflight
pnpm run pregate
```

The final two commands remain governed gates. Their exact accepted invocation and evidence ids are recorded on the Workroom; no manual Docker or live-runtime mutation is part of this branch.

## Phase 7 — Repair live open-PR source availability and audit identity

This phase was added after the first live deployment produced exact normalized execution arguments but could not resolve the bound PR commit from the stale live git volume.

1. Capture the live failure as RED: the same TaskRun must show exact normalized execution arguments, missing local commit `9295d1ad4f750c1c2b8c4dc65b8d37330c79bbe8`, no successful reader execution, no writer receipt, and `{}` persisted audit parameters.
2. Extend repository-artifact tests first for an exact canonical provider blob read, blob mismatch refusal, and the 1 MiB ceiling.
3. Extend version-history tests first for local-miss/provider-success and incomplete-identity/no-fallback behavior.
4. Bind `repositoryFullName` from the server-issued artifact alongside path, commit, and blob id; reject provider conflicts in the terminal policy.
5. Reuse the authenticated repository provider fetcher after local git failure. Validate canonical repository, immutable identities, provider blob id, UTF-8, and size before paging.
6. Add a generic metrics-only audit opt-in and test that it retains schema-redacted normalized parameters while suppressing result content. Enable it only for `read_source_at_version`.
7. Run the expanded focused suite, original BI-SIG regression suite, typecheck, generated-artifact guards, preflight, exact-tree CI, semantic review, and protected delivery.
8. After deployment, issue exactly one materially new BI-42 review. Accept completion only from a successful persisted reader execution with exact server-bound parameters plus the independently selected governed writer receipt.

## Phase 8 — Preserve a missing terminal writer as resumable work

This phase was added after the repaired live reader completed five exact immutable pages but the provider returned prose twice without calling `record_initiative_evidence`; the TaskRun incorrectly persisted `completed` with no proposal, execution, or receipt.

1. Use TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-992A316B45A0` as the red evidence identity: five successful bound reads, zero writer calls, zero proposals, and no receipt.
2. Change the terminal text policy's second prose exit to a typed `missing-terminal-writer` input-required disposition. Do not synthesize a judgment or treat prose as a writer attempt.
3. Persist a versioned `terminalWriterWait` projection on the same TaskRun, clear `completedAt`, and keep approval requirements distinct from the system wait.
4. Permit one identical request replay to reserve the exact waiting TaskRun through `status + updatedAt` compare-and-set and rerun with the same thread, token authority, request digest, tool grants, and immutable artifact binding.
5. If that bounded continuation also omits the writer, retain `input-required` and refuse a third execution attempt. A real writer proposal still follows the existing separately approved envelope path.
6. Prove the focused policy/loop/submission tests, impacted loop tests, typecheck, size/source guards, exact-tree CI, protected PR, canonical release, and live same-TaskRun behavior before issuing a fresh BI-42 review identity.

## Phase 9 — Make writer-only dispatch a hard provider contract

This phase is the BI-DE58CFE8 successor owned by WC-14EA9122 after live attempt five hydrated the exact BI-F48 artifact but returned prose with zero writer executions.

1. Preserve TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-95A624D36842` and its unchanged request key as the red fixture; do not replay it before deployment.
2. Add a caller-owned required tool-choice option to routed inference and apply it after recipe/harness plan resolution.
3. Set the option only when the initiative-review surface contains exactly its governed writer, including the post-evidence nudge and same-TaskRun writer resume.
4. Compile required choice for OpenAI-compatible/Qwen, Gemini, Anthropic, ChatGPT, and Responses requests; fail closed before dispatch for adapters that cannot honor it.
5. Preserve the required policy unchanged across fallback plans. Keep `requireTools`, exact grants, immutable binding, model-selected writer arguments, and separate approval unchanged.
6. If a provider violates the hard contract, persist explicit required-call noncompliance on the same resumable TaskRun. Never synthesize a decision, envelope, execution, or receipt.
7. Prove focused red/green tests, ordinary-turn non-regression, typecheck, size/source guards, exact-tree CI, protected PR, canonical release, and exact live CAN-TEST.
8. Only after that live proof, replay the preserved BI-F48 key once and accept only a genuine grounded writer proposal or the explicit fail-closed noncompliance projection.

## Phase 10 — Keep cross-attempt reader history recoverable

This phase is the BI-DE58CFE8 successor on Workroom `WC-14EA9122`, branch `fix/terminal-writer-reader-history-budget`. It follows the single post-`3370a769` replay that remained on the same BI-F48 TaskRun but failed `terminal_writer_context_reader_count_invalid` with seven successful exact-bound reader rows and no writer, envelope, or receipt.

1. Preserve the seven live reader execution ids as the RED fixture and do not replay the TaskRun again before a material deployment.
2. Separate TaskRun-lifetime authority history from the existing per-attempt reader ceiling. Validate every historical row for exact tool/binding, unique id, durable order, and persisted result identity before classifying success as evidence.
3. Treat content-free results only as authority proof. Partition contentful results at exact line-one request boundaries and enforce the reader-call, page, character, cursor, line-contiguity, and stable-total limits independently on each attempt.
4. Reuse the latest complete coherent successful attempt only when all complete successful attempts agree on source content. Failed rows contribute no content or authority, while unauthorized, stale, conflicting, malformed, duplicated, out-of-order, gapped, overlapping, cursor-repeating, or per-attempt-over-budget evidence still fails closed.
5. If no complete contentful attempt exists, deterministically reread only the server-bound artifact from line one under the existing bounded budget. Never mix partial persisted content with reread content.
6. Prove the exact seven-row fixture RED then GREEN, longer coherent-history reuse, conflicting-attempt refusal, per-attempt ceiling, existing negative fixtures, adjacent submission/resume tests, typecheck, source guards, preflight, exact-tree CI, protected PR, canonical single-flight release, governed upgrade, and exact live CAN-TEST.
7. Only after live proof, obtain a new narrow authority for one identical-key replay of the preserved BI-F48 TaskRun. Accept only a genuine grounded writer proposal/envelope and separately approved writer receipt.

## Phase 11 — Isolate failed reader attempts from complete successful evidence

This phase extends BI-DE58CFE8 on Workroom `WC-14EA9122` after preserved BI-F48 TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-0B380E66396F` failed `terminal_writer_context_reader_failed`. Its exact live history contains five successful exact-bound content pages at start lines 1, 58, 97, 148, and 165 plus one intervening failed exact-bound subset request at start line 28. The complete successful sequence must remain usable without treating the failed row as evidence.

1. Preserve the six execution rows, request digest, immutable binding, Workroom identity, and zero-writer/zero-receipt state as the RED fixture. Do not replay the live TaskRun before a protected deployment.
2. Add the exact chronological fixture first and prove that the current validator rejects it. Add negative fixtures for failed-only history, failed rows with conflicting binding, unauthorized failed tools, invalid non-empty persisted results, duplicate ids, and reversed durable order.
3. Validate tool authority, execution identity/order, immutable parameters, and any persisted result identity for every row before evidence selection. Retain every failed row as audit history, but exclude it from successful reader ids, content coverage, attempt boundaries, and reader-call budgets.
4. Build attempts only from successful exact-bound rows. Reuse one complete internally coherent attempt; never splice pages across attempts. Preserve disagreement, pagination, content, truncation, call-count, and size checks unchanged.
5. If successful persisted rows do not independently form a complete attempt, use only the existing bounded deterministic server reread of the exact bound artifact. Require at least one successful exact-bound historical read before hydration authority exists; failed-only evidence remains fail closed.
6. Refactor the validator under green so authority validation and successful-evidence selection are explicit without adding a parallel recovery model. Keep TaskRun/digest/grants/provider floors/writer idempotency and approval behavior unchanged.
7. Run the focused terminal-writer-context suite, adjacent submission/approval-recovery/agent-loop suites, web typecheck, source and generated-artifact guards, pregate preflight, governed exact-tree CI, and independent semantic review. Preserve any infrastructure-inconclusive gate as such.
8. Deliver one DCO-signed protected PR, one canonical release, and one governed live upgrade. Require exact served SHA and CAN-TEST before obtaining fresh authority for one same-identity replay of TaskRun `...0B380E66396F`; accept only a genuine writer/baseline or an exact fail-closed refusal.

## Phase 12 — Preserve a guarded CLI route for a sole terminal writer

This phase extends BI-DE58CFE8 on Workroom `WC-14EA9122` after WordPress completion TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-8139EEF334F5` reached attempt five with zero executions. Codex CLI was rejected before inference because it lacks provider-native required-tool choice; Gemini and local were simultaneously unavailable. No objective mapping or completion receipt exists.

1. Preserve the TaskRun, key, digest, immutable WordPress artifact binding, and zero-writer state as the live RED identity. Do not create a sibling reviewer or synthesize objective mappings.
2. Add RED tests proving a resumed writer-only turn carries both `toolChoice: required` and the exact bound terminal writer name into route resolution.
3. Bind that name into the resolved plan after recipe/harness selection and preserve it across existing fallback plan construction.
4. At the adapter boundary, permit a CLI attempt only for a governed MCP session with exactly one attached function whose name exactly matches the bound terminal writer. Keep ordinary required-tool CLI requests, missing sessions, mismatches, and multi-tool surfaces fail closed.
5. Preserve the outer terminal policy as the sole completion boundary: prose or an absent writer remains `input-required/missing-terminal-writer`; only an actual governed writer execution may advance to approval or receipt.
6. Run focused terminal-policy, plan-override, and provider-dispatch tests; the linked inference/agent-loop blast radius; web typecheck; source/module/docs guards; pregate preflight; exact-tree CI; and semantic review. Record infrastructure failures as non-PASS and keep protected CI mandatory.
7. Deliver one DCO-signed protected PR, one canonical release, and one governed live upgrade. Require exact served SHA and CAN-TEST.
8. Resume only the preserved WordPress TaskRun on a server-authorized identical-key path. Accept only genuine immutable reads plus governed `record_initiative_evidence` execution and objective-mapping receipt, then close BI-A45D744A and WC-04941646 through their normal server gates.

## Phase 13 — Bootstrap a resumable TaskRun that has no reader rows

This phase extends BI-DE58CFE8 on Workroom `WC-14EA9122` after Portfolio Advisor TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-634F7FF63BF8` persisted an explicit missing-terminal-writer wait before any reader or writer tool execution. WWMD decision `DI-6A51BE456F49` keeps the exact TaskRun and request digest authoritative.

1. Preserve the exact zero-reader TaskRun, request key, digest, immutable artifact binding, and zero-writer/zero-envelope/zero-receipt state as the RED fixture. Do not mint a sibling identity.
2. Add RED submission tests proving an identical replay currently cannot reserve an explicit wait with zero readers, while a completed route exit with no persisted evidence remains closed.
3. Permit zero-reader reservation only for an explicit `input-required` terminal-writer wait. Retain the existing digest, writer-success, proposal-envelope, and compare-and-set protections.
4. After reservation, execute exactly one bounded line-one `read_source_at_version` call using only the server-bound repository/path/commit/blob identity. Do not synthesize or directly trust its returned content.
5. Re-query persisted reader ToolExecutions for the same TaskRun and pass only those durable rows into the existing hydration validator. Refactor the shared reader query so reservation and post-bootstrap hydration cannot drift.
6. On failed tool execution, missing persistence, invalid binding, malformed result, or incomplete hydration, restore the same TaskRun to a typed resumable context failure and do not invoke writer-only inference.
7. Prove the exact zero-row RED then GREEN, bootstrap failure, completed-no-evidence non-regression, existing persisted-reader recovery, adjacent submission/approval/capacity/tool-grant suites, web typecheck, style/docs/source guards, preflight, exact-tree CI, and semantic review. Record infrastructure-inconclusive gates as non-PASS.
8. Deliver one DCO-signed protected PR, one canonical release, and one governed live upgrade. Require exact served SHA and CAN-TEST before one identical-key replay of `...634F7FF63BF8`.
9. Accept only a genuine persisted immutable reader, governed writer execution, exact current approval envelope, receipt, and server baseline/mapping. Apply WWMD approval decision `DI-85F8C9528BE4` only when the envelope is exact, current, and immutable; otherwise fail closed.

### Phase 13 atomic coverage

The governed coverage writer cannot issue a receipt while the condition `no initiative scope baseline exists for BI-DE58CFE8` remains true. Until that prerequisite is repaired independently, this table is the canonical in-plan traceability record; it does not infer a baseline or receipt.

| Deliverable | Requirement refs | Flow refs | Contract refs | Verification refs | Atomicity |
| --- | --- | --- | --- | --- | --- |
| Zero-reader same-TaskRun terminal-writer recovery | Phase 13.1, 13.3, 13.6, 13.9 | Phase 13.4, 13.5 | Phase 13.3, 13.6, 13.9 | Phase 13.2, 13.7, 13.8 | Reservation, the governed bootstrap read, persisted-row requery, hydration validation, and typed resumable failure form one fail-closed unit. Shipping any subset would either leave the preserved TaskRun unrecoverable or weaken evidence authority. |

## Phase 14 — Supersede an expired unapproved writer proposal

This phase extends BI-DE58CFE8 on Workroom `WC-14EA9122` for the exact PR #4891 design-review TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-57CC78DB3778`. Its proposal envelope expired in `proposed`, leaving the same immutable review unable to obtain fresh approval or a genuine baseline.

1. Preserve the TaskRun, request digest, writer proposal ToolExecution `cmthhuxly00a501qmsogavxv5`, expired envelope `cmthhuxlm00a201qmftzezz1k`, exact approval binding, and zero-receipt state as the RED fixture. Never approve the expired envelope or mint a sibling review.
2. Add the failing transaction test proving the recovery query cannot see an expired `proposed` envelope. Add the paired refusal for an unexpired proposal.
3. Extend the existing approval-recovery transaction, not terminal inference, to accept `proposed` only after expiry and only when TaskRun/digest/user/agent/writer/binding/proposal all match exactly.
4. Compare-and-set the source envelope to `cancelled`, copy the stored envelope binding and proposal arguments into exactly one fresh proposal/envelope pair, and park the same TaskRun `input-required`. Roll back on any race.
5. Preserve inference, the independent decision, grants, approval separation, writer validation, receipt semantics, and all historical rows unchanged. Refuse completed writers/receipts, conflicting or ambiguous bindings/proposals, and unexpired envelopes.
6. Prove the exact RED then GREEN, unexpired refusal, existing approved/failed recovery cases, adjacent submission/terminal-writer tests, web typecheck, source/docs/style/preflight guards, and protected GitHub checks. Record any local or semantic infrastructure failure as non-PASS.
7. Deliver one DCO-signed protected PR, one canonical release, and one governed live upgrade. Require exact served SHA and CAN-TEST before replaying `...57CC78DB3778` once.
8. Accept only the fresh exact envelope, separately approved same-TaskRun writer execution, and genuine baseline. Then record atomic coverage and finish PR #4891 through its normal protected queue.

### Phase 14 atomic coverage

The existing BI-DE bootstrap has no initiative scope baseline, so this table remains traceability evidence rather than a fabricated coverage receipt.

| Deliverable | Requirement refs | Flow refs | Contract refs | Verification refs | Atomicity |
| --- | --- | --- | --- | --- | --- |
| Expired proposed-envelope same-TaskRun recovery | Phase 14.1, 14.3, 14.5, 14.8 | Phase 14.3, 14.4 | Phase 14.3, 14.4, 14.5 | Phase 14.2, 14.6, 14.7 | Source-envelope cancellation, exact proposal rebinding, TaskRun parking, fresh approval, and writer receipt form one audit chain. Partial delivery would either reuse expired authority or rerun the independent review. |

## Phase 15 — Enforce the terminal writer at the remote-task completion boundary

This phase extends BI-DE58CFE8 after BI-FFBDDD96 research TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-7991D9CAE467` completed at the review duration ceiling with one malformed read attempt, one successful exact-bound read, and no required writer, envelope, or receipt.

1. Preserve the TaskRun, request key/digest, exact artifact binding, successful reader execution `cmti6qhl303tm01o0upfpg15y`, zero-writer state, and incorrect completed projection as RED evidence. Do not replay or mint a sibling before deployment.
2. Add a remote submission RED that returns a normal agent-loop result containing the failed-then-successful reader history but no writer failure marker. Prove current code persists `completed`.
3. Make the remote-task executor independently require the exact bound writer in governed executions or the active bound proposal before allowing completion.
4. Reuse the existing `terminalWriterWait` state, retry limit, escalation, request identity, and approval handling. Do not create a parallel recovery state or infer a writer failure from unrelated tasks.
5. Fail closed as `input-required/missing-terminal-writer` for every incomplete agent-loop exit, including duration and iteration exhaustion, while preserving successful writer/proposal behavior and non-review completion.
6. Prove the exact RED then GREEN, all MCP-task and terminal-policy suites, web typecheck, style/diff/preflight guards, DCO, and every protected PR/merge-group check. Record broken local infrastructure as explicit non-PASS only.
7. Deliver one protected merge, one canonical release, and one governed live upgrade. Require exact served SHA and CAN-TEST before any same-TaskRun recovery.
8. Recover BI-FFBDDD96 through genuine persisted research and objective-mapping writers only; then reconcile its already-protected delivery and live acceptance evidence without fabricating a baseline, receipt, or objective result.

### Phase 15 atomic coverage

| Deliverable | Requirement refs | Flow refs | Contract refs | Verification refs | Atomicity |
| --- | --- | --- | --- | --- | --- |
| Executor-owned terminal-writer completion invariant | Phase 15.1, 15.3, 15.4, 15.8 | Phase 15.3, 15.5 | Phase 15.3, 15.4, 15.5 | Phase 15.2, 15.6, 15.7 | Agent-loop policy and executor postcondition ship together so no loop exit can falsely complete a governed review while ordinary tasks and genuine writer proposals retain their existing semantics. |
