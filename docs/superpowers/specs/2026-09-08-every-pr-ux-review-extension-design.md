---
status: draft
---

# Every-PR UX review: L4 implementation extension

Parent design: [Holistic UX system](2026-07-22-holistic-ux-system-and-agent-codification-design.md), L4. This focused extension owns only BI-D543F934; the parent remains authoritative for the wider system.


Backlog: **BI-D543F934**. Status: proposed; independent review and implementation
remain pending. This design extends L4 only. Historical findings in the parent retain
their original dates. The accepted criteria live in the
[portal UX evaluation framework](../../architecture/portal-ux-evaluation-framework.md)
(merged PR #5233); this section specifies their enforcement transport.

### Objectives and acceptance

**OBJ-UX-CLASSIFY:** Every PR produces one explicit UX-impact result, including
indirect effects and removal of existing UI.

**OBJ-UX-EVIDENCE:** Affected work carries versioned, persona-specific evidence
for all ten criteria; missing evidence cannot masquerade as a successful review.

**OBJ-UX-IMPROVE:** Refactoring proves a bounded improvement and preserves known
debt without silently resetting the baseline.

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-UX-01 | OBJ-UX-CLASSIFY | The existing UX-fit CI gate evaluates every changed path and emits affected, no-impact, or unknown; unknown fails with the unresolved paths. |
| AC-UX-02 | OBJ-UX-CLASSIFY | Backend, permissions, prompts, workflows, shared dependencies, CSS and removed UI cannot bypass review because they contain no added TSX copy. Pure documentation/test changes produce source-backed no-impact output. |
| AC-UX-03 | OBJ-UX-EVIDENCE | A changed version-2 UX-fit manifest covers each affected path and identifies affected routes or components, persona, archetype, state, source revision, served revision and graph revision or a concrete graph-unavailable reason. |
| AC-UX-04 | OBJ-UX-EVIDENCE | Each of the ten named framework criteria carries evidence or a concrete not-applicable reason. Affected rendered behavior requires sweep evidence and a linked task exercise; propose-n-pick alone fails. |
| AC-UX-05 | OBJ-UX-EVIDENCE | The validator rejects stale scope, unsupported versions, non-finite measurements, missing rendered evidence and unknown impact. It reports structural validation separately from semantic review. |
| AC-UX-06 | OBJ-UX-IMPROVE | New regressions fail; touched legacy debt identifies the improvement or an owned BI follow-up; unrelated debt remains attributed to its original scope. Refactoring declares before/after measures and at least one verified improvement. |
| AC-UX-07 | OBJ-UX-IMPROVE | Ratchet comparison uses the base revision's budget, so changing the budget in the PR cannot conceal regression. Deliberate budget changes require explicit rationale and review evidence. |
| AC-UX-08 | OBJ-UX-CLASSIFY | Permanent fixtures exercise backend-only UX, docs-only no impact, shared consumers, UI removal, missing/stale evidence, intentional baseline changes and legacy debt. An end-to-end synthetic diff proves the CI entry point uses the validator. |

### Research and benchmarking

Reuse the parent design research in sections 5 and 6: Carbon lint provides deterministic
component constraints, Playwright ARIA snapshots preserve rendered semantics,
and axe supplies accessibility rule findings. Adopt their separation of checks
with reproducible evidence. Reject treating a clean lint or accessibility report
as proof of task success. Existing source anchors are
`scripts/check-ux-fit-decision.mjs`, its `.test.mjs` suite,
`scripts/lib/gate-sensitivity.mjs`, the route sweep and committed UX budget.
No new service, component library, graph store, scanner or dashboard is needed.

The framework's recorded WWMD direction is to extend existing purpose contracts
and use graph-guided rendered sampling. Source-only review cannot show layout or
interaction; a full manual crawl on every PR does not scale. The hybrid keeps
cheap deterministic checks on every diff, affected-flow browser verification,
and semantic review of the evidence against the criteria. Numerical proxies do
not certify design quality or replace the separate judge calibration in L6.

### Transport and classification

Extend the existing `*.ux-fit.json` envelope to version 2. Preserve version-1
parsing for historical fixtures and readers, but require version 2 for new
affected-change evidence after rollout. Keep one gate entry point and reuse the
existing measurement validators; factor pure validation helpers only when needed.

Every changed path is accounted for. A narrow allowlist may classify prose,
test-only and generated documentation changes as no-impact with the matched
rule in output. Shared code, configuration, dependencies and generated runtime
assets default to unknown, never silently no-impact. A submitted no-impact
classification includes a source-backed reason for each unresolved path;
semantic review judges that claim. The existing direct UI detector is a floor:
an author cannot mark its positive result no-impact. Removed controls, style
changes and route removals also count as direct impact.

Version-2 evidence extends `scope.files` and the existing `evidence` measurement
fields with impact classification, consumer mapping, review context, criterion
results and debt disposition. Validate closed disposition values and nonempty
reasons. Scope must be in the current diff. The source revision identifies the
code measured, so an evidence-only commit need not claim it measured itself;
verify ancestry and reject intervening changes to covered source paths. A served
revision differing from the measured source requires explicit equivalence proof,
otherwise it is unresolved. Graph data is advisory discovery, not runtime proof.

Render findings retain route, viewport and state keys. The ten criteria are
referenced by stable names from the framework. A result is observed or source-
verified, or explicitly unknown/not-applicable; estimates never satisfy a
measurement. The gate validates the evidence contract and committed budget.
Independent semantic review evaluates whether the evidence supports the claimed
outcome. CI must not label structural success as an automatic design approval.

### Improvement, rollout and rollback

Use the parent revision's route budget for regression checks. Keep full-page and
first-viewport counts distinct. Record removed duplication, consumers migrated
and setup/failure burden for consolidation; hiding detail alone is not structural
consolidation. A refactoring result needs a comparable before/after improvement
with no unexplained regression. Touched debt may cite an owned follow-up, but a
new regression cannot be waived by filing debt. Preserve necessary diagnostics
behind persona-appropriate disclosure and retain permission boundaries.

The program allocation remains 80% refactoring/consolidation and at most 20%
justified net new. This gate extension is bounded supporting work. The measured
runtime refactoring pilot belongs to existing BI-971D6F22 and its own PR; it is
the program acceptance exercise, not additional implementation hidden in this BI.

Roll out the transport, classifier, fixtures and contributor instructions in one
revertible PR so readers and writers agree. Run the current gate suite plus the
new synthetic-diff tests and required cloud checks. Do not weaken existing UX
protection during rollout. Revert the gate extension as one unit if classification
blocks valid work incorrectly; preserve evidence artifacts and filed debt. No
database migration or live-install configuration change is required.
