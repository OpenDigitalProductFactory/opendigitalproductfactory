---
status: active
backlog: BI-550E8244
---

# Plan: signed-in account visibility

Design: `docs/superpowers/specs/2026-10-11-session-identity-design.md`.

## Recovery and delivery — 2026-11-02

The original worktree and local branch are absent. The implementation remains recoverable at `c7241ad55f3e3390d8e5c0ace6d2e4fb6b7a4705`. The platform admitted replacement Workroom WC-A49AB673 for the same backlog item on `codex/session-identity-delivery`, based on current main `1f0b5a7eabc08c40eec0076ab98097c23b0cb0ba`. The old room is retained as historical evidence, not treated as the current executor.

The restored account disclosure now incorporates the current header's help and feedback actions. Authenticated users get one account trigger with their name, details and sign-out; callers without account data retain the established header behavior. The additive client projection preserves the current installation and grant fields. All 68 focused tests and the web production typecheck pass on this restored source. Browser exercise, measured UX evidence, merged-code verification, independent review, publication and deployment remain incomplete.

The old permission denial is resolved: live discovery confirms both UX-service tools callable. CE-93234362 records the original advisory engagement request; it is not a completed critique. Current main contains the preview binding, bounded clone and preview sign-in procedures, so this delivery will exercise those procedures rather than presume the October repair is still unavailable. No runtime or publication check is represented as passed before execution.

## Served checkpoint and remaining checks — 2026-11-02

Follow-up commit `476a7ac597c80ca80099674b604a2f558c654ca5` fixes a reproduced nested-feedback Escape regression. All 69 focused tests and both web typecheck programs pass. The admitted preview NPEL-B3441F1BE5 completed its sanitized clone, including 14,560,515 telemetry rows in bounded batches, and served that exact source with healthy database and event loop checks. A platform-issued automation session authenticated successfully; the browser rendered the persistent name and disclosure with email, role, organization, help, feedback and sign-out.

The documents-page sweep failed against its frozen baseline: words 118 to 911, maximum choices 1 to 6, plus structural differences. It is not a passing UX measurement. The sweep wrote its generated report into the pinned checkout; the controller then recorded a source-binding heartbeat failure and stopped the preview. The report is preserved outside the source tree. Future measurement outputs must be isolated from the pinned source. The recorded choice between one consolidated account disclosure and separate account/help disclosures is DI-D79779F7D223; the native outcome writer records the agent following the high-confidence consolidation recommendation. The UX-fit manifest uses that actual option decision and does not claim the full-page sweep passed.

Mobile/Simple-mode exercise, served nested-dialog and sign-out checks, full shared-layout coverage, integrated gate, independent review, PR, merge and deployment remain pending. The desktop screenshot is illustrative acceptance evidence for the running preview, not evidence of live deployment.

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

Umbrella and atomic deliverable: BI-550E8244. No dependency. Receipt `cmv46dehmainv01pertgl32bx` binds the immutable plan at `c9331d1cc71f3f59ac074490018e5c27383dccb0`, blob `cfb25ea60a6d7d9855ce38b18aa57cde77571ed8`. Research receipt `initiative-0f22125c-9835-47c0-bf89-49eb77897c4f`; implementation admission `IRD-05E65B786A7E` allowed.

## Verification checkpoint — 2026-10-11

The portal disclosure and additive client profile are implemented locally. A new regression test confirmed that an unassigned first group hid a later assigned role; the projection now reuses the platform's workforce role resolver. All 61 targeted tests pass across the account projection, profile handler, account disclosure, header, and shell action contract. Web production typecheck passed.

The full delivery preflight ran and failed only the missing measured UX-fit manifest. Browser checks, measured UX, merged-code verification, semantic review, publication, and deployment remain unrun. This checkpoint does not establish acceptance or readiness to merge.

The shared preview was admitted, but initialization failed in the sanitized clone with JavaScript heap exhaustion near its 4 GiB heap limit. Preview-only migrations succeeded; no feature migration was added. Preview startup also exposed incorrect worktree binding and live database dependency recreation, recorded as BI-10AC904B. Startup was interrupted before its initializer ran; the live portal and database were healthy afterward, and the portal health endpoint reported database and event loop checks as OK. The corrected initializer was explicitly bound to the feature worktree and launched without starting dependencies, but the later clone failure prevents UI measurement.

UX specialist engagement is separately blocked by missing `coworker_catalog_read` and `coworker_engagement_write` grants on the connected external coworker. An administrator must resolve that authorization prerequisite through the platform; no shell or database fallback is authorized. Existing grant-provisioning work is BI-9FA87F90. Continue this plan after preview initialization and reviewer access are available; preserve the current source checkpoint and do not claim an unrun gate passed.

## Continuation — 2026-10-12

The separate `Repair external-client verification` chat is still working on the prerequisite repairs. They are absent from fetched main, and current discovery still reports the UX service's coworker grants missing. Do not duplicate that repair or start the known unsafe preview runner.

The feature branch incorporates main through `007eef1a3bc035a5f7906cf92cd2432819695534`. Its profile-tool merge preserves the new installation operating context alongside authenticated account and connection identity, including on an agentless connection. The combined tests assert that account identity does not remove development/peer-write limits. All 65 targeted tests pass; the managed dependency probe reports compile-ready, and web production typecheck passes. Required browser, measured UX, merged-code and publication evidence still awaits the separate prerequisite repair. No feature PR or deployment is claimed.

## Delivery attempt — 2026-10-13

Current main through `e4edd79cd6cfa83ac00df4dd64494090573b3e23` integrates cleanly. Managed dependency readiness, all 65 targeted tests, and web production typecheck pass against the combined source.

The operator explicitly authorized a scoped AI Ops provisioning request for `coworker_catalog_read` and `coworker_engagement_write`. The platform refused the general handoff with `independent_review_request_denied`: this connection is restricted to readiness-bound independent review requests. Refreshing feature readiness confirmed implementation allowed but supplied no provisioning handoff. No request was executed and no grant was changed.

The accessible formal capability-request workflow accepted CWN-21E88B67 (assessment CWSA-9C8AE57B), linked to BI-CAP-5B683E8F for authorized owner review. It requests only the two approved UX-service grants and cites existing BI-9FA87F90. This is a submitted request, not permission provisioning. The separate preview repair remains unmerged; required browser/UX, merged-code, review, PR and deployment evidence remain incomplete. An authorized administrator must fulfill the scoped grant request, and the separate repair owner must deliver safe preview initialization before this thread can finish its runtime checks.
