---
title: The third state is typed — a non-verdict may never be persisted as a verdict
slug: 2026-09-15-third-state-is-typed-addendum-design
status: draft
authoredAt: 2026-09-15
backlog_item: EP-A480A6F7 (epic); phase items filed 2026-09-15 — see §9
addendum_to: 2026-06-05-unified-delivery-surfaces-execution-alignment-design.md §9
---

# The third state is typed

**Addendum §10 to [unified delivery surfaces](2026-06-05-unified-delivery-surfaces-execution-alignment-design.md).** §9 of that spec carries an operator directive: a gate refusal declares which kind of no it is, and "every gate requirement and definition — now and for those built later — carries this as an implementation mechanic." That directive was ratified as universal and implemented as local: one chokepoint, `evaluateWorkCasePolicy`, via `apps/web/lib/work-management/gate-shaping.ts`.

This addendum does not propose a new rule. It reports what implementing a universal rule in one place has cost, and specifies the mechanic that makes §9 hold everywhere it was already directed to hold.

## 1. Thesis

A delivery plane has two kinds of outcome, and DPF has a type for only one.

A **verdict** is an answer: proceed, or refuse. A **non-verdict** is the absence of one: a person has not ruled yet, an input the caller holds is missing, or the check could not determine anything. §9 named the distinction for gate denials. Everywhere else, non-verdicts are carried in prose inside a `message` or `condition` string, or flattened into `false`.

The consequence is not cosmetic. A coworker reading "rejected" about a pending approval concludes the capability is absent and acts on that conclusion — it files work to build tools that already exist, or it retries until its turn is exhausted. Both were measured on the reference install, and both are recorded in the code that fixed them.

## 2. What is true today

Every row below was verified against the working tree at `c8cc4b94`, not inferred.

### 2.1 The repair load

Of the 50 most recently updated pull requests against `main`, **28 repair the delivery machinery itself** (16 are product or domain work, 6 are Dependabot). Of those 28, **17 belong to a single defect class**: a non-verdict rendered as a verdict, or a verdict that reached the caller with its reason erased.

This is a title-level classification, spot-checked against the diffs of #5349 and #5335. The titles are unusually literal, and read in sequence they are a description of this spec's problem:

> "an approval wait is not a rejection, and says so" (#5349) · "a run that asked for approval has not failed" (#5335) · "a lapsed approval is settled, not left pending forever" (#5351) · "tell 'no ignored builds' apart from 'pnpm cannot say'" (#5324) · "the control-plane probe names the docker failure it saw" (#5330) · "a refusal names the shape that gated it" (#5327) · "say when a consult could never have recommended" (#5343) · "explain expired and unavailable recovery" (#5345) · "no work stops without a conclusion" (#5323)

### 2.2 The measured cost

Recorded in the fixing code, not estimated here:

- **183** `AgentActionProposal` rows in status `proposed` since 2026-08-26, none ever approved — including **55 copies of one `run_hive_scout_ingest`** and 50 of one `run_discovery_triage`. That is a retry loop, not seventeen days of daily runs (`apps/web/lib/tak/scheduled-task-runs.ts:53-71`).
- **425** tool failures carrying `approval_required` since 2026-08-25, led by `record_initiative_evidence` (187) and `record_initiative_design_review` (186) — which is why the readiness and evidence chain reads as broken (same source).
- Over seven days to 2026-09-02, of **~5,700 failed `ToolExecution` rows, roughly 4,900 were governed refusals** rather than faults — `gate_evidence_blocked` alone was 4,520, against ~235 genuine caller defects. **Two of the four open MCP-efficiency backlog items existed only because of this conflation** (`apps/web/lib/operate/mcp-call-efficiency/refusal-codes.ts:1-20`).
- Coworkers proposed building `record_initiative_evidence` and `get_backlog_item` because the wait read as a denied grant. `record_initiative_evidence` had **139 successful executions** at the time (`apps/web/lib/govern/authority/approval-pending-result.ts:15-22`).

### 2.3 Eight vocabularies, none shared

The three-way distinction is not missing. It has been discovered independently at least eight times, in eight mutually incompatible shapes:

| Subsystem | Shape | Third state named |
| --- | --- | --- |
| Workroom gate denial | `Record<GateDenialReason, …>` → `shape \| escalate \| hard-no` | `escalate` |
| Coworker authority | discriminated union + `Record<ReasonCode, string>` | `require-approval` |
| Host resource admission | 4-way union, closed reason literals per branch | `queued` |
| Scheduled run required tools | `executed \| proposed \| absent` | `proposed` |
| Semantic change review | `pass \| fail \| inconclusive` | `inconclusive` |
| Initiative readiness | `allowed \| input-required \| denied` | `input-required` |
| Worktree ignored-builds probe | `{ ok, indeterminate }` — a second boolean | `indeterminate` |
| MCP call-efficiency scan | `ReadonlySet<string>` allowlist of refusal codes | (membership only) |

`gate-shaping.ts`, `coworker-authority-decision.ts`, `host-resource-policy.ts`, `scheduled-task-runs.ts`, `semantic-change-review.ts`, `initiative-readiness/types.ts`, `scripts/lib/bootstrap-worktree-deps.mjs`, `operate/mcp-call-efficiency/refusal-codes.ts` respectively.

The eighth is the clearest statement of the problem written by anyone here, and it opens: *"A governed refusal is not a tool failure."* It is also the only one that is not a union at all — a `ReadonlySet<string>` whose membership is the classification, deliberately conservative so an unlisted code counts as a failure. That is correct for its purpose and structurally unable to stay current: it mixes `approval_required` (a wait) with `branch_occupied` (a refusal) under one label, and nothing tells its author when a new code appears.

Two mechanisms park the *same* event — a human has not answered — on *opposite* success flags: `AgentActionProposal` succeeds with `data.status === "proposed"`, while `CoworkerActionEnvelope` fails with `error === "approval_required"`. They are reconciled by an `||` in one function.

### 2.4 The collapse is at the boundary

The distinction is not lost where it is computed. It is lost where it is written down or handed on. Four sites, all verified:

1. **`apps/web/lib/change-review/semantic-review-background.ts:213`**
   ```ts
   const terminalStatus = outcome.receipt.result.decision === "inconclusive" ? "failed" : "completed";
   ```
   "Could not tell" is persisted as "failed". Eight lines above, the deadline path writes `status: "input-required"` with a structured reason — the file demonstrates the correct shape and then does not use it. AGENTS.md §4 states the prohibition verbatim: a gate that could not run "is recorded as inconclusive … **Never a FAIL against the diff**."
2. **`apps/web/lib/nonprod/environment-lease-pool-policy.ts:66`** — `const admitted = admission.status === "admitted"`. A four-way admission becomes a boolean plus a nullable string; `queued` and `blocked` become indistinguishable to the lease caller.
3. **`apps/web/lib/govern/authority/approval-pending-result.ts:46`** — returns `{ success: false, error: "approval_required" }`. #5349 fixed the *wording* in `message`; the shape still says failure.
4. **`apps/web/lib/explore/feature-build-types.ts:724`** — `export type PhaseGateResult = { allowed: boolean; reason?: string }`. The gate governing ideate→plan→build→review→ship cannot express "waiting on a reviewer" at all. `reason` is an untyped string assembled by prose builders.

### 2.5 The shared primitives have no third case

- `apps/web/lib/shared/action-result.ts:26` — `ActionResult<T> = { ok: true … } | { ok: false; error: string }`. Binary. Its header records that it replaced ~700 hand-inlined sites, so this binary shape is now the platform's default idiom.
- `apps/web/lib/mcp-tools.ts:342` — `ToolResult = { success: boolean; message: string; error?: string; … }`. Every governed tool returns it.

### 2.6 §8 is violated on the field that matters most

```prisma
/// A2A-aligned task states: submitted | working | input-required | auth-required | completed | failed | canceled | rejected | archived
status               String                   @default("submitted")
```
`packages/db/prisma/schema/build-delivery.prisma:1059`. A nine-member closed set, documented in a comment, typed as `String` — against AGENTS.md §8 ("closed-set string fields are typed enums, never free-form strings"). `input-required` and `auth-required` are *already in the vocabulary*; nothing stops `"failed"` being written instead, so §2.4(1) compiles.

`packages/db/prisma/schema/ai-coworker.prisma:1200` is worse: `lastStatus String? // ok | error`, and #5335 has since begun writing `"proposed"` to it. The comment is now wrong and no type noticed.

### 2.7 Shapes carry dispositions in prose

`WorkShapeStopCondition.kind` is `"success" | "failure" | "budget"` (`apps/web/lib/work-management/work-shapes.ts:66`). There is no stop kind for "parked on a person", although `escalation` is a valid *trigger* class — escalation can start standing work but cannot stop it. What the shape authors actually wrote, in the free-text `condition` field:

> "the run stops and escalates" · "stop and escalate; that is a migration, not a review" · "the room stops and the item is reshaped" · "the room stops for decomposition" · "refused; the lane is WIP 1"

Those are `escalate`, `escalate`, `shape`, `shape`, `hard-no` — §9's vocabulary exactly, written in English because the type could not hold it.

## 3. Research & benchmarking (AGENTS.md §7)

Every comparator below treats the third state as first-class. DPF is the outlier, not the innovator.

| System | Non-verdict states | What DPF should take |
| --- | --- | --- |
| **A2A task states** | `input-required`, `auth-required` alongside `completed`/`failed` | **Adopt as-is.** `build-delivery.prisma:1059` already names A2A as its vocabulary; it is documentation, not a type. Making it a Prisma enum is alignment with a standard DPF already chose, not a new invention. |
| **GitHub Checks API** | `neutral`, `action_required`, `stale` alongside `success`/`failure` | Confirms the shape at the CI boundary: `neutral` exists precisely so a check that reached no verdict does not read as a failure — §2.4(1)'s bug, solved upstream years ago. |
| **Temporal** | Closed workflow/activity execution status enum; a workflow awaiting a signal is not a failed workflow | Durable-execution precedent that the run-status field is an enum, never a string. |
| **BMAD Method** (v6.12.0, MIT) | `bmad-build-auto` halts with `status: blocked` plus a named blocking condition and its evidence; `done` carries verification and deferred findings | Independent corroboration from the nearest open-source peer: a halt is a terminal state with a reason, never a failure. Its review loop also caps at 5 non-converging iterations, matching `GATE_SHAPING_DEFAULT.maxAttempts`. Evaluated in full at [`docs/security/tool-evaluations/2026-09-15-bmad-method.md`](../../security/tool-evaluations/2026-09-15-bmad-method.md) — rejected as a dependency, adopted as the standing comparator for delivery-process specs. This is that adoption's first use. |

**What DPF rejects:** BMAD's prose-in-a-spec-file evidence contract, for the reason in that evaluation — §4 forbids weakening the evidence contract, and a `status: blocked` in Markdown is not readable by `checkPhaseGate`.

## 4. The mechanic (§10)

§9's four rules stand unchanged. Three more generalise them past the gate chokepoint.

**The canonical disposition.** One closed union, declared once, beside `action-result.ts`:

| Disposition | Meaning | Absorbs |
| --- | --- | --- |
| `proceed` | the answer is yes | `allowed`, `admitted`, `executed`, `pass`, `completed` |
| `awaiting-person` | a human must rule; no input the caller holds will help | `escalate`, `require-approval`, `proposed`, `queued`, `auth-required` |
| `awaiting-input` | the caller holds the missing input and may retry, bounded | `shape`, `input-required` |
| `inconclusive` | the check did not determine anything | `indeterminate`, `inconclusive`, `neutral` |
| `refused` | the answer is no | `hard-no`, `denied`, `blocked`, `absent`, `fail` |

Three non-verdicts, not one, because they route differently: `awaiting-person` must never be retried, `awaiting-input` must be retried within budget, and `inconclusive` must be **re-run on the same input** — AGENTS.md §4's "fail closed on safety; fail open on infrastructure".

**Rule 5 — a boundary may narrow a disposition, never collapse it.** Persisting or handing on an outcome may drop detail; it may not map a non-verdict onto a verdict. `inconclusive → "failed"` and `queued → false` are the prohibited shape. Where a downstream type is binary, the non-verdict stops there and is reported, rather than being cast.

**Rule 6 — every closed outcome vocabulary classifies through a total `Record`.** Not `Partial<Record<…>>`: the readiness code union has 27 members and every map keyed by it is partial, so adding a code compiles silently. Partial is the loophole that turns §9's compile-time guarantee back into a convention.

**Rule 7 — a run-status column is an enum.** §8 applied to the delivery plane's own fields, starting with the two that already carry their vocabulary in a comment.

## 5. Substrate to extend, not rebuild

Nothing here is new substrate. `gate-shaping.ts` is the reference implementation and does not change. The seven vocabularies in §2.3 keep their local names and gain a total mapping to the canonical disposition — a subsystem that already distinguishes correctly is conformant by declaration, not by rewrite. `2026-08-21-three-band-decision-verdict.md` (draft) makes this same argument on the decision-engine axis (`proceed | uncertain | decline`); it is the same mechanic in another plane and should be reconciled into this vocabulary rather than landed separately.

## 6. Phasing

1. **Declare the vocabulary** and make it expressible on `ToolResult`, additively. Route the approval paths through it so `awaiting-person` stops arriving as `success: false`. *(This spec's companion change.)*
2. **Close the four collapse sites** in §2.4, highest cost first: `semantic-review-background.ts:213`, then the lease pool, then `PhaseGateResult`.
3. **Enum the run-status columns** (§2.6) — a migration, forward-only, backfilling the two values #5335 already writes.
4. **Total the readiness maps** (§2.3, Rule 6) and give `WorkShapeStopCondition` a typed disposition, migrating the prose in §2.7.

## 7. Success criteria

- No outcome type in the delivery plane expresses a non-verdict only in prose.
- A coworker handed a pending approval never reports a missing capability. The counter to watch is §2.2's: duplicate proposals for one tool should fall to ~1.
- Adding an outcome reason without classifying it does not compile — in every vocabulary, not one.
- `TaskRun.status` cannot hold a value outside its declared set.

## 8. Non-goals

- Changing what any gate decides. This is about how an outcome is *said*, not what is *allowed*.
- Merging the seven vocabularies into one flat enum. They are correctly domain-specific; they need a shared mapping, not a shared name.
- Weakening any refusal. A `hard-no` stays a `hard-no`; §9 rule 4 is untouched.

## 9. Open

**Backlog coverage — filed 2026-09-15, closing this section's original gap.** This spec was authored while the DPF MCP plane was unreachable (`ConnectionRefused` on `127.0.0.1:3000/api/mcp/v1`), so `create_backlog_item` could not be called and §5 coverage was owed before phase 2 could begin. It is now filed.

Epic **`EP-A480A6F7`** — *Delivery outcomes carry their kind, not just their success* — owns this addendum. Its overlap check is recorded on the epic: no existing epic owned delivery-outcome typing across the plane (`EP-0AF96937` owns the §9 directive but is scoped to the workroom chokepoint, `EP-WORK-CONVERGENCE` to the work-graph substrate, `EP-ABB3AC9D` to latency tiering).

| Phase | Item | Title |
| --- | --- | --- |
| 2.1 | `BI-FF63D266` | An inconclusive review is not a failed review |
| 2.2 | `BI-C77D920A` | A queued lease is not a blocked lease |
| 2.3 | `BI-09D11444` | A phase gate says which kind of no it is |
| 3 | `BI-9F6AFFA0` | A run status is an enum |
| 4 | `BI-174DB909` | A readiness code cannot be added unclassified |
| 4 | `BI-77CFC7BF` | A work shape declares how it stops, not just that it stopped |
| 4 | `BI-AF9E4906` | The call-efficiency refusal set cannot go stale |
| §5 | `BI-2B96E1B9` | One verdict vocabulary across gates and decisions |

Phase 1 landed as #5364. Its sibling contract — that `approvalPendingResult`'s wording is load-bearing because the scheduled-run verdict classifier keys on `error === "approval_required"` — is `BI-4F64C5D3`, which merged as #5335 but held **no live backlog row** until it was restored on 2026-09-15; merged code was citing an id the coordination plane could not see, and `check-doc-anchor-existence.mjs` caught it only because a changed doc cited it.

`gate-shaping.ts:29` cites its spec as `2026-08-23-decision-concierge-design.md §4.7`. That section is "Guardrails" for the decision panel and says nothing about dispositions; the real owner is §9 of the unified-delivery-surfaces spec. Corrected in the companion change.
