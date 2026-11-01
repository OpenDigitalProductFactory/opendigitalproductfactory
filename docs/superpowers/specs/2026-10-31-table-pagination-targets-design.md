# Shared table pagination targets

Status: Approved direction; verification pending
Date: 2026-10-31
Backlog: BI-7E3BDE16
Workroom: WC-88E3C250

## Problem and objective

Operators paging routing Evaluation encounter Next at 40.25×21px and disabled Prev at 39.125×21px. Root observed this on canonical DEV `047c2fb055d392ee02d9ebc1b007429ad0cda7fd`, across 320/390/1280 widths in light and dark. Original routing BI-2BBD9D34 records `ux_fail` activity `cmvx8x6ge05r001ns5g8sss2g`.

Make both controls at least 44×44 CSS pixels through the existing shared DataTable. This benefits every paginated DataTable consumer while preserving its sorting, paging, data, labels and disabled semantics.

## Design grounding

Reuse [report-kit design](../../specs/reporting-ux-primitives-spec.md), its `DataTable` presentational boundary, [usability standard C5](../../platform-usability-standards.md#common-shell-action-result-contract), and the [portal UX spine](../plans/2026-05-26-portal-ux-simplification-spine.md). The canonical source is `apps/web/components/ui/report-kit/DataTable.tsx`; no route-local pager is introduced. The primary persona is the operator on a phone; these are contextual paging actions, with no new navigation layer.

The [interactive comparison](../../ux-fit/2026-10-31-table-pagination-targets.prototype.html) was created before implementation. At 320px in light/dark, browser geometry measures its proposed controls at 44×44, with no horizontal overflow; Next advances to page 2 and changes the disabled state. This is a standalone prototype, not served-portal acceptance. Its compact-control widths differ slightly because the prototype font is not the portal font.

WWMD `DI-E746B2B56F67` recommends `extend-canonical-pager` over `route-only-pager`, high confidence. Extending the existing primitive avoids a second navigation implementation. The Critic has not reviewed this repair: the existing Critic service repair remains separate, and an independent exact-source review will be cited separately.

## Research and reproduction

On source `f794efb2aebbf516955fd83014bf1183e5ee6b7a`, blob `fdc4f425b5e4e156fe4b07abeb2ba8c7f763752f`, lines 254 and 262 set small padding without minimum dimensions. The same source appears in the observed live failure. Successful page 1→2 action rules out broken paging; failure in six viewport/theme contexts rules out a single viewport/theme effect; enabled and disabled controls both fail, ruling out disabled-only styling.

The DPF design intelligence touch rules recommend minimum 44×44. [W3C SC 2.5.5 Target Size Enhanced](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) also specifies 44×44; this is the enhanced AAA criterion, distinct from the 24px AA minimum. Adopt the existing 44px project target. This is a mechanical defect repair, not a new feature or component-library selection.

The code graph returned ready with no linked tests for DataTable. Use its colocated functional tests plus a bounded caller/test search, not a claim that no tests exist. The rendered geometry is the first failing proof. Do not add class-string assertions that merely restate the utility change.

## Ordered implementation plan

This document is the canonical ordered fix design and plan for implementation parent BI-7E3BDE16. One atomic deliverable, `pager-targets`, owns both buttons and its verification. No phase is independently useful without the shared correction.

1. Record current reproduction and claim the existing DataTable path; consume the impact contract before editing.
2. Add existing `min-h-11 min-w-11` utilities to both pager buttons. Preserve all props, event handlers, counters and disabled conditions.
3. Run colocated DataTable behavior tests, affected tests/guards and web typecheck. Run the exact-tree governed gate and independent code review; publish a DCO PR through the protected queue.
4. After a containing canonical release, root remeasures actual routing Evaluation controls at 320/390/1280 in light/dark, tests page movement and disabled boundaries, and supersedes the recorded UX failure with fresh evidence. Source/prototype checks do not establish this result.

## Acceptance and boundaries

- Both pager controls have at least 44×44 CSS pixel targets, including disabled states.
- Paging, sorting, page boundaries and labels retain existing behavior. Verify no horizontal overflow in the six routing contexts above.
- Existing theme tokens continue to own colors; no new API, data model, provider, inference, policy, lifecycle or route behavior.
- No migration, user configuration or data-retention change. An ordinary release delivers the compatible CSS correction; this workroom does not advance the installed runtime.
- Operator instructions remain accurate: controls retain their labels/actions. No user-guide change is needed for a pure hit-area correction.

## Verification status

RED: live targets below 44×44, as recorded above. Prototype: 44×44 at 320px light/dark, paging works, no horizontal overflow. Source tests, gate, review, merge and containing-release live verification remain separate evidence; none is implied by this design.

