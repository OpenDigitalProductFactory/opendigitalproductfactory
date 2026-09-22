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
submitted agent identifier is revalidated on POST. Vendor-specific identity
requires an operator-approved binding to this registration; self-declared
"Codex" is insufficient. A generic approved external role may be offered
without claiming verified vendor provenance.

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
eligible options. POST rechecks login, active user, current delegation policy,
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

Draft for immutable design review. No implementation, migration or acceptance
gate has passed. Formal baseline and coverage receipts remain prerequisites.
