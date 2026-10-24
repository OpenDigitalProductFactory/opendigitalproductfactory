---
status: active
title: Portal UX simplification thread audit
---

# Portal UX Simplification Thread Audit

| Field | Value |
| --- | --- |
| Date | 2026-09-06 |
| Thread outcome | Closeout audit plus execution packet |
| Workroom | `WC-1183CC5B` |
| Backlog item | `BI-436A9466` |
| Epic | `EP-4FF5273F` |
| Source ref reviewed | `origin/main` at `6c47df32889` |
| Prior implementation evidence | PR #5091, merge commit `874fc01f1e47b0e0e675868a5f338564bfb8416c` |
| Delivery recommendation | WWMD decision `DI-6E3E979EC8CE`: `auditable-packet-plus-slices`, confidence high |

## Executive Verdict

The thread has delivered a real foundation, but it should not be called fully
delivered in the live platform yet.

Delivered in source:

- The shape-graph `delegate` step role landed through PR #5091 and is present in
  `apps/web/lib/ea/interaction-shape.ts`, `navigation-extract.ts`, and their
  focused tests.
- The May portal UX simplification spine remains the right organizing document.
- The Pipedrive CRM/marketing slice has been reconciled into the current
  Business > Customer direction; Slice 1 is historical, while remaining CRM
  agentic operations are tracked separately.

Not yet closed:

- Live served verification was not closed during this review. Earlier preflight
  for the PR #5091 feature SHA returned `MUST-ADVANCE`, and the self-upgrade UI
  showed an update available. The correct next move is the sanctioned
  self-upgrade path, then a fresh `CAN-TEST`/served-SHA verification.
- The broad UX objective is larger than one implementation slice. The visible
  UX simplification work now has backlog handles, but it still needs PR-sized
  implementation slices with runtime evidence.

## Evidence Reviewed

- Source route inventory on `origin/main`: 367 `page.tsx` routes and 652
  page/API route files.
- Largest page-route families: `/platform` 86, `/finance` 53, `/admin` 34,
  `/compliance` 25, `/s` 19, `/portfolio` 19, `/storefront` 18, `/ops` 15,
  `/workspace` 14, `/customer` 14, `/coworker-decisions` 13, `/portal` 11, and
  `/ea` 10.
- Committed UX route-budget baseline covers 205 measured routes.
- Current measured examples from that baseline: `/platform/ai/overview` has
  3,048 default visible words; `/workspace/documents` has 111 default visible
  words, 2 primary actions, 4 visible fields, and 3 axe violations.
- Navigation source still carries mixed labels that affect memory: shell
  sections are Workspace, Business, Products, Delivery, Platform, and Knowledge;
  the nav model also includes `People`, `Portal`, `Backlog`, `Delivery`,
  `Platform Hub`, and `Knowledge`.
- Existing May audit evidence remains material: `/workspace` behaved like a
  dashboard plus site map, empty states lacked consistent next action, coworker
  transcript/provider failures damaged trust, and Platform AI had conflicting
  grant/governance readouts.

## Main Findings

1. **The source foundation is real but not the user outcome.** PR #5091 fixed a
   key substrate problem: delegation no longer makes a human flow look more
   expensive. That supports future simplification, but it does not by itself
   make `/workspace` easier to use.
2. **The platform has outgrown recall-based navigation.** A 367-page route
   estate makes a shell taxonomy alone insufficient. The UX must show the next
   useful action by persona and work object, not rely on the user remembering
   where a concept lives.
3. **Workspace is still the first simplification target.** It is the daily entry
   point, and the May audit plus current source shape still indicate too many
   adjacent choices, too much launcher behavior, and not enough "what needs me
   now" prioritization.
4. **Trust failures are UX failures, not only provider/runtime bugs.** Prompt
   leakage, repeated provider-unavailable turns, and conflicting AI workforce
   counts break the user's confidence even when the underlying platform is doing
   technically honest work.
5. **Business-area vocabulary is still teaching the wrong model.** `People`
   landing on Employee and `Portal` landing on internal Storefront management
   makes users remember implementation history instead of business meaning.
6. **Empty states need one reusable decision grammar.** Documents, Compliance,
   Knowledge, Architecture, and similar fresh-install surfaces should converge
   on create/upload/connect/import/configure/unavailable decisions rather than
   repeating isolated zero-state panels.
7. **Pipedrive/CRM work fits only as Business > Customer.** The "Pipedrive"
   framing remains research language. Product copy and navigation should stay
   DPF-native and avoid global AppRail, Workspace, Platform, or customer-facing
   `/portal` leakage.
8. **Feature fit must become a standing gate.** Incoming UI work must name owner
   area, route family, primary persona, nav layer, component convergence, source
   truth, empty/failure state, AI boundary, and verification evidence before it
   adds another surface.

## Backlog Mapping

| Outcome | Backlog item | Status at audit |
| --- | --- | --- |
| Closeout audit and execution packet | `BI-436A9466` | In progress |
| Shape-graph `delegate` substrate | `BI-5A1A3C13` | Source merged in PR #5091; backlog closeout still needs governed evidence reconciliation |
| Workspace first-viewport simplification | `BI-971D6F22` | Open |
| Workspace coworker trust boundary | `BI-36A2CF08` | Open |
| Business navigation terminology alignment | `BI-1F0B4184` | Open |
| Empty-state orchestration pattern | `BI-CEB3FDF8` | Open |
| Platform AI grant/governance source truth | `BI-FFCE0D22` | Open |
| CRM marketing agentic operations follow-on | `BI-D8E00326` | Existing follow-up |

## Review Questions For Circulation

Ask the 10-person review group to comment in this shape:

```text
Finding or slice:
Persona:
Route(s):
Concern:
Evidence needed:
Recommendation: accept / change / defer / reject
```

Specific questions:

1. Does the sequence start in the right place, or should coworker trust move
   ahead of Workspace layout?
2. Are the founder/operator, dispatcher/scheduler, worker, platform operator,
   and external customer personas enough for this pass?
3. Which terms still feel like platform internals rather than the user's work?
4. Which empty states make a fresh install feel broken?
5. What live evidence would convince the group that a slice is actually done?

## Definition Of Done For This Thread

This thread is delivered when:

- The closeout audit and execution plan are merged through a DCO-signed PR.
- The current live install has advanced to a served SHA containing PR #5091, or
  the remaining self-upgrade blocker is recorded explicitly.
- Each accepted important UX finding maps to a live backlog item, a planned
  slice, or an explicit defer/reject decision.
- The next implementation worker can start one BI, one branch, and one PR
  without re-reading the entire history of the thread.
