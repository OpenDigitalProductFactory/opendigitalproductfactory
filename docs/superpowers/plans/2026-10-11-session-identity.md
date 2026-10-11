---
status: proposed
backlog: BI-550E8244
---

# Plan: signed-in account visibility

Design: `docs/superpowers/specs/2026-10-11-session-identity-design.md`.

## Acceptance criteria

- AC-ACCOUNT: The workforce shell displays the authenticated person's name with email fallback; an accessible disclosure shows account email, role, and organization, including on mobile and in Simple mode.
- AC-CLIENT: The existing get_my_coworker_profile read tool exposes the authenticated human account separately from the acting coworker and server-resolved connection authentication/scope.
- AC-TRUST: Identity comes from the session and Principal/User records, never client-supplied identity parameters; no credentials or token IDs are returned.
- AC-COMPAT: Existing profile and grants fields remain compatible; sign-out behavior remains functional; missing display names fall back honestly to email.

## Sequence

1. Add a shared authenticated-account read model under `apps/web/lib/identity/`, using the authenticated user ID to read User email and its canonical Principal alias display name. Verify missing names, unavailable accounts, and caller binding with focused tests.
2. Pass the account name and email from the workforce layout to Header. Compose one native account disclosure around the existing ShellSignOut action, with theme tokens, responsive width and a 44px target. Verify name visibility, details, keyboard operation and sign-out compatibility.
3. Extend `get_my_coworker_profile` in the existing coworker capability pack. Read account identity using its authenticated handler userId, keep profile fields and effective grant semantics, and expose server context authentication/scope. Verify spoofed params cannot select another account and agentless compatibility.
4. Run affected tests, web typecheck and gate context; collect governed runtime and measured UX evidence before a ready PR. Update user documentation with account identification and the existing profile tool.

These steps are internal sequencing for one shared identity projection and its two required consumers. The requested cross-surface identity contract is incomplete if either consumer omits the authenticated account. No independent follow-on feature is hidden here.

## Traceability

Requirement AC-ACCOUNT, AC-CLIENT, AC-TRUST, AC-COMPAT; contract AUTHENTICATED-ACCOUNT-PROJECTION (canonical Principal/User, additive profile); flow ACCOUNT-DISCLOSURE-AND-CLIENT-SELF-READ; verification IDENTITY-BINDING-AND-HEADER-TESTS.

Risk: wrong-account display if a caller ID replaces authenticated context. Tests must pass spoofed params and assert the DB selector. Name/email values render as React text. Missing names use email; missing accounts are explicit, never a guessed identity. Rollback reverts this feature's additive read/display changes.

## Backlog coverage

Umbrella and atomic deliverable: BI-550E8244. No dependency. Receipt pending provider verification of this immutable plan before source implementation.
