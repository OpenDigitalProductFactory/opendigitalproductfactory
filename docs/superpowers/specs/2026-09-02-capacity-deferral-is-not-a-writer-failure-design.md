---
status: active
title: A capacity deferral is not a writer failure — letting the governed reviewer route report why it stopped
---

# A Capacity Deferral Is Not a Writer Failure

- **Date:** 2026-09-02
- **Scope:** platform — agentic loop route-failure classification, remote task execution wait projection
- **Backlog item:** `BI-8B8731EE`
- **Status:** Active — capacity classification is shipped; terminal-writer adapter enforcement is the current extension.

> The governed reviewer route computed the true reason it stopped, then overwrote it
> with a false one. Everything downstream acted on the false one.

---

## 1. What is true today

Verified against `origin/main` at `0acfd06c58` and against the live install, not inferred.

| # | Finding | Evidence |
| --- | --- | --- |
| 1 | **The loop already classifies route failures correctly.** `describeToolRouteFailureOutcome` returns `kind: "capacity"` for a local-host deferral, with copy that names the window. | `inference-dead-ends.ts`, `isLocalCapacityDeferral` |
| 2 | **The reviewer path discarded that classification.** On any `routeAndCall` throw with a `terminalToolPolicy` set, the catch computed `failure` and then returned a hardcoded `{ kind: "terminal-writer-missing" }` instead. | `agentic-loop.ts`, `catch (routeErr)` |
| 3 | **The platform already has the right state and it was unreachable.** `preInferenceResourceWait` projects a resumable `provider-capacity` wait — but it keys on `failure.kind === "capacity" \| "busy"`, which finding 2 had just erased. | `mcp-task-capacity-contract.ts` |
| 4 | **A second guard closed the same door.** Even with the kind preserved, the terminal-writer branch runs first and its `terminalWriterMissing` condition is true for *any* governed route that executed no tools — exactly what a deferral looks like. | `mcp-task-execution.ts` |
| 5 | **Measured cost.** Terminal writes landed on ~34% of external-MCP reviewer dispatches: 35 completed, 49 `input-required`, 18 failed over 5 days. | live `TaskRun` query, 2026-09-01 |
| 6 | **The real cause was in the log the whole time.** Every stranded run: `routeAndCall threw: Local provider dispatch deferred: local-ci-queued-capacity-reservation`. | `dpf-portal-1` logs |
| 7 | **That condition clears itself.** The routing layer attaches `expectedFreeAt`; a real gate holds the host ~195s on average. | `local-provider-capacity.ts` |

### 1.1 A second cause must not be reported as a writer no-show

TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-7ECDD7A53D18` is the exact
counterexample to the earlier CLI exception. Its immutable packet required
`record_initiative_evidence`; five exact-bound reads succeeded; the session token
had write capability and the writer grant; and two writer-only turns still
returned prose with zero writer calls. No approval envelope or receipt exists.

The reason is structural, not probabilistic. `ai-inference.ts` currently allows
`claude-code-cli` and `codex-cli` through a `toolChoice: "required"` plan when the
caller exposes one bound terminal writer. Neither adapter has a server-verifiable
required-tool mechanism:

- Claude CLI receives an MCP server and a list of allowed tools, but no native
  force-this-tool choice. The model may finish with prose, as `...7ECDD7A53D18`
  proved twice.
- Codex CLI receives text-described tool schemas and parses text-shaped tool
  calls after inference. A prompt cannot prove that the call will happen.

The outer terminal policy correctly refuses to infer a receipt, but it can only
detect the breach after spending an inference and it reports the symptom as
`missing-terminal-writer`. A writer-only request must instead avoid an adapter
that cannot enforce the contract and continue through the existing fallback
chain to an adapter with native required-tool choice. If no such adapter is
eligible, the original TaskRun returns a typed
`required-terminal-writer-not-enforceable` refusal before inference.

### 1.2 What the substitution cost

`missing-terminal-writer` describes an *outcome* — no receipt yet — and says nothing true about the
cause. Callers act on the cause. Reading it as a writer-contract failure sends you auditing grants,
autonomy tiers and tool surfaces, because those are what could make a writer undispatchable.

That is what happened. Five dispatches for `BI-5CBDC146` were spent disproving, in order: that the
governed path was structurally unreachable; that the provider was down; that the reviewer's
`hitlTierDefault = 1` ("Approve each action") was blocking it; and that the writer grant was missing
from the run's scope. Every one of those was wrong, and each was ruled out with evidence:
`requiresApproval: false` in the response, a Tier-3 agent stranding identically, and
`tool:record_initiative_design_review` present in the run's `authorityScope`.

The condition was a transient reservation that clears in about three minutes.

---

## 2. Research & benchmarking

The design question is narrow: **what should a gate report when the thing it was waiting for never
ran?**

- **Kubernetes pod conditions.** A pod that cannot be scheduled is `Pending` with reason
  `Unschedulable`, never `Failed`. The *phase* stays coarse; the *reason* carries the cause, and the
  two are separate fields. **Adopted:** the wait stays resumable, and the reason names the resource.
- **HTTP 503 + `Retry-After`.** The canonical way to say "not now, and here is when". A server that
  returned 400 for an overloaded backend would send clients to fix their request. **Adopted:** the
  deferral already carries `expectedFreeAt`; routing it to the existing `provider-capacity` wait is
  what surfaces it.
- **The platform's own precedent.** `routed-semantic-review.ts` already handles this exact error by
  returning `inconclusive` with a typed `inconclusiveReason` rather than a verdict. **Adopted
  wholesale** — this change makes the reviewer route behave the way semantic review already does.

**Rejected: adding a `cause` field to the terminal-writer wait.** That was the first implementation
here and it was wrong — it would have built a second, parallel way to report a condition the platform
already models as `provider-capacity`. Verifying the substrate first turned a new mechanism into a
precedence fix.

---

## 3. Decision

**Stop overwriting the classification, and let the resource wait win when nothing has run yet.**

No new state, no new field, no new tool. Two conditions, both narrowing an over-broad branch.

For a required terminal-writer turn, **adapter enforceability is also a hard
dispatch capability**. An allow-list, an MCP attachment, a prompt reminder, or a
post-response check is not enforcement. The shared provider boundary refuses
known non-enforcing CLI adapters before model invocation with the typed code
`required-terminal-writer-not-enforceable`. The fallback chain treats that as a
route-candidate capability miss, not a provider outage, and tries only subsequent
adapters that pass the same enforcement check. It must not cool down, degrade, or
disable a healthy provider for a plan/adapter mismatch.

If every eligible adapter lacks the capability, remote task execution preserves
the same TaskRun, request digest, immutable binding, successful reads, grants,
approval/idempotency state, and returns the typed refusal. It never synthesizes
writer arguments or a receipt. The rule is writer-name agnostic and therefore
covers both `record_initiative_evidence` and
`record_initiative_design_review`.

---

## 4. What was built

### 4.1 The loop keeps what it classified

In the `terminalToolPolicy` catch, a `capacity` or `busy` classification is returned as itself
instead of being rewritten. An unclassified failure still reports `terminal-writer-missing`, because
without a known cause there is nothing truer to say.

**Only pre-inference.** The reclassification requires `executedTools.length === 0`, mirroring
`preInferenceResourceWait`'s own contract. This bound was not in the first draft, and an existing
test caught it: once a reader has succeeded, the resumable writer wait is the *better* state — the
read work is banked and only the receipt is outstanding, whereas a resource wait at that point would
fail the run.

### 4.2 The resource wait takes precedence

`mcp-task-execution.ts` computes `preInferenceResourceWait` before the terminal-writer branch and
skips that branch when a resource wait owns the turn. Both paths resume on the same TaskRun, so this
changes only which reason is reported.

### 4.3 Regression guards, verified to fail without the fix

Both halves were confirmed by removing the fix and watching the tests go red:

- `agentic-loop.test.ts` — a capacity deferral and a busy provider stay classified; an unclassifiable
  failure still blames the writer.
- `mcp-task-execution.test.ts` — a pre-inference deferral becomes a resumable `provider-capacity`
  wait with no `terminalWriterWait` in the payload; a genuine writer no-show after a successful read
  is unchanged; a capacity failure *after* tool work is not diverted.

---

## 5. Objectives and acceptance criteria (BI-8B8731EE)

**OBJ-BI8B-001:** A governed initiative review reaches its exact bound receipt
writer or refuses before inference with the provider/adapter capability that is
missing.

**OBJ-BI8B-002:** A capability refusal preserves the original TaskRun and every
immutable authority, evidence, approval, and idempotency binding without
manufacturing writer arguments or a receipt.

**OBJ-BI8B-003:** Adapter incompatibility uses the existing route fallback path
without degrading a healthy provider, and no inference is sent through an
adapter that cannot prove required-tool enforcement.

**OBJ-BI8B-004:** Evidence and design-review writers obey the same generic sole
terminal-writer contract.

| Acceptance criterion | Objective links | Observable result |
| --- | --- | --- |
| AC-BI8B-001 | OBJ-BI8B-001, OBJ-BI8B-003 | A writer-only plan refuses Claude CLI and Codex CLI before their adapter `execute` method or model transport runs, with `required-terminal-writer-not-enforceable`. |
| AC-BI8B-002 | OBJ-BI8B-001, OBJ-BI8B-003 | The fallback chain skips that candidate without provider health mutation and may complete through a later HTTP adapter that preserves `toolChoice: "required"` and the exact writer name. |
| AC-BI8B-003 | OBJ-BI8B-002 | When no enforceable adapter is eligible, the response is typed, actionable, resumable on the same TaskRun, and receipt-free; digest, binding, reads, grants, and approval state are unchanged. |
| AC-BI8B-004 | OBJ-BI8B-004 | Parameterized tests cover `record_initiative_evidence` and `record_initiative_design_review`, including the exact prose/zero-tool native-MCP failure shape. |
| AC-BI8B-005 | OBJ-BI8B-002, OBJ-BI8B-004 | No branch constructs decision arguments, invokes a writer itself, approves an envelope, or infers a receipt. |

---

## 6. What this does not do

It does not make the reviewer route succeed. A capacity reservation still defers the run; what
changes is that the caller is told so, is told when the host frees, and can wait rather than
investigate. The ~34% completion rate is a *capacity* question — how local inference and governed
local CI share one host — and that is not this change.

It also does not touch `hitlTierDefault`. Both reviewers are Tier 1 ("Approve each action"), which
looked like the cause and is not; whether an independent reviewer *should* be Tier 1 is an operator
decision about risk posture, not a defect.

The adapter-enforcement extension does not promise that an enforceable provider
is available. Capacity, credentials, data clearance, model floors, and approval
remain independent gates. It only ensures that an adapter incapable of the
required call is never asked to improvise compliance, and that its absence is
reported truthfully instead of consuming another prose-only writer turn.
