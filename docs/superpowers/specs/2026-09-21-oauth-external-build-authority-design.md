---
status: draft
---

# OAuth identity and authorized external build orchestration

Backlog: BI-B986A18B. Workroom: WC-F174CC4F.
Decision: DI-3E8D81C1A2FB (consent-bound authorization).
Source baseline: 2e226dd6584c3dbc51e67ab6787523de2099a0e0.

## Outcome and boundary

An external coding task may orchestrate the same authorized build operations as
Build Studio on behalf of its authenticated human. OAuth setup must establish
an approved acting coworker without a legacy token. Authentication alone does
not grant build permission, coworker grants, task ownership or room admission.

The implementation is incomplete until fresh setup, old-connection recovery,
refresh, concurrent tasks and denied cross-user/room access pass on DEV.
BI-3C0A2D88 and BI-2B634E68 remain separate blocked work.

## Existing architecture and observed defects

Extend the MCP self-authentication design (2026-08-26), authenticated work
attribution design (2026-06-20), and unified delivery surfaces design (2026-06-05).
AuthorityBinding, its subjects/grants, DelegationChain and
AuthorizationDecisionLog already own delegation and audit. BI-E9018F3B and
BI-F82F4E04 are the existing authority-intersection and custody foundations.

The authorization code stores the human but no approved coworker. Token
issuance instead reads OAuthClient.agentId; DCR supplies none. Refresh copies
the missing value. A global client field cannot represent two humans' different
authorizations. Live AGT-EXT-CODEX has only registry_read, work_room_read and
work_room_write: repairing identity will not itself enable build execution.

Portal backlog promotion uses view_platform; MCP promotion uses manage_backlog.
Portal release actions call low-level executeTool after ownership checks;
the MCP catalog's operation capability is not checked by that dispatcher.
Current-user loading differs across portal, MCP and background loops. The
checkpoint build pipeline supplies a system actor in one code-generation path.
Explicit invalid build hints may fall back to another owned active build.
These are source findings, not successful unauthorized live executions.

The OAuth handoff adapter repair merged in #5481 at the baseline above. Reuse
its admitted OAuth context and revalidation; verify its deployment independently.

## Research & Benchmarking

- [OAuth Security BCP, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html):
  preserve PKCE, audience restrictions and refresh replay protection. Implement
  atomic rotation and family-wide revocation, including derived access tokens.
- [Ory Hydra consent](https://www.ory.com/docs/oauth2-oidc/custom-login-consent/flow):
  adopt the separation of login subject, client request and server-approved
  consent data. Do not import a second authorization server or copy an example
  that automatically accepts every requested permission.
- [Keycloak role scope mappings](https://www.keycloak.org/docs/latest/server_admin/index.html#_role_scope_mappings):
  adopt intersection of user roles and client scope. Reject full-scope defaults
  for external assistants; DPF must also intersect coworker and room authority.

## Identity contract (C1)

| Association | Owner and lifetime |
| --- | --- |
| Human | Existing User/Principal; accountable origin, current permissions |
| Client | OAuthClient registration; app metadata, not impersonation authority |
| Connection | Human + client + resource + approved coworker AuthorityBinding; revocable consent lifetime |
| Task | Existing work packet/task session/lease; exact build and room, bounded lifetime |

The client name is untrusted display data. The server resolves eligible
coworkers from approved delegation policy for this human and client/resource.
An active coworker or work_room_write grant alone is not eligibility. A
submitted agent identifier is revalidated on POST. The source-approved external
development roles may be consented to by a human with current Build Studio
access. Other coworkers require an administrator or an exact human/client/
resource delegation. The displayed role is an assignment, not verified vendor
identity: self-declared "Codex" or "Claude" supplies no authority.

Reuse AuthorityBinding.appliedAgentId and human/client subjects. Each consent
revision is a new binding record; do not mutate the identity/scope of issued
authorizations. Codes, access tokens and refresh tokens gain nullable FK links
to that immutable binding. Revocation changes status, not historical identity.
Use typed discriminators for added closed-set states and indexed FK lookups.
Existing null rows stay null: no name-based backfill and no global client edit.

## Consent and recovery (F1, F2)

GET shows the signed-in person, app (with self-asserted label where applicable),
approved assistant role and understandable allowed actions. If one role is
eligible, explain it without an unnecessary picker; otherwise show only
eligible options. **Superseded 2026-09-23 by the one-click connection
amendment below (BI-05E0EA33): the server resolves the assistant and
shows a choice only when eligible coworkers differ in authority.** POST rechecks login, active user, current delegation policy,
client, redirect, PKCE, resource and narrowed scopes before issuing a code.
Persist binding, code and successful consent audit atomically.

Missing identity returns a typed setup-required result at coworker-dependent
tools with a same-install recovery destination. Copy: "This connection needs
one more setup step before your assistant can work. Reconnect to approve its
role." Do not reveal agentId, ask users to mint tokens, or imply room admission.
Recovery starts a fresh client OAuth authorization; it does not put old tokens
in browser URLs or change their authority. Revoke the superseded connection
family when replacement is confirmed. Never revoke another user's connection.

## Credential lifecycle (C2, F3)

Code exchange derives human, coworker, resource and scopes from the consumed
authorization binding, never from mutable client.agentId. Confidential
client_credentials remains explicitly configured and independently tested.

Exchange consumes the code and creates credentials transactionally. Refresh
atomically consumes once and issues one successor; replay revokes the family
and derived access credentials. Add an explicit indexed family relation/key
on the existing credential records rather than walking an unbounded chain.
Validate binding, client and human activity on resolution and refresh. Scope
requests can narrow only. Revoked or missing bindings return invalid_grant for
refresh with a reconnect explanation. Legacy unbound refresh cannot repair
itself or gain identity. Preserve ordinary allowed read behavior where it does
not require coworker identity; never pass unbound credentials to room actions.

One OAuth approval covers transport reconnections and concurrent tasks. Normal
refresh is silent. Task idempotency uses the server-issued credential family,
not an access-token row. Queued execution may survive access-token expiry only
when a current successor preserves the same human, client, consent, resource,
coworker and scope envelope. Expired bearer authentication remains refused.

## Operation authority and attribution (C3)

Effective authority is the intersection of current human permission, token
scope/grants, approved connection binding, coworker grants, task scope, room
admission and existing policy/approval gates. No component may widen another.

Create a single operation policy consumed by portal actions and MCP, delegating
to the existing coworker authority decision. Preserve read/view permissions;
promotion requires manage_backlog, execution requires the existing start_build
capability, and release operations retain their existing stricter capability.
No new blanket build-admin role. Test each operation's mapping explicitly.
Consolidate current user resolution (all roles, active status); privileged
actions and queue resumes must reload authority rather than trust login claims.
Carry originUserId through background execution and delegate hops. System
service identity cannot substitute for the initiating human's authority.

Define external orchestration grants from the exact planned operations and
existing registry vocabulary. Keep deployment/production promotion outside
the default development role. Seed policy changes through source; existing
install grant changes require the governed approval flow, not direct DB edits.

## Task and workroom boundary (C4, F4)

Use the existing work packet/session/lease flow (BI-D4C110BC). Bind task context
to the authenticated connection, human and exact work item. A client thread
label is correlation only; task isolation requires server-issued narrowed task
credentials. Reject explicit missing/foreign build targets instead of falling
back. Shared coworker identity cannot let another human/task inherit room
admission. Recheck human, task and room authorization for reads and writes.

## Audit, scale and rollback

Correlate human, client, binding, coworker, task, build/room and delegation chain
on allow/deny decisions. Never log bearer secrets. Consent audit persistence
failure must not produce unaudited new authority. Retain existing lifecycle
policies for credential/audit records; paginate connection lists (50 per page),
index family/binding revocation, and avoid scanning all clients or rooms on an
action. No new cross-install service or inventory sweep is required.

Use additive nullable migrations first; exercise populated and clean databases.
Do not backfill guessed identities. Rollback disables new issuance while
retaining deny/revocation semantics and audit records; never restore a revoked
family or fall back to legacy tokens. Existing confidential clients need a
compatibility regression suite. UI uses existing theme primitives and consent
rendering, with keyboard, light/dark and refusal/recovery verification.

## Acceptance (V1-V9)

**OBJ-1:** Establish a revocable, consent-bound external coworker identity.

**OBJ-2:** Enforce the current human's authority across build surfaces and tasks.

**OBJ-3:** Make setup, recovery and evidence understandable and auditable.

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | V1 and V8 prove authorized fresh OAuth identity without client-name impersonation. |
| AC-2 | OBJ-1 | V2 and V3 prove safe existing-connection recovery and atomic refresh without authority expansion. |
| AC-3 | OBJ-2 | V4 and V5 prove task, user and room isolation. |
| AC-4 | OBJ-2 | V6 and V7 prove current human permissions and surface parity, including queued execution. |
| AC-5 | OBJ-3 | V9 proves actionable setup/refusals and complete secret-free audit correlation. |

1. V1: fresh OAuth consent produces approved identity and permitted exact-task
   build/evidence actions without granting room access automatically.
2. V2: old identity-less connection recovers through consent; old credentials
   never gain identity; changed consent does not affect another user.
3. V3: refresh preserves binding and scope; concurrent rotation and replay have
   one successor or safe family revocation; revoked access cannot be reused.
4. V4: two concurrent tasks under one connection keep targets/evidence separate;
   invalid explicit target fails; one expired lease cannot affect the other.
5. V5: another user with the same client/coworker cannot borrow permission,
   ownership, task credentials or room membership; read-only remains read-only.
6. V6: user disablement, role/grant removal and room revocation take effect at
   the next privileged action, including queued/resumed execution.
7. V7: portal/MCP role-by-operation matrices agree on human authority, while
   external delegation restrictions remain additive; server actions cannot
   bypass release checks.
8. V8: spoofed app names/agent identifiers fail; foreign resource, PKCE, client
   and scope attacks remain denied; client_credentials remains compatible.
9. V9: nontechnical setup/recovery and all refusal states work on DEV, and audit
   traces the complete authority chain without secrets.

## Review status

## Ordered implementation and backlog coverage

Implementation parent: BI-B986A18B. This fix design is its canonical ordered
implementation artifact; the companion plan is explanatory only.

1. BI-B986A18B: consent binding, code/access/refresh custody and safe recovery
   implement C1/C2 and F1-F3; verify V1-V3/V8. These are atomic internal steps.
2. BI-1E56D891: shared current-human operation policy, queue attribution and
   the explicit external development grant profile implement C3; verify V6/V7.
   This is independently shippable and is not a new authority substrate.
3. BI-D4C110BC: narrowed task credentials and exact build/workroom association
   implement C4/F4; verify V4/V5. Integrate after identity and operation policy.
4. BI-D6D79AC4: human-owned connection management and recovery presentation
   integrate F2 with the existing connection UI; verify V2/V9 after step 1.
5. BI-B986A18B acceptance: exercise V1-V9 on the deployed candidate, reusing
   BI-FB58767A's already-merged OAuth handoff repair. No phase grants room access
   automatically. Formal live coverage receipt is pending.

### Reproduction evidence

On source ee44d214b7cbbefc9725121b7de0b562c0999282, the new isolated
oauth-identity-binding.test.ts reproducer failed: createAuthorizationCode
omits authorityBindingId from its persisted data. The existing oauth-security,
oauth-authorize-request and oauth-scope-map suites passed 74 tests in the same
worktree. Those runs distinguish binding loss from broken PKCE/request parsing
or scope mapping. They do not establish a passing implementation or live proof.

## Review state

Implementation admitted under IRD-A8107E37E8CF and coverage receipt
cmubxupm50wg301ru404n27ll. The initial committed identity lifecycle passed the
canonical gate at afd62e4f095f1afb31a8a2bd492c468b05b746b1, evidence
cmuc1na3g165e01mkk2eyj7jq. Subsequent human-authority and task-continuity changes
landed in #5549 and deployed at 5c52f711c98c22a864867b40b6dd6229b7d285ad.
Fresh consent, old unbound recovery, silent refresh, replay revocation and two
concurrent tasks passed live. Positive room evidence remains unaccepted.

### Supported data-access setup after live acceptance

Decision DI-A8F0093A0CAF extends BI-B986A18B in WC-BDBAFFC7. Agent Principal
clearance intentionally defaults to public; new workrooms default to internal.
The live test confirmed both canonical and legacy external identities remain
public. No existing source/UI path writes this coworker clearance.

Extend the existing AI Coworker Identity surface with one on-demand editor.
The signed-in human must currently hold manage_agents and may assign only
levels in their recorded Principal clearance. Keep defaults and existing rows
unchanged until explicit Save. Use the existing typed Principal field, a
compare-and-set update and AuthorizationDecisionLog in one serializable
transaction. Record human, assistant, before/after access and rationale.

The setting affects the selected coworker across connections, visibly explained
before Save. Current human permissions, scopes, coworker grants, room admission
and action approval gates remain independent intersections. Existing tokens
pick up grants and revocations on their next operation without new consent.
Return a data-access recovery link for an insufficient-clearance refusal;
retain the invitation explanation for an admission refusal. Do not automatically
admit the coworker to existing rooms or override explicit public-only limits.

### Existing-room recovery and author evidence

DI-0F2E1820E309 extends the same repair in WC-BDBAFFC7. Add an on-demand
assistant invitation in the selected room's Participants section. The signed-in
owner chooses an assistant from their active, server-approved OAuth bindings.
An active human, exact room ownership, current clearance and active assistant
identity are checked server-side. Persist only that WorkroomParticipant row and
an audit in one transaction; never write every room under its WorkItem.

OAuth calls targeting a capsule resolve both principals against that exact
room. Active participant roles distinguish content from action. An explicit
inactive assignment denies access despite historical creator/holder references.
Sibling-room holder references never supply admission. Existing case-wide
policy remains an additional restriction, not an implicit invitation to every
child room. Unanchored rooms use their declared boundary or the internal default
and receive the same clearance checks; ownership is not a clearance bypass.

The invitation grants no user capability, tool grant, OAuth scope or review
authority. Saved access applies to the existing connection's next operation.
External development author profiles gain only initiative_evidence_write under
BI-1E56D891, preserving explicit grant revocations and independent reviewer
grants. The existing author lane still checks manage_backlog for the current
human. No production or administrative grant is added.

Acceptance includes siblings sharing one WorkItem, foreign users sharing an
assistant, removed participants, observer versus contributor, unanchored-room
clearance, atomic audited invitation, and existing-token use without new consent.

### Consent steers routine writes (BI-12E5DD91)

WWMD DI-178749D7F5BD extends C3. External assistants seed at HITL tier 1, and
the MCP route supplied no steering, so every non-damaging write reached the
escalation gate's `unsteered-side-effect` branch. A human who had consented to
the assistant then clicked through generic cards, while the same human on a PAT
was never asked. The access-token resolver already revalidates the consent
binding on every call. The route now passes that binding as
`connection-delegation` steering, which the existing gate treats like any other
recorded delegation. Damaging, restricted and proposal-shaped actions still
reach a person, because gate branch 4 precedes steering. PAT, session and
client-credentials tokens, unbound connections and a different acting coworker
steer nothing. Independent review lanes are unchanged. Each decision log row
records the escalation branch and the consent binding. Approval cards show the
exact proposal, found by the envelope id on the pending execution, and state
that authorizing is not review.

## One-click connection (BI-05E0EA33, amendment 2026-09-23)

Backlog: BI-05E0EA33 (triaging; no implementation authorized by this text).
Baseline read: origin/main 5d3757539 and the live install on 2026-09-23.
Kernel grounding: [automation is measured by the human steps it removes](../../founder-kernel/wiki/principles/automation-is-measured-by-the-human-steps-it-removes.md),
with [human in the loop at phase boundaries](../../founder-kernel/wiki/principles/human-in-the-loop-at-phase-boundaries.md) and
[show the consequence before the confirm](../../founder-kernel/wiki/principles/show-the-consequence-before-the-confirm.md) setting the floor
below which no step may be removed.

This amendment supersedes one sentence of F1 above: *"If one role is
eligible, explain it without an unnecessary picker; otherwise show only
eligible options."* The picker was the fallback, and on every real install
it is the only branch that runs (see "Why the picker always shows" below).
Everything else in C1, C2, F1 to F3 and V1 to V9 stands unchanged; this
section removes a decision from the consent screen and adds none.

### Operator request

On 2026-09-23 the founder connected Codex. The consent page already said
"Codex wants to work in this operator install" and then required choosing "Codex
(external CLI)" from a three-entry dropdown. Founder: "the need to select
what's already on the screen is cognitive load and cost that's unnecessary
... Something to be one-click." The request is to remove the decision, not
to relabel it.

### Measured as-is (the baseline the principle requires)

The principle scores a delta, and a delta needs a counted current state.
Counted on the live install from `OAuthClient`, `AuthorityBinding`,
`AuthorizationDecisionLog` and the consent renderer on 2026-09-23.

| Path | Human operations today | Decisions | Observed |
|---|---|---|---|
| Fresh connect, signed in | open dropdown, pick assistant, click Approve = **3** | **1** (three options) | 13:37 consent bound Codex to `AGT-EXT-CLAUDE`; redone at 14:17 as `AGT-EXT-CODEX`. The wrong pick cost a full second cycle: register, consent, exchange. |
| Reconnect (new `codex mcp login`) | same **3** | **1** | Every login registers a **new** DCR client row (4 Codex rows, 10 Claude Code rows on this install). A consent binding is keyed on the client row, so no prior binding ever matches and the whole screen, picker included, comes back. |
| Refresh inside the 30-day window | **0** | 0 | Silent rotation, binding revalidated. Already correct. |

Two ledgers: this change touches only the customer-facing ledger. It adds
no step to platform delivery.

### Why the picker always shows

Three findings from `apps/web/lib/auth/oauth-identity-binding.ts` and the
live tables, not from the screen:

1. **The eligible set is always three.** `eligibleOAuthCoworkers` offers
   every source-approved external development role (`AGT-EXT-CLAUDE`,
   `AGT-EXT-CODEX`, `AGT-EXT-GROK`) to any human with `view_platform`. The
   single-eligible collapse in the renderer exists but cannot fire for a
   builder, which is every human who connects a coding client.
2. **The three roles are authority-identical.** Live: the same thirteen
   tool grants each, zero revocations, clearance `{public}`, tier 2, HITL
   tier 1, sensitivity `internal`. Choosing between them changes attribution
   (which coworker name appears in a room) and nothing a token can do. The
   dropdown asks the human to make a decision that decides nothing about
   authority, which is exactly the click the principle says to remove.
3. **The human is transcribing an untrusted name.** The heading shows the
   self-asserted `client_name`; the dropdown asks the human to re-enter it
   as a role. That transcription is where the mis-selection happened. The
   server can do the same comparison deterministically, and unlike the
   human it can also prove the candidates are authority-equivalent first.

The delegation branch of the resolver (an active `delegation` binding for
this human, client row and resource) is structurally dead for DCR clients
for the same reason reconnects re-consent: the client row is new each time.

### Candidate approaches

| | A. Server-resolved default, one Connect action, optional Change | B. Portal-initiated "Connect Codex" intent bound to the OAuth request | C. Keep the picker, pre-select it |
|---|---|---|---|
| Operations on fresh connect | 1 click, 0 decisions | 1 portal click + the client's own login, then 1 consent click; 2 to 3 | 1 click, but a visible dropdown still asks to be read |
| How the role is chosen | Server policy over the eligible set, authority-signature check, prior consent, then label match | Human picks in the portal first; the OAuth request must then be matched to that intent | Untrusted name pre-selects; human confirms |
| Binding the choice to the request | Same request, same screen; nothing to correlate | The client controls the authorize request and carries no intent id; `resource` canonicalisation strips any query hint, so correlation falls back to session plus recency heuristics | Same as A |
| Substrate added | One resolver function, one hidden default fingerprint, screen copy. No table, enum, grant or migration | Intent table, TTL policy, portal page with its purpose contract, correlation rule | None |
| Handles genuine ambiguity | Yes: a specific choice is shown only when candidates differ in authority | Yes, by moving the choice earlier | No: still a generic picker |
| `human_cognitive_load` (cost axis, higher is worse) | Low: one legible screen, one button | Medium: two surfaces, and the human must understand the intent expires | Medium: the dropdown is still on screen |
| `operator_effort` | Low | Medium | Low |
| `blast_radius` | Low: consent renderer and resolver only; POST contract unchanged | Medium: new pending-flow state the token path must honour | Low |
| `legibility_of_consequence` | High: the recorded identity is named on the button and the line above it | High | Medium: identity hidden in a control |

**Recommendation: A.** B moves the step rather than removing it, adds
state, and its only advantage (a human-declared role when policy cannot
decide) is covered by A's specific-choice fallback. C keeps the control the
founder asked to remove.

**Kernel decision recorded 2026-09-23: `DI-673B7C9162D9`.** `principle_decide` scored the three options above with `human_cognitive_load` supplied as the principle requires and recommends A (confidence high, verdict proceed); the outcome is recorded as followed, A having merged in PR #5572 as e3d778b. The hand-scored table stays as the audit trail of the inputs.

### Design (approach A)

**Resolution runs on the server, once, from facts the server owns.** A new
`resolveDefaultOAuthCoworker(human, client, resource, eligible)` beside
`eligibleOAuthCoworkers` in `apps/web/lib/auth/oauth-identity-binding.ts`
returns one of three typed outcomes; the closed set is a TypeScript union
now and becomes a Prisma enum only if it is ever persisted.

1. `single`: exactly one eligible coworker. Unchanged behaviour.
2. `resolved`: several eligible coworkers that all share one **authority
   signature**, plus the coworker the policy chose and why.
3. `choice`: eligible coworkers whose signatures differ, with the
   least-authority candidate first and a one-line reason per candidate.

**Authority signature** is derived, never stored: the coworker's effective
tool grants (`AgentToolGrant` minus `AgentToolGrantRevocation`, through the
existing helpers in `apps/web/lib/tak/agent-grants.ts`), its `Principal`
`sensitivityClearance`, its `hitlTierDefault` and `sensitivity`. Two
coworkers with equal signatures are interchangeable for everything the
token can do; the consent then chooses a name, not a power.

**Within an equal-signature class the label is chosen in this order**, and
each rule is a lookup over existing rows:

1. The coworker on this human's most recent active `consent` binding for
   this resource whose client has the same self-asserted name and the same
   redirect family (scheme, host and path with the loopback port ignored,
   the same comparison `isRedirectUriAllowed` already makes). This is what
   makes a reconnect land on the same assistant without a question.
2. A coworker whose registry aliases (`agent_registry.json`, for example
   `codex` for `AGT-EXT-CODEX`) match the client's self-asserted name,
   case-insensitively, as a whole word.
3. The alphabetically first eligible coworker, so the outcome is total and
   deterministic.

A self-asserted name therefore picks a **label within a class the server
has already proven authority-equivalent**. It can never select a coworker
outside that class, never widen a scope, and never bypass eligibility,
because the eligible set and the signature check run before the name is
looked at. This is the same information the human was being asked to
transcribe, applied after a check the human could not perform. Forged
names are covered below.

**The screen** keeps its shape and loses its controls.

- Heading unchanged: "`<client_name>` wants to work in `<installation>`",
  with the self-asserted warning for DCR clients exactly as today.
- One consequence line, in the platform's words, before the button:
  "It will work as **Codex (external CLI)** under your account. Change".
  `Change` is a disclosure that reveals the existing eligible list; the
  default flow never shows the list. For a `choice` outcome the disclosure
  is open, the candidates are named with their difference in one line each,
  and the least-authority candidate is pre-selected.
- Permissions are a plain list in the default flow, drawn from the same
  `PUBLIC_SCOPE_COPY`. "Adjust permissions" is a disclosure that reveals
  today's pre-ticked checkboxes. The POST contract does not change: the
  human can only remove authority, never add it.
- One primary button, "Connect `<client_name>`" (escaped, truncated), and
  Cancel. "Connecting to" and "Returns to" stay, because the consequence
  must be visible before the confirm.
- The revocation footer stays.

**The POST trusts nothing the GET showed.** It already re-parses the
request and re-runs eligibility. It additionally re-runs
`resolveDefaultOAuthCoworker` and compares the result to a hidden
`default_coworker` field the GET rendered. If the human made no change and
the server's answer is the same, that coworker is bound. If the answer
differs (eligibility or signatures changed between GET and POST), the POST
re-renders the screen with the new answer instead of binding anything. If
the human chose from the disclosure, the chosen id must be in the eligible
set, as today. A client-supplied `acting_coworker` is still never echoed as
a hidden identity.

**Reconnect.** Rule 1 above removes the role question on every reconnect
while the assistant, its signature and the scopes are unchanged. The
consent click itself stays on every new DCR registration. That click costs
one and exists to be seen: a public loopback client with a fresh
`client_id` cannot prove it is the same program, so an auto-approval would
let any local process that can reach `/register` and open the operator's
browser obtain a token silently under a previous envelope. The principle's
own example draws this line: an approval whose outcome the platform can
already determine is removed; a step that exists to be seen stays. Whether
an operator-pinned, pre-registered client may skip the click within the
refresh window is an open decision below.

**Refresh** is unchanged and already silent.

**What this does not touch.** Eligibility, scope intersection, coworker
grants, clearance, room admission, revocation, family rotation, the
`AuthorizationDecisionLog` row, the resolver's use of `appliedAgentId`, the
three external registry identities and every acceptance in V1 to V9.

**What was considered and rejected.** Merging the three external roles
into one identity with the vendor as a label would remove the class
altogether. It is a substrate change with reach into room participants and
the surface-claim skills, so it is not admissible as a UX fix; if the
vendor split proves to be labelling only, that is its own item. Persisting
a per-human "default assistant" preference is unnecessary once rule 1
exists and would be a second source of truth for the same fact.

### Security invariants

- A forged `client_name` can at most change which of several
  authority-identical labels is recorded, and the screen still marks it
  self-asserted. It cannot reach a coworker outside the eligible set,
  cannot escape the signature check, and cannot widen scopes.
- The signature check is a strict equality over derived sets; an admin
  delegation that adds one grant to one candidate turns the outcome into
  `choice`, never into a silent default.
- The POST re-derives the default and refuses on drift, so a screen
  rendered before a policy change cannot bind the identity it showed.
- Nothing is auto-approved for a DCR client. Revocation, room admission and
  `OAUTH_SETUP_REQUIRED` recovery are unchanged.

### Acceptance criteria

**OBJ-OC-1:** a signed-in human connects a supported client with one
consent click and no role decision.

**OBJ-OC-2:** the server, not the client name, decides authority; the name
may only label.

**OBJ-OC-3:** the removal is measured on live paths.

| Acceptance | Objective | Required outcome |
|---|---|---|
| AC-OC-1 | OBJ-OC-1 | Fresh Codex connection by a human with build permission: one click on Connect, zero selections, zero command or file-edit instructions from DPF. The binding records `AGT-EXT-CODEX`. |
| AC-OC-2 | OBJ-OC-1 | Reconnect after a new DCR registration with unchanged scopes lands on the same assistant with no role question; refresh stays silent. |
| AC-OC-3 | OBJ-OC-1 | Default flow shows app, installation, acting human, assistant, permissions, resource and return address; no dropdown, no checkbox, no internal CLI taxonomy beyond the assistant's display name. |
| AC-OC-4 | OBJ-OC-2 | With an admin delegation that gives one eligible coworker a different signature, the screen presents a specific choice with the least-authority candidate first; with equal signatures it presents none. |
| AC-OC-5 | OBJ-OC-2 | A client registered as "Codex" by a human without build permission is refused as today; a client named "Claude Code" that is actually Codex is recorded under the Claude label with no change in what it can do; a hostile name is escaped and marked self-asserted. |
| AC-OC-6 | OBJ-OC-2 | POST re-derivation: if eligibility changes between GET and POST, no code is issued and the screen re-renders. Tampered `default_coworker` or `acting_coworker` outside the eligible set is refused. |
| AC-OC-7 | OBJ-OC-3 | Clicks, decisions and elapsed time recorded on a live first connect and a live reconnect for Codex and Claude Code, before and after, in the item's evidence. Target: 3 to 1 operations, 1 to 0 decisions on both paths. |

### Open operator decisions

1. **Pinned-client skip.** Should an operator pre-registered client with an
   active consent for the same human, scopes and assistant skip the click
   on reconnect within the refresh window? Recommended **no** by default,
   because a loopback public client cannot prove identity even when pinned;
   offered as an explicit per-client setting if wanted.
2. **Display names.** The three external roles are labelled "`<vendor>`
   (external CLI)". The default flow shows that once. If the parenthetical
   is unwanted on the consent screen, the fix is the registry seed, which
   also changes the label in rooms and reports; this amendment does not
   change it.
3. **Unused registrations.** Ten DCR rows on this install never reached
   consent (two registrations per Codex login). Expiring never-consented
   registrations was named in the 2026-08-26 design §7.3 and belongs to
   BI-D6D79AC4, not here.

### Ordered implementation and backlog coverage

No implementation is authorized by this text; BI-05E0EA33 is in triage and
this is the design extension it asked for. When admitted:

1. Failing tests first in `oauth-identity-binding.test.ts` and
   `oauth-consent-page.test.ts`: signature equality across the three
   external roles, rule 1 reconnect match, alias match, deterministic
   fallback, `choice` on a divergent delegation, POST drift refusal, no
   echoed client identity.
2. `resolveDefaultOAuthCoworker` and the signature derivation, reusing the
   grant helpers; no schema change.
3. Consent renderer: consequence line, disclosures, single button, hidden
   `default_coworker`; POST re-derivation in the authorize route.
4. Live measurement for AC-OC-7 on the canonical runtime, both clients,
   recorded as evidence on the item.
5. Docs: the MCP tool authorization runbook's setup paragraph and the
   2026-08-26 design §4.6 pointer.

Coverage: atomic under BI-05E0EA33. The parent decision id is pending the
kernel recording named above.
