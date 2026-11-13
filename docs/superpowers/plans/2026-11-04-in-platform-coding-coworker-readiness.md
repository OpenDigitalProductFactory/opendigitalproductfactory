---
status: active
---

# In-platform coding coworker readiness

**Epic:** EP-INPLATFORM-CODING. **Backlog:** BI-408A74F2. **Workroom:** WC-40B1B7A6.
**Status:** plan; dated estimates, not commitments. Re-baseline at each milestone review.

## Why

On 2026-11-04 the owner set the goal: "moving your presence into the platform itself rather than on the outside … with subscription level pricing to maintain productivity at reasonable costs … Once under the workroom design this sort of rogue behavior should never be possible due to workroom boundaries, shapes, GPP and a built up corpus and steerage in place." He then asked, "I need to know when this switch can happen", and added: "we need to get enough of the self improvement and proactively in place too", and "Better tools would allow you to do more work with precision tools rather than basic tools."

The 2026-11-03/04 thread on PR #6869 is the baseline evidence. The external coding agent designed, built and pushed while its workroom sat on its first stage. It decided a budget design without the portfolio or architecture experts. Routine actions fell to the owner's inbox: five approvals in one night, one of which held an emergency fix for over seven hours. A per-agent budget halted every PR.

## Milestones

All dates are US Central. They assume two to four parallel delivery sessions, review and merge throughput at least as good as on 2026-11-04 once M0 lands, and no new production halt. Every milestone ends with a go/no-go review against its criteria. A miss moves the dates; it does not lower the bar.

### M0: Unblock (Wed 4 to Fri 6 November)

| Item | What | State on 4 November |
|---|---|---|
| BI-F3B6713F / #6869 | Meter only paid spend; owner allowance; plain "allowance used" | Built; waiting on the workroom handover approval |
| BI-88D51B8F / #6888 | Freeing a stale, ended or own test-machine lease needs no approval | Merged |
| BI-F1FC0B62 / #6902 | Same-scope handover is request then acknowledge, with no approval | In the merge queue |
| BI-B05C3C39 / #6876 | Profession rulings: scope-placed controls, portfolio budgets, same-scope handover | Merged |
| BI-572A37DA / #6903 | Kernel: expertise compounds in profession coworkers | Reviewed; merging |
| Production upgrade | `request_self_upgrade` carrying the above | After #6869 and #6902 merge |

**Go criteria:** all of the above are live on production, and no routine action of these kinds reaches the owner's inbox for 48 hours.

### M1: Pilot prerequisites (Mon 9 to Fri 13 November)

| Item | What |
|---|---|
| T3 Code trial | First recorded runtime trial (the 2026-09-04 review was code reading only). Run one delivery-small item end to end inside a workroom on the subscription, recording cost, latency, plan-capacity use and failure behaviour. Result (2026-11-12): [trial record](../research/2026-11-12-t3-code-runtime-trial.md): reached a gated PR, not merged; blockers are platform-side |
| BI-FC94F754 | Coding sensitivity by repository visibility, so open-source platform code is not confidential |
| BI-F98BBE4F | Subscription effective-cost estimator v1: monthly fees recorded; cost per unit = fee ÷ observed usable capacity; reset-aware; hourly recheck and immediate re-enable verified |
| BI-F039D17A | Corpus and vectors converge on update: re-embed on content change, profession corpus included |
| BI-218A4555 / BI-995E9530 | Test-machine overseer v1: policy-ordered queue, bounded preview holds, fair share, reviews not starved |

**Go criteria:** the T3 trial completes one item without leaving its workroom, and its cost per unit has an estimate. Coding work can route to every provider cleared for public data. Changed corpus pages show fresh vectors after an upgrade. No test-machine hold exceeds its class bound while others wait.

### M2: Pilot (Mon 16 to Wed 25 November)

One in-platform coding coworker, on subscription, handles delivery-small items only, inside workrooms.

- **Precision tools, first slice of BI-3E2B7A96.** The pilot gets a named, workroom-bound toolset: read and search source, edit inside its worktree, run scoped tests, run the gate, record evidence, open a PR. Each tool is covered by a focus-area GPP binding resolved by its owning scope (WSID software-engineer and devops-platform). There is no general shell. A tool the pilot lacks is filed as a tool gap, not worked around.
- **Permissions follow tool use.** The owner said: "Many are because of GPP. A permission ties to using a tool. Some tools may be more common than others." So bindings are sized by how often a tool is used and how consequential it is:
  - Common, low-consequence tools (read, search, edit in the worktree, scoped tests, recording evidence) get standing bindings for the whole workroom mandate.
  - Rarer or consequential tools (opening a PR, claiming shared capacity, schema change, anything outward or irreversible) get narrower bindings, admitted by their owning expert's decision.
  - Usage counts from the pilot set which tools move between those tiers.
- **Budgets.** The pilot's use is attributed through workroom → item → epic → portfolio, in dollars at the estimated effective cost and in plan capacity (BI-7138C61B, first slice).
- **Measures, published weekly:** items merged, lead time, cost per merged item, approvals that reached the owner (target: zero routine), stages skipped (target: zero) and tool gaps found.

**Go criteria for widening:** two weeks with no stage skipped and no routine approval reaching the owner. Cost per merged item is at or below the external-agent baseline measured in M1. Every tool gap is filed.

### M3: Full-switch guardrails (Mon 30 November to Fri 11 December)

| Item | What |
|---|---|
| BI-3E2B7A96 | One GPP binding per focus area, resolved by WWMD, WWWD or WSID; the human checkpoint only for the uncovered or damaging. Core set: workroom coordination, nonprod capacity, source change, schema, UI, spend |
| BI-4E32AD28 | Work shapes derive expert stages from the change; experts score with their own profile; decisions are linked to the work |
| BI-7138C61B | Portfolio-level budgets, including subscription capacity; worker caps become signals; mandatory checks are never refused |
| BI-C6007CB0 | Decision learning loop v1: reviewed outcome → corpus and weightings, as knowledge, not memory |
| BI-8A61CD7F | Continual improvement as a platform operation: each work shape carries an improve activity |
| BI-B8D3FB9D | WWMD and TAK stewardship seeded, with origin installs |
| Proactivity | Confirm that the proactive workroom drive (spec 2026-08-29, all six plan items done) wakes in-platform coworkers for their own stages instead of parking them on `role:author` (BI-8A32EBFF) |

**Go criteria:** a sample of ten consecutive delivery items runs with expert stages and receipts, per-area bindings admit every routine action, at least one decision outcome has fed back into a profession corpus page, and the owner's inbox receives only genuinely ungoverned or damaging requests.

### M4: Switch (go/no-go Mon 14 December; switch that week)

In-platform coworkers become the default delivery executor for platform work. External sessions remain an emergency fallback under the same workroom and GPP rules. The pilot measures continue, and the plan is re-baselined from them.

## Risks

- **Throughput.** Every slice needs a review and a merge; a new gate outage moves every date. M0 removes the known blockers, and BI-218A4555 addresses the rest.
- **T3 Code is unproven here.** If the M1 trial fails, the pilot moves to the best qualified in-platform harness. The guardrail milestones do not depend on T3.
- **Estimator precision.** Reset generosity makes subscription cost an estimate with a confidence band; budgets act on the band, not a single number.
- **Scope creep.** Each milestone admits only its listed items; anything new is filed under the epic and scheduled at the next review.

## What this does not claim

No milestone is started by this plan, none of the dates is a commitment until its prerequisites land, and no pilot or switch result exists yet.
