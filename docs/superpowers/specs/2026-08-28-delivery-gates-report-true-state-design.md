---
status: active
title: Delivery gates report true state — recorded evidence, profile-specific requirements, host-side conformance assertions, and Workroom binding
---

# Delivery Gates Report True State

- **Date:** 2026-08-28
- **Scope:** platform — initiative readiness projection, backlog completion evidence, pregate preflight, Workroom branch identity
- **Backlog items:** `BI-28E8CB88` (keystone), `BI-3AE38A1F`, `BI-7B249AFE`, `BI-D526F72C`
- **Status:** Design — implemented in this branch.

> Four defects, one shape: **a gate or a tool reports a state that is not true.**
> Two under-report — they say clean or undelivered when they are not. One over-reports —
> it demands an artifact shaped for work the branch did not do. One lies about identity.

---

## 1. What is true today

Every row was verified against `origin/main` at `fa060999b4` and against the live install, not inferred.

| # | Finding | Evidence |
| --- | --- | --- |
| 1 | **Readiness reads gate receipts only.** `latestGateStates` filters `activity.kind === "initiative_gate_receipt"`. `record_execution_evidence` writes `BacklogItemActivity` of kind `evidence`. The writer works; it writes where the reader never looks. | `entry-adapter.ts` `latestGateStates`, `research: state(evidence, "research")` |
| 2 | **Nothing says so, in either direction.** The author gets a success result and a visible timeline entry. The gate then reports `missing` — not "recorded in a form that does not count". | measured: 38 items hold `evidence`, 4 hold `initiative_gate_receipt`, 35 hold evidence and no receipt |
| 3 | **A sub-policy's precise reasons are collapsed before the caller sees them.** `completion-evidence-policy.ts` computes typed blockers (`missing-dimension`, `stale-evidence`, `foreign-evidence`) and a `nextAction`. `deliveryState()` flattens all of them into `"missing"`. | `backlog-terminal-transition.ts` `deliveryState` |
| 4 | **The result of that collapse is self-contradictory output.** On `BI-3727106F` — merged as `708961196e`, 37 checks green — `update_backlog_item_status` answered `DELIVERY_EVIDENCE_REQUIRED  state: missing  evidenceRefs: ["cmtb1e3it09mb01o0k78v8o7k"]`. It listed the evidence and still said missing. | BI-28E8CB88 recurrence note, 2026-08-27 |
| 5 | **One undifferentiated `RESEARCH_REQUIRED` applies to every non-doc profile.** Nothing states what satisfies it for a `fix` versus a `feature`. | `evaluate.ts` `planRequirements` |
| 6 | **The research receipt has one writer and one grant.** `record_initiative_evidence` carries the `research` lane with `independent: false`, gated on `initiative_evidence_write`. Exactly one agent holds it. | `initiative-readiness-tool-grants.ts`; `AgentToolGrant` — `initiative_evidence_write` → `AGT-WS-PORTFOLIO` only |
| 7 | **The preflight strips every `node --test` from the guard profiles.** `stripSelfTests` removes them on the theory that they prove the guard and CI runs them anyway. | `pregate-preflight.mjs` `stripSelfTests`; `ci-policy-guards.mjs` `isPolicyGuardSelfTest` |
| 8 | **15 of those 114 files are conformance assertions over live repository state,** not unit tests. Stripping one removes the only check on the tree being pushed. | detector output, §4.1 |
| 9 | **`adopt_worktree` never declared `backlogItemId`.** It read the binding only from `outcomeAnchor`, so the argument every caller reaches for was dropped while the call answered `success: true`. | `work-capsules-pack.ts` `adopt_worktree` schema; `mcp-handlers.ts` `backlogItemIdFromOutcomeAnchor(params)` |
| 10 | **The resulting orphan capsule was unclaimable and unreleasable at once.** `planAbandonedCapsuleResume` requires `existing.backlogItemId !== null` and equal to the incoming one, so an orphan can never be resumed; `readBranchIdentityCapsule` still returns it, so the branch stays occupied. | `work-capsule-branch-identity.ts`; live reproduction `WC-8DB317F7` |

### 1.1 Why these belong in one change

They are not four unrelated bugs. Each one is a **report that does not match reality**, and three of them
compound: an author records evidence (1), is told `missing` with no reason (3), is refused for a requirement
whose meaning is unstated (5), through a door they cannot open (6). The result is the state
`BI-5CBDC146` and `BI-B986A18B` are in — merged, green, deployed, and stuck `in-progress`.

Fixing them separately means four trips through a CI gauntlet that costs more than the fixes.

---

## 2. Research & benchmarking

This is repair of an existing contract rather than new capability, so the comparison is narrow and
concerns the one genuinely open design choice: **what a gate should do when evidence exists in a form it
cannot read.**

- **GitHub required status checks / branch protection.** A check that never reported is `pending`, never
  `failing`, and the UI names the check that has not reported. The distinction between "no answer" and
  "a bad answer" is preserved and surfaced. **Adopted:** `evidenceLane` separates `none` from
  `recorded-unread`; the verdict arithmetic is unchanged.
- **Sigstore / in-toto attestation.** Only a signed attestation from an authorised issuer satisfies a
  policy; an unsigned artifact carrying the same claim never counts, and the verifier reports *which*
  attestation is absent rather than "unverified". **Adopted:** receipts stay the only currency, and the
  refusal names the writer. **Rejected:** widening the reader to accept the unsigned lane — on a
  single-human-principal install that turns the reviewer lane into self-approval, which is the one
  property the separation of duties exists to hold.
- **OPA / Rego decision logs.** A deny carries the rule that denied and the input that failed it, not a
  boolean. **Adopted:** the completion policy's typed blockers now travel to the caller instead of being
  collapsed to one word.

The rejected option is the important one. BI-28E8CB88 offered it first — "have the readiness projector
also consider qualifying `evidence` activities" — and it is the cheapest fix and the wrong one.

---

## 3. Decision

**Keep receipts as the only currency. Make everything else true.**

Nothing here changes a verdict. No requirement is relaxed, no state becomes `pass` that was not `pass`
before, and no path becomes fail-open. What changes is what the system *says* about the state it is in.

---

## 4. What was built

### 4.1 `BI-7B249AFE` — conformance assertions run host-side

`conformanceTest(...)` marks a guard command as an assertion over repository state.
`isPolicyGuardSelfTest` returns false for a marked command, which fixes both the pregate preflight and
`pr-readiness/core.mjs` through the one predicate they share.

The class is closed rather than hand-picked. `scripts/lib/guard-conformance-detect.mjs` recognises the
shape statically: a binding derived from `import.meta.url`, and a filesystem read whose own argument list
names that binding. `scripts/check-guard-conformance-marks.mjs` fails when a detected file is unmarked.

Two refinements were needed to make the detector honest, both from false positives observed in the audit:

- `process.cwd()` is not a repo-root signal. It is also how an embedded fixture script — written into a
  template literal and executed inside an `mkdtemp` sandbox — names its own temporary root.
- A bare `spawnSync(SCRIPT, ...)` is not a conformance read. Spawning the script under test is what a unit
  test does, and it almost always points the child at a fixture directory. A spawn counts only when
  `cwd:` is the repo root.

**Audit result: 15 of 114 test files, measured at ~11s against a ~95s preflight.** The four most expensive
false positives the sharpened detector removed (`sandbox-freshness-preflight`, `pre-push-dco-check`,
`build-docs-staleness`, `check-doc-reference-integrity`) accounted for 22s of the 33s the naive detector
would have added.

### 4.2 `BI-D526F72C` — the Workroom binds what it was given

`adopt_worktree` declares `backlogItemId`, resolves it against the live `BacklogItem`, and refuses
`unknown_backlog_item` rather than persisting a partially-populated capsule. The binding is **read back
from the stored capsule** — the original defect was invisible precisely because the tool reported the
request rather than the result.

`planAbandonedCapsuleResume` becomes `planTerminalCapsuleResume`. An **orphan** capsule — terminal with no
backlog item — is resumed and rebound instead of blocking the branch, and `archivedAt` is cleared so a
resumed capsule is not ready on one surface and archived on another. A terminal capsule bound to a
*different* item still refuses, so the history protection `readBranchIdentityCapsule` documents —
a foreign or terminal binding refuses rather than falling through to an impossible duplicate create —
holds unchanged.

The `branch_occupied` remedy no longer says "resume that capsule for the same backlog item" when the
occupying capsule has no backlog item to resume against — an instruction that could not be followed.

### 4.3 `BI-28E8CB88` — the decision says which lane the evidence is in

`ReadinessRequirementResult` gains three fields, and every construction site fills them through one
constructor (`readinessRequirement`) so a new site cannot reintroduce a bare `{ code, state }`:

- `evidenceLane` — `gate-receipt` | `recorded-unread` | `none`.
- `unreadEvidenceRefs` — the activity IDs behind `recorded-unread`.
- `nextAction` — one actionable sentence, profile-aware.

The projector maps a timeline `evidence` activity to the requirements it could plausibly be an attempt at,
by evidence *dimension*. The mapping is deliberately narrow: reporting every recorded activity against
every unmet requirement would be as uninformative as reporting none. A failing or non-gate-eligible record
is excluded — reporting a `test_fail` as "evidence this gate cannot read" would mislead in the other
direction.

The completion policy's blockers now travel with the requirement, so
`DELIVERY_EVIDENCE_REQUIRED: missing` carries the dimension that is actually unmet.

**Acceptance criterion 3** (surface the 35) is served by `list_backlog_items({ evidenceNotCounted: true })`:
items holding `evidence` activities and no `initiative_gate_receipt`. It reuses the existing read tool
rather than adding tool surface.

### 4.4 `BI-3AE38A1F` — what a requirement means, per profile

`RESEARCH_DEFINITIONS` and `PLAN_DEFINITIONS` state, per profile, what the requirement asks and which tool
records it. They are surfaced in two places: the `nextAction` on the refusal, and the description of
`record_initiative_evidence` itself, so the bar is legible **before** the work starts rather than being a
code discovered on rejection.

For a `fix`, research is verification and reproduction — the defect confirmed on a named ref, a
failing-then-passing proof, and the candidate causes ruled out by running them rather than reading them.
That definition is written from a record that was actually produced for `BI-2DB7254B` and had nowhere to go.

For a `fix`, the plan is the ordered fix sequence in the design doc, **not** a separate plan document.
Shipping a `docs/superpowers/plans/` file for a single-deliverable fix adds the plan-backlog coverage gate,
whose receipt is obtainable only through the reviewer route — which is the loop this work exists to break.

---

## 5. Sequence (this is the plan; no separate plan document — see §4.4)

1. `BI-7B249AFE`: mark, detect, guard, register in the CI test inventory. **Landed.**
2. `BI-D526F72C`: bind, read back, resume orphans, correct the remedy text. **Landed.**
3. `BI-28E8CB88` + `BI-3AE38A1F`: lane, definitions, reason propagation, reconciliation filter. **Landed.**
4. Close a merged-and-stuck item through the governed path. **See §7.**

---

## 6. What was deliberately not done

- **`evidence` activities do not satisfy a gate.** See §2.
- **No new MCP tool.** The reconciliation query is a filter on `list_backlog_items`.
- **The `pull-request` profile's excluded gates stay excluded.** `seed-fit-gate` reads the PR body;
  `decision-baseline` merges `origin/main`. Neither reason has expired.
- **`BI-2CA24BC0` (Workroom rename), `BI-48741E66` (UX route sweep), and the `BI-980FE9F5` live-state
  projection are out of scope** and are not touched here.

---

## 7. Open: the door is legible; for most callers it is still shut

This work makes the requirement and its writer **legible**. It does not make the writer **reachable**, and
that gap is now measured rather than assumed:

`initiative_evidence_write` is held by exactly one agent, `AGT-WS-PORTFOLIO`. `initiative_design_review` is
held by `AGT-WS-REVIEW` and `change-reviewer`. A session token without those grants gets `count: 0` from
`load_tools`, so an author who has genuinely done operational-fix research still cannot record it directly;
the sanctioned route is a `request_coworker` dispatch carrying an immutable review binding, which needs a
Workroom branch, an immutable head, and a resolvable canonical artifact.

That is a second-order blocker, and the depth bound applies: it is recorded here and handed back rather
than descended into. `BI-3AE38A1F` already names it as gap 3 ("MCP-only, no UI — no human can click this").
