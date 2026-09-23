---
status: draft
---

# OAuth external build authority implementation plan

Status: implementation in progress; no deployed fix or live acceptance yet.
Parent: BI-B986A18B. Workroom: WC-F174CC4F.
Design: ../specs/2026-09-21-oauth-external-build-authority-design.md.

Deliver consent and its human/task authority protections as one reviewable
repair under BI-B986A18B, with linked coverage below. Use dpf-tdd for red-green
implementation, dpf-local-merge-ci-before-push plus the completion gate before
any success claim, and dpf-pr-with-dco for handoff.

## Sequence and delivery boundaries

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

### Host preflight prerequisite

Three PKI contract fixtures require POSIX mode 0600, which Node chmod cannot
establish on Windows NTFS. Keep their script checks and assertions unchanged;
mark only those fixtures POSIX-only with an explicit Windows skip reason.
The Linux policy-guard pipeline continues to execute them. Other static PKI
checks and command-validation tests still run on Windows with Git Bash.
This is a test-host correction, not a permission-check exception. Record
Windows skips separately from Linux test evidence before claiming acceptance.
