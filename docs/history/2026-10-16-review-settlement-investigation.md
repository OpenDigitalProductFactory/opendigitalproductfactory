---
status: historical-reference
backlog: BI-7906C73E
---

# Review settlement: historical investigation and sequencing

The original extracted sections below come verbatim from commit
`39026640348a1348fb84ab65b92ebaba2d43f133`, canonical design blob
`9f2da2e540f076dd1d48d5f1532554cee8f2fecc`. They retain prior observations,
proposed P1–P4 sequencing and the evidence available at those checkpoints. Later
dated appendices identify their own upstream source and preserve subsequent
clarifications without rewriting those original snapshots.
They grant no present implementation, replay, independent approval or settlement.
Current requirements and delivery sequencing live in the
[canonical design](../superpowers/specs/2026-10-16-original-initiative-review-settlement-design.md).
This extraction keeps that review artifact within the existing 64,000-character
resume bound; it changes no active objective or acceptance statement.

## Ordered implementation plan

**Implementation parent:** BI-7906C73E; existing Workroom WC-FDAC8963 and branch
`fix/original-review-settlement`. This fix keeps its sequence in this canonical
design rather than creating a second plan document. The historical investigation
and collector/admission integration belong to this parent. The separately owned
`fix/original-review-writer-fence` contribution supplies a prerequisite writer
fence; this plan neither takes its edit claims nor declares it delivered.

The native readiness read on 2026-10-18 identifies profile `fix`, permits design,
and reports only RESEARCH_REQUIRED and PLAN_REQUIRED before implementation.
Research is author-owned reproduction and verification on a named source;
completion separately owes acceptance and objective reconciliation. This read
supersedes the earlier blanket instruction to obtain feature spec/architecture
receipts before implementing this fix. The server still selects the coverage
schema and prerequisite baseline: an absent baseline is not permission to invent
one, lower the work shape, or self-approve a design.

### P1 — Establish executable evidence adapters

Requirement references: AC-HR-1, AC-HR-2; contract reference: CONTRACT-PROOF;
flow reference: FLOW-COLLECT; verification reference: VERIFY-PROOF.

Resolve the saved request through `mcp-task-persisted-request.ts`, current actor
checks through `mcp-task-review-recovery.ts`, and original uncertainty through
`shared/execution-uncertainty.ts`. These files exist under `apps/web/lib/` on
source `46f9f42b28aff0af9bbc92c0140f1d01de516b8f`; the recovery loader and
readback issuer reject uncertainty rather than qualifying it. Preserve that
refusal until the complete qualification contract is implemented.

Use the existing owners below; implement no arbitrary JSON proof importer.
Each adapter must authenticate the producer, bind the original identity, expose
inventory completeness and finality, and distinguish unavailable from empty.

| Evidence adapter | Existing owner and locator | Historical qualification boundary |
| --- | --- | --- |
| Saved request and dispatch | TaskRun metadata/progress plus persisted-request reconstruction; TaskArtifact references use the TaskRun row identity. | Retained logical identity is available; dispatch does not authenticate a launched process. |
| Execution membership and closure | `routing/cli-adapter.ts`, `routing/cli-owned-runner.ts`, and `self-upgrade/maintenance-epoch-evidence.ts`. | A task-bound immutable launch receipt and closure are required. Signed environment retirement without original membership is insufficient. Prospective launch recording cannot backfill it. |
| Tool reservation and durable winner | `mcp-governed-execute.ts`, `tak/tool-execution-receipt.ts`, and each called domain's canonical repository. ToolExecution uses the semantic task id. | Consequential pre-effect reservations differ from post-effect best-effort audits. Enumerate actual admitted capabilities and domain results before treating an empty audit as complete. |
| Approval continuation | CoworkerActionEnvelope taskRunId, authority decision, exact argument fingerprints and associated ToolExecution/receipt. | Resolve pending, expired and executed states under current authority and the writer fence; do not cancel an unknown envelope as evidence collection. |
| Provider operation | AsyncInferenceOp identityVersion, task row relation, request/binding digests, operationId and ordered transitions. | A real operation identifier and attributable final result can qualify only that operation; an absent row does not cover an uninstrumented native CLI. |
| Authentication and other native/remote effects | The actual enabled capability inventory and the original credential/provider/effect owner's retained operation record. | Present account health and a static denylist cannot supply the original inventory or authentication result. No generic complete producer has been demonstrated for the inspected originals. |

Before an implementation claim, prepare the reproduction from the actual
original readback and the named source refusal, then identify a retained,
authenticated qualified input for every adapter. Candidate causes already
distinguished by the recorded result are approval gating (requiresApproval=false)
and writer invocation failure (no terminalWriterWait); these do not establish
execution closure. A quota result explains a provider failure but leaves child
closure unverified. No current-tree failing-to-passing collector test has run.

VERIFY-PROOF requires two different proofs: a regression that fails on the
unrepaired qualified case and passes after repair, and unchanged zero-dispatch
refusal for incomplete/foreign/truncated evidence. Exercise real owner readers
as well as injected malformed fixtures. Source fixtures establish validation
behavior, not historical settlement. If no authenticated qualified input exists,
P1 reports the missing producer and stops admission; it does not report research
or AC-HR-2 as passed on refusal tests alone.

### P2 — Consolidate qualification and integrate the writer fence

Requirement references: AC-HR-1, AC-HR-2, AC-HR-3; contract references:
CONTRACT-PROOF, CONTRACT-FENCE; flow reference: FLOW-QUALIFY;
verification reference: VERIFY-FENCE. Depends on P1 and the separately owned
writer-fence contract becoming qualified on the integration source.

Refactor repeated generation, uncertainty and current-authority predicates in
their existing shared homes before adding an admission branch. Keep at least
one fifth of implementation effort on that consolidation, measured by the
reviewed change and eliminated duplicate decisions rather than filler edits.
Reuse the writer-fence owner's authenticated generation contract at tool entry,
approval continuation, canonical receipt commit and task settlement. Resolve
actual edit claims and the returned testImpact/guardObligations first; unresolved
impact advice requires exhaustive verification. No code paths are claimed by
this documentation checkpoint.

VERIFY-FENCE covers real PostgreSQL races: callback paused after authorization,
concurrent recovery, cancellation, delayed approval and a writer committing
across reservation. One durable winner is allowed; stale generations cannot
publish. Reuse valid exact-source evidence from the fence owner where applicable,
and test this integration's additional boundaries rather than duplicating its
release or treating its tests as collector qualification.

### P3 — Admit one same-task continuation

Requirement references: AC-HR-1, AC-HR-3, AC-HR-4; contract references:
CONTRACT-FENCE, CONTRACT-RECEIPT; flow reference: FLOW-RECOVER;
verification reference: VERIFY-RECOVERY. Depends on P2.

Extend `mcp-task-review-recovery.ts` and the existing terminal-writer reservation
and background dispatch paths only after qualified proof. Under their stable
lock order, recheck the immutable request, actor, source, proof, prior generation,
deadlines and aggregate budgets. Read a genuine canonical winner first. Preserve
the original uncertainty and history while reserving one continuation; do not
remove the uncertainty field merely to make the old predicate return false.
Issue the exact supported recovery locator through existing readback and retain
the original task and request key. Unrepresentable legacy checkpoints remain
typed unsupported results with no inference or successor task.

VERIFY-RECOVERY extends the existing `mcp-task-review-recovery.test.ts` and
terminal-writer/dispatch suites with qualified positive admission, duplicate and
late arrivals, conflicting receipts, missing-writer budgets, expired deadlines,
revoked authority and changed source. Tests must count provider starts and task
creation explicitly. A passing admission test is not an independent review.

### P4 — Qualify delivery and served behavior

Requirement references: AC-HR-2, AC-HR-4, AC-HR-5; contract references:
CONTRACT-PROOF, CONTRACT-RECEIPT; flow reference: FLOW-VERIFY;
verification reference: VERIFY-SERVED. Depends on P3.

Run affected package tests/typechecks and PostgreSQL tests in a compile-ready or
governed shared environment. Apply the canonical merged-tree gate, independent
source assessment, DCO PR and protected merge. The existing release coordinator
alone advances the install. Verify deployment coverage and rollback protections
before enabling recovery. Exercise one genuinely qualified, authorized original
and one missing-proof refusal on the served source; observe the real independent
writer and native readiness. Do not launch a new reviewer merely to manufacture
an uncertain task. If no genuine positive case can qualify, retain the hold and
report AC-HR-5 as unproven.

### Backlog coverage

Proposed decision: atomic, with BI-7906C73E as the implementation parent for
P1–P4. These are internal sequencing: evidence adapters without the fenced
consumer cannot recover a task, and admission without complete adapters must
remain disabled. The independent writer-fence contribution retains its own
carrier and release evidence; it is a prerequisite, not duplicate parent work.

| Deliverable | Implementation BI | Depends on | Requirements | Contracts | Flow | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | BI-7906C73E | None | AC-HR-1, AC-HR-2 | CONTRACT-PROOF | FLOW-COLLECT | VERIFY-PROOF |
| P2 | BI-7906C73E | P1; separately owned writer fence | AC-HR-1, AC-HR-2, AC-HR-3 | CONTRACT-PROOF, CONTRACT-FENCE | FLOW-QUALIFY | VERIFY-FENCE |
| P3 | BI-7906C73E | P2 | AC-HR-1, AC-HR-3, AC-HR-4 | CONTRACT-FENCE, CONTRACT-RECEIPT | FLOW-RECOVER | VERIFY-RECOVERY |
| P4 | BI-7906C73E | P3 | AC-HR-2, AC-HR-4, AC-HR-5 | CONTRACT-PROOF, CONTRACT-RECEIPT | FLOW-VERIFY | VERIFY-SERVED |

Native coverage receipt: **not recorded**. One request on published commit
`b6980fde56afecec40156f7312d319b3dba0df8c`, blob
`27ac3cef9bfcacb9f9c90eed03b73d5f92042fb9`, returned
`traceability-incomplete`: **no initiative scope baseline exists for
BI-7906C73E**. Its supported same-room implementation-claim remedy returned
IRD-C9039B49742F and an exact independent spec-approval route. No reviewer task
was submitted. Although fix readiness directly lists research and plan, the
large coverage contract still requires that baseline; the readback does not
waive this indirect prerequisite. Resume with the server-issued route only when
reviewer execution is eligible, then submit corrected coverage against the
genuine baseline and exact current immutable source. Do not repeat the rejected
request unchanged. No Markdown table, client assessment or blocked-by
placeholder stands in for the native receipt.

### Finite unsupported boundary and resumption

The inspected original755 and D836 records retain immutable logical identity
but do not supply complete original launch membership, capability inventory or
effect closure. Those missing historical facts cannot be produced by a newer
deployment, current credentials, a new request key or prospective fence tests.
No retained authenticated qualified case has yet been demonstrated. The proof
owners listed in P1 must supply the actual original records, or the collector
must return unsupported historical provenance while preserving unknown.

Native Research PASS, plan coverage, implementation admission, collector code,
qualified recovery and the main BI-5366EF78 handoff remain separate outstanding
results. This plan makes their order and evidence concrete; it does not claim
that historical recovery or the thread's desired outcome is delivered.

## October 19 bounded source recovery: original proof inventory

The normal author research writer accepted preimplementation diagnostic research
as `initiative-2f0151e8-426c-4d6f-9ce4-0159590516a7` against immutable
`43f7c590105caa3877e690407bf6847da7642847`. This advances the author research
lane; it does not pass P1's positive proof qualification, implement recovery, or
settle the original executions. Plan coverage still lacks an independently
approved scope baseline. Its original DED689F4DDF6 review remains UNKNOWN.

AGENTS.md section 1 and the checked-in recovery-routing reference permit bounded
source repair of unavailable admission machinery under the operator's existing
repair instruction. The Workroom records the unavailable baseline/review gates
and exact source claims. DCO, tests/typechecks, independent assessment, protected
publication and canonical deployment remain required. No missing authority is
waived, no baseline is invented and no new review request is issued.

Fresh main already supplies `mcp-task-original-result.ts`: it authenticates the
original requester/coworker and exact room, verifies immutable request identity,
reads canonical writer receipts and rechecks authority. Extend that reader rather
than create a second settlement or proof-import surface.

The bounded contribution queries metadata-only inventories for TaskArtifact and
AsyncInferenceOp through the TaskRun row identity, and ToolExecution and
CoworkerActionEnvelope through the semantic task identity. Each source is capped
at eight records plus an overflow sentinel. Raw artifact parts, tool parameters
and results, approval arguments and provider output are not selected or returned.
Two reads fingerprint the selected observation fields; changed, unavailable,
overflowing or mismatched inventories withhold counts. Current read authority
is checked again before any inventory is returned.

This is a task-linked observation inventory, never a complete capture contract.
Its output always declares capture completeness false and settlement unknown,
and names the required original launch, capability, descendant, credential,
effect-reconciliation and late-writer/approval-fence producers. Zero rows and
printable completion claims cannot satisfy any of those contracts. Auxiliary
inventory failure does not erase a separately authenticated canonical receipt;
that receipt still grants no replay or effect-settlement authority.

The first regression ran on the unrepaired reader and failed specifically on
the missing structured inventory (61 other tests passed). Focused tests exercise
bounded inventories, correct relation identities, access denial/revocation,
late approvals, unavailable/overflowing sources, canonical-receipt precedence
and rejection of printable proof claims. These are source behavior tests, not
historical launch/closure proof or the positive recovery case in AC-HR-2/5.

Response-budget calibration found a real auxiliary failure: seven valid writer
observations for the same genuine receipt, with current/prior native and capacity
observations, produced a 7,961-character base result; attaching the inventory
crossed the unchanged 8,000-character cap and erased the receipt. Qualify the
complete base result first. When only the auxiliary inventory exceeds the cap,
omit it and return `proofInventoryUnavailable: "budget"` if that marker fits;
otherwise return the complete base without the marker. A valid locator three
characters longer exercises the marker-omission boundary. Base overflow still
returns the original over-budget refusal. Neither path authorizes replay.


## October 24 upstream historical plan clarification

The following clarification is retained from merged source
`966b7164fa25544c91980424fb461735b44a23f9`, design blob
`9b62245987300c98440ba0deaa1b433c622bdc49`. It applies to the historical P1–P4 plan above;
the current present reassessment contract and R1–R4 sequence remain in the
[canonical design](../superpowers/specs/2026-10-16-original-initiative-review-settlement-design.md).
The upstream plan labels the AC-HR-* references as acceptance references. Its
clarified objective/acceptance mapping follows; the original extracted snapshot
above remains verbatim and supplies no admission or completion receipt.

| Deliverable | Implementation BI | Depends on | Objectives | Acceptance | Contracts | Flow | Proof checks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | BI-7906C73E | None | OBJ-HISTORY, OBJ-RECOVER | AC-HR-1, AC-HR-2 | CONTRACT-PROOF | FLOW-COLLECT | VERIFY-PROOF |
| P2 | BI-7906C73E | P1; separately owned writer fence | OBJ-HISTORY, OBJ-RECOVER, OBJ-FENCE | AC-HR-1, AC-HR-2, AC-HR-3 | CONTRACT-PROOF, CONTRACT-FENCE | FLOW-QUALIFY | VERIFY-FENCE |
| P3 | BI-7906C73E | P2 | OBJ-HISTORY, OBJ-RECOVER, OBJ-FENCE | AC-HR-1, AC-HR-3, AC-HR-4 | CONTRACT-FENCE, CONTRACT-RECEIPT | FLOW-RECOVER | VERIFY-RECOVERY |
| P4 | BI-7906C73E | P3 | OBJ-HISTORY, OBJ-RECOVER, OBJ-FENCE | AC-HR-2, AC-HR-4, AC-HR-5 | CONTRACT-PROOF, CONTRACT-RECEIPT | FLOW-VERIFY | VERIFY-SERVED |

When recording native coverage, map the Objectives column to requirementRefs
and the Acceptance column to verificationRefs. The VERIFY-* labels name the
proof checks described in P1–P4; they are not scope-baseline acceptance IDs.

## October 23 bounded recovery: issued review admission

The live implementation claim for BI-7906C73E issued a spec-approval packet
because plan coverage lacked its objective baseline. Admission rejected that
exact packet with "This item has no pending review for the requested lane."
A merged diagnostic contribution had made delivery completion allowed; that
projection erased the prerequisite the admission selector used. No task was
created by the refused request.

Keep delivery completion unchanged. Resolve the missing planning prerequisite
from the complete own and inherited baseline history, and pass that compact
observation to the existing independent-review selector for both bounded reads
and request admission. Only input-required implementation with missing plan
coverage qualifies. An unavailable design observation or any retained baseline
history suppresses the new route. Read failures remain failures. Explicit null
means no observed prerequisite; legacy callers without the field retain their
existing behavior.

The claim-to-admission regression reproduces the native rejection before the
repair. Verification covers the exact bounded packet, retained/inherited and
malformed history, changed authority, and unresolved original reviews. The
change introduces no writer, settlement proof, replay permission or exemption
from independent review. Historical DED689F4DDF6 remains UNKNOWN; native baseline
and plan review are unrun. This bounded DEV admission repair follows the existing
recovery procedure with independent source assessment, normal tests, DCO,
local gate and protected publication. It does not deliver the full historical
recovery specification or BI-5366EF78's receiver acknowledgement.

**October 24 spec-review finding and clarification.** The original current-source
review task ending 1427D0CD59CA completed through supported same-task recovery.
Its independent spec-approval receipt
initiative-review-v1-2a7b54f0e844b5295d85c7a3004b2ebf2198cf504be7a3cdb21caaf5dde392fd
recorded FAIL at 2026-10-24T17:40:13.478Z for source
4514841246f099c7f3d241326e313577e4bc1027, blob
1b9692e589595594e0325d9bf4c7a2ff62693223, with finding IF-F99ADDF4DF95A0DD.
The finding cites the absent baseline and coverage and this design's explicit
limits on implementation and recovery claims.

This amendment makes the spec gate's input, output and order explicit and
separates native objective/acceptance identifiers from proof-check labels. The
OBJ-* and AC-* statements and the required historical proof are unchanged.
The FAIL and finding remain actual evidence on the reviewed artifact; the author
does not mark them resolved. Independent review of this amended immutable source
must judge the clarification and any substantive design or feasibility concerns.
No prior task, receipt, attempt budget or execution uncertainty is replaced, and
successful admission or continuation does not supply design acceptance.
