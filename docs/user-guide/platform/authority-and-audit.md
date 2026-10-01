---
title: "Authority And Audit"
area: platform
order: 3
---

## Use This Doc For

- `/platform/ai/authority`
- `/platform/audit`
- `/platform/audit/authority`
- `/platform/audit/journal`
- `/platform/audit/ledger`
- `/platform/audit/metrics`
- `/platform/audit/operations`
- `/platform/audit/routes`

## Choose The Evidence Surface

The audit area deliberately separates permission design, action approval, tool
execution, aggregate health, and model routing. Start from the question you
need to answer:

| Question | Surface |
| --- | --- |
| Who should be able to reach a route or coworker? | **Identity → Authorization** |
| Which standing grant or delegation chain applies? | **Authority** |
| Which side-effecting action was proposed, approved, rejected, executed, or failed? | **Action Ledger** |
| Which journal- or ledger-class tool call actually ran? | **Capability Journal** |
| Are failure rate, latency, or read-only probe volume changing? | **Operational Metrics** |
| Which model route was selected, and what was excluded? | **Route Decision Log** |
| What is the state of a long-running provider operation? | **Long-running Operations** |

The **Action Ledger** and **Capability Journal** are related but not
interchangeable. The ledger follows the proposal and its outcome. The journal
follows the execution evidence. Read-only probes are aggregated in Operational
Metrics instead of filling the journal with low-value chatter.

## Investigate An Unexpected Action

1. Name the exact actor, action, resource, route, and time window. Avoid starting
   from a broad claim such as “the coworker has admin.”
2. In the **Effective Permissions** inspector, select the user role and AI
   coworker whose combined access you need to understand. Separate the employee
   role from the coworker grant before changing either one.
3. In **Authority**, inspect standing agent grants, temporary delegation chains,
   and the shared authority binding. Runtime grants remain execution truth;
   identity snapshots and portable authorization labels make that truth easier
   to review. Reading quiescence status uses the existing
   `release_plan_read` grant and does not mutate the platform.
4. In the **Action Ledger**, find the proposal and distinguish pending,
   executed, rejected, failed, and expired states. Expired means nobody decided
   it within the seven-day approval window, so nothing ran. Approval is evidence that the named
   action was authorized; it is not evidence that execution succeeded.
5. In the **Capability Journal**, find the corresponding execution and inspect
   the coworker, capability, result, and available receipt reference. A failed
   execution is not automatically an authorization failure.
6. Use **Operational Metrics** to decide whether the event is isolated or part
   of a wider error or latency pattern.
7. If AI routing matters, use the **Route Decision Log** for the selected model,
   fitness evidence, and excluded alternatives. Routing evidence does not widen
   the actor's authority.

### What A Route Decision Records About The Call

Expand a row and two further panels appear when the platform has something to
report about how the model was called, not only which one was chosen.

**How it was called** lists the sampling values the call actually used —
temperature, top-p, top-k, min-p, repeat penalty — the output ceiling, whether
extended reasoning was switched on, and whether the response was constrained to
valid JSON as it was generated. Each value says where it came from:

| Provenance | Meaning |
| --- | --- |
| the model's published setting | the vendor documents this value for this model; on a reasoning call it is the vendor's reasoning-mode setting |
| what this kind of task needs | the task's own shape asked for it — a schema-bound extraction is deterministic whatever budget it ran on |
| what measured best for this model on this task | a recorded recipe, learned from production |
| an override set for this install | an operator chose it explicitly |

Two honest absences are reported rather than hidden. A model that refuses a
setting has it listed as not accepted. A task that asked for extended reasoning
on a model with no way to receive that instruction says so, instead of appearing
to have reasoned.

**Ran with low confidence** appears only when routing itself had little
confidence in the answer: no model met the quality bar and the best available ran
instead, only one model was available so nothing competed, or a fallback ran
rather than the ranked choice. On a confident decision the panel is absent, so
its presence is the signal.

Rows recorded before these panels existed show neither. That reads as *not
recorded* — not as a call made with no parameters, and not as a confident route.

## Separate The Failure Domains

- **Route not visible** — inspect the user's platform role and authority
  binding.
- **Route visible, action denied at execution** — inspect coworker grants,
  delegated scope, record scope, connection state, sensitivity, and oversight
  policy.
- **Action approved, tool failed** — inspect the execution record and provider
  or service health; do not grant more authority as a connection repair.
- **Action succeeded but result is disputed** — preserve the proposal,
  execution receipt, and relevant business record before correcting the
  downstream state.
- **Metrics look incomplete** — confirm that capability sync has populated the
  platform capability inventory. Missing telemetry is not proof that no action
  occurred.

## Change And Recovery Rules

Change authority from **Identity → Authorization**, where users with
`manage_platform` can work with the shared binding record. Use the audit
surfaces to understand and verify the change; do not edit permissions merely to
make an audit warning disappear.

For a sensitive or incorrect action:

1. stop or contain any still-active operation when the owning workflow supports
   it;
2. preserve the ledger, journal, and business-record evidence;
3. correct the narrow binding, grant, delegation, connection, or record scope
   that caused the problem;
4. rerun only the smallest safe check; and
5. confirm both the intended access path and the denied path.

## What To Watch

- actions that appear available in UI but are blocked at execution time
- missing or unclear audit evidence for a sensitive action
- route-level policy changes that alter visible authority without documentation
- approvals being treated as proof of successful execution
- tool failures being “fixed” by widening a user role or coworker grant
- read-only probe counts being confused with journal-class business actions
- model-selection evidence being confused with permission evidence
- deleted or rewritten history that prevents later reconstruction
