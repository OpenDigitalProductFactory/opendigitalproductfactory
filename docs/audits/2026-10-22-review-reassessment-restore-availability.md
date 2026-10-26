# Recovery availability on the self-upgrade page

BI-7906C73E · WC-A5703D01 · PR #6546

## Finding and approved scope

At commit `314303f93940cfbd0404c3cb5e12eb5254985d06`, the page treated a complete saved recovery point as permission to restore. The owner card promised reversibility and the client offered a Restore form. The approved R4 implementation instead refuses canonical database restoration before effects until retained allocations, histories and fences can be proven. An independent deployment-page audit confirmed the mismatch.

The refusal implements the approved baseline `baseline-d22ae46a-b22c-4708-9ba7-f7932e81b628` and implementation admission `IRD-873FD21E6421`. This addendum makes its visible consequence accurate. It does not amend the immutable design, add a retention-proof input, grant permission, or widen the broader trusted-admin boundary.

The previous-version image fallback is conditional and does not establish availability of saved database recovery-point restoration. The page must not promise automatic recovery for every failure.

## Prototype and fit decision

The [working prototype](../ux-fit/2026-10-22-review-reassessment-restore-availability.html) was authored before this plan. It compares:

1. Show the unavailable reason, retain the saved backup/history record, and omit the unusable Restore and confirmation controls.
2. Show the same reason while retaining both controls visibly disabled.

WWMD interaction `DI-CC66F745BF49` selected option 1 with usable, high-confidence, autonomy-eligible signal. The comparison cites the actual prototype and accounts for the cognitive cost of zero versus two unusable controls. Earlier interaction `DI-74508F80847D` abstained because malformed locator fields caused evidence features to be dropped. It is historical abstention evidence, not a ruling.

**UX fit review — recovery availability**

- Decision: fits with guardrails.
- Owning area and route: Platform, existing `/ops/self-upgrade`.
- Persona: the operator deciding whether to install a release and assessing recovery.
- Navigation: existing contextual action; no added route, tab or page home.
- Reuse: existing owner release card, risk notice and saved recovery/history presentation.
- Source truth: the existing recovery-eligibility owner, freshly loaded run evidence and the same server restore guard.
- Empty and failure behavior: distinguish missing, malformed, failed, in-progress and historical recovery evidence; display unavailability rather than offer an action that will refuse.
- AI boundary: the page does not start a coworker. Advisory critique `CE-7F4B1050` was requested through the UX design critique service; a request is not a delivered critique.
- Evidence: the [fit manifest](../ux-fit/2026-10-22-review-reassessment-restore-availability.ux-fit.json) carries the recorded two-option choice. Source and served verification remain required.

## Implementation plan

1. Extend the existing browser-safe recovery-eligibility owner with shared recovery-point parsing and restore availability, a stable reason code and operator wording. Retain the existing predecessor predicate. Accept no caller-supplied flag that can enable restoration.
2. Consume that policy from the freshly loaded rollback run before backup reads, locks, runners or writes. Preserve fail-closed behavior and its existing refusal identity.
3. Use the same policy in the server owner summary and the client's current live snapshot. Keep saved backup/history evidence visible; explain unavailable restoration and omit its unusable form. Qualify previous-version fallback wording.
4. Add meaningful regressions for complete saved backups, missing/malformed/failed points, running runs, historical successful rollback, forged retention fields, live snapshot changes and zero restore effects.
5. Keep the operator guide consistent with unavailable database restoration and conditional previous-version fallback.

The source scope extends existing owners; no endpoint, table, runtime substrate, grant or budget policy is added. The two authorized parent reassessment candidates remain separate from this source repair.

## Verification and publication

### Task and scorecard contract

When an operator reviews a proposed upgrade or its recovery history, they need to distinguish a saved backup from an available restoration action so that they can judge the upgrade's consequence accurately. Start and finish on `/ops/self-upgrade`; the completion oracle is an accurate unavailable explanation with the saved evidence still reachable and no unusable Restore form. An apparent restoration success, an unconditional automatic recovery promise, or a caller-supplied proof enabling restoration is a failure.

Use the existing platform operator permission and install fixture, en-US, with the owner card and advanced recovery/history disclosure. This informational recovery decision needs no Workroom embedded in the page and starts no AI work. Keep release orientation and the existing upgrade action visible; recovery evidence remains operator diagnostics under its existing disclosure. No new navigation home is introduced.

Record the before/after scorecard in the Workroom with exact source and served identities. A source comparison, prototype rendering and the older canonical install are separate evidence classes; none may be relabeled as a served comparison at the proposed source. Human comprehension and timing remain unmeasured unless actual participants are available.

| Applicable dimension | Baseline evidence | Before observed score | After observed score | Predeclared acceptance target |
| --- | --- | --- | --- | --- |
| Outcome orientation and state quality | Source at `314303f9` offers restoration despite the authoritative refusal | U | U | Same saved evidence, explicit unavailability, no false action or universal recovery promise |
| Persona fit, cognitive load and disclosure | Existing owner card, risk notice and recovery/history area | U | U | Existing orientation and upgrade action remain reachable; omit two unusable restore controls |
| Navigation and time/distance to decision | Existing route and disclosure | U | U | No extra route changes; reach recovery reason through its existing disclosure |
| Data model leakage and dependencies | Duplicate client recovery-point parser and existing shared owners | U | U | One browser-safe policy/parser; no new runtime dependency or irrelevant detail |
| Workroom relevance | No room needed for this operator decision | N/A | N/A | Keep work identity and delivery evidence in the owning Workroom |
| AI context and trust | This page does not start AI work | N/A | N/A | No new AI action or hidden effect |

Before merge, collect a representative browser task and adverse-state/permission checks, mobile and manual accessibility evidence under the [evaluation framework](../architecture/portal-ux-evaluation-framework.md). Freeze fixture, permission, disclosure and geometry for comparable captures: desktop 1440×900 and mobile 390×844 at 100%, plus 320-pixel reflow and 200% zoom; inspect light/dark contrast, keyboard focus, accessible names and status announcements. Record visible choices, words and navigation separately for each viewport using the canonical measurement scope; unavailable measurement is U. The deterministic task target is to find the recovery explanation without a new route or effect and retain access to saved history. Test populated, missing/malformed, failed, running, historical and live-changed recovery evidence; verify an unauthorized or forged-proof attempt cannot restore. A propose-and-pick decision alone does not satisfy this served evidence requirement.

### Source and delivery checks

The expanded Workroom claims succeeded, but the returned cumulative impact contract exceeded the response budget. Verification therefore remains exhaustive. Resolve related-test advice before the failing regressions; run affected tests and both TypeScript programs, then independent source review and a fresh exact-source canonical gate. Required GitHub production-build and served route-sweep checks still govern publication.

A prior 9,798-test PASS at `314303f9` is historical and cannot qualify this correction. The PR was temporarily closed while the known finding was repaired so autonomous follow-through could not merge it. Reopen the same PR only when the correction is ready, and merge through the protected queue.

Results belong in the Workroom and PR with their actual source identities. Prototype checks are not deployed feature acceptance. After merge, use the canonical self-upgrade and live-version preflight before genuine parent review receipts and the owning chat's normal plan admission.

### Served verification, 26 October

Governed preview `NPEL-A8123220A2` served clean commit `e643f8ef30cf8036900147444e36e78ee8fdba49` (tree `65529017b0fb3fbec7cf8472480bbd2e1e1c628a`). Native verification sign-in admitted the automation persona on the operator development install, in the Full navigation view and en-US. This persona is separate from the original human review requester. Anonymous navigation reached the welcome page without recovery data. The preview honestly reported an unverified installation identity and no automatic upgrade action; this was not production-install acceptance.

At 1440×900, 390×844 and 320×844, the page showed the unavailable explanation, zero Rollback confirmation fields and zero Restore recovery point buttons. Recovery point status `ok`, `postgres: backed up`, latest run `SUR-235D611D` and Run History remained available. The existing deploy/history disclosure arrived expanded. Skip-to-main focused the main region; Tab reached the disclosure, Enter collapsed and reopened it, and the next Tab reached View changes. No operational action was invoked.

The reason wrapped within its container at both phone widths; document overflow was zero at all three sizes. The existing history table remained clipped inside an `overflow-x: hidden` container (about 551 pixels of table within a 252-pixel container at 320 pixels). This is retained history-layout debt, not a successful table reflow. The new explanation does not introduce a column or widen the table.

The canonical measurement helper, applied to a read-only served DOM serialization with computed-visibility exclusions, reported:

| Viewport | Default-visible words | Reading grade | Primary actions | Visible fields | Maximum choices | Document overflow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1440×900 | 1,129 | 1.6 | 1 | 0 | 0 | 0 px |
| 390×844 | 1,079 | 1.6 | 0 | 2 | 7 | 0 px |
| 320×844 | 1,079 | 1.6 | 0 | 2 | 7 | 0 px |

These are current-state measurements, not a whole-page improvement claim: the earlier canonical capture used a different persona, install state, run history and dynamic content. The task-local comparison is one unusable confirmation field and one unusable Restore button before, versus zero of each and an accurate reason after. Human comprehension and timing remain unmeasured.

Actual dark rendering gave 14.70:1 and 8.12:1 text contrast for the two explanations. Light color-scheme emulation changed the rendered styles and gave 15.53:1 for the owner-card explanation, but only 4.40:1 for the 12-pixel secondary explanation. That failed the 4.5:1 target. The follow-up changes that explanation to the existing theme-aware primary-text token; final served contrast verification is still required. Browser zoom could not be exercised through the available keyboard interface, so 200% zoom remains unverified. Audible screen-reader announcements, restricted-role fixtures and live state transitions also remain unverified; no upgrade or restore was triggered to manufacture those states. Source regressions cover adverse recovery states separately.

The keeper exited normally after interruption; both identified preview containers were absent and the preview lease was absent from the admitted/queued inventory. The browser color-scheme emulation and viewport override were reset, and the temporary QA tab closed. Screenshots, accessibility trees and measurement inputs are retained in the chat's artifact directory; the Workroom records their source and lease identity. This evidence is not a native review receipt, a deployment record or a parent reassessment.

## Sources

- [Approved original initiative design](../superpowers/specs/2026-10-16-original-initiative-review-settlement-design.md).
- [Platform usability standards](../platform-usability-standards.md).
- [Portal UX simplification spine](../superpowers/plans/2026-05-26-portal-ux-simplification-spine.md).
- [Build gate and live deployment procedure](../architecture/build-gate-runbook.md).
