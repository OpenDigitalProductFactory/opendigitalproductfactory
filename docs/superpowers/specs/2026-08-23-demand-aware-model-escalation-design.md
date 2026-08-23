---
status: active
---

# Demand-Aware Model Escalation

- **Date:** 2026-08-23
- **Backlog item:** `BI-07F1A95F`
- **Scope:** platform — coworker model routing and escalation
- **Origin:** operator question, 2026-08-23 — a coworker routed below its task's demand should be able to say "this is above my head" and hand the work up, the way a person does, without that becoming a cop-out.

## 1. Outcome

Today `minimumTier` is admission control only: a static prior checked before
dispatch. When that prior guesses wrong in the permissive direction there is no
runtime correction, and both available outcomes are bad — silent fabrication, or
a hard failure with no retry.

1. **OBJ-DAME-001:** A coworker whose dispatched model is demonstrably insufficient for the task hands the work up instead of fabricating an answer or hard-failing.
2. **OBJ-DAME-002:** Escalation is triggered by measured, verifiable signals, never by the model's own opinion of its capability.
3. **OBJ-DAME-003:** The coworker proposes; the router disposes. No coworker re-routes itself.
4. **OBJ-DAME-004:** Escalation cannot degrade into a shrug — its rate is measured per coworker, it must cite the signal that fired, and a tier shortfall is distinguishable from an ill-posed task.
5. **OBJ-DAME-005:** A judging or approving role never self-downgrades, because a weak judge manufactures a governance receipt indistinguishable from a real one.
6. **OBJ-DAME-006:** An unsatisfiable tier floor is surfaced as a finding before it strands a mandatory gate.

## 2. Existing substrate

Verified before designing:

- `agentModelConfig.minimumTier`, `budgetClass`, `minimumCapabilities`, `minimumContextTokens` — the static floor (`packages/db/src/agent-model-defaults.ts`).
- `projectCoworkerRouteReadiness` and `apps/web/lib/coworker-service-catalog/routing-reachability-preflight.ts` — already compute whether a coworker's route is satisfiable. Computed, not surfaced.
- `toolFidelity` on the model profile — already a measured routing score (`ai-platform-posture`, `ai-readiness`).
- `principle_decide`'s `requireEvidence` — already drops a scored feature that carries no admissible citation.
- Golden journeys and their oracles (`apps/web/lib/coworker-lifecycle/golden-journeys.ts`, `certification-runner.ts`) — already judge behaviour on the real execution path.
- `propose-acknowledge-reassign` (PAR) — commandment-tier kernel principle, already applies to `in_platform_coworker`.

There is **no runtime escalation path**: `apps/web/lib/ai` and `apps/web/lib/model-selection` contain no escalation logic. That is the gap.

### Prior art this extends

| Item | State | Relationship |
| --- | --- | --- |
| `EP-E431FC8A` | done | Direct ancestor — fidelity-bounded tool attachment and intent routing. Bounded ADMISSION; runtime escalation is the half it did not cover. |
| `EP-BUILD-FBE98E` | open | "No re-inference retry on local-model parse failure" — a narrow instance of the retry half; folded in here. |
| `EP-BUILD-D08AB8` | open | Null `maxContextTokens` silently exempts the local model — same floor-evasion family. |
| `BI-654EE2E9` | done | Routing selected an insufficient local tier despite an active frontier provider. |
| `EP-27FD96BC` | done | Reasoning Economy; its dormant effort-warrant knobs are the same shape. |

## 3. The design correction

The intuitive framing — let the model judge whether the task is above its head —
inverts the real risk. Self-assessed capability is precisely what weak models are
worst at: a model that cannot do a task usually cannot detect that it cannot, so
it under-escalates and over-claims. `dpf-establish-coworker` already records the
consequence: *"a missing floor is how weak local models produce fabricated 'Done'
replies."* EP-E431FC8A's originating incident is the same shape — a local model
handed 49 tools made zero tool calls and returned a fabricated "59/60 done"
against a live truth of 710 items.

Over-escalation is the cheap failure. Under-escalation is the expensive one.
**Design for the expensive one.**

So the model is never asked to introspect. Escalation triggers on signals the
platform already measures:

| Signal | Source |
| --- | --- |
| Required tool call malformed or absent | `toolFidelity`, loop tool-call inspection |
| Output failed its StructuredOutput contract | schema validation at the tool boundary |
| Required evidence citations missing | `requireEvidence` admissibility |
| Golden-journey oracle failed | `certification-runner` |

These are **measured refusals, not self-reports**, which keeps the mechanism
consistent with the commandment *governance approves evidence, not provenance*.

## 4. Contract

**PAR shape.** The coworker emits a reassignment PROPOSAL carrying the signal
that fired. The router acknowledges and decides. A coworker never re-routes
itself — that is the difference between escalation and self-service, and it is
why PAR is the right protocol rather than a bespoke one.

**Bounded.** One tier hop per attempt, never straight to frontier, with a
per-task ceiling.

**Comparative.** The task is re-run on the higher tier and the outcome compared.
If the higher tier also fails it was not tier — it was an ill-posed task or a
defective coworker definition. This comparison is the load-bearing anti-cop-out
mechanism: it converts "above my head" from an assertion into a measurement.

**Measured.** Escalation rate is a per-coworker metric surfaced in AI posture, so
a coworker that escalates everything is as visible as a flaky test.

**Task-class asymmetry — the load-bearing rule.** Escalation is not uniform:

- **Producing** work (draft, summarize, extract) — evidence-triggered escalation applies.
- **Judging** work (approve, gate, review, certify) — the floor is hard and self-relaxation is forbidden. A weak reviewer that rubber-stamps is strictly worse than no reviewer: it manufactures a governance receipt indistinguishable from a real one, a silent failure that forges an audit record. For approval roles the honest answer to "can a lower tier do this?" is "we do not let it try."

This is live, not hypothetical. `change-reviewer` carries `minimumTier: "strong"`
because it is a judging role, and it is the sole holder of
`initiative_design_review`.

**Unsatisfiable floors surface.** When a coworker's floor cannot be met by any
connected provider, that is a finding — emphatically so when the coworker solely
holds a mandatory gate's grant. On 2026-08-23 the chain "Change Reviewer requires
strong / this install has no provider connection able to serve strong" was found
only by driving the portal by hand (`BI-3EC58C5A`).

## 5. Authority and data architecture

No new identity or authority concept. The escalation proposal is an existing
routing decision record plus the signal that triggered it; the router remains the
only actor that changes a route. Escalation rate is derived from those records,
not a new counter. Task class is derived from the coworker's existing `role`
(`reviewer`, `architect`, `operator`, `specialist`, `builder`) rather than a new
axis — a judging role is one whose output is a verdict others rely on.

## 6. Scale, security, and privacy

At most one extra dispatch per escalating task, capped per task, so worst-case
cost is bounded and predictable. No unbounded retry. No personal data enters the
signal record — it carries the signal kind, the coworker, the model profile, and
the outcome, not the payload. A judging role's hard floor means escalation can
never be used to obtain a cheaper verdict.

## 7. Research and benchmarking

- **LLM calibration literature** consistently finds smaller models are more overconfident: self-reported confidence correlates poorly with correctness, and worsens as capability drops. DPF adopts the conclusion — never gate escalation on self-assessment — and rejects the "ask the model how sure it is" pattern.
- **Kubernetes / autoscaler eviction and requeue** escalate on *observed* resource pressure, never on the pod's own opinion, and cap retries with backoff. DPF adopts the observed-signal trigger and the bounded hop; the comparison re-run is the analogue of a crashloop check that distinguishes a bad node from a bad image.
- **Human escalation policy in incident management** (PagerDuty-style tiers) works because escalation is time- or condition-bound and logged, not discretionary. DPF adopts the logged, condition-bound shape and the visibility of escalation rate.
- **Rejected: cascade/router-model architectures** (a cheap model with a learned "defer" head). They are the closest published analogue and would be a reasonable long-term direction, but they require a trained deferral policy and calibration data this platform does not have, and they place the deferral decision inside the weak model — the exact property this design refuses. Revisit if per-coworker escalation telemetry ever provides the training signal.

## 8. Acceptance mapping

| ID | Objectives | Statement | Sections |
| --- | --- | --- | --- |
| AC-DAME-001 | OBJ-DAME-001, OBJ-DAME-002 | A dispatch producing a measured insufficiency signal emits a PAR reassignment proposal carrying that signal instead of fabricated output or a hard failure | §§3-4 |
| AC-DAME-002 | OBJ-DAME-002 | No escalation path consults the model's self-reported confidence or capability | §3 |
| AC-DAME-003 | OBJ-DAME-003 | The router performs any re-route; a coworker cannot change its own routing, and the decision plus its evidence are recorded | §§4-5 |
| AC-DAME-004 | OBJ-DAME-004 | Escalation is capped at one tier hop per attempt with a per-task ceiling | §4 |
| AC-DAME-005 | OBJ-DAME-004 | The higher-tier outcome is compared, so a tier shortfall is distinguishable from an ill-posed task | §4 |
| AC-DAME-006 | OBJ-DAME-004 | Escalation rate is queryable per coworker and surfaced in AI posture | §4 |
| AC-DAME-007 | OBJ-DAME-005 | A judging or approving role cannot self-downgrade under any configuration, asserted by test | §4 |
| AC-DAME-008 | OBJ-DAME-006 | An unsatisfiable tier floor on a coworker that solely holds a mandatory gate's grant is surfaced as a finding | §4 |

## 9. Review boundary

This design changes routing authority semantics, so it requires an independent
design review through the governed lane. Data review is N/A — no schema or
classification change; escalation records reuse existing routing decision
storage. UX review is applicable and narrow: escalation rate appears in AI
posture. Security review is applicable and is satisfied by AC-DAME-007 and
AC-DAME-003 — the design's whole risk is that "route by demand" becomes a way to
obtain a cheaper verdict or to let a coworker widen its own authority, and those
two statements are the assertions that it cannot.
