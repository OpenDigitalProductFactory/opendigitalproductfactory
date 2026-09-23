---
status: draft
---

# OAuth external build authority implementation plan

Status: OAuth repair deployed in #5549; live acceptance remains incomplete.
Parent: BI-B986A18B. Workroom: WC-F174CC4F.
Design: ../specs/2026-09-21-oauth-external-build-authority-design.md.

Deliver consent and its human/task authority protections as one reviewable
repair under BI-B986A18B, with linked coverage below. Use dpf-tdd for red-green
implementation, dpf-local-merge-ci-before-push plus the completion gate before
any success claim, and dpf-pr-with-dco for handoff.

## Sequence and delivery boundaries

### Live acceptance follow-up: coworker data access

Workroom WC-BDBAFFC7; decision DI-A8F0093A0CAF. On deployed 5c52f711,
fresh consent, identity, silent refresh, refresh replay revocation and concurrent
task continuity passed. New own-room writes failed after exact operation approval:
the coworker's recorded clearance is public while the room requires internal.
Canonical and legacy external identities share this intentional public default.

1. Add a tested, audited writer for the existing Principal clearance field.
   Require current manage_agents permission and an active human principal;
   assigned levels must be within that human's recorded clearance. Reject stale
   edits; commit audit and permission together. No seed, backfill or schema change.
2. Extend the existing AI Coworker Identity page with an accessible data-access
   setting. Show the current restriction and scope of the change before Save.
   Preserve defaults, tool grants, approval policy and separate room admission.
3. Explain that saved access applies to existing connections without another
   login. A different user's permissions still bound every interaction.
4. Test nonadministrator, inactive human/agent, out-of-scope level, stale save,
   audit failure, revoked access and existing-token behavior. Retest positive
   own-room evidence and negative cross-user/room cases on the canonical image.

This follow-up does not claim full OAuth acceptance or change the approval
policy. Legacy human-only rooms still need a supported explicit admission action.

### Complete existing-room recovery on the same governed branch

Decision DI-0F2E1820E309; coverage BI-B986A18B (room recovery) and BI-1E56D891
(external author profile). Extend PR #5558 before queueing its final head.

1. Reproduce cross-sibling admission and unanchored-room clearance gaps. Add an
   exact-room resolver using existing Principal, participant lifecycle/roles,
   boundary and case policy. Keep case-wide messaging semantics separate.
2. Add an owner-authenticated, transactional assistant invitation and audit.
   Select only active assistants already approved in that human's OAuth setup.
   Treat existing observer/contributor assignments explicitly; never replace
   coordinator or reviewer assignments through this recovery control.
3. Add the on-demand control in Participants, carrying the already selected
   workroomRowId from the case detail. Explain room-only scope and show refusals.
4. Add the author evidence grant to canonical and legacy external profiles;
   test that independent review/admin/deployment grants remain absent.
5. Run targeted negative and UI tests, exact-head canonical gate and independent
   review. Update PR scope and evidence, pass protected checks and merge queue.
6. Deploy canonically; verify real OAuth evidence, room recovery, denied users
   and siblings, refresh and concurrent tasks. Keep the parent unaccepted until
   the complete matrix passes. No DB authorization edits or token substitution.

The extension now includes exact legacy identities in the administrator's
data-access selector, without changing the deduplicated identity cards or
requiring a replacement connection. The room editor loads current participation,
preserves contributor access on reopen, and blocks selection changes during Save.
Missing case admission fields differ from explicit empty restrictions; a
sensitivity-only policy does not invent a membership denial. Removed membership
still overrides historical ownership.

CI follow-through: the identity page's deliberate new control requires the
supported measured route-baseline refresh. Splice only that route, retaining
its word and accessibility budgets. CodeQL's credential-name heuristic treated
the fixed refusal result of oauthCapsuleTargetRefusal as a password and followed
it into the existing transient HMAC redaction vault. Rename that result helper
to workroomTargetAccessRefusal to describe its actual output; do not change
cryptography, credential handling, or suppress the security rule.
The primary rule sources are CodeQL's
[sensitive-call classification](https://github.com/github/codeql/blob/main/javascript/ql/lib/semmle/javascript/security/SensitiveActions.qll)
and [credential-name heuristic](https://github.com/github/codeql/blob/main/shared/concepts/codeql/concepts/internal/SensitiveDataHeuristics.qll).

Grant convergence uses the existing boot seed on canonical and legacy profiles;
both seed paths honor AgentToolGrantRevocation tombstones. The author-only grant
does not add independent review, administrator or deployment authority. Data
clearance and room admission still require explicit supported setup.

1. Identity lifecycle (BI-B986A18B): extend core-identity.prisma and forward
   migration; auth/oauth-tokens.ts, oauth-consent-page.ts, authorize/token
   routes and MCP identity-required responses. Consent binding, recovery and
   rotation form one atomic credential-security change. First fail V1-V3/V8
   regressions, then implement and test migration on clean/populated data.
2. Operation policy and attribution (independently shippable; BI-1E56D891):
   govern/permissions.ts, authority resolver,
   mcp-governed-execute.ts, actions/backlog-build.ts, actions/build-release.ts,
   build/build-pipeline.ts and tak/agentic-loop.ts. Share current-human and
   operation policy without weakening any release gate. V6/V7 first. Allocate
   about 20% of total effort to this focused refactor.
3. Task/workroom isolation (coordinate BI-D4C110BC): mcp/build-tool-helpers.ts,
   existing task session and room admission services. Reject explicit invalid
   targets; bind narrowed task authority to human/connection/work item. V4/V5
   first, including read denial and evidence attribution.
4. External orchestration grants (BI-1E56D891, internal sequencing of step 2):
   exact operation-to-grant matrix
   and source registry policy; no blanket Build Studio grant copy. Depends on
   steps 1-3; verify V1/V5/V6 without changing live authorization via DB.
5. Connection management (BI-D6D79AC4): expose human-owned authorizations,
   recovery and per-connection revoke. Do not assign global DCR ownership to
   the first consenting human. V2/V9.
6. Reuse handoff repair BI-FB58767A / PR #5481, merged at source baseline
   2e226dd6584c3dbc51e67ab6787523de2099a0e0. Validate deployed OAuth authority
   preservation and reviewer delegation rather than implementing it again.

## Test and completion gate

Resolve a new changeImpactContract when implementation paths are claimed.
Current documentation impact is resolved, with no testImpact/guardObligation;
it does not exempt subsequent source changes. Update the generated doc index.

Start with oauth-security.test.ts, oauth-consent-page.test.ts,
oauth-authorize-request.test.ts, coworker-authority-decision.test.ts,
resolve-coworker-tool-authority.test.ts and build-tool-helpers.test.ts. Add
transaction/concurrency tests for credential rotation and role-by-operation
tests covering portal, MCP and resumed jobs. Confirm failures before fixes.

Run affected tests and fast checks in a managed compile-ready worktree; this
worktree has a managed compile-ready dependency environment. Runtime/migration/UI evidence uses
the governed shared nonproduction lease and exact candidate SHA. Cloud build,
PR health and live DEV V1-V9 complete acceptance; do not describe structural
checks as functional proof. Release through the canonical upgrade mechanism.

## Backlog coverage

Decision: decomposed. Reviewed baseline: baseline-3cdbe047-532c-4470-ac13-1cbdb096b6a6.
Coverage receipt: cmubxupm50wg301ru404n27ll.
Implementation admission: IRD-A8107E37E8CF. Existing mappings
are listed above; BI-1E56D891 was filed after live overlap reconciliation for
the independent operation-policy defect. The parent remains unaccepted until the complete live matrix passes.

## Risk and rollback

Primary risks are authority expansion, stale permission reuse, refresh races,
cross-task target confusion and confidential-client regression. Use the
design's additive migration and fail-closed rollback; preserve audit and
revocation. Popup and duplicate-hook repairs remain outside this plan.

## Implementation progress

Consent binding, credential-family rotation and MCP recovery responses are in
progress in the governed source worktree. The binding uses typed nullable
human/client foreign keys on AuthorityBinding for relational integrity and
indexed eligibility, with no guessed backfill or duplicate subject strings.
The public coworker identifier is carried into MCP; the database key is used
only for refresh-token and binding relations. Consent audit links directly to
the binding. Generic binding edits cannot rewrite issued consent.

Focused tests include public/database identity custody, cross-human/client/
audience/scope denial, disabled users, missing consent, narrowed refresh,
replay-family isolation and actionable MCP setup refusals. These use mocked
persistence; actual transaction concurrency, migration and browser acceptance
still require the leased candidate runtime. Current-human policy, exact build
targeting, OAuth task continuity and human/coworker room intersection now have
source implementations and focused regression tests. Connection-management
and final live acceptance remain open. Nothing in this note
claims that an installation upgrade contains this unmerged implementation.

The shared current-human resolver replaces separate first-role/session-claim
checks in MCP, portal release actions, queued execution and the agent loop.
This is the focused refactor portion of the repair. The source-approved external
development profile permits coordination and development; deployment and
administration remain excluded. Registry and workforce seed sources agree,
and existing grant revocation tombstones remain respected.

The room regression first reproduced cross-human content and action admission
through a shared coworker. The resolver now requires both human and coworker
admission; 27 related room tests pass. A live release task also reproduced
duplicate creation with the same user/idempotency key after its token changed,
consistent with the token-family task continuity regression fixed here.

OAuth workroom creation and adoption now persist the human owner separately
from the acting assistant. Existing branch and idempotency matches cannot be
used to acquire another human's room through a shared assistant. Governed
dispatch checks the target room before evidence writes or lease renewals and
retains room policy and clearance checks. An older room with no recorded human
owner requires explicit room admission; its caller is never guessed as owner.
These checks are silent authorization checks, not repeated OAuth approvals.

### Host preflight prerequisite

The refreshed main branch supplies the POSIX-mode capability probe for PKI
fixtures. This repair reuses that checked-in host correction. Windows skips
remain distinct from Linux policy-guard evidence.
