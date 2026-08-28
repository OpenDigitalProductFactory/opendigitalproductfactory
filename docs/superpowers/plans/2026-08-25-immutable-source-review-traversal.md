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
