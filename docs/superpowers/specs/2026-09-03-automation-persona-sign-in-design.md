---
status: binding
---

# Automation Persona Sign-In: the platform signs its own browser in

| Field | Value |
| --- | --- |
| Date | 2026-09-03 |
| Backlog | BI-9369DEB5 (EP-ZERO-CONFIG-FEDERATION) |
| Surface | Auth.js session issuance, MCP `ux-verification` pack, `/api/automation/sign-in` |
| Owners | Identity, delivery surfaces |

## 1. Decision

An installation that is operated by agents alone must let those agents verify
its pages in a real browser: layout, type, colour, overrun and empty states
cannot be judged any other way. Most pages are session-gated. The platform
therefore signs **its own** browser in, as a seeded automation persona, through
a one-time link it mints for itself. No person is asked to sign in, no password
is typed by an agent, and no credential passes through an agent prompt.

Founder ruling, 2026-09-03, on the development install nobody but agents
touches: "I need you to log in and test the UX, not ever bypass" and "it
defeats 99% of the need for you if you can't test in my complete absence."

## 2. Research and benchmarking

| System | Pattern | DPF decision |
| --- | --- | --- |
| [Playwright `storageState`](https://playwright.dev/docs/auth) | Tests sign in once through the real UI and reuse the saved session. | Adopt the shape (a real session, reused), reject the mechanism: it still needs a credential the automation can type. |
| [Auth.js magic links](https://authjs.dev/getting-started/authentication/email) | A signed, expiring, single-use link establishes a session without a password. | Adopt: the link is minted server-side for the persona and exchanged for the same JWT cookie Auth.js issues. |
| [Kubernetes service accounts](https://kubernetes.io/docs/concepts/security/service-accounts/) | Automation acts under its own identity with its own audit trail, never a human's. | Adopt: a dedicated persona (`automation@dpf.local`) with its own Principal and EmployeeProfile. |

Rejected: reusing the seeded operator account (audit would blame a person);
a test-mode auth bypass header (a bypass by construction); typing the install's
admin password from a file (a credential handled in plain text by an agent).

## 3. Contract

- **Persona.** `automation@dpf.local`, display name "Platform automation",
  created on first use with a random unusable password, `HR-000` group,
  Principal via `syncUserPrincipal`, an active EmployeeProfile. Idempotent.
- **Permission.** Allowed when the resolved environment class is `development`
  or `test`. Any other class refuses unless PlatformConfig
  `automation.signIn.enabled` is `{ "enabled": true }`, recorded by an operator.
  Checked at mint AND at exchange.
- **Link.** `GET /api/automation/sign-in?token=<jwt>`; the token is HS256 over
  `AUTH_SECRET`, purpose `dpf.automation-sign-in/1`, subject = persona user id,
  `jti`, ten-minute expiry, `next` = same-origin landing path. Consumed once:
  the `jti` is recorded in PlatformConfig `automation.signIn.consumed`, pruned
  by expiry.
- **Session.** The route re-runs `authorizePrincipalForSession`, then issues the
  Auth.js JWT cookie (same name, secure flag and encoding salt as the
  configured sign-in) for two hours and redirects to `next`.
- **Tool.** `issue_ux_verification_sign_in` (pack `ux-verification`),
  capability `manage_platform`, grant `sandbox_execute` so an existing
  development token can call it. Returns the link, expiry and persona.
- **Audit.** Mint and exchange are logged with the requesting agent tag; every
  action in the session is the persona's.

## 4. Acceptance

1. On a development-class installation, an agent holding a development token
   calls the tool, opens the link in the browser it drives, and lands on the
   requested page signed in as the persona.
2. The same link opened twice is refused the second time; a link older than
   ten minutes is refused; a tampered link is refused.
3. On a production-class installation the tool refuses unless the operator
   grant is recorded.

## 5. Objectives and acceptance

The decision in §1, the contract in §3 and the criteria in §4 already state all
of this in prose. This section restates them as an identified manifest so the
delivered work carries a machine-readable scope baseline; it adds no new scope.

1. **OBJ-AGENT-VERIFIES-UNATTENDED:** An installation operated by agents alone
   lets those agents open its session-gated pages in a real browser, with no
   person present.
2. **OBJ-NO-CREDENTIAL-IN-A-PROMPT:** No password is typed by an agent and no
   credential passes through an agent prompt; the platform signs its own
   browser in through a link it mints for itself.
3. **OBJ-REFUSED-WHERE-IT-DOES-NOT-BELONG:** The capability is bounded by
   environment class, so a production installation refuses it unless an
   operator grant is recorded.

| Criterion | Objectives | Statement |
| --- | --- | --- |
| AC-PERSONA-LANDS-SIGNED-IN | OBJ-AGENT-VERIFIES-UNATTENDED, OBJ-NO-CREDENTIAL-IN-A-PROMPT | On a development-class installation an agent holding a development token calls the tool, opens the link in the browser it drives, and lands on the requested page signed in as the persona. |
| AC-SINGLE-USE | OBJ-NO-CREDENTIAL-IN-A-PROMPT | A minted link can be spent exactly once: a second exchange of the same token never mints a second session. |
| AC-EXPIRY-AND-TAMPER | OBJ-NO-CREDENTIAL-IN-A-PROMPT | A link older than ten minutes is refused, and a tampered link is refused. |
| AC-PRODUCTION-REFUSES | OBJ-REFUSED-WHERE-IT-DOES-NOT-BELONG | On a production-class installation the tool refuses unless the operator grant is recorded. |

**A note on AC-SINGLE-USE, added 2026-09-23.** §4 item 2 was written as "the
same link opened twice is refused the second time", which is how single use
shows up to a caller. A browser, however, may fetch the link twice by itself,
and the operator then sees a raw `UNAUTHORIZED` body while already signed in
(BI-D146D071). The invariant that matters is the one stated above: the token is
spent once and no second session is ever minted. A repeat request that already
carries the session that spending produced is shown its destination instead of
an error; a repeat request without that session, or with another, is still
refused.

## 6. Isolated permission verification (proposed 2026-09-27)

This extension is proposed under BI-9369DEB5, Workroom WC-EE471770. It is not
implemented or approved merely because the original document is binding.
It unblocks BI-1E56D891 and parent BI-B986A18B acceptance V6/V7/V9. The original
shared-persona flow remains compatible; the new fixture flow is strictly
development/test-only, even when production enables the original operator grant.

### Observed gap and decision

At deployed commit `0d827752665f790d3c4d3eba789ae908c45d78ba`, the issuer always
creates or selects `automation@dpf.local`; the consumer rejects every other
email. The MCP input contains only `nextPath` and `reason`. This proves browser
reachability but cannot prove differing current permissions. Changing that
shared superuser's roles would contaminate other sessions and would not test
ordinary role intersection. Coverage audit: `cmuke4c5a0biw01qspo3sf9uw`;
fixture prerequisite and matrix: `cmukegffm0j9m01qs6qdcyza9`.

WWMD `DI-0549069249CA` recommends accounts owned by each verification run over a
fixed shared pool, with high confidence and autonomy eligibility. The principal
contributors were reuse of the existing platform and standards. This settles
design direction, not independent design/plan approval or acceptance.

Research rechecked on 2026-09-27:

| Source | Adopt | Reject or constrain |
| --- | --- | --- |
| [Playwright authentication](https://playwright.dev/docs/auth) | Separate accounts and browser contexts for tests changing server state; reuse authentication within a run. | Shared accounts for concurrent permission mutation; committing saved browser state. |
| [Auth.js email authentication](https://authjs.dev/getting-started/authentication/email) | Existing platform exchange establishes a real session. | A second session issuer or credentials copied into test prompts. |
| [OAuth security BCP](https://www.rfc-editor.org/rfc/rfc9700.html) | The fixture follows ordinary consent, PKCE, scope restriction, rotation and revocation. | A test bearer bypass or a fabricated OAuth binding. |

### Ownership and data

Reuse User, UserGroup, Principal, EmployeeProfile, RuntimeVerification and
Workroom. A fixture is an ordinary non-superuser User, not a new identity kind
or coworker role. A fixture's role is its actual UserGroup membership; no
test-mode branch in capability, consent, tool, task or workroom authorization.

User presently has no verification ownership or expiry. Workroom JSON cannot
provide a foreign key or unique run/profile/slot membership, and email syntax
alone cannot prove provenance. Add nullable User fields for its owning
RuntimeVerification, a closed AutomationPersonaProfile enum, a bounded integer
slot and an absolute automation expiry. Add a unique run/profile/slot key and
an expiry index. Normal users retain nulls. The RuntimeVerification relation
uses restrict-on-delete while fixture users exist; audit must not disappear
through cascading deletion. No parallel user table or generic impersonation
grant is introduced.

The profile enum initially describes platform-manager, developer,
backlog-manager, employee and combined-developer-backlog-manager. Map these at
creation to the existing HR-000, HR-200, HR-500, HR-600 and HR-200 plus HR-500
role IDs, respectively, after validating the canonical role rows. All have
`isSuperuser=false`, including platform-manager. The profile records initial
fixture intent only; it never overrides current memberships. Missing roles
refuse provisioning. Creating or renewing a link never restores removed roles,
reactivates a disabled user, or extends its original expiry.

Use at most two slots per profile and ten users per run. The server creates
the RuntimeVerification under the authenticated actor's admitted Workroom and
shared verification lease. Its user-facing evidence remains ordinary runtime
verification evidence, not a new lifecycle. A caller cannot attach arbitrary
existing users to a run, select an email, supply a User ID, set superuser, or
edit fixture provenance through the new tool. Creation is transactional with
ownership, initial groups and an audit record; identity-spine failure must leave
an unusable fixture and an explicit recoverable error, never a signable orphan.

### Issuance and exchange

Extend `issue_ux_verification_sign_in` with an optional discriminated fixture
request: run creation binds a Workroom and current shared lease; subsequent
requests name the server-issued verification ID, profile and slot. Reuse the
same route, signer, consumer, next-path validation and Auth.js session encoding.
Refactor the current shared-persona helpers instead of duplicating them.

Fixture creation requires the current human's manage_platform, manage_users and
manage_user_lifecycle capabilities, the existing sandbox_execute coworker grant,
current OAuth consent/scope where applicable, and exact-room action admission.
The server derives human and coworker from ToolContext, never `reason` text.
The shared lease must belong to that admitted executor and point at this
installation; no caller URL or peer installation may choose the authority target.
Repeat issuance checks current requesting-human authority and run ownership.
Another human, task or Workroom cannot borrow the verification ID.

At both mint and exchange, require resolved development/test environment,
active run, live lease, matching persisted fixture provenance, unexpired
absolute lifetime and current principal signability. A generic production
automation grant does not authorize fixtures. Bind the signed link to the
exact user, run, profile, slot and originating requester, with the existing
ten-minute upper bound. Consume once using an atomic database conditional
write/unique claim; the existing read-then-upsert consumed map alone is not
sufficient for racing exchanges. Preserve the already-signed-in redirect
behavior without issuing another session.

Session expiry is capped by the fixture's absolute lifetime and lease, never
more than two hours. The standard current-user loader and identity signability
check must reject expired fixture users so an OAuth refresh family or stale
browser cannot outlive the fixture. This adds only a denial; it grants no
capability. A disabled fixture cannot obtain a new sign-in link, although its
previous session is deliberately retained by the harness to test current-role
and active-user enforcement. Every allowed action still passes the ordinary
authorization path.

### Cleanup, evidence and operational limits

Close only run-owned tasks through supported cancellation and confirm terminal
state before cleanup. A cancellation that returns to working/input-required is
an explicit failed cleanup, never permission to delete or reset the task.
Revoke only the fixture's OAuth consent/families, disable only its users, and
close only its rooms through governed actions. Repeated cleanup is idempotent.
An expiry backstop performs the same bounded cleanup if the client disappears;
immediate expiry checks deny further work even before that backstop runs.
Keep identity, consent, decision and verification records for audit under
existing retention policy. No global client revocation, shared role restoration,
table truncation, production deployment or grant-matrix edits are test cleanup.

Mint/consume/cleanup audit records correlate requester human, requesting
coworker, fixture user, run and Workroom. They never contain passwords, sign-in
JWTs, session cookies, bearer/refresh tokens, authorization codes or PKCE
verifiers. Browser traces must exclude sign-in URLs and OAuth token responses.
There is no new operator form: concise failures name the failed condition and
the supported recovery (for example, obtain a new lease and start a fresh run).
Do not tell users to create a legacy token or expose internal identifiers in
routine setup copy.

Creation is capped at ten users per run; active runs follow the existing lease
capacity. Expiry cleanup pages by indexed expiry and stable ID, at most 100
users per batch, with resumable progress. It must not scan the User table on
each action. The owning epic remains EP-ZERO-CONFIG-FEDERATION; increasing these
limits requires measured need and its own reviewed scope. This proposal adds
no package, service, background runtime or new authentication endpoint.

### Implementation and verification boundary

1. Add populated-database-safe nullable ownership fields, enum, relations and
   indexes; no guessed backfill and no changes to existing users.
2. Write failing ownership, environment, concurrent redemption, expiry and
   current-authority tests. Extract shared persona creation/session primitives
   under regression coverage (about 20% of effort), then extend the tool.
3. Add bounded, idempotent fixture retirement and expiry denial. Verify failures
   leave no live orphan and that a changed role is never repaired by renewal.
4. Run source tests/typechecks, canonical shared integration and protected PR
   gates. Deploy only through canonical release/self-upgrade before live proof.
5. Drive the original shared-persona flow and two isolated fixture contexts.
   Then run the actual OAuth V6/V7/V9 matrix under BI-1E56D891; provisioning
   passing does not by itself pass any parent OAuth acceptance criterion.

Update the build-gate runbook and OAuth acceptance plan in the implementation
branch. Rollback disables new fixture issuance while retaining expiry,
revocation and audit. Never reactivate fixtures or undo denial controls when
rolling back. Existing shared-persona callers that omit fixture input retain
their documented contract.

**OBJ-FIXTURE-ISOLATION:** Concurrent permission tests use ordinary isolated
users without changing another run or the operator's authority.

**OBJ-FIXTURE-AUTHORITY:** Test sessions use the real authorization path and are
bounded by current requester authority, environment and lifetime.

**OBJ-FIXTURE-AUDIT:** A run can be traced and retired without exposing secrets
or losing evidence.

| Criterion | Objectives | Statement |
| --- | --- | --- |
| AC-FIXTURE-CONCURRENT | OBJ-FIXTURE-ISOLATION | Two server-issued runs create distinct non-superusers; repeated same-run/profile/slot issuance returns the same user without resetting roles or expiry. Another run or human cannot sign in as that user. |
| AC-FIXTURE-CURRENT | OBJ-FIXTURE-AUTHORITY | Current requester capability loss, user disablement, foreign room/lease, missing roles, unknown profile and arbitrary User ID/email all refuse before session issuance. |
| AC-FIXTURE-BOUNDARY | OBJ-FIXTURE-AUTHORITY | Production, unknown environment and paired-peer targets refuse fixture issuance/exchange even with the legacy production automation grant enabled. |
| AC-FIXTURE-EXPIRY | OBJ-FIXTURE-AUTHORITY | Racing exchanges issue at most one session; tamper/replay/expired links refuse. Fixture expiry denies browser privileged actions and OAuth access/refresh; renewal never restores authority. |
| AC-FIXTURE-CLEANUP | OBJ-FIXTURE-ISOLATION, OBJ-FIXTURE-AUDIT | Cancellation-confirmed cleanup and expiry recovery affect only run-owned identities/consents/rooms; failed cancellation remains visible and audit remains readable. |
| AC-FIXTURE-AUDIT | OBJ-FIXTURE-AUDIT | Persisted mint/exchange/cleanup decisions correlate requester, fixture, run and room; captured evidence contains none of the actual test credentials. Audit failure cannot mint unaudited authority. |
| AC-FIXTURE-COMPAT | OBJ-AGENT-VERIFIES-UNATTENDED | Existing no-fixture sign-in, same-session redirect, normal users and populated databases retain their prior behavior. |

Independent review must approve this extension and its plan before runtime
implementation. The source audit and WWMD recommendation are not that receipt.
