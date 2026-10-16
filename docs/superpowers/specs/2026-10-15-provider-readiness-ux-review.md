---
status: active
---
# Provider configuration UX review — incomplete

**Decision: defer readiness.** The compact revision is a design draft responding to the operator's explicit feedback. No completed UX Design Critic review or calibrated design-quality verdict has been obtained. Do not publish the earlier sparse implementation as an accepted UX design.

- [Preserved first prototype](2026-10-15-provider-readiness.html) — unchanged from committed revision 767d937b28265e0741d01beafe61302d2c392304.
- [Compact configuration revision](2026-10-15-provider-readiness-dense.html) — separate artifact, illustrative fixtures, no live configuration writes.
- Implementation and verification context: [provider readiness repair](2026-10-15-provider-readiness-repair.md), backlog BI-2ECA4E9C.

## Fit and purpose

Owning area: Platform, existing `/platform/ai/providers` route. Persona: founder/operator comparing configured provider accounts and deciding which can run the intended work. Only local filters and contextual account actions change; there is no new navigation home or status datastore.

Navigation layer: local filters and contextual account actions. Source truth remains the provider-account read model, account-owned capacity observations, shared routing restrictions and recovery-job timing. A fresh install must distinguish no saved connection from an enabled account; permission and connection failures need a specific explanation and permitted next action. AI boundary: this draft sends no prompts; any implemented coworker request retains preview and explicit confirmation.

The rejected prototype made the operator open account management to discover most configuration and evidence. The operator explicitly called it “WAY too sparce” and requested compact useful detail. That is direct owner feedback; it is not a completed specialist finding.

The revised default view keeps these decision-relevant facts visible:

| Group | Visible facts | Decision it supports |
| --- | --- | --- |
| Account and connection | Human provider/account names, saved sign-in or key method, authentication owner | Is the account actually configured, and where is its connection managed? |
| Live status and routing | Strong semantic badge, observed reachability, eligibility and current reason | Can new work run, and why or why not? |
| Model access and allowed work | Verified account inventory versus unverified catalog inventory, human model names, workload allowance | Can this account perform this work, and may the data be sent? |
| Capacity and checks | Last check, last success, next earlier availability check, distinct provider reset estimate | Is the evidence current, and what happens next? |
| Next action | Verify, check availability, review connection/billing, or review/resume | What can the operator do without decoding a diagnostic? |

Endpoint internals, full model inventories, raw response evidence, advanced routing and histories remain secondary detail. Labels use provider, account, model and workload names. The prototype clearly labels fixtures and actions as illustrative; its verification examples must not be reported as live account health.

Implementation reuse remains ProviderAccountsOverview, report-kit status/filter/table primitives, the account read model, account-specific capacity evidence and the existing verification/CAS boundary. The sparse source implementation is committed locally but has not been pushed or deployed; it needs alignment with this revision after the required review. Its earlier MCDA/UX manifest establishes neither acceptance of the denser design nor design quality.

## Live craft and critique evidence

The `dpf-ux-fit-review` skill was read and reapplied. Live `wiki_query` retrieved the following UX profession pages, and their source documents were read for the detailed rules:

| Guidance | Effect on the revision |
| --- | --- |
| [Information hierarchy and content density](../../professions/ux-design/wiki/information-hierarchy-and-density.md) | Group related decision facts into aligned comparison rows. Treat default-visible counts as regression measures; lower word count is not proof of better cognition or design. Keep pertinent detail visible. |
| [The 10 usability heuristics](../../professions/ux-design/wiki/ten-usability-heuristics-summary.md) | Show system status and separate it from saved configuration. Familiar names and simultaneous comparisons reduce the need to remember details between accounts. |
| [Error prevention and recovery](../../professions/ux-design/wiki/error-prevention-and-recovery.md) | Put a precise stop reason beside a relevant recovery action. Distinguish billing/credential repair from automatic capacity waiting. |
| [Design critique corpus method](../../professions/ux-design/wiki/design-critique-corpus-method.md) | Keep attributable observations, agent proposals and founder/designer verdicts separate. Do not invent retrieved examples. |
| [Critique calibration gate](../../professions/ux-design/wiki/critique-calibration-gate.md) | No self-certified design verdict. Accessibility, counts, MCDA confidence and elapsed time do not stand in for design authority or completed specialist work. |

Authorized critique searches returned **zero entries** for the provider route, calibrated density examples, all calibrated examples, and an unfiltered sample. This establishes the result of these searches, not that no critique exists anywhere. No historical designer finding was retrieved to shape this revision; the table above is craft guidance, not a claimed critique-corpus exemplar.

## Consultation provenance and actual status

| Attempt | Observed result | Disposition |
| --- | --- | --- |
| UX Design Critic service catalog | Offer identifies the UX Design Critic and its advisory deliverables. Engagement CE-9A18E31A is `requested`, with no workroom or completed critique. | Engagement exists; execution and findings are unproven. |
| Explicit UX profession consultation | Requested `external_coding_agent` and `ux-design`; decision DI-B7B319FA0F99 returned **`software-engineer`**, `declaredBorrow: false`, confidence 0.45 and escalation. | Excluded as UX profession review evidence. The authenticated external coworker identity took precedence over the requested craft. |
| Governed critic execution handoff | `request_coworker` returned `independent_review_request_denied` and required the readiness-supplied review packet. | Denied action stopped; no alternate identity, rephrased objective or direct dispatch used. |
| Prescribed recovery | Refreshed the exact provider Workroom with plan intent and its full head. Readiness was allowed, no unmet gate and **no reviewer route** was returned. | The suggested remedy could not execute this advisory review. |

There are **no completed coworker findings to attribute**. The visible changes respond to owner direction and the retrieved craft guidance only. The service request must not be described as a completed review. The external consultation and service execution gaps are reconciled under existing research item BI-0AABCD1F, “Reconcile external-client UX consultation, executed coworker review, and corpus evidence”; duplicate occurrence reports were absorbed there.

## Revision observations and disposition

These are author observations under explicit owner direction, not calibrated critic verdicts:

1. Sparse version hides the comparison facts needed to choose an account. Revision exposes connection, eligibility, access and timing in five consistent groups.
2. Successful verification and a stale routing hold can coexist. Revision represents both rather than calling the whole provider working or broken.
3. A distant provider reset estimate does not describe the next earlier check. Revision labels both separately.
4. An account that is enabled but lacks recent successful evidence must not be called working. Revision retains that distinction.
5. A single generic Manage action makes recovery indirect. Revision offers action names tied to the current reason; previews do not apply changes.

## Verification and remaining evidence

The first prototype's original bytes remain preserved. Its filter was exercised after correcting the static HTML hidden-state styling. The denser revision is served as a static draft for browser inspection, separate from the application runtime. Browser checks must record default and filtered comparison states, configuration previews, local-only policy explanation, keyboard dialog close, and mobile readability. These checks establish artifact behavior, not design quality or live feature acceptance.

Completed draft checks: the default eight-account comparison, three-account waiting/paused filter, Gemini-only search, ChatGPT availability preview and Escape close, and the local-only explanation were exercised in the browser. Cloud accounts remained configured while their routing eligibility changed. At 390 × 844 the document had no horizontal overflow; account facts flowed into two columns. The temporary viewport override was reset. The desktop screenshot shows connection, status, model/work allowance, timing and next action together. These are author observations of fixtures, not an independent usability evaluation.

Preserved prototype SHA-256: `EDE51BCBE2232E5723E258006FAC0879D146468D47741C167E8158CAAC120689`.

Backend architecture follow-up moved the reusable verification and recovery implementation into inference services, leaving compatibility exports at existing action entry points. This removes reverse application-boundary dependencies without widening exceptions. Application-boundary validation and production/test typechecks passed; the affected authentication, quota reconciliation and recovery suite passed 55 tests after the move. The broader preflight previously failed boundary and stale UX-scope checks; those causes were corrected, but the complete preflight and governed integration gate have not been rerun. No PR, push or deployment has occurred.

Before this can be ready:

1. The platform UX consultation owner must provide the supported service request-to-execution path and honest cross-profession consultation. Do not bypass the refusal.
2. UX Design Critic must return an attributable critique of the exact compact revision, with corpus references or an explicit grounding limitation, concrete findings and dispositions.
3. Reconcile those findings and the operator's density requirements into the actual account read model and UI. Preserve backend reliability repairs already committed.
4. Re-run exact-source tests/typechecks and governed integration verification, then exercise the served application in relevant themes/viewports. UI counts and accessibility passes supplement the critique; they do not replace it.

## Operator follow-up: multiple accounts per provider option

The operator requested additional accounts under each provider option. The revised draft shows two named Claude API accounts with independent states, offers a contextual Add account action with provider preselection, and uses the same entry form from the page-level Add account action. Provider and account counts derive from the fixture collection; search and status filters remain account-scoped. Under filtering, the first visible account retains the provider's Add account entry.

The local preview collects only a provider option and a human-readable account name. It explains the supported connection method and adds a temporary Setup needed row. No credential is collected, and no live account is created. A new account inherits no sibling verification, model-access, allowed-work approval, routing eligibility or quota evidence. Implementation must preserve explicit shared authentication ownership and provider-wide restrictions where the actual provider contract requires them; adding a row must not imply an independent allowance or bypass a shared quota.

Browser verification added an Operations team draft under Claude / Anthropic: account count rose from nine to ten, the original Team API account remained Working, and the new account showed Not connected / Not eligible for routing / No successful request. Reusing the same name under that provider was rejected with an inline validation message and no extra row. The original sparse prototype remains unchanged. This extension remains an unapproved design draft under the existing incomplete specialist review.

## Implementation resumed under operator approval

The operator confirmed the multi-account draft, then asked why implementation was paused. Source implementation has resumed: readiness claim IRD-199093B17925 allowed implementation with no unmet gates. The missing independent UX review remains a release-readiness limitation, not a need for another prototype approval.

ProviderAccountsOverview now exposes five comparison groups through report-kit: provider/account and connection method; current status and routing eligibility; model access and allowed work; owned observation/success timestamps with availability/reset timing; and contextual account actions. Secondary diagnostics remain disclosed. Account creation continues through the existing action and opens the new account configuration route. Navigation does not dispatch a connection or probe. Regression coverage checks visible comparison facts, exact account navigation and isolation from provider-wide success timestamps.

Source checks passed before final documentation updates: 23 affected tests, production/test TypeScript checks, application boundaries and the mechanical UX-manifest check. The manifest is architecture-choice evidence, not independent review certification. Broader source preflight is running; served application verification and specialist critique remain unproven.
