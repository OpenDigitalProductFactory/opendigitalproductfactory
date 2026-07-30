# Progressive disclosure and interpretable context as enforced architecture

**Date:** 2026-07-29
**Status:** Research synthesis + refactoring assessment. No build authorized by this document.
**Author:** external coding agent, at founder request
**Question asked:** these two methodologies have shaped the platform through prompting, but no controlling mechanism enforces them continually. Where are the mechanisms, where are the holes, and what should be refactored?

## 1. The two methodologies, stated precisely

They are duals, and the platform has been treating them as one thing.

**Progressive disclosure** is a *volume and timing* discipline. The default view carries
only what the consumer needs for the task in hand; everything else stays reachable but
deferred. It answers **"how much, and when."** It is measurable as: what share of the
available content sits in the default scope, and does the deferred remainder have
structure.

**Interpretable context** is a *provenance and legibility* discipline. For every element
present, the consumer can tell **why it is here**, **where it came from**, and **what was
left out**. It answers **"on what basis."** It is measurable as: is each block attributed,
and is the exclusion set recorded.

The duality matters because each fails differently without the other:

- Disclosure without interpretability: content disappears and nobody can reconstruct why.
  This is not hypothetical here — it is the shape of the local-model cascade (BI-F4D3B9E9),
  where context was excluded, a provider was disabled as a downstream effect, and no
  durable record of the exclusion existed to diagnose from.
- Interpretability without disclosure: a fully-attributed wall of text. Every block
  justified, the consumer still swamped.

External work has converged on the same split. The 2026 context-engineering literature
proposes five context quality criteria — **relevance, sufficiency, isolation, economy,
provenance** — and treats provenance as a precondition rather than a nicety: without
per-element traceability to source, trust level, and time, agent decisions cannot be
audited, errors cannot be debugged, and compliance cannot be demonstrated. DPF today
enforces **economy** hard, **relevance** partially, and **provenance** not at all on its
runtime plane. See §6 for sources.

## 2. DPF has four consumer planes, not one

The reason enforcement feels uneven is that the platform applies these methodologies on
four distinct planes with four different consumers, and maturity differs by an order of
magnitude across them.

| # | Plane | Consumer | Disclosure mechanism | Interpretability mechanism |
|---|---|---|---|---|
| 1 | Portal UX | human operator | **Measured + ratcheted.** `lib/ux-budget`: `scope.ts` excises deferred subtrees, `budgets.ts` sets per-shell budgets, `ratchet.ts` freezes a per-route baseline, absolutes block net-new routes | Partial. `legibility_of_consequence` kernel axis exists. Per-route Purpose Contract is **filed, not built** |
| 2 | Static agent instruction plane | external coding agent | **Measured + ratcheted.** `check-instruction-plane-size.mjs`: byte ratchet, manifest-closure check, advisory structural signal. Runs in CI under Policy Guards | Genuine — `instruction-plane-manifest.json` declares exactly what is always-on |
| 3 | Runtime assembled context | in-platform coworker, local model | **Budgeted, not ratcheted.** `tak/context-arbitrator.ts` tiers L0/L1/L2 and defers L3/L4 to tools | **None persisted.** Dropped sources are formatted into a debug string and discarded |
| 4 | Tool surface | any model | **Capped.** `LOCAL_TOOL_SELECTION_CLIFF = 15`, per-turn attachment budget, description-hygiene test | **Observability only.** `context-economy-metrics.ts` states outright that nothing it measures changes what is sent |

This is the answer to the founder's question. **Planes 1 and 2 have controlling mechanisms.
Planes 3 and 4 have thermometers.** Plane 3 is the one that has already caused a
production outage.

It is worth being explicit that plane 2's ratchet is real and well-built. It exists
because the always-on plane grew ~4,000 chars in a single day *while the audit measuring
it was still open* — proof that doctrine re-accretes absent a ratchet. That mechanism is
the template the other planes should copy, and §4 leans on it.

## 3. Findings

Each is verified against the working tree at `59f8826e44`.

### F1 — The canonical disclosure vocabulary is invisible to the measurement that enforces disclosure (blocking, inverted incentive)

This is the sharpest finding and it inverts the control.

`disclose-before-you-add-a-surface` prescribes which construct fits which
summary-to-content relationship: `CollapsibleList` to preview a long list,
`ExpandableCard` for subordinate detail among peers, native `<details>` for *one short
secondary aside*, a drawer to preserve a large workspace, a route only when
linking/history/workflow demand it.

But `ExpandableCard` renders an `<article data-open="…">` with the panel behind
`{open && …}` — no `<details>`, no `data-dpf-disclosure`. So against
`ux-budget/scope.ts:197`, `isDisclosureRegion()` returns false and
`countDisclosureRegions()` returns **0** for a surface built entirely from the canonical
construct.

That number feeds a **blocking** check. `evaluate.ts:134-139`:

```
check: "deferred-detail",
ok: metrics.defaultVisibleWords <= budget.deferredDetailRequiredAboveWords
    || metrics.disclosureRegions > 0,
severity: "blocking",
```

So a wordy surface that defers correctly via the prescribed component **fails**, while the
same surface using a raw `<details>` — the construct the principle ranks lowest, reserved
for one short aside — **passes**. The measurement steers agents and humans toward the
dialect the principle deprecates.

Adoption, measured:

| Construct | Files (excluding own definition and tests) |
|---|---|
| `CollapsibleList` + `ExpandableCard` | **5** |
| raw `<details>` | **56** (106 occurrences) |
| `data-dpf-disclosure` marker | **1** |

The marker that `scope.ts` was built to read is emitted by exactly one component
(`wiki/DecisionAwaitingHelp.tsx`). The measurement layer therefore observes disclosure
almost entirely through raw `<details>`, and the prescribed vocabulary sits at roughly 8%
adoption with no mechanism pulling toward it. This is the same failure class as the one
that motivated the UX-fit gate: the rule exists, and nothing enforces it.

### F2 — The runtime context plane records no provenance and no exclusion trace

`context-arbitrator.ts` returns `ArbitrationResult { selected, dropped, totalTokens,
budgetUtilization }`. `dropped` is consumed in exactly one place — a debug-string
formatter at `context-arbitrator.ts:189-190` — and never persisted. There is no
`ContextArbitration` record, no telemetry field, no audit trace.

Consequences:

1. When a coworker behaves as if it did not know something, there is no way to establish
   whether the fact was absent, present-and-dropped, or present-and-ignored. These need
   different fixes and are indistinguishable from the outside.
2. Any future ratchet on this plane is blocked. You cannot ratchet what you do not record.
3. It is the diagnostic that the local-model cascade needed and did not have.

"Persist `excludedTrace`" is already listed as open hardening under BI-F4D3B9E9, so the
need is recognized. What §2 adds is that this is not a one-off outage fix — it is the
missing provenance half of the methodology on the platform's most constrained plane.

### F3 — The always-on plane is roughly 2× its own target

Measured live, `node scripts/check-instruction-plane-size.mjs`: **91,025 bytes across 3
always-on files (baseline 91,227; ~22,756 tokens)** — AGENTS.md carries almost all of it at
~90.6k of the 91k. That is roughly 22.8k tokens read on every external agent session, and
BI-3B7494AD names a ≤45k ceiling. Current headroom under the ratchet is 202 bytes.

This is a burn-down, not a leak: the ratchet permits shrink only, so the number cannot
regress. Worth stating plainly because the mechanism working and the work being unfinished
are different problems, and only the second one is open here.

### F4 — Load-bearing doc drift: AGENTS.md understates the cost-axis set

AGENTS.md §320 instructs agents calling `principle_decide` that higher-is-worse on "the
four **cost** axes (`blast_radius`, `human_cognitive_load`, `vendor_lock_in`,
`business_disruption`)". The authoritative registry `PRINCIPLE_COST_DIMENSIONS`
(`packages/db/src/wiki-taxonomy.ts:201`) contains **five** — it also has `operator_effort`.

An agent following the always-on plane will supply `operator_effort` as though higher were
better, inverting the sign on the axis most relevant to disclosure decisions. This is
precisely the "prose/code discriminator drift on load-bearing rules" that BI-0020D511
exists to catch, occurring inside the very file that BI is about. One-line fix.

### F5 — The kernel has no axis for agent-side context economy

The registry carries 21 dimensions. Three bear on this work: `human_cognitive_load`
(cost), `operator_effort` (cost), `legibility_of_consequence` (benefit — "can the operator
foresee what an action will do before authorizing it").

All three are **human**-scoped. And `human_cognitive_load`'s own docstring reads "more
operator/agent cognitive load" — the axis is being asked to carry two different consumers
with two different constraints. A human's working memory on one screen and a 24,576-token
served window are not the same quantity and do not trade off the same way.

The practical consequence: `principle_decide` cannot score the decisions this research is
about. "Add twelve fields to the tool description" versus "return a handle and let the
model fetch" moves **no axis in the registry**. The kernel is structurally unable to weigh
context economy, which is why the discipline has lived in prompts rather than in the
decision plane. This is the WWMD gap the founder suspected, and it is real.

### F6 — The human-side gate is still self-attestation

`check-ux-fit-decision.mjs` fails a UI-impacting PR lacking a `UX-Fit-Decision:` trailer.
Its own header calls this "a conscious-attestation MVP". A trailer asserting
`progressive-disclosure (principle_decide, margin 0.85)` is accepted without verifying
that any consult occurred.

Already filed as **BI-D967DEE0** — "UX-Fit gate upgrade: measured-evidence manifest
(`*.ux-fit.json`), attestation retires" — at priority 4. Noted here only to argue the
priority is wrong: it is the keystone of plane 1, and the measured evidence it would
require already exists in `lib/ux-budget`.

## 4. Recommendations

Ordered by leverage per unit of work. R1 and R2 are defect repairs; R3–R5 are architecture.

**R1 — Make the canonical constructs emit `data-dpf-disclosure` (F1).** Filed as
**BI-2B196D07** (EP-UX-SYSTEM, small). Add the attribute
to `CollapsibleList` and `ExpandableCard`. Two-line change per component; immediately
un-inverts a blocking check and makes correct usage measurable. Then, separately, ratchet
raw `<details>` against its 56-file baseline using the `check-no-hand-rolled-*` pattern
the repo already applies about a dozen times. Do the first part before the second — the
guard is unfair until the sanctioned alternative scores.

**R2 — Correct the cost-axis list in AGENTS.md (F4).** One line. Add `operator_effort`,
say five. Consider a guard asserting the prose list matches `PRINCIPLE_COST_DIMENSIONS`,
since this class of drift is what BI-0020D511 was opened to stop.

**R3 — Persist the arbitration trace (F2).** Record, per dispatch: selected sources with
tier, token count, and source label; dropped sources with the same; budget utilization.
This is the single highest-value structural change in this document. It converts an
invisible failure mode into an auditable one and it is the **precondition for R4**. It
also aligns the platform with where the external work has landed: governed,
provenance-carrying selection has been measured beating sparse retrieval on answer quality
at roughly one-third the token cost, so provenance is not purely a compliance tax.

**R4 — Extend the ratchet from bytes-on-disk to tokens-at-dispatch (plane 3).** The
instruction-plane ratchet is the proven template: freeze a baseline, permit shrink only,
check manifest closure so the obvious evasion is caught. Apply that shape to the
*assembled* context — a per-agent-profile baseline of L0+L1+L2 tokens that may only
shrink. Honest cost note: this needs a deterministic, DB-free assembly fixture or it will
flake in CI, which is real work and the reason to sequence it after R3 rather than with it.

**R5 — Propose one new kernel axis: `context_economy` (COST) (F5).** Defined as: how much
of a finite consumer window this option consumes on every future invocation.

The registry has an orthogonality bar — a new axis needs an orthogonality claim and at
least two authoring principles. The claim:

- vs `human_cognitive_load` — that is a human's working memory on one surface at one
  moment; this is a machine's token window across every dispatch, forever.
- vs `cost_efficiency` — that is money. An option can be free and still window-fatal on a
  single local GPU. The local-window contract is not a budget line.
- vs `blast_radius` — that is reach of harm, not standing occupancy.

Naming follows the cost-name discipline that caught the `never-wipe-db` sign inversion:
high means more of a bad thing. One axis, not two — the interpretability gap is a
*persistence* problem (R3), not a scoring problem, so `legibility_of_consequence` should
stay human-scoped rather than be stretched.

**This one is a founder decision, not an agent decision.** Adding to the closed dimension
registry changes how every principle scores. It should go through the kernel and be
ratified, not filed and built.

## 5. Already filed — do not duplicate

The backlog sweep found this ground substantially covered. Recommendations above are
scoped to avoid overlap.

| Item | Title | Bearing |
|---|---|---|
| BI-D967DEE0 | UX-Fit gate upgrade: measured-evidence manifest, attestation retires | F6 — plane 1 keystone |
| BI-8316AC0C | Ratchet flip contract: absolute budgets + judge advisory→blocking | plane 1 teeth |
| BI-939E57D0 | Per-page Purpose Contract — primary user, one outcome, primary action | **plane 1 interpretability**, with BI-B4A4C76E, BI-D27323A0, BI-B6935E5B |
| BI-1D718FCA | Progressive-disclosure audit pass for high-overload technical pages | plane 1 remediation |
| BI-2677A465 | Gate-context pack: inject live ratchet baselines into agent context pre-generation | plane 2/3 |
| BI-0020D511 | Instruction-plane audit: 32k always-on preamble, discriminator drift | F3, F4 |
| BI-3B7494AD | Tighten AGENTS.md toward the ≤45k ceiling | F3 |
| BI-F4D3B9E9 | Local-model cascade hardening (includes persist `excludedTrace`) | F2 |

The Purpose Contract chain deserves a note: it is plane 1's interpretability layer under a
different name. Declaring each route's primary user, single outcome, and primary action —
then scoring content against that declaration — is exactly "why is this element here,"
made checkable. It is filed with no priority set. If R3 lands on plane 3 and the Purpose
Contract lands on plane 1, the platform has provenance on both planes that matter.

## 6. Sources

Internal:

- [`docs/founder-kernel/wiki/principles/disclose-before-you-add-a-surface.md`](../../founder-kernel/wiki/principles/disclose-before-you-add-a-surface.md)
- [`docs/architecture/context-engineering-standards.md`](../../architecture/context-engineering-standards.md) — P1–P13; four ENFORCED, nine REVIEW
- [`docs/professions/ux-design/wiki/information-hierarchy-and-density.md`](../../professions/ux-design/wiki/information-hierarchy-and-density.md)
- `apps/web/lib/ux-budget/{scope,measure,budgets,evaluate,ratchet}.ts`
- `apps/web/lib/tak/{context-arbitrator,context-economy-metrics}.ts`
- `scripts/check-instruction-plane-size.mjs`, `scripts/check-ux-fit-decision.mjs`
- `packages/db/src/wiki-taxonomy.ts` — `PRINCIPLE_DIMENSIONS`, `PRINCIPLE_COST_DIMENSIONS`

External:

- Context Engineering: From Prompts to Corporate Multi-Agent Architecture — <https://arxiv.org/abs/2603.09619> (the five criteria: relevance, sufficiency, isolation, economy, provenance)
- ContextNest: Verifiable Context Governance for Autonomous AI Agents — <https://arxiv.org/abs/2607.02116> (governed provenance-carrying selection vs sparse retrieval: higher pass rate at ~1/3 input-token cost)
- Auditing Provenance Sensitivity in LLM Agent Action Selection — <https://arxiv.org/html/2607.20827v1>

The platform's own honesty note applies to everything numeric above: the UX text-mass
thresholds are platform-owned calibration, not validated science, and must not be
presented as findings about human cognition. The visual/perceptual metrics and the
token-window constraints are different — those carry evidence.
