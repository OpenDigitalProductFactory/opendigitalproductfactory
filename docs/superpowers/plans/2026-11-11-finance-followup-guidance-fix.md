---
status: active
Backlog: BI-01C83BCF
Profile: fix
---

# Finance follow-up expense guidance

## Reproduction and diagnosis

The retained real-provider Finance answer in TR-CHAT-1125d7b10a0bf85180084c610ca2cd1b
did not know the native expense workflow and invented mandatory-looking information.
The request and answer survived reload; useful-answer acceptance failed.
The current Finance context provider contains tax, recurring and invoice data,
but no native expense-entry guidance, including its no-tax-profile early return.

## Existing design and bounded repair

Extend the page-owned context provider, reusing the native expense form's
`shell.finance.expenseEntryDetails` and `expenseProfileRequired` catalog entries,
`getLocaleContext`, and `/finance/my-expenses/new`. The existing owner expense
navigation and Finance contextual-opening specs remain accurate: this is the
distinct generative follow-up gap. No new workflow, schema, provider or tool.

1. Reproduce missing native guidance through `getRouteDataContext` with and
   without a tax profile. Include a resolved pseudo-locale control. The source
   graph is ready but has no linked tests for this provider; bounded source search
   found the route-context suites and existing opening-briefing controls.
2. Supply shared-catalog expense guidance before the tax-profile branch, labelled
   as static workflow knowledge. State the profile prerequisite without claiming
   the current person's profile was checked. Retain financial reads, tax guidance,
   live-data authority, claim/approval actions and deterministic opening behavior.
3. Run affected route-context and opening-briefing tests, both typechecks,
   architecture/style and derived-artifact checks; independently review the frozen
   signed change and pass canonical merged-code verification before a regular PR.
   Coordinate one ordinary canonical release with the existing release owner.

## Business acceptance and boundaries

After canonical deployment, exercise a permitted guidance-only native Finance
request and verify its useful saved answer once after reload. It must name the
native route and actual required/optional information, distinguish draft from
approval, and avoid fabricated live balances. Do not create or submit an expense,
journal, payment, setting, contact or employee-profile fixture in production.
Source tests and a merged PR do not satisfy this served acceptance.

Normal Small implementation admission IRD-73E7584D8E0A and fresh own path claims
cover this clean worktree on b0b4d583c3b44e652655c1c932ad2e7c12e4fd7e.
The former native build is abandoned; no restart or competing source writer was
created.

## Observed source verification

Three regressions failed before correction because the native route was missing;
twelve existing controls passed. The corrected six-suite run passes102tests,
including route inheritance, registry and deterministic briefing controls.
Production/test typechecks, application boundaries, style and whitespace checks
pass. The existing documentation index is fresh without a generated-file change.
Independent review, canonical integration, protected publication, deployment and
served useful-answer acceptance remain pending.

## Served follow-up: authorized workflow evidence

PR6955 supplied the shared catalog text, but the served 6d1 guidance-only turn
TR-CHAT-e0a0901901bab3aab6d5e867896d785c still failed. Its exact diagnostic
artifact retained two withheld native-workflow drafts; no assistant answer was
published. The shared authorized-surface seam was not grounded for Finance:
the registry covered Discovery Operations and Response Feedback only.

Reuse that surface contract for static personal expense workflow guidance on
the Finance overview and personal entry routes. Share the form's existing
translation catalog; authorize the current human's Finance capability before
opening or rehydrating the contract. Do not query or assert employee linkage,
claim status, balances or totals. No actions are added to this guidance surface.

1. Add failing registry/grounding regressions for the actual guidance question,
   revoked or inactive human access, unavailable context, live-value and mixed
   requests, and imperative submission. Existing surfaces retain their behavior.
2. Register the Finance workflow surface and narrowly qualify expense workflow
   questions at the existing shared seam. Static guidance must not make a request
   for live financial values tool-free. Preserve generic evidence enforcement,
   principal filtering, and the action tool path.
3. Run affected tests and both web typechecks, independent review, canonical
   verification and normal protected publication. Coordinate deployment with
   the release owner, then verify a newly authorized guidance turn and reload.
   Never replay either original failed turn or use withheld drafts as answers.

This continuation uses WC-589473AF / codex/finance-authorized-guidance. The
first normal claim after successful SUR-DD81F176 preceded retirement evidence
publication and failed. After actual publication, the same ordinary plan-path
claim succeeded. This is current admission, not restart-continuity acceptance.
The separate falsely responded system-output artifact belongs to BI-D0D2FF0D.


## Basic entry wording correction — 13 November 2026

An independent release executor reproduced a current-source gap after the
initial native review: both “Where do I enter an expense?” and “How do I enter
an expense?” were rejected. The entry matcher allowed `enter` and `entry`,
but the positive vocabulary omitted both. The ordinary-tool fallback has not
been shown useful for these questions, so it is not an acceptance substitute.

Three direct question regressions fail against the reviewed source; two new
imperative/mixed-action controls remain on the tool path. Add only the two
missing vocabulary words, keeping every clause matcher and authority check.
The affected grounding, registry and wrapper suites pass42 tests after this
correction (initial RED3failed/21passed). The previous canonical/native receipts
qualify the older source only. New exact-tree verification, independent review,
publication and served acceptance remain required.


## Served assignment-marker regression — 13 November 2026

On served0dde, new native requests434401 and9d5d3 both initially generated the
correct entry link, then the evidence gate requested a tool and the provider
claimed a permission blocker without executing a tool. The second request was
the covered phrase “Where do I enter an expense?”. Both failed runtime receipts
are retained. No grant change or old request replay is authorized by this fact.

The native caller appends its Active assignment marker to the current user
message. The shared seam qualifies the entire marked string against the strict
Finance vocabulary. Existing raw-string tests omit that production boundary.

Carry the original current assignment content and message identity from the
trusted native caller alongside the unchanged marked history. The seam may use
the original text only when the latest user message exactly matches that text
plus the platform-generated marker. Otherwise retain the existing conservative
classification. Do not strip arbitrary user text or broaden the Finance grammar.

First reproduce through the real history builder and real classifier: covered
guidance must remain eligible, while mixed live-value requests, imperative
actions, forged/mismatched identity and content remain tool-backed. Retain
human Finance authorization, source grounding, later request identity, and all
provider/evidence guards. Run related tests and both typechecks, current review
and canonical gates, then land normally. The two failed live cases remain
failed until a containing deployment and genuinely new useful-answer check.

Source regression results: the real history-builder/classifier seam failed two
covered guidance cases (13 controls passed), then passed after exact original
assignment matching. Four focused suites pass53 tests; 13 related suites pass156.
Both production and test typechecks pass. These are source-local results only;
current independent review, canonical gate, publication and live proof remain owed.

The native sendMessage wiring regression also calls the real shared seam and
classifier with a mocked authorized surface/provider. Removing only the new
caller assignment field makes its original-text assertion fail; restoring it
passes. Final affected caller/seam run passes30 tests in two suites. This adds
production assembly coverage without a provider call or a production fixture.
