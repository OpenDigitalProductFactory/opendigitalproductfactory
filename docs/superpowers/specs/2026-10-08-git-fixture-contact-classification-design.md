---
status: active
---

# Synthetic Git authorship in source contact screening

Backlog: BI-E84B9600. Workroom: WC-CEDC6987. Delivery shape: small fix.

## Existing architecture and observed defect

This extends [vertical sensitive policy packs](2026-07-27-vertical-sensitive-policy-packs-design.md)
at its classifier input. The existing PDP, provider suitability intersection,
clearance and residency constraints remain authoritative. The shared
`apps/web/lib/inference/data-screening/source-contact-evidence.ts` already
removes narrowly recognized non-contact spans before testing remaining text.
No new store, public API, authorization lane or provider policy is needed.

On source commit `979fd38e11fce24ec9385ec3a50c6cb353710432`, the shared
pattern does not recognize `"user.email=test@example.invalid"`. This exact
argument appears in the temporary Git fixture in the gate repair diff at
`febfbd81fe6c23dcd2c5448c4f00d944088171c4`. Canonical routing evidence
`cmuyqeehi4ub101owk54oevnr` establishes that the resulting contact-detail
classification excludes enabled cloud reviewers. Enabling another provider
does not override the classifier's local-only restriction.

## Research and alternatives

[RFC 2606 section 2](https://www.rfc-editor.org/rfc/rfc2606.html#section-2)
reserves `.invalid` for names that cannot be real public DNS names. This does
not establish that every local part is nonpersonal. Therefore the proposed
recognition is deliberately limited to the synthetic value
`test@example.invalid` in a quoted Git `user.email=` argument, with an exact
closing quote boundary. Person-shaped values, deceptive suffixes, bare
addresses and other property names continue to count as contact evidence.

Rejected: exempting all source code or every reserved-domain address. Either
could conceal adjacent real or ambiguous data. Rejected: forcing cloud routing
or changing the frozen review payload to escape detection. Neither repairs the
shared classifier or proves that its existing safeguards still hold.

The chosen approach extends the existing strip-and-retest expression. It
removes only the recognized argument span; contacts before, after, or on the
same line remain visible. Explicit governed classes and local-only constraints
still dominate. At least 20% of the implementation effort covers shared-helper
clarity and cross-consumer regression coverage rather than caller-specific fixes.

## Ordered implementation and verification

1. Reproduce against the named current source with the exact Git fixture, and
   record the failing test before implementation. Existing trailer/quantity
   cases and contact negatives distinguish the defect from general routing.
2. After normal research admission, extend the shared exemption with one
   bounded synthetic Git argument pattern. Keep other classification rules.
3. Run classifier and screen tests including actual contacts, suffix attacks,
   adjacent contacts, explicit local-only, and source-code classification.
   Run affected suites and both typechecks, then DCO commit and canonical CI.
4. Obtain independent committed review, publish a regular PR, and merge through
   protected controls. Advance only through canonical release/self-upgrade.
5. Verify the served classifier and actual reviewer route, preserving the
   expired review history when requesting supported bounded recovery. A local
   source test or merged PR alone does not establish runtime remediation.

## Acceptance and rollback

The named synthetic fixture must stop producing customer contact evidence;
actual or ambiguous contacts must continue to do so. The same source review
must remain eligible for permitted external providers, while an explicit
local-only boundary stays local. Runtime qualification must cite served image
identity and a real screening/routing observation before review recovery.

Rollback reverts the narrow shared pattern and its documentation through the
normal delivery process; conservative false-positive routing then returns.
No stored records, provider grants or policy packs change.
