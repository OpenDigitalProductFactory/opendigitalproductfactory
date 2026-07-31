# Complete AI Coworker Declarations

> For agentic workers: execute this plan one independently reviewable backlog
> item at a time - one BI, one branch, one PR. Use `dpf-tdd` for red-green
> implementation, `dpf-local-merge-ci-before-push` plus the plan's completion
> gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Complete the source declarations and owner experience that let people find AI
coworkers by work, understand business fit, distinguish fit from executable
readiness, and recover without reading technical internals.

- Umbrella: `BI-97CD9E4B`
- Epic: `EP-UX-SYSTEM`
- Design:
  `docs/superpowers/specs/2026-07-30-coworker-declarations-design.md`
- Applicability WWMD: `DI-17EC37A4F121`
- Catalog ownership WWMD: `DI-8F0D4C46402A`
- Primary placement WWMD: `DI-D27A79E99964`
- State/action WWMD: `DI-B17F4DE8FD51`

## Backlog Coverage

- Decision: `decomposed`
- Receipt: `cms751r4c0o3u01ogl2xxg8ci`
- Plan path:
  `docs/superpowers/plans/2026-07-30-coworker-declarations.md`

| Key | Deliverable | BI | Independently shippable | Depends on |
| --- | --- | --- | --- | --- |
| `marketing-live-acceptance` | Prove the first truthful Marketing slice | `BI-C1943813` | Yes | None |
| `compatibility-reader` | Dual reader, canonical owner, and expand-only schema | `BI-3FB40CCA` | Yes | Marketing |
| `aggregate-contract` | Remediate duplicates and enforce canonical-owner uniqueness | `BI-2E7972A7` | Yes | Reader |
| `versioned-writer` | Install-gated v1 writer and atomic source CAS | `BI-33A623D0` | Yes | Reader, contract |
| `readiness-evidence` | Declaration-derived readiness manifest and projection | `BI-1FDEF342` | Yes | Marketing, reader |
| `customers-declarations` | Customers and sales declarations | `BI-A00EAD43` | Yes | Contract, writer, readiness |
| `team-declarations` | Your team declarations | `BI-A02A060E` | Yes | Contract, writer, readiness |
| `operations-declarations` | Operations and delivery declarations | `BI-3BDB5C04` | Yes | Contract, writer, readiness |
| `platform-declarations` | Platform and back office declarations | `BI-F798996C` | Yes | Contract, writer, readiness |
| `roster-record-consumers` | Searchable directory, record states, recovery, and named Ask | `BI-57F76D61` | Yes | Readiness, declaration batches |
| `cross-archetype-acceptance` | Cross-archetype desktop/mobile acceptance and docs | `BI-57F76D61` | No | Consumers |

Receipts `cms73kcjc0kb601ogtctrjequ` and `cms74lbb70n4v01ogrzdxetu2` are
superseded. Independent reviews proved both a single-release reader/writer
cutover and a combined writer/readiness/fleet release were unsafe.

## Dependency Stop Rule

Do not implement declaration source behavior until `BI-C1943813` has:

1. passed exact-SHA merged-code CI;
2. merged through the queue;
3. deployed through governed self-upgrade; and
4. passed live directory -> Marketing record -> exact named Ask acceptance.

Design, review, backlog capture, and test planning may proceed while it waits.

## Release 0: Marketing Proof

Owner: `BI-C1943813`

Prove the smallest customer-facing vertical slice:

- food-hospitality applicability uses explicit governed evidence;
- Marketing service backing, route, provider, grant, and authority checks are
  service-specific;
- only current evidence projects Available;
- directory -> record -> Marketing Ask sends nothing before explicit submit.

Completion gate:

- exact-SHA local merged-code CI;
- ready PR with no unresolved review;
- merge queue;
- governed self-upgrade;
- desktop/mobile live acceptance.

## Release R: Compatibility Reader

Owner: `BI-3FB40CCA`

### R1. Contract TDD

Add:

- `packages/db/src/coworker-applicability-contract.ts`
- `packages/db/src/coworker-applicability-contract.test.ts`
- package export consumed by web

Tests first:

- strict legacy and v1 parsing;
- unknown-member rejection;
- registry validation;
- order permutation;
- inheritance boundaries, cycles, depth, and ties;
- exact leaf/category legacy behavior;
- DB/web parser parity.

### R2. Typed Catalog Ownership

Change:

- `packages/db/prisma/schema.prisma`
- one fleet-safe migration
- closed registries and tests in `packages/db`

Add:

- `CoworkerService.catalogRole`;
- `CoworkerService.catalogOwnerAgentId`;
- `Agent.coworkerCatalogExceptionReason`;
- declaration owner/revision/hash fields.

Backfill the catalog owner through the governed slug -> canonical identity map
and only known, unambiguous `metadata.aggregate === true` values. Detect and
report duplicate aggregates. This is expand-only: do not add a unique index or
fail a forward migration because dirty rows already exist.

### R3. Reader Convergence

Refactor every consumer:

- `apps/web/lib/coworker-service-catalog/archetype-declarations.ts`
- `apps/web/lib/coworker-service-catalog/availability-projection.ts`
- `apps/web/lib/coworker-service-catalog/catalog.ts`
- DB seed/catalog readers
- roster and coworker-record loaders

Use one raw+parsed contract. Continue writing arrays only.

### R4. Reader Verification

- expand migration applies to clean, dirty, and slug/`AGT-*` alias fixtures;
- legacy behavior is unchanged;
- v1 values are readable in all consumers;
- current writer still emits arrays;
- rollback to the prior binary remains safe because no v1 is written;
- focused DB/web tests, typecheck, docs/guards, exact-SHA local CI, PR health,
  merge queue, governed deployment, and live no-regression acceptance pass.

Record install-local Reader R activation only after post-deploy health.

## Release C: Canonical Aggregate Contract

Owner: `BI-2E7972A7`

1. Recompute every service owner from the immutable migration-local identity
   map, replacing null, stale, alias, and incorrectly populated values before
   any duplicate grouping.
2. Read duplicate reports by the recomputed canonical catalog owner.
3. Apply source/operator-approved remediation where the intended aggregate is
   known.
4. In the contract migration, demote every member of any unresolved duplicate
   set to `specific`, retain the active services, and attach
   typed `CoworkerService.catalogIntegrityStatus/evidence`.
5. Compare the immutable SQL alias map with the TypeScript identity registry in
   CI. Missing canonical targets retain the provider owner and typed evidence.
6. Make `catalogOwnerAgentId` non-null, add its named Agent foreign key, then
   add the partial unique index.
7. Reject alias-row catalog exceptions and aggregate-plus-exception state.
8. Serialize aggregate/exception writes by locking the canonical Agent row,
   re-reading both tables, and applying or rejecting in one transaction.
9. Add an authorized repair transaction that promotes one selected aggregate
   or records a canonical Agent exception and atomically clears quarantine.

Verification:

- dirty duplicate fixtures always advance;
- no service is deleted and no arbitrary aggregate winner is fabricated;
- quarantined-no-aggregate projects Coverage needs repair in Other with no Ask;
- null owners cannot bypass uniqueness;
- clean/repeat-apply/old-binary compatibility fixtures pass;
- canonical alias pairs cannot bypass uniqueness.

## Release W: Versioned Writer And Source CAS

Owner: `BI-33A623D0`

### W1. Writer Gate

Use existing substrate:

- typed `PlatformConfig["coworker-applicability-storage"]` owns install-local
  reader/writer version;
- self-upgrade recovery evidence records the pre-swap reader version and SHA;
- the promoter contract manifest declares minimum reader/storage versions;
- v1 writes require compile-time and PlatformConfig reader/writer version 1;
- activation binds one exact successful SelfUpgradeRun whose `deployedSha`
  equals the current served SHA; both it and `targetSha` must match
  `EXACT_GIT_SHA_RE = /^[0-9a-f]{40}$/i` before ancestry is tested;
- readiness/completion evidence persists `promoterSourceSha` from the validated
  OCI `org.opencontainers.image.revision` label, and it equals `deployedSha`;
  `targetSha` remains the upstream lineage marker and must be contained by
  `deployedSha` through `shaContains` only after the exact-SHA guard;
- that run binds the launched target manifest digest and one complete recovery
  point whose source SHA equals its currentSha and whose manifest reads v1;
- absent/unknown/incompatible evidence keeps array writes.

A direct pre-Reader -> Writer upgrade remains in array mode because its recovery
point cannot read v1.

Implement separate `canActivateWriter(runId)` and `canWriteV1` predicates.
Activation does not require writer marker fields; after post-health evidence
passes, it locks the config row, rechecks the run/served bindings, and writes
`writerVersion`, `writerSourceSha = deployedSha`, and
`writerActivatedForRunId` atomically. Every normal write requires those fields
and re-evaluates the full activation binding. Stale or unrelated recovery
evidence fails. Do not rely on the existing helper's prefix acceptance. Tests
reject abbreviated/colliding prefixes, malformed values, and absent/mismatched
`promoterSourceSha`, while accepting exact fast-forward equality and exact
merge ancestry.

### W2. Source Ownership

Move the authored declarations and types out of
`COWORKER_SERVICE_CATALOG_SERVICE_SEEDS` into the sole registry:

- `packages/db/src/coworker-service-declarations.ts`
- `packages/db/src/coworker-service-declarations.test.ts`

Seed convergence uses RFC 8785 JCS + SHA-256 over the exact governed field set:

- adopt only semantic-equivalent known legacy seed snapshots;
- atomically compare owner, revision, stored hash, recomputed current hash, and
  `updatedAt`;
- update only the expected platform-owned snapshot;
- preserve concurrent edits and transition operator changes to operator
  ownership;
- preserve operator/unknown/invalid values and report them;
- repeated reseed is idempotent.

The seed imports this registry; no parallel list remains. Inventory every
existing service upsert/update path and route governed-field changes through
the CAS writer.

### W3. Writer Integrity

Add source and runtime checks for:

- invalid applicability and inheritance;
- source ownership/hash drift;
- writer activation without install and recovery reader evidence.

Detection reports; it does not repair live rows.

### W4. Writer Verification

- JCS order permutation and SHA-256 fixtures pass;
- legacy adoption, lost-update, interrupted/repeat reseed, and ownership
  transition pass;
- direct pre-Reader upgrade remains in array mode;
- `writerVersion = 0`, unrelated recovery run, SHA/digest mismatch, and stale
  recovery evidence remain in array mode;
- Reader R can read writer-created v1 values;
- prior-reader rollback is blocked;
- exact-SHA merged-code CI, PR health, merge queue, governed deployment, and
  runtime integrity report pass.

## Release E: Readiness Evidence

Owner: `BI-1FDEF342`

### E1. Expected Manifest

Derive one expected check for every declared:

- backing skill, tool, and grant;
- required input and produced output;
- authority boundary;
- executable route and selected provider;
- unresolved capability need.

An executable service creates route/provider binding slots before lookup.
Missing bindings emit failed checks; they never disappear from the manifest.
One kind-to-failure-class registry owns blocked versus setup-needed.

The canonical Marketing route source lands through `BI-C1943813`; do not assume
`route-readiness.ts` exists on main before that merge.

### E2. Evidence And Projection

Normalize Marketing into:

- exactly one result for every expected `checkRef`;
- no duplicate, missing, or extra checks;
- `failureCode` required on fail/unknown and forbidden on pass;
- RFC 3339 UTC evaluation time;
- injected clock and exact stale boundary;
- total precedence: invalid/stale/unknown -> not-evaluated, then blocked,
  setup-needed, ready;
- permission-aware recovery resolver;
- no arbitrary stored recovery URL or owner prose.

Likely files:

- `apps/web/lib/coworker-service-catalog/readiness-contract.ts`
- `apps/web/lib/coworker-service-catalog/service-readiness.ts`
- the Marketing route-readiness module delivered by `BI-C1943813`

### E3. Verification

- an incomplete passing set never projects ready;
- blocked wins over setup-needed when failures coexist;
- one ready service never blesses a sibling;
- exact boundary tests run before, at, and after staleness;
- Marketing remains the first governed positive live fixture.

## Release D: Portfolio Declaration Batches

Owners:

1. Customers and sales: `BI-A00EAD43`
2. Your team: `BI-A02A060E`
3. Operations and delivery: `BI-3BDB5C04`
4. Platform and back office: `BI-F798996C`

Each independently reviewable batch declares:

- one aggregate service or canonical Agent exception;
- specific services;
- canonical service portfolios and service-scoped interaction;
- v1 applicability and inheritance;
- backing skills/tools/grants;
- required inputs, outputs, and authority;
- source revision/hash;
- exhaustive generated service-by-registered-archetype resolution plus
  portfolio-local integrity evidence.

Do not derive from coworker name, kind, description, or workforce identity
portfolio. The default ready, permitted action service owns primary placement;
every service portfolio remains a filter membership. Customer-facing work has
the highest sequence priority; batches may otherwise proceed independently
after C, W, and E.

Per-batch verification:

- no missing/duplicate aggregate or alias exception;
- no missing/orphan portfolio;
- unsupported backing and stale/invalid readiness remain non-Available;
- source and runtime invariants pass;
- every registered archetype/service pair resolves supported, future, or an
  explicitly authored not-applicable rule; no-match remains undeclared and
  creates backlog evidence;
- the Archetype Completeness Guard rejects a new archetype without declaration
  coverage and its recorded coworker decision;
- exact-SHA CI and representative live state pass before the batch merges.

## Release U: Roster And Record Consumption

Owner: `BI-57F76D61`

### U1. Canonical Projection

Keep applicability, readiness, and viewer permission as separate closed facts.
Converge labels, reason templates, tones, selected service, placement, recovery
owner/kind, actions, and Ask eligibility in one derived state/action registry.
Maintain separate catalog-summary, default-action, and remediation service
selection with total deterministic tuples. Ready and permitted work wins the
default action and primary placement; when none is Ask-eligible, blocked wins
over setup-needed. Invalid and undeclared win remediation before future and
not-applicable. Every unlisted fact combination fails closed.

### U2. Directory

Refactor existing `RosterView`:

- add `Find a coworker`;
- show Business area by default;
- place each coworker under its default action/recovery service while filtering
  by every active service portfolio membership;
- show Availability and Interaction on desktop;
- move secondary filters behind `Filters (n)` on mobile;
- update visible group/result counts through a polite live region;
- provide truthful no-result context and Reset filters;
- use one state-specific primary command: named Ask for ready/permitted work,
  typed recovery for blocked/remediation work, or View when no work action
  exists;
- keep `View coworker` as the secondary route when another primary exists;
- preserve Agent, service, recovery, blocker, route, and return context in every
  recovery link.

No new roster, dashboard, global nav item, or Details modal.

### U3. Coworker Record And Recovery

- show the default action service first, aggregate summary second when
  different, and sibling services next;
- render every canonical state from the shared registry;
- map recovery by permission and `recoveryKind`;
- keep technical evidence in `OwnerFirstDisclosure`;
- route unauthorized owners to explanation rather than unusable controls.
- render the record hierarchy in the visual prototype before implementation.

### U4. Named Ask

Reuse the shared coworker panel/dialog:

- exact full identity;
- versioned named-work target carrying canonical Agent, provider Agent,
  required service and active offer, route context, return destination, and
  projection revision;
- expected next step;
- explicit editable request;
- no send on open/navigation/filter;
- shared pending, duplicate-submit prevention, success, failure, and retry;
- focus return on close.

Add one server-owned `resolveCoworkerServiceInvocationDecision` resolver over
existing RBAC, membership, TAK authority, active-offer state, funding,
contract, and action-specific approval inputs. Call it from projection, panel
open, HTTP submission, MCP engagement request, and A2A task creation; unknown
fails closed. Refactor `createCoworkerEngagement` to consume this decision and
remove its independent offer lookup and approval derivation. Ask is ineligible
without the active offer returned by the decision. Revalidate the named-work
target at submit and create a `CoworkerEngagement` with the exact service/offer
identity before every named-service dispatch. Generic route-aware launchers
remain distinct and cannot claim named work.

The concrete integration path is:

1. `AgentCoworkerShell` carries `CoworkerNamedWorkTargetV1` into
   `AgentCoworkerPanel`.
2. `AgentCoworkerPanel` posts content, route context, the full target, and a
   stable client request id to `/api/agent/send`.
3. The API validates the target and calls the sole invocation-decision resolver.
4. One DB transaction derives a deterministic `CoworkerEngagement.engagementId`
   from organization, requester, and request id; persists the decision digest;
   and creates a one-to-one `CoworkerEngagementDispatch`. An exact retry returns
   the existing rows, while a reused key with a different payload digest is
   rejected. Approval-free decisions create `pending`; approval-required
   decisions create `awaiting-approval`.
5. A vendor-neutral worker claims the dispatch row by compare-and-set lease.
   Claim requires `state = pending`, an executable engagement status, and no
   cancellation/quiescence marker. `awaiting-approval` cannot be leased. A
   transactional approval CAS validates approver authority, decision digest,
   and approval evidence before moving both rows to executable states. The API
   returns durable status and never owns a long-lived in-process `sendMessage`
   promise.
6. The worker passes `engagementId` as the provider idempotency key, persists
   the provider receipt, and marks success. An expired pre-call lease can be
   reclaimed; an uncertain post-call result becomes `ambiguous` and must be
   reconciled before any retry.
7. The response and Work view use the same engagement id, and later work
   capsule, tool execution, and audit references attach to that row.

Treat `BI-PSC-004` as a hard prerequisite: it must publish the reviewed
vendor-neutral publish/claim/lease/retry/receipt/reconciliation/cancellation/
quiescence interface and conformance suite before named Ask dispatch is
implemented or activated. Implement the engagement row as an adapter to that
contract using the lease/CAS semantics already proven by
`DataControlOperationStep`, but do not reuse that data-mutation table or create
a second scheduler. `TaskRun` remains execution history.

Focused API/component/DB tests cover response-loss retries, concurrent duplicate
submits, mismatched idempotency payloads, permission changes between open and
submit, persistence failure, crash before lease, crash after lease but before
call, lease-expiry takeover, receipt-write failure after provider completion,
ambiguous reconciliation, cancellation, quiescence, and parity across
projection, panel, HTTP, MCP, and A2A. Add no-lease-before-approval,
unauthorized/stale/double approval rejection, and one authorized approval CAS
fixture.

### U5. Documentation And Live Acceptance

Update:

- `docs/user-guide/ai-workforce/index.md`
- `docs/superpowers/specs/2026-07-25-ai-workforce-ia-design.md`
- Purpose Contracts affected by state/action changes
- canonical AI route and launcher disposition registry plus generated guard

Run:

1. focused DB/web tests and typecheck;
2. docs index/link, migration, and invariant guards;
3. exact-SHA merged-code CI and production build;
4. independent implementation architecture/UX critique;
5. ready PR, PR health, merge queue;
6. governed self-upgrade;
7. live desktop and 390x844 mobile acceptance.

Live assertions:

- all four business areas contain truthful declarations;
- Other is limited to deliberate remediable exceptions;
- Marketing remains genuinely Available for Restaurant;
- search and Business area find a named target quickly;
- mobile filters do not bury the first result;
- the real mobile shell still leaves the first result identity and state in the
  initial viewport;
- every state has a truthful permission-aware next action;
- named Ask targets the exact coworker and does not auto-send;
- keyboard, focus restoration, Axe, console, and overflow pass.

## Review

Earlier reviews completed:

- independent architecture critique;
- independent UX critique;
- second architecture critique;
- every critical/important finding from those rounds folded into the first
  correction.

The cross-design review evidence `cms89aasd02zh01qobapm3tok` then found two P0
contract conflicts. WWMD evidence `cms89hv2a038101qoy22jq12a` selected
`action-service-primary` and `orthogonal-facts-derived-state`; this revision
folds both into the spec, plan, prototype, and acceptance fixtures.

Review candidate `306b529c5bb60a60f0637fb70cb34c184d374dbd` was deferred
by architecture reviewer `019fb701-377b-72e3-8c27-b480fced5aa4` and UX
reviewer `019fb701-5ba5-7f63-bb40-83f0a09a8e4b`. Their P0/P1 corrections are
folded into the migration, named-work, permission, registry, surface,
archetype, prototype, and acceptance contracts.

Review candidate `3720ae1c4f8cd94acaaec02717a14cb05d2d736d` was deferred
by architecture reviewer `019fb722-8144-7fe1-b0f8-ac4c709f5f12`; UX reviewer
`019fb722-8205-7943-8e14-0da53c9ce8b4` returned
`fits-with-guardrails`. The next correction separates activation/write
predicates, binds merge-mode promoter evidence to `deployedSha`, keeps
unmatched archetypes undeclared, names the idempotent Shell-to-dispatch path,
adds machine-readable route lifecycle fields and exact launcher sources, and
closes the measured search/mobile/recovery/accessibility guardrails.

Review candidate `34ff4a33ae5a05dcb67dc285d22214eb6930bb4e` received
terminal UX fit from `019fb733-4bf8-7eb1-8c6d-503ff548c410`. Architecture
reviewer `019fb733-4b1b-7363-ba35-9a29064e8003` deferred it for five remaining
contract gaps: strict full-SHA writer validation, machine route destinations,
crash-recoverable dispatch, one owner for permission/offer/approval, and
explicit OCI-derived `promoterSourceSha` evidence. The amended candidate closes
all five. Substrate verification found the implemented lease/CAS pattern in
`DataControlOperationStep` and the planned general contract in `BI-PSC-004`;
WWMD interaction `DI-4EA59A3AE69C` selected the one-to-one engagement dispatch
record with high confidence and no commandment conflict. Fresh exact-SHA
architecture and UX confirmation remains required.

Review candidate `9ca40eef7a2eb645b5cd16d18d12b6908d8e6677` retained
terminal UX fit from `019fb733-4bf8-7eb1-8c6d-503ff548c410` with no findings.
Architecture reviewer `019fb733-4b1b-7363-ba35-9a29064e8003` confirmed the
original five corrections, then deferred approval leasing, durable-execution
ownership, and structured context mapping. The amended candidate adds an
unleaseable `awaiting-approval` state plus approval CAS, makes `BI-PSC-004` a
hard prerequisite rather than an aspirational adapter, and places query/path/
entity/focus/return transforms in the machine route registry. That corrected
content was frozen for one final exact-SHA architecture and UX confirmation.

Final content candidate `511784f8f8189d94c15e9747f1d67b718f0b6675`
received terminal architecture fit from
`019fb733-4b1b-7363-ba35-9a29064e8003` and terminal UX fit from
`019fb733-4bf8-7eb1-8c6d-503ff548c410`, with no P0, P1, or P2 findings. Review
provenance is added separately from the immutable reviewed content.

Required before the design PR:

- fresh terminal architecture and UX reviews against the corrected exact SHA;
- exact revision SHA, reviewer ids, and review evidence recorded on
  `BI-97CD9E4B` and `BI-F2278856`;
- architecture and UX review against each implementation diff;
- measured browser evidence, not screenshots alone.

## Refactoring Allowance

Reserve roughly 20 percent of implementation effort for:

- the shared applicability parser/export;
- raw+parsed catalog read model;
- readiness evidence projector;
- owner-state/action registry;
- removal of `metadata.aggregate` and duplicate display-state logic.

Do not spend this allowance on unrelated routes, schema, or visual cleanup.

## Risks And Rollback

| Risk | Control | Rollback |
| --- | --- | --- |
| v1 reaches array-only consumer | Reader release and fleet gate before writer | Keep array writer; rollback Reader safely |
| dirty aggregate rows wedge migration | expand Reader, quarantine-before-index Contract release | retain active specific services and report repair |
| alias identities bypass uniqueness | canonical catalog owner separate from provider identity | disable aggregate write; keep services specific |
| writer enabled too early | install PlatformConfig + recovery evidence + promoter manifest | fail closed to array writes |
| not-offered has two owners | Agent exception plus typed service role | Reject contradiction |
| inheritance hides coverage | Deterministic tuple, cycle/depth/tie rejection | Disable inheritance, retain local rules |
| seed overwrites operator work | JCS hash, guarded adoption, atomic revision/hash/updatedAt CAS | Disable convergence; preserve live row |
| evaluator omits a prerequisite | declaration-derived exact check manifest | project Readiness not checked |
| stale evidence claims Available | derived status and injected-clock boundary | project Readiness not checked |
| UI creates another AI surface | existing roster, record, and panel only | revert consumers, retain truth substrate |

After Writer W persists v1, Reader R is the oldest supported rollback target.
