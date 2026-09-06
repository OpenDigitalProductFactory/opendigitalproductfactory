# Portal page / flow scorecard template

Copy into the slice's audit artifact. Method and scoring anchors:
[portal evaluation framework](../architecture/portal-ux-evaluation-framework.md).
Replace every placeholder; use U for unmeasured and N/A with a reason.
Do not put proposed values in observed columns.

## Identity and purpose

- Audit ID / date / reviewer / BI / Workroom:
- Source SHA / served SHA / install and readiness evidence:
- Route or flow / canonical home / owning area:
- Primary persona / actual permissions / archetype / locale:
- Fixture reference, configuration and data volume:
- Trigger -> job -> meaningful outcome:
- Start route / expected route sequence / completion oracle:
- False success conditions (for example, prompt sent but work not done):
- Current source-of-truth service/read model and freshness:
- Navigation: global / section / local / filters / contextual command:
- Workroom relevance: none / summary / linked room / detail; reason:
- Current default content / deferred content and trigger / diagnostic audience:
- Viewport / zoom / theme / input method / default disclosure state:
- Measurement tool/version and scope / DOM settlement or timeout:
- Predeclared task targets and why / comparison fixture parity:

## Measures

One row set per viewport and scenario; do not merge mobile and desktop results.

| Measure | Before observed | After observed | Estimate or target (label it) | Evidence reference / verdict |
| --- | --- | --- | --- | --- |
| First-view clarity: job, attention, next step (0-3 correct) | U | U | | |
| Default visible words / separate viewport-only words | U | U | | |
| Canonical shell budget / lead-band words | U | U | | |
| Visible choices: shell / task / disabled | U | U | | |
| Primary actions / fields / max choices per control | U | U | | |
| Action above fold / scroll pixels / clicks or taps / route changes | U | U | | |
| Pointer distance and start / keyboard focus stops | U | U | | |
| Nav layers / repeated-intent pairs / return-state preserved | U | U | | |
| Leakage occurrences / distinct values / justified exceptions | U | U | | |
| Items inspected / items exposing unnecessary internals / unnecessary details | U | U | | |
| Duplicate surfaces/components/projections retired / consumers migrated | U | U | | |
| External dependencies / setup steps / failure points retained or removed | U | U | | |
| Time to useful action / outcome / separate load and provider wait | U | U | | |
| Workroom depth / parent return / blocking child / evidence freshness | U | U | | |
| AI preview / confirmation / receipt / safe retry | U | U | | |
| Empty / loading / failure / permission / not-applicable | U | U | | |
| Mobile overlap/overflow / zoom/reflow | U | U | | |
| Axe findings / keyboard / focus / labels / announcements / contrast | U | U | | |

## Rubric

| Dimension | Before 0-3/U/N/A | After 0-3/U/N/A | Evidence and remaining harm |
| --- | --- | --- | --- |
| Outcome orientation | U | U | |
| Persona/archetype fit | U | U | |
| Progressive disclosure | U | U | |
| Time/distance to action | U | U | |
| Cognitive load | U | U | |
| Data model leakage | U | U | |
| Workroom relevance | U | U | |
| AI context/trust | U | U | |
| Navigation | U | U | |
| State quality | U | U | |

## Task and state evidence

| Scenario | Start and fixture | Expected outcome / prohibited behavior | Actual result | Receipt, trace or screenshot |
| --- | --- | --- | --- | --- |
| Primary populated task | | | Unmeasured | |
| Returning user / changed work | | | Unmeasured | |
| Fresh install | | | Unmeasured | |
| Loading / partial or stale data | | | Unmeasured | |
| Failure and retry | | | Unmeasured | |
| Permission-limited / unauthorized attempt | | | Unmeasured | |
| Not applicable yet | | | Unmeasured | |
| Parent -> child -> evidence -> return | | | Unmeasured | |

## Disposition and refactoring

### Item-detail and dependency inventory

| Item / field / control | Persona need now | Current exposure | Keep / summarize / disclose / operator-only / merge / remove | Canonical owner and acceptance proof |
| --- | --- | --- | --- | --- |
| | | | | |

| Dependency or duplicate implementation | Job and consumers | User setup / failure burden | Retain / consolidate / replace / retire and rationale | Migration, verification and rollback |
| --- | --- | --- | --- | --- |
| | | | | |

- Blockers, including unmeasured safety/task scenarios:
- Evidence coverage: observed / source-verified / estimated / proposed:
- Fit verdict: fits / fits-with-guardrails / defer / reject:
- Runtime verdict: passed / failed / inconclusive / not run:
- Finding -> user harm -> existing BI -> bounded PR slice:
- Reuse choice / exact duplication to remove / compatibility and rollback:
- Effort allocation: planned 80% refactoring/consolidation, at most 20% net new; actual effort in both categories and variance rationale:
- Net-new gap that existing capability cannot satisfy; evidence reuse/refactoring is insufficient:
- Removed item-level internals, retired duplication and dependency burden (not merely hidden):
- Required edits, accountable owner and review trigger:
- Gate/UX-fit manifest and canonical Workroom evidence references:
- Participant results (individual attempts, assistance, timing, order); or human evidence pending:

No aggregate score can waive a blocker. Screenshots prove layout at the captured
state; task completion and data/action boundaries need their own evidence.
