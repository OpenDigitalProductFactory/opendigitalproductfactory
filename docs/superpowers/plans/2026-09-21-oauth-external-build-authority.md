---
status: draft
---

# OAuth external build authority implementation plan

Status: draft; implementation blocked pending reviewed baseline and coverage.
Parent: BI-B986A18B. Workroom: WC-F174CC4F.
Design: ../specs/2026-09-21-oauth-external-build-authority-design.md.

For agentic workers: execute this plan one independently reviewable backlog
item at a time — one BI, one branch, one PR. Use dpf-tdd for red-green
implementation, dpf-local-merge-ci-before-push plus the completion gate before
any success claim, and dpf-pr-with-dco for handoff.

## Sequence and delivery boundaries

1. Identity lifecycle (BI-B986A18B): extend core-identity.prisma and forward
   migration; auth/oauth-tokens.ts, oauth-consent-page.ts, authorize/token
   routes and MCP identity-required responses. Consent binding, recovery and
   rotation form one atomic credential-security change. First fail V1-V3/V8
   regressions, then implement and test migration on clean/populated data.
2. Operation policy and attribution (independently shippable; live BI mapping
   required before implementation): govern/permissions.ts, authority resolver,
   mcp-governed-execute.ts, actions/backlog-build.ts, actions/build-release.ts,
   build/build-pipeline.ts and tak/agentic-loop.ts. Share current-human and
   operation policy without weakening any release gate. V6/V7 first. Allocate
   about 20% of total effort to this focused refactor.
3. Task/workroom isolation (coordinate BI-D4C110BC): mcp/build-tool-helpers.ts,
   existing task session and room admission services. Reject explicit invalid
   targets; bind narrowed task authority to human/connection/work item. V4/V5
   first, including read denial and evidence attribution.
4. External orchestration grants (part of the accepted scope, live delivery
   mapping to be settled at baseline review): exact operation-to-grant matrix
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
worktree currently classifies source-only. Runtime/migration/UI evidence uses
the governed shared nonproduction lease and exact candidate SHA. Cloud build,
PR health and live DEV V1-V9 complete acceptance; do not describe structural
checks as functional proof. Release through the canonical upgrade mechanism.

## Backlog coverage

Decision: decomposed, pending formal baseline and receipt. Existing mappings
are listed above; step 2 needs overlap reconciliation and a distinct linked BI
if none covers it. No coverage receipt has been minted. This draft deliberately
does not claim permission to implement or mark the original item accepted.

## Risk and rollback

Primary risks are authority expansion, stale permission reuse, refresh races,
cross-task target confusion and confidential-client regression. Use the
design's additive migration and fail-closed rollback; preserve audit and
revocation. Popup and duplicate-hook repairs remain outside this plan.
