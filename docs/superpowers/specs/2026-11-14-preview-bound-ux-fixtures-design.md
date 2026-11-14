---
status: draft
date: 2026-11-14
backlog: BI-79C9523A
---

# Preview-bound UX fixtures and permission personas

BI-79C9523A / WC-3B029586, delivery-large@1.0.0. Native design admission
IRD-26FA1429AA30 binds base f5dbcf027df88f5684420ff734e89a8ff8f3ffa7.
This is a design draft, not an implementation, approved mechanism, passing
research receipt, spec approval, architecture approval or runtime evidence.
The exact item funding binding was authorized and completed on November 14 at
20:00:24.835 UTC (envelope `cmwgsg5uk07qn0eoxuej10cvg`). Native readback resolves
the organization/shared-platform scope and refactor classification. This records
attribution only; this document assigns no budget increase or grant.

## Objective and retained scope

The original [external-client verification plan](../plans/2026-10-11-external-client-verification.md)
and archived BI-10AC904B AC-PREVIEW-8 require representative desktop/mobile/
Simple-mode checks and exhaustive affected-route coverage with dynamic fixtures.
That acceptance obligation survives the original carrier's recorded completion.
BI-9FA87F90 owns the separate approved-delivery permission acceptance.
BI-F19DDBCA / PR7109 owns the separately delivered admission-clock correction;
its installed acceptance is still unrun and is not closed by this design.

The preserved candidate is `codex/session-identity` at
`7cba454af18d0d25f0d96c8a06ac6d0fed1cf488`. Its source inventory has 332 routes:
262 static and 70 dynamic. All original 331 remain; `/login` is the additional
signed-out/redirect case. These are a pinned acceptance inventory, not a new
canonical route registry. Runtime fixtures verified: zero. UX measurements: zero.

**OBJ-TARGET:** Only a currently authorized actor and its exact admitted,
immutable disposable preview may prepare or exchange verification identities.

**OBJ-PERSONA:** Existing isolated ordinary users demonstrate actual permission
intersection and identity presentation without changing the shared automation
persona, selecting an existing user or broadening production authority.

**OBJ-COVERAGE:** Every retained route and required viewport/persona context is
accounted for using real target fixtures and honest missing/denied/redirect states.

**OBJ-LIFECYCLE:** Expiry, release, authority loss and cleanup remain bounded,
observable and unable to create a false UX or production-safety pass.

## Observed gap and existing contracts

At the admitted source base, `apps/web/scripts/ux-sweep-fixture.ts` publishes only
`/workspace/cases/[caseKey]`. It cannot resolve the other 69 dynamic patterns.
The existing preview issuer supports its default shared superuser. The native
UX pack correctly rejects `previewLeaseId` combined with ordinary `fixture` or
`retireRunId`: those ordinary helpers currently use global canonical Prisma and
the canonical installation environment. This PROD installation is not a safe
ordinary fixture target merely because a preview exists.

Extend, rather than replace:

| Existing owner | Contract to preserve |
| --- | --- |
| `apps/web/lib/mcp/packs/ux-verification-pack.ts` | Authenticated tool actor, fixed input validation, existing mixed-target refusal until an approved replacement is implemented. |
| `apps/web/lib/govern/preview-automation-sign-in.ts` | Active owned lease, current verifier/source Workrooms under the same principal/repository, actual running container/full ID/mount/loopback port/development class, inspected disposable DB and signing identity, post-issuance lease/source recheck. |
| `apps/web/lib/govern/automation-fixture.ts` | Current human capabilities, assistant grant, OAuth authority and exact-room action admission; five fixed non-superuser profiles, two slots, ordinary identity spine, unusable passwords, transactional provenance, expiry and retirement. |
| `apps/web/lib/govern/automation-sign-in.ts` and `apps/web/app/api/automation/sign-in/route.ts` | One-time signed link, purpose/audience/expiry checks, atomic consumption, principal signability and actual Auth.js session cookie. |
| `apps/web/lib/nonprod/environment-lease-lock.ts` | Canonical renewal/release/expiry/fence serialization, not a target-database substitute. |
| Existing UX fixture, route-shell and touched-route sweep modules | One inventory/fixture projection, concrete paths, expected redirects and full accounting; no second sweep engine or 40-route acceptance cap. |

The [automation sign-in design](2026-09-03-automation-persona-sign-in-design.md)
already specifies isolated run-owned users, no shared-role mutation, current
authority at mint/exchange, ten users per run, fixed expiry and bounded cleanup.
This draft must explicitly identify any proposed change to those limits or
original-expiry semantics. The original binding status does not approve an
extension merely because it appears in the same document.

### Standards research and comparison

The following primary sources were read on November 14, 2026. They constrain
the open design; they do not establish an implemented protocol or authorize a
new endpoint.

| Source | Adopt | Constraint |
| --- | --- | --- |
| [RFC 7662, OAuth token introspection](https://www.rfc-editor.org/rfc/rfc7662.html) | Ask the authority owner for current active state when current validity is required. | An authorization-server query needs its own authorized caller; a copied row or unauthenticated callback is not introspection. Applying this principle to a preview proof does not by itself make that proof an OAuth token. |
| [RFC 8725, JWT security practices](https://www.rfc-editor.org/rfc/rfc8725.html) | Verify allowed algorithms, issuer/subject and audience; keep different token purposes and validation rules distinct. | A browser sign-in token, session cookie and target validation request must not be interchangeable authority. Do not reuse a production credential or accept caller-selected signing context. |
| [Playwright authentication](https://playwright.dev/docs/auth) | Separate browser contexts and accounts for tests that change server state; reuse qualified authentication state within its valid context. | Keep saved state out of source control. A shared superuser account cannot demonstrate ordinary permission isolation. |

The existing implementation already supplies the session/fixture primitives.
The missing cross-target authority contract must be proved before a transport
is chosen. Performance comparison remains unrun: measure validation calls,
target transaction/lock time, route-cohort duration and refresh overhead on a
governed isolated target. Do not turn a design estimate into a runtime benchmark.

### Source compatibility is an admission prerequisite

Exact 7c has no `automation-fixture.ts`. Its `automation-sign-in.ts` rejects every
email except the shared automation persona at line 292. Issuer-side target DB
injection cannot make isolated ordinary fixture tokens compatible with that
consumer. Do not rotate the shared persona's roles, forge cookies, copy an
operator session or silently change the target.

A separately registered immutable integration target is a design candidate under
normal merged-code verification. Bind candidate 7c, contribution base
`bacf013ce9085633d155849067ac6e9eb7dd23be`, selected integration base/final tree,
approved auth-consumer protocol and each accepted feature contribution.
The existing preview recipe supports a clean named topic HEAD with expected
SHA/branch checks and actual mount/container verification; the native issuer
requires its exact registered source Workroom. No integration target has been
created or admitted for this design.

The separate feature owner delivered PR6959 from
`48263800aa04cdb091113c46ae576e98bb1bf7ab`, merge
`a1bd49267b61361051eb8f0e03ab8e5b6fef3f0c`.
A source comparison of the original 15 paths against main
`9e865eb7db79b375a5e39e7d839396896c9d132b` found the authenticated-account helper
and its tests byte-equal; Header, ShellAccount, layout and other consumers differ.
Ancestry and a PR title do not prove equivalent feature behavior. Exact-7c
default-persona evidence and integration-target full-persona evidence must remain
separate. The protected original branch does not move.

## Selected direction and remaining qualification

The following design direction remains subject to the normal Large independent
design/security/architecture approval route. Root's source assessment is advisory.
WWMD DI-78D0807246E3 ranked a distinct corrective
carrier above widening generic reachability, but returned low confidence,
all-options-opposed and autonomy-ineligible. It is not implementation permission.
The subsequent, distinct mechanism decision `DI-332166C63495` selected
`governed-ci-same-db` with high confidence, usable signal, strong structured
coverage, stable sensitivity, no commandment conflict and autonomy eligibility.
The agent recorded that selection through `record_decision_outcome`. Its leading
contributors were Ground New Work In Existing Platform and Research and Use
Standards. These qualitative comparisons are not runtime benchmarks or approval
of the resulting specification.

### Reuse the governed cloud runtime before adding an authority bridge

The original acceptance explicitly permits the governed/cloud path. The existing
`.github/workflows/ux-route-sweep.yml` already owns an ephemeral PostgreSQL,
source/build artifact qualification, a served portal, fixture setup, browser
authentication and bounded route measurement with two workers by default. The reusable workflow
is already part of protected CI. The existing foreground scenario additionally
has an explicit CI/loopback-database target guard. This is a concrete alternative
to adding a cross-database authority protocol for every local preview request.

The current workflow is not already sufficient: its ordinary session bootstrap
selects the CI-only administrator password, its install-state fixture does
not declare a development/test environment class, and no approved ordinary-
fixture MCP actor/workroom/lease bootstrap was found in the inspected workflow.
It also publishes only the same one dynamic route. These remain design and
verification work, not assumed capabilities.

Compare two complete delivery candidates:

| Candidate | Reuse | Missing mechanism to prove |
| --- | --- | --- |
| Same-database governed cloud verification | Existing reusable runtime, actual source/build provenance, ordinary fixture authorizer/consumer, existing domain writers and browser contexts. | Explicit isolated test classification and supported test-actor bootstrap; actual native workroom/lease admission on that isolated installation; passwordless fixture session consumption; all dynamic mappings and full target/contribution accounting. No production token or grant may be copied to the job. |
| Preview-local personas with canonical authority | Existing canonical preview proof, disposable target client, ordinary fixture/session primitives and native fence. | Canonical-versus-target serialization, fresh exchange/request validity, bounded renewal/hard deadline and source-compatible consumer; no new general authority or credential substrate. |

Cloud evidence would belong only to its admitted immutable integration target.
The exact-7c local preview still owes its own source/mount/clone/environment/
passwordless-session and cleanup evidence. Neither target may borrow the other's
identity or imply that unmeasured ordinary personas worked on exact 7c. Choosing
the cloud candidate requires approved source/fixture bootstrap and a clear
original-scope reconciliation, not dispatching another incomplete sweep.

No cloud workflow was dispatched or changed for this proposal. The selected
same-database direction avoids a new cross-database credential/authority bridge.
The local preview issuer's existing mixed-target refusal remains appropriate;
the implementation must not weaken it to make ordinary fixture tokens work on
exact 7c. The earlier carrier advisory remains separate and unchanged.

### Same-database runtime contract to qualify

Extend the existing workflow, fixture projection and browser authentication
bootstrap rather than adding a second sweep engine. Before a fixture write,
the runner must prove all of the following:

1. The job is an admitted verification of its immutable integration source/tree
   and build artifact, with an explicit source contribution map back to 7c.
   The original branch stays unchanged. An unrelated current-main build cannot
   count as evidence about that contribution.
2. The existing isolated CI database is loopback-only, disposable, and explicitly
   classified `test` in its installer-owned snapshot. Both installer state and
   the normal environment-class resolver must agree. An environment label alone
   supplies no additional authority. A production/undeclared snapshot, remote
   database or identity mismatch refuses before writing.
3. The isolated installation has its own qualified test actor and existing
   coworker identity, effective tool grants, human capabilities, exact source
   Workroom and ordinary active lease. Bootstrap must use an approved existing
   installation/test procedure, not a production token, an alternate auth-source
   label, unchecked direct helper invocation or fabricated lease rows. No such
   complete bootstrap is currently established by the inspected workflow; its
   executable provenance is a blocking qualification prerequisite.
4. Persona preparation uses the existing fixed profile/slot authorizer on that
   same database; one-time sign-in uses the existing signed-link exchange and
   actual session cookie. The browser does not fill a password form. Each
   persona has a separate context, and storage state stays private and expires
   with its run. Existing role removals and disabled state are preserved.
5. Fixture output extends the existing route-parameter projection. Every one of
   the 70 patterns has a concrete valid route, relation/visibility proof and
   source-qualified domain factory or registry owner. A missing factory or
   required persona prevents a passing full-scope receipt; it cannot shrink the
   denominator or be replaced with a guessed identifier.
6. Route cohorts fit the existing absolute fixture/run expiry. The approved
   implementation must calculate a conservative cohort bound from measured
   route duration and remaining admission, stop before expiry, and obtain the
   next ordinary admission for a later cohort. It must not extend original
   expiry, create another run on the same lease or rotate terminal claim keys
   automatically. An incomplete cohort remains incomplete.
7. The workflow records each route/context result, current target and persona,
   missing/denied/redirect outcomes, expiry and cleanup independently. Reuse the
   existing bounded worker setting and route inventory. Run retirement and
   native reservation settlement remain separate from the UX verdict.

The source findings above establish the missing prerequisites, not a functional
RED/GREEN result. Obtain the independent reviewers' disposition of bootstrap,
cohort bounds, role visibility and source equivalence before implementing them.
If no approved existing bootstrap can satisfy item 3, return to the design gate
with that exact missing contract; do not silently select the rejected bridge.

### Rejected bridge: canonical authority and target transactions

The canonical installation owns current actor, token, coworker, Workroom and
native lease authority. The preview owns disposable fixture rows and its signer.
A lock or copied lease row in the target cannot serialize a canonical release.
RuntimeVerification stores lifecycle/evidence; it cannot authorize execution.

Compare a bounded canonical-owned prepare/exchange validation boundary with an
explicit target-only fixture operation that re-enters the canonical authority
owner. The exact transport, linearization point and failure/compensation behavior
need an approved threat model. Reuse existing issuer/fixture validation and
environment locks. Do not invent a general credential, authority ledger, copied
production DB access or parallel client polling engine. A target snapshot or a
matching session string alone is insufficient.

Required race cases: release/expiry/reassignment between proof and target commit;
source/container swap; current capability/grant/OAuth revocation; two actors,
profiles and slots; concurrent redemption; partial target commit and unavailable
canonical validation. Bound lock/transaction duration. A stale decision cannot
turn into a signable orphan or a claimed successful cleanup.

### Existing admission TTL, fixed lifetime and session revocation

The current preview controller renews with `ttlMinutes: 2` in
`scripts/lib/dev-preview-runtime.mjs`; the shell's 120-minute request duration
is not evidence of a two-hour active admission. Existing fixture lifetime is
`min(now + 2 hours, current lease expiry, original run expiry)`. Same-run reuse
cannot extend original expiry, and the same lease cannot create a replacement
run. Blindly reusing this path would strand a long sweep despite healthy renewal.

The selected direction uses explicit bounded cohorts preserving existing lifetime.
The rejected alternative was narrowly validated same-run renewal within an
immutable hard deadline. The latter changes
the existing original-expiry contract and needs explicit approval; it must never
restore removed groups, reactivate a disabled fixture or extend authority merely
because a keeper is present. Do not lengthen native lease TTL to work around
fixture lifetime, rotate claim keys, or silently issue a longer cookie.

JWT/session callbacks retain claims. Exchange-time validation alone does not
prove immediate revocation on every read route after retirement or authority
loss. Map the existing current-user/principal guards and actual session boundary;
prove the chosen denial mechanism without changing ordinary user behavior.
Native serving-stop and the independent cleanup witness remain mandatory.

### Domain fixture writers and feature mapping

The appendix maps all 70 source patterns, owning modules, proposed lookup keys and
relation/visibility constraints. It is not an executable fixture manifest and
does not claim that 70 domain factories exist. A lexical scan of 76 existing seed/
fixture modules found candidates for only some models. Broad install seeds are
not automatically safe, bounded target fixture writers.

Resolve the actual existing writer and accountable domain reviewer for each
fixture before implementation. Prefer synthetic target-only fixture records and
valid registry keys. No canonical business-record browsing to recover denied IDs,
production identifier/secret copying, provider refresh tokens or outbound actions.
The employee slots may need plain-versus-synthetic-linked account scenarios;
those links must use the existing identity/domain writer, not fabricated aliases
or role changes. Missing approved writers remain explicit design gaps.

## Bounds, provenance and cleanup

Reuse User, UserGroup, Principal/PrincipalAlias, EmployeeProfile and existing run/
Workroom lifecycle fields. No new table, role/profile, grant or arbitrary user/
database/URL selector is presumed. Fixed profile membership is initial fixture
intent; every operation still uses ordinary current authorization.

Bind each output to source/tree, lease, target, run/profile/slot and capture time.
Each concrete path must have an actual target row or valid registry/redirect
target, required relations and expected visibility. Bound domain writes and
reads before choosing a mechanism; stable cursor pagination, not silent caps,
owns larger datasets. The pinned 332/70 scope is the present acceptance ceiling;
EP-CLIENT-CONFIG owns this correction and related BI-2ABB23AE owns generalized
feature reachability/freshness. Any higher scale needs measured evidence and a
reviewed scope change, not a second inventory.

Retirement retains the existing run lock, task/room settlement checks, own-only
revocation/deactivation, audit and bounded indexed 100-user expiry scan/cursor.
It does not cancel foreign work, purge a database or produce a UX verdict.
No passwords, JWTs, cookies, bearer/refresh tokens, codes or verifiers enter
committed evidence, tool transcripts or browser traces. Private browser state
stays untracked with restricted local access; retained evidence follows the
existing audit/retention policy.

## Acceptance baseline proposed for independent approval

| Criterion | Objectives | Statement |
| --- | --- | --- |
| AC-FIXTURE-1 | OBJ-TARGET, OBJ-LIFECYCLE | The approved design and implementation bind current canonical actor authority and exact admitted immutable target/source/container/database/signer, and refuse foreign/stale/swapped/expired/reassigned/released or unproven targets before mutation and at exchange. |
| AC-FIXTURE-2 | OBJ-PERSONA, OBJ-LIFECYCLE | Existing fixed non-superuser profiles/slots obtain platform-issued one-time sessions with actual authorized capabilities, role isolation, bounded lifetime/renewal and retirement/revocation behavior; arbitrary user/role/URL selection, production fixture writes and grant widening remain refused. |
| AC-FIXTURE-3 | OBJ-COVERAGE, OBJ-TARGET | All70 original dynamic patterns resolve to actual source/lease-bound target fixtures or valid registry/redirect targets with relation/visibility proof and domain-owner/factory provenance; missing fixtures remain explicit UNRUN and never reduce the332-route denominator. |
| AC-FIXTURE-4 | OBJ-TARGET, OBJ-PERSONA, OBJ-LIFECYCLE | Actual isolated canonical-authority/disposable-target integration and browser tests prove zero production/foreign writes, restricted role behavior, prepare/renew/exchange/retire/release races, hard deadlines, idempotence and bounded cleanup. Structural/mocked evidence is identified separately. |
| AC-FIXTURE-5 | OBJ-COVERAGE, OBJ-PERSONA | The original332-route scope is exhaustively accounted for on the identified compatible immutable integration target, including representative12-route desktop/mobile × Full/Simple × light/dark and ordinary/restricted persona checks. Preserve exact7c branch and evidence separately; ancestry alone is not feature equivalence. |
| AC-FIXTURE-6 | OBJ-LIFECYCLE, OBJ-COVERAGE | Normal classifier/design/plan/security/architecture/owner decisions and protected delivery precede canonical containment and independent installed acceptance. Stop on first failure; report pending cleanup/missing factory/persona/session honestly. Original BI9 permission acceptance remains separately owed. |

No objective baseline, independent acceptance or architecture gate is claimed by
this table. The native reviewer must mint and retain the approved baseline.

## Ordered work and verification

1. Complete source/standards research, real defect reproduction and the open
   authority/expiry/compatibility decisions. Record actual evidence; a structural
   source audit is not a passing runtime test. Resolve funding before budgeted
   review/inference. Obtain independent spec/security/architecture approval.
2. Map independently shippable implementation units to live backlog coverage
   against the retained baseline. The likely boundaries are the existing preview
   authority/persona lifecycle extension and the domain fixture/coverage adapters;
   this is a decomposition candidate, not filed child work or approved coverage.
   Keep generic reachability BI-2ABB23AE related rather than silently expanding it.
3. Use meaningful RED/GREEN tests against actual isolated canonical-authority and
   disposable-target PostgreSQL clients. Cover zero production writes, wrong
   binding/foreign roles, prepare/renew/exchange/retire/release races, hard
   deadlines, idempotence, partial failures and bounded cleanup. Do not substitute
   a mocked approval or RuntimeVerification result for native authority.
4. Freeze each admitted source unit, run affected tests/typechecks/guards,
   independently review it, and publish through normal protected delivery.
   Root alone advances the canonical install through its supported gate.
5. Bind and qualify the actual compatible integration target and the preserved
   feature contribution before native preview admission. Measure the real
   passwordless session and least-privilege profile before using saved browser
   state. Obtain all 70 actual target fixtures before claiming exhaustive coverage.
6. Execute the original representative 12-route matrix across desktop 1280×900,
   mobile 390×844, Full/Simple and light/dark with the required legitimate personas.
   Run the exhaustive 332-route desktop and mobile cohorts. `/login` has separate
   signed-out/redirect accounting. Refresh authentication only through the
   approved bounded lifecycle; stop rather than measure after lost admission.
7. Reconcile every expected route/persona/redirect/failure/UNRUN result and retain
   the denominator. Independently observe actual native own-runtime stop/readback
   and unchanged protected services. Complete objective reconciliation and
   independent acceptance; permission BI9 and installed F19 remain separately
   recorded until their own actual outcomes are proven.

Current draft impact: one spec file. Native impact contract requires doc-index
and doc-impact freshness checks; no runtime tests or UI measurements have run
for this document. No implementation admission or source runtime change exists.

## Overlap and non-supersession

BI-2ABB23AE remains OPEN generic reachability with three spot checks, not this
preview/session boundary. BI-DE67A3EC is DONE single-case fixture work.
Retired narrower fixtures/noise items and DONE BI-D96C01CC/BI-9F057CA8 retain
their original scopes. EP-UX-SYSTEM does not resolve; the BI-BD81682A read refusal
is preserved and was not proxied. This corrective uses normal intake and a new
governed Large design room; it does not revive an archived carrier or evade a
refusal. F19's merged worktree remains read-only awaiting installed acceptance.

## Source-only dynamic fixture appendix

Every row below is a proposed fixture contract derived from immutable 7c page/
loader source. It is not a concrete URL, authorized runtime fixture, assigned
human owner or measured route. Existing module owners must qualify the writer,
relations and policy before use. Redirects retain their actual canonical targets.

| Dynamic pattern | Fixture/key proposal | Existing owning source | Required relation/visibility proof |
| --- | --- | --- | --- |
| `/admin/twin-gallery/[archetypeId]` | `registry:ALL_ARCHETYPES` / `archetypeId` | `apps/web/app/(shell)/admin/twin-gallery/[archetypeId]/page.tsx` | Use an actual archetype key from the preserved target registry; deterministic in-memory demo, no database row. |
| `/area/[key]` | `registry:AREA_SECTIONS` / `key` | `apps/web/lib/areas/area-team.server.ts` | Use an actual section key; declare view_operations/setup capability expectations per profile. |
| `/build/work/[capsuleId]` | `workroom` / `capsuleId` | `apps/web/lib/actions/work-capsules.ts` | Fixture-owned room with source and WorkItem; requireBuildAccess remains enforced. |
| `/compliance/actions/[id]` | `correctiveAction` / `id` | `apps/web/lib/actions/compliance.ts` | Declared compliance fixture relations; requireViewCompliance. |
| `/compliance/audits/[id]` | `complianceAudit` / `id` | `apps/web/app/(shell)/compliance/audits/[id]/page.tsx` | Declared audit fixture and included evidence relations. |
| `/compliance/controls/[id]` | `control` / `id` | `apps/web/lib/actions/compliance.ts` | Declared control/obligation relation and active evidence; requireViewCompliance. |
| `/compliance/evidence/[id]` | `complianceEvidence` / `id` | `apps/web/lib/actions/compliance.ts` | Declared evidence fixture with readable relationships; requireViewCompliance. |
| `/compliance/incidents/[id]` | `complianceIncident` / `id` | `apps/web/lib/actions/compliance.ts` | Declared incident and corrective-action relationships; requireViewCompliance. |
| `/compliance/obligations/[id]` | `obligation` / `id` | `apps/web/lib/actions/compliance.ts` | Declared obligation/controls/regulation links; requireViewCompliance. |
| `/compliance/policies/[id]` | `policy` / `id` | `apps/web/lib/actions/policy.ts` | Declared policy requirements/obligations and active completion state; no real employee data. |
| `/compliance/regulations/[id]` | `regulation` / `id` | `apps/web/app/(shell)/compliance/regulations/[id]/page.tsx` | Declared regulation fixture and included obligations. |
| `/compliance/risks/[id]` | `riskAssessment` / `id` | `apps/web/lib/actions/compliance.ts` | Declared risk/control relationships; requireViewCompliance. |
| `/compliance/submissions/[id]` | `regulatorySubmission` / `id` | `apps/web/lib/actions/reporting.ts` | Declared submission/obligation snapshot and pinned test due date; requireViewCompliance. |
| `/coworker-decisions/[...slug]` | `wikiPage` / `slug` | `apps/web/app/(shell)/coworker-decisions/[...slug]/page.tsx` | Organization overlay or kernel fallback according to loader; publish readable fixture document only. |
| `/coworker-decisions/craft/[professionKey]` | `registry:PROFESSION_REGISTRY` / `professionKey` | `apps/web/lib/decision-perspective/resolve-profession-profile.ts` | Actual profession key and applicable organization/kernel wiki pages; auth required. |
| `/coworker-decisions/decisions/[interactionId]` | `decisionInteraction` / `interactionId` | `apps/web/lib/decision/decision-origin.ts` | Synthetic recorded decision and optional outcome/proposal; no provider execution or old task replay. |
| `/coworker-decisions/edit/[...slug]` | `wikiPage` / `slug` | `apps/web/app/(shell)/coworker-decisions/edit/[...slug]/page.tsx` | Declared organization context and overlay/kernel source; measure editor without saving. |
| `/coworker-decisions/perspectives/[profileId]/voice` | `decisionPerspectiveProfile` / `profileId` | `apps/web/app/(shell)/coworker-decisions/perspectives/[profileId]/voice/page.tsx` | Declared profile; no real voice/model credential or synthesis side effect. |
| `/customer/[id]` | `customerAccount` / `id` | `apps/web/lib/customer-estate/account-estate-summary.ts` | Synthetic account in fixture organization with fabricated contacts/opportunity/order links; no production CRM lookup. |
| `/customer/opportunities/[id]` | `opportunity` / `id` | `apps/web/lib/actions/crm.ts` | Synthetic opportunity/account and valid pipeline-inspector state; no sales action. |
| `/customer/quotes/[id]` | `quote` / `id` | `apps/web/app/(shell)/customer/(crm)/quotes/[id]/page.tsx` | Synthetic quote linked to fixture opportunity/account and valid status; no sending. |
| `/docs/[[...slug]]` | `registry:loadAllDocs` / `slug[]` | `apps/web/app/(shell)/docs/[[...slug]]/page.tsx` | Actual readable doc key from immutable target corpus; optional slug is handled as an array, not malformed placeholder. |
| `/ea/models/[slug]` | `eaReferenceModel` / `slug` | `apps/web/lib/actions/ea.ts` | Existing declared reference model imported for fixture archetype; read-only projection data, no proposal execution. |
| `/ea/views/[id]` | `eaView` / `id` | `apps/web/app/(shell)/ea/views/[id]/page.tsx` | Declared view/notation/element types and fixture elements; view_ea_modeler and manage_ea_model tested separately. |
| `/finance/assets/[id]` | `fixedAsset` / `id` | `apps/web/lib/actions/assets.ts` | Synthetic fixed asset with valid accounts/depreciation state; no journal posting. |
| `/finance/banking/[id]` | `bankAccount` / `id` | `apps/web/lib/actions/banking.ts` | Synthetic bank account and stable opening balance; requireManageFinance. |
| `/finance/banking/[id]/import` | `bankAccount` / `id` | `apps/web/lib/actions/banking.ts` | Same synthetic bank account; render import form only, no upload or bank connection. |
| `/finance/banking/[id]/reconcile` | `bankAccount` / `id` | `apps/web/lib/actions/banking.ts` | Same bank account with declared unmatched synthetic transaction; no reconciliation mutation. |
| `/finance/bills/[id]` | `bill` / `id` | `apps/web/lib/actions/ap.ts` | Synthetic bill/supplier and valid lines/currency; requireManageFinance, no posting/payment. |
| `/finance/expense-claims/[id]` | `expenseClaim` / `id` | `apps/web/lib/actions/expenses.ts` | Own-profile and foreign-profile claim variants; ordinary owner visibility differs from finance-manager access. |
| `/finance/invoices/[id]` | `invoice` / `id` | `apps/web/lib/actions/finance.ts` | Synthetic invoice/account/lines; requireManageFinance; no send/payment/journal action. |
| `/finance/purchase-orders/[id]` | `purchaseOrder` / `id` | `apps/web/lib/actions/ap.ts` | Synthetic purchase order/supplier/lines; no vendor communication. |
| `/finance/recurring/[id]` | `recurringSchedule` / `id` | `apps/web/lib/actions/recurring.ts` | Synthetic recurring schedule and declared generated invoices; no scheduled execution. |
| `/finance/suppliers/[id]` | `supplier` / `id` | `apps/web/lib/actions/ap.ts` | Synthetic supplier/financial summaries without real payment/provider account. |
| `/inventory/entity/[entityId]` | `inventoryEntity` / `id` | `apps/web/app/(shell)/inventory/entity/[entityId]/page.tsx` | Canonical non-superseded fixture entity and relationships; test canonicalization redirect separately. |
| `/knowledge/[articleId]` | `knowledgeArticle` / `articleId` | `apps/web/app/(shell)/knowledge/[articleId]/page.tsx` | Published/readable fixture article with declared visibility and organization. |
| `/platform/ai/agent/[agentId]` | `loader:loadCoworkerRecord` / `agentId` | `apps/web/lib/coworker-record/load-record.ts` | Actual seeded test coworker accepted by loader, including canonical identity/aliases; no engagement or inference. |
| `/platform/ai/assignments/bindings/[bindingId]` | `authorityBinding` / `bindingId` | `apps/web/app/(shell)/platform/ai/assignments/bindings/[bindingId]/page.tsx` | Actual synthetic binding; preserve redirect to assignments?binding= and validate drawer target, not placeholder URL. |
| `/platform/ai/decisions/[interactionId]` | `decisionInteraction` / `interactionId` | `apps/web/app/(shell)/platform/ai/decisions/[interactionId]/page.tsx` | Same synthetic decision; preserve redirect to canonical coworker-decisions detail. |
| `/platform/ai/providers/[providerId]` | `modelProvider` / `providerId` | `apps/web/lib/inference/ai-provider-internals.ts` | Synthetic non-executing provider; no credentialEntry secret/refreshToken, live connection or remote refresh. |
| `/platform/identity/authorization/bindings/[bindingId]` | `authorityBinding` / `bindingId` | `apps/web/app/(shell)/platform/identity/authorization/bindings/[bindingId]/page.tsx` | Actual synthetic binding; preserve canonical authorization?binding= drawer redirect. |
| `/platform/services/[serverId]` | `mcpServer` / `id` | `apps/web/app/(shell)/platform/services/[serverId]/page.tsx` | Same synthetic service as canonical tools/services detail; preserve redirect. |
| `/platform/tools/services/[serverId]` | `mcpServer` / `id` | `apps/web/lib/actions/mcp-services.ts` | Synthetic non-executing service/config and declared grants; requireUser and write-capability distinction. |
| `/portfolio/[[...slug]]` | `registry:portfolio tree` / `slug[]` | `apps/web/lib/work-management/area-flow.server.ts` | Actual target portfolio node path; synthetic organization/product associations and permitted viewer context. |
| `/portfolio/product-line/[id]/direction` | `loader:loadCurrentProductOperatingContextByKey` / `product-line key` | `apps/web/lib/product-management/current-product-operating-context.server.ts` | Resolve supported semantic/internal key in fixture organization through canonical product operating-context loader; do not assume id field. |
| `/portfolio/product/[id]` | `digitalProduct` / `id` | `apps/web/lib/product-management/current-product-operating-context.server.ts` | Same existing fixture product.id; operating-context routes also require supported product key, fixture organization and viewer authority. Populate only declared per-tab relations; no release/upgrade/action. |
| `/portfolio/product/[id]/architecture` | `digitalProduct` / `id` | `apps/web/app/(shell)/portfolio/product/[id]/architecture/page.tsx` | Same existing fixture product.id; operating-context routes also require supported product key, fixture organization and viewer authority. Populate only declared per-tab relations; no release/upgrade/action. |
| `/portfolio/product/[id]/backlog` | `digitalProduct` / `id` | `apps/web/app/(shell)/portfolio/product/[id]/backlog/page.tsx` | Same existing fixture product.id; operating-context routes also require supported product key, fixture organization and viewer authority. Populate only declared per-tab relations; no release/upgrade/action. |
| `/portfolio/product/[id]/changes` | `digitalProduct` / `id` | `apps/web/app/(shell)/portfolio/product/[id]/changes/page.tsx` | Same existing fixture product.id; operating-context routes also require supported product key, fixture organization and viewer authority. Populate only declared per-tab relations; no release/upgrade/action. |
| `/portfolio/product/[id]/direction` | `digitalProduct` / `id` | `apps/web/lib/product-management/current-product-operating-context.server.ts` | Same existing fixture product.id; operating-context routes also require supported product key, fixture organization and viewer authority. Populate only declared per-tab relations; no release/upgrade/action. |
| `/portfolio/product/[id]/direction/intelligence` | `digitalProduct` / `id` | `apps/web/lib/product-management/current-product-operating-context.server.ts` | Same existing fixture product.id; operating-context routes also require supported product key, fixture organization and viewer authority. Populate only declared per-tab relations; no release/upgrade/action. |
| `/portfolio/product/[id]/direction/outcomes` | `digitalProduct` / `id` | `apps/web/lib/product-management/current-product-operating-context.server.ts` | Same existing fixture product.id; operating-context routes also require supported product key, fixture organization and viewer authority. Populate only declared per-tab relations; no release/upgrade/action. |
| `/portfolio/product/[id]/direction/roadmap` | `digitalProduct` / `id` | `apps/web/lib/product-management/current-product-operating-context.server.ts` | Same existing fixture product.id; operating-context routes also require supported product key, fixture organization and viewer authority. Populate only declared per-tab relations; no release/upgrade/action. |
| `/portfolio/product/[id]/health` | `digitalProduct` / `id` | `apps/web/lib/release-health/state.ts` | Same existing fixture product.id; operating-context routes also require supported product key, fixture organization and viewer authority. Populate only declared per-tab relations; no release/upgrade/action. |
| `/portfolio/product/[id]/inventory` | `digitalProduct` / `id` | `apps/web/lib/assurance/bom-read.ts` | Same existing fixture product.id; operating-context routes also require supported product key, fixture organization and viewer authority. Populate only declared per-tab relations; no release/upgrade/action. |
| `/portfolio/product/[id]/knowledge` | `digitalProduct` / `id` | `apps/web/app/(shell)/portfolio/product/[id]/knowledge/page.tsx` | Same existing fixture product.id; operating-context routes also require supported product key, fixture organization and viewer authority. Populate only declared per-tab relations; no release/upgrade/action. |
| `/portfolio/product/[id]/offerings` | `digitalProduct` / `id` | `apps/web/lib/products/operational-offerings.ts` | Same existing fixture product.id; operating-context routes also require supported product key, fixture organization and viewer authority. Populate only declared per-tab relations; no release/upgrade/action. |
| `/portfolio/product/[id]/supply-chain` | `digitalProduct` / `id` | `apps/web/app/(shell)/portfolio/product/[id]/supply-chain/page.tsx` | Same existing fixture product.id; operating-context routes also require supported product key, fixture organization and viewer authority. Populate only declared per-tab relations; no release/upgrade/action. |
| `/portfolio/product/[id]/team` | `digitalProduct` / `id` | `apps/web/lib/actions/business-model.ts` | Same existing fixture product.id; operating-context routes also require supported product key, fixture organization and viewer authority. Populate only declared per-tab relations; no release/upgrade/action. |
| `/portfolio/product/[id]/versions` | `digitalProduct` / `id` | `apps/web/app/(shell)/portfolio/product/[id]/versions/page.tsx` | Same existing fixture product.id; operating-context routes also require supported product key, fixture organization and viewer authority. Populate only declared per-tab relations; no release/upgrade/action. |
| `/portfolio/products/[productId]` | `digitalProduct` / `productId` | `apps/web/app/(shell)/portfolio/products/[productId]/page.tsx` | Legacy semantic product key resolving to existing fixture product.id; preserve actual redirect. |
| `/storefront/items/[id]/catalog` | `storefrontItem` / `id` | `apps/web/lib/products/catalog-builder.ts` | Fixture storefront item with catalogItem and effective-window SKU/pricing/fulfillment relationships. |
| `/storefront/items/[id]/purchases` | `storefrontItem` / `id` | `apps/web/lib/products/product-sold-query.ts` | Same item in selected fixture storefront; product-sold trace and valid catalog relation; no purchases. |
| `/wiki/[...slug]` | `wikiPage` / `slug` | `apps/web/app/(shell)/wiki/[...slug]/page.tsx` | Same readable fixture wiki slug; preserve canonical coworker-decisions redirect. |
| `/workbooks/[workbookId]` | `workbook` / `workbookId` | `apps/web/lib/workbooks/workbook-service.ts` | Declared workbook and fixture-user share/role; view_workbooks and row/table access enforced by service. |
| `/workbooks/system/[entityType]` | `registry:platform-tables` / `entityType` | `apps/web/app/(shell)/workbooks/system/[entityType]/page.tsx` | Actual registered entity type; assert canonical home redirect instead of inventing a workbook. |
| `/workforce/[agentId]` | `loader:loadCoworkerRecord` / `agentId` | `apps/web/lib/coworker-record/load-record.ts` | Same seeded synthetic coworker and declared local cost/engagement/team projections; no runtime tasks. |
| `/workspace/cases/[caseKey]` | `workItem+workroom` / `sourceType:sourceId` | `apps/web/lib/i18n/locale-context.server.ts` | Reuse existing deterministic ux-sweep:ux-sweep-case and declared posture; enforce effective-auth/room selection. |
| `/workspace/documents/[documentId]` | `document` / `documentId` | `apps/web/lib/documents/document-store.ts` | Use existing managed-document fixture writer; readableDocumentWhere(viewer), source provenance, local stored file/rendition only. |
| `/workspace/mailroom/items/[inboundId]` | `inboundChannelMessage` / `inboundId` | `apps/web/lib/mailroom/runtime.server.ts` | Synthetic mailroom message in resolved fixture organization with domain=mailroom; optional draft/workitem links, no outbound send. |

The source-only matrix accounts for all 70 original dynamic patterns exactly
once. Actual factory availability, target fixture IDs, authorized persona states,
runtime mapping and measurements remain unverified. The runtime projection must
derive from the existing route/fixture substrate; this appendix does not become
a second executable route registry.
