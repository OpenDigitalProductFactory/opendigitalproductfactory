# Complete external-client verification repair

Backlog: BI-10AC904B and BI-9FA87F90. Workroom: WC-1916B51E.
Repair branch: codex/external-client-verification, base 4bf3422a1d.
Preserved feature: codex/session-identity at 7cba454af18d0d25f0d96c8a06ac6d0fed1cf488.
The feature's reported 61 tests and production/test typechecks are prior evidence,
not repair evidence. No feature PR or deployment is authorized by this document.

## Objective and stop condition

Repair the approved delivery workflow from readiness and admission through
preview initialization, passwordless browser authentication, measured UX,
exact-tree merged-code verification, independent review and cleanup. Preserve
grant intersection, restricted connections, production refusal, source database
integrity, maintenance windows, DCO and merge queue protection. Completion means
installed functional evidence, not a listening port or a source commit.

## Evidence and design grounding

Current source base is 4bf3422a1d. Live get_backlog_item read both items on
2026-10-11; neither had an existing repair Workroom. The source-independent
recovery route was read before ordinary prerequisites.

- Executed a temporary Node test harness derived from
  tests/release/dev-portal-lease-contract.test.mjs with stubbed Git/MCP/Docker.
  Two tests failed: refresh emitted `compose -p dpf --profile dev up -d dev-portal`
  without dependency isolation; queued claim emitted `Retry this same claim`.
  No real Compose mutation ran. This rules out install credentials and Docker
  daemon behavior as causes of these two command-contract defects.
- docker-compose.yml dev-init depends on both postgres and dev-postgres;
  its workspace volume resolves relative to the Compose file, not the claim.
- packages/db/src/sanitized-clone.ts selects complete confidential tables before
  obfuscateRows creates another array. Existing 500-row insert transactions
  address transaction timeouts but do not bound these reads.
- Live load_tools returned tokenGranted=true and agentGranted=false for
  list_coworker_offers and request_coworker_engagement, naming
  coworker_catalog_read and coworker_engagement_write. Registry discovery is
  reachable; this is an authority denial rather than an MCP outage.
- Current development token template already contains both UX service grants
  and initiative_evidence_write. Bootstrap still probes registry_read and a
  nonempty tools/list, so adding token strings alone cannot fix this denial.
- Compose declares DPF_ENVIRONMENT=dev but lacks DPF_ENVIRONMENT_CLASS.
  Environment resolution defaults to production; e2e/global-setup.ts still
  uses a password form and reads an install admin password.

Reuse docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md,
docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md,
docs/superpowers/specs/2026-08-31-lease-retry-storm-control.md,
docs/superpowers/plans/2026-07-20-sanitized-clone-transaction-scaling.md and
docs/superpowers/plans/2026-07-20-sanitized-clone-atomicity.md.
Existing lease, TaskRun, environment resolver, automation persona, clone cleanup
and UX route accounting remain the sources of truth; no parallel substrate.

WWMD consultation DI-E1203C00715D recommends owner-scoped cleanup with high
confidence, usable signal and proceed verdict. Apply a per-call consequence
refinement only after verifying authenticated principal AND exact session for
the reservation. Foreign, unknown, forced or destructive cleanup retains
authority approval. This advisory is not a runtime grant.

## Acceptance criteria (BI-10AC904B, verbatim)

- AC-PREVIEW-1: Startup verifies the admitted worktree mount and served SHA and does not recreate live services.
- AC-PREVIEW-2: Install settings and development-only prerequisites are provisioned before runtime mutation without operator credential entry or production secret copies.
- AC-PREVIEW-3: Sanitized clone uses bounded read/transform/write batches verified with large JSON/vector data and a failed clone cannot be served.
- AC-PREVIEW-4: Both token and coworker authority are checked across the approved delivery workflow; restricted connections and no self-granting remain enforced.
- AC-PREVIEW-5: Scripts, hooks and instructions use durable queued resume and terminal-stop lease semantics.
- AC-PREVIEW-6: Verified owner cleanup follows WWMD and justified approvals show exact actions with automatic expiry/cancellation reconciliation.
- AC-PREVIEW-7: The admitted preview has the correct environment class and a platform-issued automation browser session consumed by the UX sweep.
- AC-PREVIEW-8: Representative desktop/mobile/Simple-mode checks and exhaustive affected-route coverage with dynamic fixtures are planned and executed before completion.

## Requirements

- R1: Bind the admitted worktree and SHA, verify the actual container mount and
  served identity, and prevent live-service recreation.
- R2: Resolve install settings and development-only prerequisites before runtime
  mutation; no operator password entry or production secret copies to worktrees.
- R3: Bound read/transform/write memory, preserve deterministic obfuscation,
  JSON/array/vector handling and restricted exclusions; failed clone is unavailable.
- R4: Check token and acting-coworker authority over the entire approved delivery
  workflow and reconcile only through sanctioned install/upgrade authority.
- R5: One durable queued wait/resume contract and terminal stop across runner,
  hooks, MCP and instructions; no historical terminal-key scan.
- R6: Verified owner cleanup follows WWMD; justified approvals identify their
  exact action and expired/cancelled requests are reconciled automatically.
- R7: Admitted preview has development/test identity and platform-issued
  automation session; UX authentication consumes it without a password form.
- R8: Plan representative desktop/mobile/Simple-mode checks and an exhaustive
  affected-route sweep with dynamic fixtures before runtime work.

BI-9FA87F90 acceptance criteria (verbatim):

- AC-1: Fresh authorized contributor install can discover and use required governed authoring tools without selecting individual grants.
- AC-2: Upgrade detects and reconciles stale approved Development permissions; rerun is idempotent.
- AC-3: Custom/read-only grants are not silently broadened and no server authorization intersection is bypassed.
- AC-4: Readiness cannot report the development workflow ready based solely on tools/list or registry_read.
- AC-5: Equivalent supported-platform behavior and sanitized evidence; tokens never appear in tracked artifacts or logs.

## Ordered implementation and verification

1. **Permissions (BI-9FA87F90; independently shippable prerequisite).** Extend
   the existing bootstrap/readiness contract with required delivery tool names
   and both authority layers. Reuse catalog grant mappings, development template
   provenance and platform-owned coworker provisioning; never a client self-grant.
   Cover authoring/research/plan, leases, UX specialist, automation sign-in,
   semantic-review and evidence tools. Shell and PowerShell consume one result.
   Test fresh issuance, stale approved bindings, idempotence, custom/read/OAuth
   restrictions, revoked/expired consent, unavailable service and redaction.
   Include contributor-readiness UI and generated capability completeness.
2. **Preview lifecycle (BI-10AC904B; internal sequence).** Replace ambient Compose
   invocation with explicit canonical install config/overlays and admitted source
   binding. Preflight real Git worktree, clean SHA, install settings, preview-only
   random material and rendered config before stop/start. Keep production settings
   outside the worktree and do not pass production secrets to dev-portal.
   Use explicit preview services with --no-deps; validate existing data-owner
   readiness and refuse changes to live services. Inspect Docker mount and source
   identity before serving. Tests inject wrong mount/SHA and missing prerequisites
   and require zero runtime mutation. Compare live container IDs/start times.
3. **Bounded clone (internal).** Use a read-only source snapshot and bounded cursor
   fetch/transform/write batches, releasing each batch before the next. Do not
   retain a full user table or second full obfuscated table; derive stable user
   obfuscation deterministically. Preserve additive-schema projection, native
   vector/search exclusion, replication posture and source integrity checks.
   Exercise large JSON/array/vector datasets in shared runtime; record peak RSS
   across increasing row counts, not a larger heap. Stop preview before clone;
   invalidate completion identity first and publish it only after successful
   clone/migrations. SIGKILL/OOM must leave no valid preview admission receipt.
4. **Lease recovery and cleanup (internal).** Queued response emits its immutable
   TaskRun/lease identity and exits without mutation or renewal. Resume only the
   admitted exact source/session; cancellation and terminal results stop. New work
   uses an explicit new invocation identity, never :rerun-N history scanning.
   Reuse bounded lease supervisor heartbeat/expiry handling. Pass ownerSessionId
   on release. Share the verified owner predicate between consequenceForCall and
   store. Test foreign principal/session, force, terminal/unknown leases, approval
   expiry/cancellation and no widening. Align hooks and the shared nonprod skill.
5. **Passwordless session (internal).** Explicit DPF_ENVIRONMENT_CLASS=development
   overrides cloned production PlatformConfig only in the admitted preview.
   Extend the existing issue_ux_verification_sign_in route to the admitted
   preview identity through the canonical runtime; never an arbitrary URL/SSRF
   relay, production cookie or secret substitution. Issue/exchange within preview
   with short-lived single-use token and normal identity-spine authorization.
   Bind host/origin/lease/source and use a local untracked auth-state file.
   e2e/auth-only.ts and global-setup consume platform-issued sign-in and reject
   origin mismatch, expiry, replay, production default and login-page redirects.
6. **Coverage and acceptance (internal).** Use the matrix below, then affected
   package production/test typechecks, exact-tree merged-code pregate, independent
   semantic review, cloud build and pnpm pr:health. Update operations/install docs
   and platform watchlist where host-specific behavior changes. Merge through the
   queue; advance canonical install only through request_self_upgrade, respecting
   its maintenance window. Re-prove the path after upgrade before marking either
   item or the preserved feature unblocked.

## UX matrix and exhaustive accounting

The feature-thread inventory is reported as 331 routes: 261 static and 70 dynamic.
Recompute against the preserved feature SHA and current merged base before
execution; retain the complete route list and fixture mapping as evidence.
scripts/ux-sweep-touched.mjs default limit 40 is an early-feedback boundary,
not completion evidence for this shared-header change.

Representative checks: 1280x900 desktop and 390x844 mobile; light/dark themes;
normal and Simple mode; workforce account with and without linked customer/
partner identity, automation persona and authorized restricted persona. Check
header identity, profile/account menu, keyboard focus/escape, menu placement,
touch targets, overflow, screen-reader names and navigation/authorization.
Include home, workforce, storefront/customer, build/workroom, admin/settings,
list/detail and an empty/error state using real admitted fixture identities.

Exhaustive served sweep: every affected static and dynamic route for desktop
and mobile, plus Simple-mode affected shell checks. Use existing
apps/web/scripts/ux-sweep-route-params.ts fixture resolver and generated shell
inventory; enumerate each dynamic parameter fixture before startup. Missing,
excluded, redirect-to-login, failed, duplicate or unexpected routes are explicit
incomplete outcomes, never successes. Use bounded existing sweep workers and
reconcileRouteAccounting; run axe and retain measurements/screenshots with
base/head/tree, environment/lease, persona, viewport and mode. The existing
runner's fixed desktop viewport must be made configurable for this matrix.
Do not update baselines just to accept a regression. UX specialist engagement
and measured UX-fit manifest remain feature-thread duties after repaired access.

## Impact contract, risks and rollback

Workroom impact is resolved for the 12 claimed paths. Resolve find_related_tests
for the seven TypeScript entries before Red; run colocated and graph-linked tests.
Run style-drift guard, generated capability-completeness check, Design Grounding
and Convergence-Impact attestations, pregate preflight, exact-tree pregate and
PR health. Missing graph advice expands verification rather than waiving it.

Risk: accidentally touching live data owners, admitting incomplete clone, leaking
install credentials, broadening a restricted connection, or serving stale source.
All are fail-closed preflight/publication checks with regression tests. Roll back
source via a reviewed revert; stop/release only owned preview, preserve source
database and clone failure evidence. Canonical deployment rollback uses the
existing self-upgrade recovery path; never a hand-built image.

## Backlog coverage

Decision: decomposed. Permissions maps to BI-9FA87F90; complete preview delivery
maps to BI-10AC904B and depends on permissions. Preview internals cannot establish
the complete acceptance contract independently. Live immutable coverage receipt
must be recorded before implementation; this document alone is not a receipt.
