---
status: active
---

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

Workroom impact is resolved for the claimed delivery paths. Resolve
find_related_tests for changed source entries; run colocated and graph-linked tests.
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

Coverage receipt cmv4bk2gqht0601pee3tfbxrn was recorded against d51569ff08c2e9a29172256c10251ec560fdcb25.
It maps permissions to BI-9FA87F90 and preview to BI-10AC904B with the dependency above.
Implementation admission IRD-4745C55FA2D0 was allowed at effective medium sensitivity.

## Initial verification record (2026-10-11)

The preserved feature is still exactly `7cba454af18d0d25f0d96c8a06ac6d0fed1cf488`.
Its dry inventory recomputes to **331 affected routes: 261 static, 70 dynamic**.
The current canonical fixture resolves only `/workspace/cases/[caseKey]`;
all other affected dynamic routes require explicit fixtures in the admitted
preview map. Their absence blocks exhaustive acceptance rather than lowering
its denominator. The map records source SHA, lease, base URL and concrete paths.
Run representative desktop/mobile, normal/Simple, light/dark and persona states
before the complete inventory. Preserve per-context execution reports and fail
on unresolved selectors, missing paths, navigation/redirect failures, duplicate,
missing or unexpected results. No exhaustive served run is claimed yet.

The operator classified BI-9FA87F90 as Medium. Permission implementation was
admitted by IRD-698A15D2EE6E in WC-3D49B086, with immutable coverage
cmv4eczbalsa601peg2e6h9il. Its source adds the two missing approved UX grants to
external coworker defaults and checks the full workflow at both authority layers.
No live grant was changed. Scope-transfer approval cmv4c4c4vilts01petn6hxx4n is
still waiting; the reserved token-scope and legacy probe files remain untouched.
The preview candidate afc3b06f40 passed its governed merged-code gate, but native
independent review returned an uncertain outcome and no publication verdict.
Permission source, canonical installation and independent live acceptance are
not yet complete. The feature remains unchanged and has no PR or deployment.

The cursor follows PostgreSQL's transaction-bound `DECLARE ... NO SCROLL` and
`FETCH FORWARD <count>` contracts, with one node-postgres Client owning its
snapshot: [PostgreSQL DECLARE](https://www.postgresql.org/docs/16/sql-declare.html),
[PostgreSQL FETCH](https://www.postgresql.org/docs/16/sql-fetch.html), and
[node-postgres transactions](https://node-postgres.com/features/transactions).

The preserved feature predates the bounded clone. Initialization therefore pins
its clone implementation to the running canonical portal image by image digest;
its packaged bounded-cursor module is a prerequisite. The same init container
runs admitted-feature migrations under `/workspace`, then the packaged clone
under `/app`. The served portal remains bound to the preserved feature. No
feature source overlay, ad hoc image build or production bootstrap is allowed.
An install predating the repair refuses initialization before service mutation.

Permission readiness uses one 22-tool inventory in the bootstrap planning
package. Portal status uses persisted coworker authority; live discovery checks
both token and coworker grants for every tool. Both shell adapters reject old
count-only probe records. Optional bounded proof is accepted by supported state
schemas; credential fields remain forbidden. The install-state validator's
existing inline schema subset is reused. Custom/read-only/OAuth authority and
durable grant-revocation tombstones are preserved by existing authorization and
platform seed reconciliation.

## Delivery continuation (2026-10-13)

The other feature executor advanced `codex/session-identity` by merging main.
Do not reset or amend that branch. WWMD supported a separate read-only source
pin; WC-E5F4957F records `codex/session-identity-verification-pin` at exactly
`7cba454af18d0d25f0d96c8a06ac6d0fed1cf488`. Use that clean sibling checkout for
the original 331-route acceptance inventory, under WC-1916B51E's verifier lease.

Scope-transfer approval cmv4c4c4vilts01petn6hxx4n is now executed. Native review
requests from the initial delivery attempt expired without verdicts; neither is
a passing receipt. Current upstream uses the documented shadow publication
policy. Apply its bounded recovery contract and retain review provenance; do
not widen grants, change policy, or relabel uncertain execution as a pass.

The assembled repair integrates current upstream and preserves the new isolated
verification-user and retirement flows. Preview requests cannot create or
retire a fixture in the canonical installation. Two mixed-request regressions
and the existing preview-issuer tests pass (13 tests). Production and test
typechecks passed in the merge hook; fresh shared-gate evidence is still needed.

The current install lacks the packaged bounded-clone module. Startup must refuse
before runtime mutation until canonical delivery installs this repair. Preview
initialization, passwordless browser consumption, all dynamic fixtures and the
full served UX matrix remain unrun. Missing actor grants and live upgrade
authority remain separate boundaries; the source repair never self-grants.

The continuation found a remaining R5 defect in `gate:wait`: its finite watch
window re-claimed durable requests, and it parsed only the first line of the
multiline status report. The wrapper now observes at most one attempt, exposes
the recorded gate state, and stops on terminal, pending or unreadable evidence.
Eighty-two targeted tests pass, including long waits, existing admitted claims,
terminal stops and the actual status projection. Adding this repair fenced the
queued candidate as source drift before CI ran; its claim is unrun, not passed.
The final committed repair needs a distinct exact-tree gate.


The operator-authorized independent client reviewer found two blocking source
issues at c224872611: partially started portals escaped cleanup before recorded
container inspection, and status reasons contradicted durable-claim guidance.
Cleanup now discovers portals using exact lease/project/service labels and
revalidates inspected ownership before stopping them. Init cleanup also requires
its unique name and dev-init service. Tests reproduce Compose errors and lease
fencing before inspection, preserving foreign leases/projects and live services.
Status reasons now consistently require observation/resume for unfinished work
and terminal reconciliation before a new authorized attempt. This assessment is
client evidence, not a native certified review. The repaired commit requires
re-review and fresh shared CI; served acceptance remains unrun.


PR #6275 exposed a CI boundary defect absent on dependency-provisioned hosts:
the dependency-free pull-request policy suite imported preview runtime code that
loaded the delivery contract through tsx, and the web program imported the same
contract from dpf-bootstrap source, which the typecheck program ratchet refuses.
The contract now has one dependency-free home,
`packages/integration-shared/src/delivery-readiness-contract.cjs` (typed by its
`.d.cts`), consumed by the web program, the preview runtime script and a
re-export in dpf-bootstrap. A source-only fixture test proves the claim-key
policy suite runs without installed workspace dependencies.

The same CI run found three further defects. The legacy external-development
grant list lagged the registry's `coworker_catalog_read` and
`coworker_engagement_write`, creating new grant-source divergence; the lists
match again. The bounded-batch clone test sampled `heapUsed` without collecting
garbage, so it measured GC timing rather than retention; it now forces
collection before each sample and asserts retained growth below 16 MiB, which
still fails when every batch is retained (~63 MiB). The UX sweep's auth-only
bootstrap had lost the CI administrator credential path; on a disposable CI
portal at `http://localhost:3000` it uses the job's `ADMIN_PASSWORD`, never an
install file, and never for an admitted preview.

PR readiness also requires an explicit qualified evidence reference despite the
old local-CI skill calling it an unnecessary fallback. Align that instruction
with the real readiness contract: use the existing qualified reference, retain
private lease/session/path detail on the install, and do not re-run a full gate
for a body metadata omission.

## Headless assistant identity correction (2026-10-16)

This continuation addresses AC-PREVIEW-4 / R4 in BI-10AC904B. It does not declare
the other preview criteria or the preserved feature accepted. WC-38F686BF owns
`fix/headless-coworker-binding`, based on
`46cce23828404c121d31eb15c82e1621193e60b5`. The initial design claim derived a
small shape from the legacy unclassified bug; retain the earlier medium
implementation history and declare medium for this authority-sensitive repair.
No credential, grant, clearance, native connector, endpoint or runtime changed.

### Reproduction and architecture

The unchanged source binder plus canonical MCP transport returned success with
`agentBound=false` and no actor. The native connector separately resolves
AGT-EXT-CODEX. On the named base, a real Node assertion configuring fixture-only
headless OAuth credentials failed: `resolveMcpAccess` returned null because it
reads only the PAT. This rules out network, OAuth exchange and agent grants as
the cause of that source failure. Existing client creation submits only name
and scopes; its server action accepts an unchecked Agent row reference. The
token exchange requires a valid active Agent row. Post-fix green and live
credential qualification remain unrun.

Reuse the existing OAuth eligible-coworker query for both listing and submission;
semantic assistant IDs must resolve to its returned row IDs. A new headless
client has no prior client/resource delegation: make that absence explicit in
the shared query while preserving existing scoped interactive calls. Current
human eligibility, active/non-archived identity, canonical mirror exclusions,
token scopes, coworker grants and room admission remain authoritative. Preserve
intentional account-only clients and the existing PAT migration path. Never
infer identity from a display name, use another client's credentials, or copy
the interactive connector's tokens into a shell.

### Design grounding

The existing `/admin/platform-development` form remains the only home. Its
operator persona needs a named client, an explicit assistant choice and the
existing permission choices. Reuse shared form fields, notices, report-kit and
theme tokens; add no navigation or wizard. Account-only clients explain their
Workroom limit. Missing eligibility, loading, permission and submission errors
stay inline and must not silently create an anonymous client after a failed
selection. Identity displayed after creation comes from the saved server result.

The working [HTML prototype](../prototypes/2026-10-16-headless-coworker-binding.html)
was exercised by selecting Codex and previewing its identity; it creates no key.
UX advisory engagement CE-7FFF5D1E is requested, not a completed critique.
Recorded kernel interaction DI-BE040C114168 chose `explicit-existing-assistant`
over `implicit-client-name` and `separate-credential-wizard`, with high confidence
and usable signal. This is design advice, not an execution grant. Reject name-only
identity inference; the existing interactive authority-equivalence default is a
separate validated mechanism and remains unchanged. The UX-fit manifest records
this actual choice. Keep existing prose budgets by shortening repeated copy.

### Ordered bounded delivery

1. **HCB-R1 / HCB-CT-IDENTITY / HCB-FLOW-ISSUE / HCB-VC-ISSUE:** add red tests for
   explicit eligible assistant selection, semantic-to-row binding, account-only
   compatibility, unauthorized/stale/archived identities and no secret issuance
   on refusal. Extend the existing OAuth eligibility seam, action and form;
   re-read eligibility on submission. Test exact persisted identity and display.
2. **HCB-R2 / HCB-CT-CREDENTIAL / HCB-FLOW-BIND / HCB-VC-BIND:** make the source
   Workroom binder reuse `mcp-credential.mjs` rather than duplicate PAT-only
   resolution. Keep endpoint precedence, short timeout and unavailable/refused
   marker behavior. Test client credentials, explicit credential file, PAT
   compatibility, absent/malformed config, no secret output and no marker on
   refusal. No interactive OAuth token extraction or Grok identity substitution.
3. Resolve graph-linked tests for all three source entries in the Workroom impact
   contract. Run affected component/action/OAuth tests, Node credential/binder
   contracts, production/test web typechecks, prose and style guards, doc index
   and diagrams. Exercise the form's keyboard, narrow viewport and failure states
   in the governed verification lane; retain measured or recorded-choice UX-fit
   evidence. Run qualified exact-tree integration and independent source review,
   then normal DCO publication, protected CI and merge queue.
4. After canonical deployment and CAN-TEST, qualify the intended source actor
   through supported credential provisioning using the same account and bounded
   permissions. Record actual get_my_coworker_profile binding separately from
   native connector identity. Unavailable provisioning remains unrun; do not
   manufacture an accepted credential, token, delegated human or review receipt.

This is one atomic correction to the existing approved delivery path: provisioning
an assistant without consumption leaves the source workflow anonymous, while
consumption alone cannot supply the missing assistant binding. Use live immutable
coverage against this continuation before product edits; historical coverage is
not evidence for these new paths. The existing eight preview criteria remain
the owning item's full completion contract.

Risks are incorrect row/semantic identity, stale eligibility, authority widening,
secret exposure and a changed default endpoint. Negative tests must fence each.
Rollback is a reviewed source revert and normal canonical release. Revoke only
an explicitly identified newly issued test client through its supported owner
flow if cleanup is required; never revoke or rotate another client's credential.
