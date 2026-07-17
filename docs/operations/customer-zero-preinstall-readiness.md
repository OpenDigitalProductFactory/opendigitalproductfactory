# Customer 0 Pre-Install Readiness (`software-platform` archetype)

Use this checklist before installing or handing off a **Customer 0** DPF environment — the first production dogfood install that runs as the `software-platform` archetype. It keeps three decisions together: the install runs as the `software-platform` archetype, reseller/customer feedback must have a governed path back to GitHub, and the first operator should not need platform-internal vocabulary to get started.

> **Scope note.** This is an archetype-level readiness guide. It deliberately does **not** name a specific customer, operator, person, IP address, or account. Fill the operator-owned inputs below from your own install's onboarding record — keep the real identity in the install's private configuration, not in this repository.

Backlog link: `BI-2F0CEB86`

## Decision Snapshot

| Area | Readiness decision | Evidence or next action |
| --- | --- | --- |
| Customer identity | Treat the first-install organization as the publisher/operator identity for Customer 0. | Keep the legal/account name consistent across install, app-store, and customer-facing config — recorded in the install's private onboarding data, not in the OSS repo. |
| Archetype | Use `software-platform` for the production dogfood install. | `software-platform` is the DPF-on-DPF archetype; it is the one case where platform/operator language is legitimate day-to-day vocabulary. |
| Public story | Use `docs/index.html` for pre-install orientation. | Keep the public tour focused on what DPF does before asking a user to run or operate the platform. |
| Feedback path | Route reseller/customer product feedback into a governed BI -> GitHub path, not ad hoc messages. | Use the upstream feedback escalation design as the source pattern: local report, consent/rate-limit, relay/direct bridge, GitHub link persisted back to the install. |
| First operator handoff | Provide a short checklist for sign-in, what to inspect first, where to ask the AI coworker, and how to file a product issue. | The user guide and platform docs exist; this page names the minimum path for a non-technical operator. |

## Pre-Install Inputs

Collect these before the installer or first-run setup starts. They are **operator-owned**: record them in the install's private onboarding configuration, not in committed documentation.

| Input | Owner | Notes |
| --- | --- | --- |
| Legal entity name | Customer 0 operator | Use one consistent legal name for publisher and customer-zero references. Store it in the install config, not in the repo. |
| Primary operator email | Customer 0 operator | This becomes the first admin handoff target. Do not use a disposable inbox. |
| GitHub upstream target | Platform maintainer | Confirm the target repo or relay target that receives governed feedback. |
| Reseller target, if any | Reseller or platform maintainer | If a reseller intermediates support, record whether feedback goes to the reseller relay first or directly upstream. |
| Customer-facing promise | Platform maintainer | Keep this to plain outcomes: what the business can run, what coworkers help with, and what setup decisions remain human-owned. |
| Mobile publishing posture | Customer 0 operator | If mobile is in scope, use the store-launch runbook (which names the actual App Store / Play Store publisher entity) before promising TestFlight, Play testing, or production store availability. |

## Archetype Readiness

Set or verify the install as `software-platform`.

- The `software-platform` archetype is the DPF-on-DPF meta-case: the organization sells, operates, or supports DPF itself.
- It is allowed to show platform/operator concepts such as backlog, builds, releases, customers, and coworkers as first-class work.
- Do not use `software-platform` as the fallback for ordinary customer businesses. Other archetypes should see their own business vocabulary and day-to-day work.
- If a reseller is involved, do not hard-code reseller behavior from the archetype alone. Reseller capability is a separate support/channel decision.

Minimum verification after setup:

1. Storefront or business setup reports `software-platform`.
2. Public copy describes DPF as the product/service being operated or sold.
3. The workspace does not look like a generic small-business fallback.
4. The AI coworker can answer "What product is this organization operating?" as DPF, not as an unrelated customer business.

## Reseller BI To GitHub Path

The Customer 0 feedback path should preserve local sovereignty while still producing upstream work when the operator consents.

Required behavior:

1. The operator reports a product issue or improvement in the DPF install.
2. The install records a local backlog item or issue report first.
3. A policy gate decides whether the report is local-only, reseller-routed, or upstream-worthy.
4. If upstream-worthy, the install uses the configured relay/direct bridge to create or link a GitHub issue.
5. The local item stores the upstream link and keeps the operator-facing status readable.

Reseller mode:

- A reseller may curate and forward feedback before it reaches OpenDigitalProductFactory.
- The install should not ship with a shared GitHub token.
- The customer should be able to see whether the issue is local, with reseller, or upstream.
- Reverse-channel acknowledgements should come back into the local install when available.

Pre-install check:

| Question | Ready answer |
| --- | --- |
| Who receives product feedback first? | `local-only`, `reseller`, or `upstream` |
| Is customer consent required before upstream filing? | Yes |
| Where is the upstream link stored? | On the local issue/backlog/evidence record |
| Can the operator explain the path without GitHub jargon? | Yes: "DPF records it here, then sends it to support/upstream when approved." |

## Non-Technical Operator Handoff

Give the first operator this four-part path, not a source-code tour.

1. **Sign in and confirm identity.**
   Verify organization name, operator email, and visible product name.

2. **Open the workspace.**
   Confirm the first screen shows what the organization is operating now, what needs attention, and which coworker can help.

3. **Ask the AI coworker one concrete question.**
   Suggested prompt: "What should I check first before showing this DPF install to a customer or reseller?"

4. **File one safe feedback item.**
   Use a harmless wording improvement or docs question to verify the local feedback path. Confirm whether it stays local, routes to reseller, or links upstream.

Do not ask the operator to run shell commands, inspect Docker, or manage Git. If a command is needed, an agent or maintainer runs it and reports the result.

## Day-Zero Checklist

- [ ] Customer 0 legal/publisher identity is confirmed (recorded in the install config, not the repo).
- [ ] Primary operator account is ready.
- [ ] Install archetype is `software-platform`.
- [ ] Public pre-install tour link is available.
- [ ] Feedback route is selected: local-only, reseller-first, or upstream.
- [ ] Consent/rate-limit policy is understood before filing upstream.
- [ ] First operator can describe DPF in one sentence.
- [ ] First operator knows where the AI coworker lives.
- [ ] First operator knows how to file feedback without using GitHub directly.
- [ ] Mobile store prerequisites are separated from core web install readiness.

## Related Docs

- [Documentation index](../README.md)
- [Public pre-install tour](../index.html)
- [Market archetypes and coworkers](../user-guide/market-archetypes.md)
- [Getting started](../user-guide/getting-started/index.md)
- [Mobile app store launch runbook](mobile-store-launch-runbook.md)
- [Zero-config upstream feedback escalation design](../superpowers/specs/2026-06-06-zero-config-upstream-feedback-escalation-design.md)
- [DPF-on-DPF production instance plan](../superpowers/plans/2026-04-25-dpf-on-dpf-production-instance.md)
