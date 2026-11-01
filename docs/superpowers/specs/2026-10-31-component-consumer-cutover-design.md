# DPF consumer cutover to independently maintained components

Status: proposed; source design, not implementation or release admission.
Owner: DPF maintainers (@markdbodman through existing CODEOWNERS).
Backlog: BI-66681CBB. Successor planning to BI-E23432C1 and merged PR #6724.
Related delivery intake: BI-B8A4DE44 (component foundation candidates),
BI-FCDCAE98 (first DPF caller). Both remain triaging until their prerequisites exist.

## Problem and design grounding

Seven public repositories are exact source seeds from
`56f3a5d2d57d751eb3ac435dcca4133c5ff46686`, merged through #6724 as
`46f8a5ca9cb75aa871a223b70acc6dcc65d15a67`. They are not finished packages:
their root manifests are private, and isolated examples do not establish a public
export map, production distribution, consumer compatibility or package release.
DPF still resolves validators, integration-shared and storefront-templates through
`workspace:*` in `apps/web/package.json`.

At inspected main `ea62f5fb890390bde854b618834f5e77fd3865ea`, all 76 canonical
package-source paths in the seven PROVENANCE manifests match the seed. Host
Workroom, inference, admission and recovery code has moved since extraction.
Migrations must start from fresh main, preserve those repairs, and compare exact
blobs again. This observation is source verification, not runtime qualification.

This extends [the extraction design](2026-10-18-reusable-architecture-extraction-design.md),
especially dependency/maintenance and absorption disposition. It does not reopen
delivered graph execution (BI-8875C9DF), the reference-package exporter
(BI-07A2B207), or the registry/intake programme (EP-D3EF50E4, BI-38E4F858).
Existing component DEPENDENCY-BOUNDARY and PROVENANCE manifests are transition
inputs; each owning repository must reconcile them before a consuming release.

BI-DBA1FE11 and BI-721C467A are the existing Workroom/GPP source-extraction
items, both currently triaging. BI-DBA1FE11 has a paused Workroom within its
resume grace (WC-BD687ACC); it is not abandoned work to take over. The new
foundation-candidate intake concerns independent distribution and cross-repository
ownership, rather than repeating their extracted implementation. Reconcile the
exact package/source edit ownership with these items before decomposing or
admitting BI-B8A4DE44. Do not silently replace their work or force their claims.

## Objectives and acceptance

**OBJ-OWNER:** One canonical implementation owner per responsibility, without a
package cycle, duplicate engine, permission system or serializer.

**OBJ-DISTRIBUTION:** Independently maintained, immutable artifacts that DPF can
receive, verify, update and roll back through its existing release process.

**OBJ-CONSUMER:** Preserve actual DPF semantics and host authority while retiring
displaced bodies in the same accepted migration.

The following acceptance statements are quoted from BI-66681CBB:

- AC-CUT-01: Every shared source responsibility has one named canonical owner and an acyclic dependency direction, with no second engine, permission system or serializer.
- AC-CUT-02: The selected immutable distribution strategy specifies exports, runtime and compiler support, complete dependency closure, licensing/provenance, integrity, release ownership and rollback.
- AC-CUT-03: The first real DPF caller migration and all retained compatibility imports have named owners, same-slice body retirement and explicit removal conditions; recent main fixes are preserved.
- AC-CUT-04: The plan identifies clean receiving-consumer, semantic/digest/receipt, loader/emitted-import, protected integration and relevant served-flow checks, distinguishing unrun checks from passes.
- AC-CUT-05: Independent review and live backlog coverage are recorded before any caller implementation; separately shippable successors have live mappings.

AC-CUT-01 maps to OBJ-OWNER; AC-CUT-02 to OBJ-DISTRIBUTION;
AC-CUT-03/04 to OBJ-CONSUMER; AC-CUT-05 applies to all three.

## Selected ownership boundary

Kernel decision DI-7AF2A4D33ED0 selected `workroom-foundation`: composite 5.202,
margin 1.669, high confidence, usable and autonomy-eligible, no commandment conflict.
The main positive contributors were existing-platform grounding and standards.
This records the design direction; independent compatibility review is still owed.

| Existing source responsibility | Canonical component owner | Other consumers |
| --- | --- | --- |
| Workroom flow graph, marking, receipts; action-result and outcome-disposition contracts | dpf-workroom | GPP, policy, DPF host |
| Pure process element IDs, diagnostics and executable-construct descriptors | dpf-workroom, explicit contract subpaths | GPP and policy import these leaves; Workroom never imports GPP compiler/schema |
| constructs-used-by analysis; work vocabulary, shape schema/contracts, compiler, interpreter and tooling | dpf-gpp | Policy and DPF authoring/runtime adapters |
| Existing canonical-json leaf | dpf-gpp, isolated serializer subpath | Operating composition; no compiler, Zod, Node or HTTP import through that leaf |
| decision-scopes and bounded-trusted-json validation | dpf-scoped-judgment, isolated contract subpaths | GPP, policy, composition and commons |
| policy-types and guards used by policy resolution | dpf-workroom-policy | Higher composition/host adapters where actual closure requires them |
| Work posture, deadlines, joins and funded-author policy | dpf-workroom-policy | DPF host; no portable grant/admission owner |
| Composition descriptors, qualification queries and legacy fingerprint parity | dpf-operating-composition | DPF host; serializer and shared validation imported from their owners |
| Business operating-model selectors and vocabulary | dpf-business-operations | DPF business surfaces through host data adapters |
| Commons exchange contracts and lifecycle | dpf-commons | DPF ledger/transport adapters; no second knowledge store |

The graph/marking source currently imports GPP element IDs; GPP currently imports
graph and receipt behavior. Moving only public import strings would create a
Workroom-to-GPP-to-Workroom cycle. Move the pure identity contract closure to
Workroom first, preserving its symbols and bytes. Keep the GPP analysis helper in
GPP; remove its unused Workroom seed copy after verified closure analysis.

Allowed package dependency directions (arrows mean "depends on"):

```text
GPP -> Workroom, scoped judgment, existing qualified Zod
Workroom policy -> Workroom, GPP, scoped judgment
Operating composition -> GPP serializer, scoped judgment
Commons -> scoped judgment
Business operations -> only its demonstrated external closure
Workroom / scoped judgment -> no higher component
```

These are package-boundary obligations, not permission to increase dependencies.
Actual imports, including declaration/type imports, must be enumerated before
each package interface is frozen. Reject any additional upward edge or resolve
it explicitly before release. Do not add an eighth foundation package to hide a
cycle. Physical source paths may move; semantic IDs, diagnostics, canonical bytes,
receipt formats and legacy hashes remain unchanged unless separately versioned.

## Immutable distribution

DI-7E68467A7AD0 selected `versioned-artifacts`: composite 7.119, margin 1.197,
high confidence, usable and autonomy-eligible, no commandment conflict. Standards
and existing-platform grounding were the leading positive contributors. Exact
source absorption was the considered alternative; recurring consumer reconciliation
made it less suitable for independently maintained component releases.

Use tested versioned package artifacts, pinned to exact versions with artifact
integrity in the receiving lockfile. Retain source Git commit, builder identity,
build inputs, package file inventory, dependency disposition and Apache notices.
Registry choice follows existing intake policy; a new registry or infrastructure
is not required or authorized here. A package candidate can be tested from its
exact tarball before any public publication is approved.

Each artifact must explicitly export its supported API and declarations. Start
with one ESM implementation; do not promise CommonJS, arbitrary internal paths,
browser compatibility or a dual build without receiving-consumer tests. Keep pure
browser-safe subpaths free of Node/transport imports. Declare a supported Node and
TypeScript matrix after checking the exact DPF pins and seed fixture compiler;
Node 24.16.0 / TypeScript 6.0.3 seed success is historical evidence only.

Build from the pinned source and lockfile; pack only intended runtime/types,
license and metadata. Validate emitted JavaScript relative imports, declaration
imports and all transitive package exports in a clean consumer without monorepo
aliases, workspace symlinks, source trees or inherited dependencies. DPF's Next
source loader and compiler modes need separate real tests. A successful synthetic
fixture does not prove these paths.

No automatic publish-on-merge, credential changes or production deployment is
part of this design. Component maintainers own compatibility/security releases;
DPF owns its dependency update PR and acceptance. A release never transfers
Workroom, organization, actor, GPP/TAK or transaction authority to a library.

## Receiving-consumer handoff and maintenance division

The owner selected coordinated shared-component development in the DPF2 chat.
The receiving audit dated 2026-10-31 reports seven isolated `npm run check`
passes on Node 24.16.0 / TypeScript 6.0.3, matching public/local seed heads,
76 matching unique manifested package-source paths on DPF main
`568c0c1ad2b52c4c42c1493feeabe325b04a4cc7`, and 15 paths copied across seeds.
These are attributed receiving-audit observations, not new executions by this
planning thread. They do not prove installed-package or product integration.

The first foundation candidate must supply the receiving graph **and** GPP
schema/contracts plus narrow decision-scope leaves. It is neither a Workroom-only
replacement nor an all-seven-family release. The corresponding source candidates
are Workroom `b43be400326f8cc5777a9d40c1f058a8f0363dc8`,
GPP `61e7e186c973bf6861383d33f021d5df62de9a69`, and scoped judgment
`8203d6a4966ed65f44892fc4fe7cbb08ef7a6704`.

DPF2's existing nine absorbed files remain pinned to
`4faccd852a49bba58e40ad7146f3d9c585874cf0`. The audit finds six differences
from the seeds, chiefly source import extensions/whitespace and optional
diagnostic metadata. Classify those differences and preserve required receiving
semantics; their count is not evidence of six broken behaviors. DPF2 owns the
adapter change and retirement of those files after receiving acceptance. Do not
silently widen its structural adapter to marking or interpreter execution.

The receiving matrix includes DPF2 TypeScript 7.0.2 / Node 24.22.0 in addition
to the source-fixture matrix, and the exact current DPF compiler/loader pins at
admission. Test clean installed-tarball JavaScript and declaration imports in each
actual receiver. Shared fixture success cannot substitute for this matrix.

Legacy receipt helpers remain compatibility APIs: missing run values can match,
and a non-blocked receipt can count as completing. Preserve that DPF meaning;
do not use those predicates as DPF2 accepted-work checks. Each host retains exact
definition/occurrence/stage/iteration/attempt/actor/binding/artifact/result and
protected-lineage validation at its command/Store boundary. A common stricter
helper, if demonstrated necessary for both hosts, needs a separately versioned
contract and paired adverse vectors rather than silently tightening legacy calls.

| Owner | Accountable deliverable |
| --- | --- |
| Shared repository maintainers | Reusable contracts, explicit packaging, compatible fixes, conformance vectors, supported combinations and security/release maintenance |
| DPF adoption item BI-FCDCAE98 | Pin qualified artifact; refactor actual DPF callers; retire replaced bodies or document temporary exports of the same body; preserve IDs/receipts/hashes; integration/recovery tests and rollback |
| DPF2 receiving owner | Its adapter and nine-file retirement, company-flow acceptance, Linux host enforcement and its own update/recovery process |

A component release does not update or deploy DPF or DPF2. Hosts choose exact
qualified artifacts through their own governed delivery. Authentication,
qualification authority, current admission, durable effect/resource custody and
native execution remain host-owned, including during uncertain recovery.

The fuller practice/job/context/tool/result assembly remains a separately bounded
shared seam in existing Workroom/GPP definitions and operating-composition homes.
Characterize its real source-registry/review-profile consumers before proposing
changes. It is not a prerequisite to ship every family, a new engine, or an
authorization to transplant a synthetic in-memory host into either product.

## DPF migration and retirement

BI-FCDCAE98 owns the first bounded consumer pilot, after the foundation candidate
is qualified. Begin with `apps/web/lib/work-management/workroom-shape-conformance.ts`
and its real graph import. Enumerate all users of the affected canonical bodies
before choosing a removal boundary: the pilot cannot retain a second live graph
implementation merely because only one direct application import changes.

`@dpf/validators/workroom/flow-graph` may remain temporarily as a thin re-export of
the same pinned artifact. Existing graph/marking/interpreter identity tests must
prove all callers see the same implementation. Remove the displaced implementation
bodies with the accepted migration; list every retained compatibility subpath,
actual caller, DPF maintainer and removal condition in its PR. The validators
workspace contains many unrelated contracts and remains supported.

Only after the pilot qualifies should GPP authoring/interpreter, policy,
composition, business surfaces and commons receive their own scoped migration
plans. The present plan does not authorize all seven migrations. Remaining
families stay in their existing supported DPF homes until those plans have live
coverage; their future direction is not a release/readiness claim.

Host database transactions, admission, permits, effect/result custody, authentication,
private corpus, transport and current actor authorization remain in DPF. No schema
or persisted-data migration is required by the move-only pilot. If a behavioral
change or data migration becomes necessary, stop the move-only slice and obtain
the appropriate versioned design and verification scope.

Rollback restores the prior tested dependency/import set in a protected revert
PR, preserving issued IDs, receipts, hashes, in-flight state and immutable DB
migrations. Retain the previous supported artifact and exact lockfile evidence.
Never rewrite current records or resurrect two concurrent canonical bodies.

## Verification contract

- **VER-CLOSURE:** exact package inventory, integrity/provenance/notices and acyclic
  runtime/type import closure; no displaced editable snapshot or monorepo escape.
- **VER-PARITY:** unchanged ordinary/adverse/recovery graph and marking cases,
  deadlines, rework, parallel/subshape/refuse behavior, receipt identity/conflicts,
  canonical JSON/digests, authority separation and legacy fingerprint vectors.
- **VER-LOADER:** clean installed-artifact runtime/declaration imports plus actual
  DPF source-loader, NodeNext/bundler and browser/server boundary checks.
- **VER-DPF:** affected real work-management callers and package typechecks;
  protected merged-source checks and relevant served Workroom happy/adverse flow
  through the canonical runtime or governed shared environment.
- **VER-ROLLBACK:** prior artifact/import restoration leaves durable work and
  receipts valid; repeat/recovery cannot grant new authority or duplicate effects.

All future checks above are unrun. This documentation change does not perform
product, runtime, browser, Windows or Linux qualification. DPF2 remains unchanged;
its Linux host and second-consumer conformance are separately owned. Broad
archetype completion on Windows is outside this cutover pilot.

## Research and existing policy

This is a package-boundary refactor, not a new product surface. Reuse the original
extraction research and dependency-sovereignty design rather than duplicating a
feature catalogue. Current primary-source checks on 2026-10-31:

- [Node package exports](https://nodejs.org/api/packages.html): explicit entry
  points define the supported surface; independent CommonJS/ESM instances can
  create identity hazards. Adopt explicit exports and one implementation first.
- [TypeScript extension rewriting](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html):
  relative TypeScript extensions can be rewritten for emitted JavaScript. This
  does not establish arbitrary aliases or consumer-loader compatibility.
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements/):
  attestations connect artifacts to source/build information, rather than proving
  absence of malicious behavior. Keep functional/security qualification distinct.

The existing dependency-sovereignty programme owns intake/mirror policy. Its
unimplemented or provisional controls cannot be claimed present. No new tool,
registry, service, external account or spending allocation is selected here.

## Planning and unresolved gates

See [the cutover plan](../plans/2026-10-31-component-consumer-cutover.md).
Independent client review of commit 0ee3b4ee9e56c16cb75f89725ec09e43fcbd968d
reported no material findings; it is not a native review receipt. Native plan
coverage cmvx2e0xp022r01pohb0jt40p binds the immutable plan at that commit.
Native semantic review and publication checks remain separate.
The generated documentation index is shared with WC-2CCBB706 and WC-4EE49A76.
Normal edit admission was refused; the operator then authorized that one shared
file and native approval cmvwzem003obv01pny3o1tayq executed. The resulting exact
index claim was verified on WC-EB8D9B19 before regeneration; no other shared
path or source implementation is covered by that permission.
Toolchain bootstrap seeded this worktree but permission convergence stopped on
the existing unsupported Grok TOML configuration; no unrelated configuration
repair was attempted and compile readiness is not claimed.
