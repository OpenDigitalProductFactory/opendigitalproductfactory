# Escalation Surface — Honest Context + Auto-Resolve (WWMD-consult supersession)

| Field | Value |
| ----- | ----- |
| Status | Implemented 2026-06-23. Replaces the §5.3 / §14 WWMD-consult mechanism of the [2026-06-20 issue-report surface attendance design](2026-06-20-issue-report-surface-attendance-design.md). |
| Date | 2026-06-23 |
| Trigger | Operator (founder), looking at the `/ops` "Escalations awaiting attention" band: "there is also a WWMD button, that looks to be largely useless… looks like noise to me." |
| Backlog | `BI-8DE13577` (honest blocker context), `BI-467E8F8D` (auto-resolve sweep). Epic `EP-INTAKE-UNIFY`. |
| Related substrate | [`PlatformIssueReport`](../../../packages/db/prisma/schema.prisma), [`escalateBuildToHuman`](../../../apps/web/lib/build/escalate-build-to-human.ts), [`escalation-attention`](../../../apps/web/lib/quality/escalation-attention.ts), [`escalation-staleness`](../../../apps/web/lib/quality/escalation-staleness.ts), [`escalation-hygiene-runner`](../../../apps/web/lib/quality/escalation-hygiene-runner.ts), [`option-scoring`](../../../apps/web/lib/decision/option-scoring.ts), [assurance P3 auto-resolve `finding-persistence`](../../../apps/web/lib/assurance/finding-persistence.ts) (BI-4D5C702F, the mirrored pattern). |

---

## 1. The finding — two defects make the band read as noise

The `/ops` escalation band surfaces builds Build Studio could not self-repair (`PlatformIssueReport` rows, `type=build-stall-escalation`, born `awaiting_escalation_ack` via `escalateBuildToHuman`). Two defects, found in code, make it read as undifferentiated noise:

**(a) The WWMD consult is degenerate.** Each card ran `principle_decide` ("WWMD") on a `resume / defer / escalate-human` decision and rendered the result. That decision has **no kernel principle that carries its axis** — it is an operations judgement, not a values trade-off — and the escalation options are passed with no structured feature vector. So `buildOptionScores` finds nothing to grip on: every option's `composite` is `0.000`, the `margin` is `0.000`, confidence is forced `low`, and the reasoning is always *"Recommends resume … margin below tieMargin (0.2); recommend human review."* Because all contributions tie at zero, the "strongest contributors" are just the first two principles in retrieval order (the highest-weight commandments — `All Changes Land via PR Against Main`, `Always respect open-source license terms`) — **identical and decision-independent on every card**. Re-consult re-runs the same deterministic dead end. This is the same degeneracy class already documented for the unscorable `human_cognitive_load` axis: forcing a non-values decision through the kernel produces theater.

**(b) The band never cleans itself.** `escalateBuildToHuman` has a create path but there is **no clear path**. An escalation lingers in `awaiting_escalation_ack` forever — even after its underlying work shipped, was dropped, or was re-attempted under a new build. (Note: the escalation itself marks the build `abandoned` and parks the originating item `deferred`, so neither "build abandoned" nor "item deferred" is a staleness signal — both are the *normal held state*.) This is the identical create-only gap the assurance lane closed in `BI-4D5C702F` (a finding lingers because persist only ever touches findings *present* in a scan).

Net effect: a few genuinely-needs-a-human items are drowned among lingering ghosts, each wearing the same useless 0.000 recommendation. The band fails its one job — being a trustworthy "here is what actually needs you" queue.

## 2. Decision

Keep the receiving loop's **intent** from the 2026-06-20 design (attend escalations in the one operator surface; don't silently convert them to evidence). Replace the broken **mechanism**.

1. **Honest context, not a kernel verdict.** The card drops the `principle_decide` consult and renders what the operator actually needs to decide: the top unresolved blocking issue (or the what-was-attempted line), already captured in the report `description` by `formatEscalationReport`; the self-fix class; and the originating `BI-*` id + status for legibility. A manual **Dismiss** resolves a report the operator knows is handled. `principle_decide` / `evaluateBuildStudioDecision` are untouched and remain in use for build plan review — only the escalation-specific wiring is removed.
2. **Conservative auto-resolve.** A pure selector (`selectResolvableEscalations`) resolves an escalation only when its originating work is provably no longer a pending decision: originating `BacklogItem.status = done`, or `triageOutcome ∈ {discard, duplicate}`, or `FeatureBuild.supersededByEpicId` set (decompose approved), or a newer open escalation exists for the same originating item. Everything still `triaging/open/in-progress`, or `deferred`-and-still-wanted, is kept. Resolving sets `status=resolved_locally`, which frees the per-build `dedupeKey` (partial-unique on non-resolved rows) so a genuine re-stall re-files. Runs in the existing 15-min `issue-report-triage` cron and best-effort at `/ops` render (idempotent; zero writes once converged) so ghosts clear without waiting.

## 3. Why not just fix the plumbing so WWMD scores non-zero

Even with embeddings restored, scoring `resume/defer/escalate` by semantic similarity of option prose to principle direction-text is weak signal whose margin would almost always fall below `tieMargin` → "ask a human" anyway. The honest, higher-integrity move is to stop asking the values kernel an operations question and show the human the facts instead. If a future need arises to have WWMD adjudicate escalations, it must first be given structured features that map a blocker to principle dimensions — a deliberate, separate piece of work, not a default.

## 4. Out of scope / follow-ups

- The `responderDecision` / `responderDecidedAt` columns are left in place (unused, harmless) rather than dropped in a migration.
- Tuning the **escalation rate** itself (why N builds reach the ideate/plan gate) is a separate question from making the queue legible; not addressed here.
- Full autonomous build disposition (execute authority) named as the remaining dial-up in the 2026-06-20 design is **withdrawn** for escalations on this evidence: there is no governed score to gate it.
