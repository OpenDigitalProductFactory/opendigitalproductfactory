---
status: draft
backlog: BI-05E0EA33
---

# One-click named-account consent

Workroom: WC-D32E1140. Decision: DI-50FF7AFF805C.
Canonical design: docs/superpowers/specs/2026-09-21-oauth-external-build-authority-design.md,
Named-account confirmation amendment. Preserve original DCO commit
1828333ce88db34ef7a8c594607f9761eebeeb02.

## Scope and acceptance

The remaining defect is the required account checkbox followed by Connect.
The existing default-coworker implementation remains in place. This change
combines explicit account confirmation with the native submit action.

Current-main reconciliation (2026-10-31): retain the separate handover
acknowledgement for an account whose work was handed over (BI-9D2199D4),
and the refusal to bind interactive clients to the automation persona
(BI-F586F8A5). One-click acceptance applies to the normal signed-in personal
account. These exceptional account protections remain unchanged.

The item's acceptance criteria are retained verbatim:

- Supported fresh connection, once signed in: one consent click, zero role selections, zero command/file-edit instructions for the operator.
- Normal reconnect/refresh: no repeated role question while valid consent and current authority remain unchanged.
- Display app, organization and consequential permissions clearly; no internal CLI taxonomy in the default flow.
- Server validates eligibility, current user permissions, requested scopes and binding. Forged client names cannot impersonate a coworker or broaden authority; revocation and room admission remain enforced.
- Genuine ambiguity or expanded authority produces a specific actionable choice, not a generic role-picker imposed on every user.
- Measure clicks, decisions and elapsed time on live first-connect and reconnect paths, including desktop and CLI clients.

## Atomic implementation sequence

1. Obtain an independent assessment of this plan and the named-account design
   amendment before implementation. Record live plan coverage for BI-05E0EA33.
2. Claim the renderer, authorize route, their colocated tests and affected
   authorization/user documentation. Resolve the Workroom impact contract and
   related tests. Classify worktree dependency readiness with the managed probe.
3. Add failing renderer tests for an escaped, untruncated account-bearing native
   Connect button, no confirmation checkbox, optional account switch, and
   wrapping on narrow widths. Add route tests for the new submitted confirmation,
   missing/mismatched identity, legacy checkbox forms and cancel.
4. Keep the existing decision=approve submit button and send the server-rendered
   user ID as hidden confirm_account. Its visible action becomes
   Connect {client} as {account}; no script automatically submits it. Retain
   POST's exact equality check against current session.user.id. Hidden fields
   are untrusted: this is an explicit UI action, never additional authority.
   Legacy checkbox submissions retain the same field/value contract. Cancel
   remains decision=deny and is processed before account confirmation.
5. Update renderer comments and user guide; preserve
   scope intersection, CSRF, PKCE, redirect and coworker eligibility checks.
   No schema, seed, grant or account-identity migration is needed.
6. Run the affected renderer and authorize suites plus OAuth regression tests,
   package typecheck and required gates. Verify served UI in light/dark themes,
   narrow width, keyboard activation and hostile/long labels on the shared
   governed nonproduction lease. No standalone worktree runtime.
7. Obtain independent committed-change review, open a DCO-signed PR only when
   ready, check pr:health, merge through the queue and request_self_upgrade.
8. Verify the canonical deployed lineage. Measure first-connect and reconnect
   separately for supported desktop/CLI paths: clicks, role selections, elapsed
   time, authorized account and resulting connection. Reuse valid prior evidence
   for unchanged boundaries. Human account is markdbodman@gmail.com; HR-000 is
   a role. Do not close from rendered HTML or merged code alone.

## Risks and rollback

The primary risks are hidden identity tampering, stale sessions and misleading
account labels. Exact server identity comparison remains mandatory, account
text is escaped and fully visible, and a changed session renders a fresh choice.
No authority is selected from an untrusted client name. No new queries or
unbounded collections are introduced. Revert the scoped renderer/test/docs
change through the normal PR path if verification fails; existing checkbox
forms remain valid throughout rollout.

## Backlog coverage

Atomic under BI-05E0EA33: UI, server compatibility, tests, documentation and live
measurement establish one consent behavior and cannot independently satisfy it.
Coverage accepted for plan commit 0cb03b16792865a5bb662c1f45d8f287b721b7bb:
cmv6928jh0r9c01lagexei5sy. Independent design assessment recorded in
cmv697jd1120u01la4rcf9srf; no blocking findings. Implementation admission
accepted for WC-D32E1140. Refresh coverage for subsequent plan revisions.

The authorization runbook is actively claimed by another recovery Workroom;
this change updates the user guide and leaves that claimed file to its owner.

Traceability: requirement AC-OC-1/3/7; contract current-account-equality;
flow named-account-submit; verification first-connect-and-reconnect.

## Historical acceptance-linked failure

The backlog parser also treats the following historical AC-OC-7 note as a
criterion. Preserve it verbatim as a regression context, not the desired outcome:

> live first-connect, administrator, DCR probe named Codex, scopes read/work/build: one Connect button, no checkboxes, but kind=choice with Mailroom coordinator (3 permissions) preselected; reaching Codex costs 2 operations and 1 decision. Recorded as functional failure ac-oc-7-live-first-connect-admin. Cause: administrator eligible set spans every room-write coworker (signatures differ) and the prior-consent rule ran only after the equality check. Probe consent declined; probe client dpfoc_1009… revoked.

Verification must establish that the current personal account resolves Codex
without a new role choice. Reuse prior role-default repair evidence only where
its exact behavior remains unchanged; remeasure the named-account click path.

## Recovery and current verification (2026-10-31)

The October 14 acceptance sweep marked the item done despite this amendment
having no PR. Reopened the same item and resumed WC-D32E1140 through governed
tools; restored the removed worktree from the preserved signed commits.
Merged current main at 10da4ec877fd362f0455a0865c9e2a9f3b853cf7, resolving only
the account renderer conflict while retaining both newer account protections.
The merge is db9aad50fb0533f0cf55da6a6bbedb2c05ae77f4.

On the merged source, all 291 OAuth tests, web typecheck and the merge's
precommit package typechecks passed. This is source-local evidence. The
October 13 integration pass and independent assessment remain historical;
the changed tree still requires fresh integration and committed-change review,
then publication, canonical deployment and measured desktop/CLI consent flows.
Do not infer delivery from the sweep's former completion status.
