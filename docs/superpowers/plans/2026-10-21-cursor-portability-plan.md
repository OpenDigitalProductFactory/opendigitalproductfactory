---
status: draft
---

# Cursor portability implementation and assessment plan

**Backlog:** BI-0E56BA38 · **Epic:** EP-B932453F · **Workroom:** WC-ADDEE529
**Design:** [Cursor import projection and semantic-loss contract](../specs/2026-10-21-cursor-portability-design.md), commit `7171ea93ee4aedd859dd4046b3ba8a331fbd89c2`, blob `fa8bc60ed5bd02d48b203d557eb1dd16738509d3`, SHA-256 `10e9687c092087ceccf20f5b19e89eddaa5b6747f2a6021916bdde262fa8fac3`.
**Planning admission:** `IRD-72313B8EB442`, feature/medium, allowed at `2026-10-21T07:16:03.525Z`, same branch and owner.

For agentic workers: execute this plan one independently reviewable backlog item
at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation,
`dpf-local-merge-ci-before-push` plus the completion gate below before a success
claim, and `dpf-pr-with-dco` for handoff.

This plan sequences a nonexecuting content projection and the later real Cursor
reproduction. It does not select a Cursor version/surface/model/profile, install
software, create an account, adopt a tool, grant authority or execute a probe.
Every proposed implementation, compatibility and runtime test below is **UNRUN**.
The design's native semantic PASS and source-documentation checks are not runtime
acceptance. Medium readiness currently treats a separate design baseline as
not-applicable; do not invent a baseline ID or promote the proposed twelve design
criteria into a frozen conformance denominator.

## Original intake acceptance and backlog coverage

The four current BI acceptance criteria remain authoritative, verbatim:

1. A named Cursor version/surface can reproduce the documented supported profile.
2. Skill import is not represented as enforcement or job qualification.
3. Unsupported mandatory requirements prevent the affected conformance claim or activity.
4. Evidence and adapter mapping are portable and do not assume DPF-local grants or secrets.

**Coverage decision to record: atomic.** Existing BI-0E56BA38 owns one
`cursor-reference-reproduction` deliverable. Content projection, semantic-loss
reporting, target binding, shared-case observations and qualification limits are
sequencing within this one outcome. A content-only importer can be useful but
does not independently satisfy the named runtime reproduction criterion; shipping
it as that outcome would conceal the unresolved enforcement and evidence work.
No new BI, adapter identity or duplicate implementation owner is needed.

The live plan coverage receipt and independent plan review are **pending**.
The coordinator records/checks coverage for this exact immutable plan using the
actual server-selected contract, expected to be schema v3 for current ordinary
medium work. This text does not choose or downgrade the contract. If inherited
baseline history is discovered, retain its real traceability requirements. The
canonical receipt stays on the BI, referenced by this stable section rather than
editing a committed plan to insert its own future commit identity. No Markdown
table substitutes for live coverage or authority.

| Deliverable | Existing BI | Required dependency | Requirement references | Contract references | Flow references | Verification references |
|---|---|---|---|---|---|---|
| cursor-reference-reproduction | BI-0E56BA38 | BI-07A2B207 delivered package; BI-F9582C48 canonical semantics; actual target authority/environment and assessment scope | The four original intake criteria above; AC-CUR-001, AC-CUR-002, AC-CUR-003, AC-CUR-004, AC-CUR-005, AC-CUR-006, AC-CUR-007, AC-CUR-008, AC-CUR-009, AC-CUR-010, AC-CUR-011, AC-CUR-012 | PC-01, PC-02, PC-03, PC-04, PC-05, PC-06, PC-07, PC-08; trusted-artifact 0.1.0; proposed BI07 inventory 1.0.0; GAID-PD-001; JSI-PD-002 | cursor-inspect-project; cursor-bind-target; cursor-observe-hold; cursor-compare-revalidate | CT-01, CT-02, CT-03, CT-04, CT-05, CT-06, CT-07, CT-08; CUR-V01, CUR-V02, CUR-V03, CUR-V04, CUR-V05, CUR-V06, CUR-V07, CUR-V08, CUR-V09, CUR-V10, CUR-V11, CUR-V12 |

BI07 is **undelivered** at planning time. Its reviewed package design and proposed
implementation plan are source inputs, not an available released importer or
accepted tool distribution. Its separate pending review does not authorize retry,
implementation or publication here. Keep this dependency blocked until actual
delivery/acceptance supplies immutable release/tool identities. Hermes and
independent external reproduction remain separate existing outcomes.

## Source grounding and planned files

The immutable design and source at base
`97ecc0c1032c737da6b399c4db78e9792e4f0018` were inspected. Proposed files are marked
**new**; do not claim they already exist or can be tested before implementation.

| Owner / existing source | Reuse and planned touch | Evidence boundary |
|---|---|---|
| `packages/validators/src/trusted-agent-contracts.ts` and `trusted-agent-reference-loop.ts` | Import existing schemas, `isBoundedTrustedJson`, semantic importer and pure transitions. | No new authority vocabulary, schema fork or effect dispatcher. |
| `packages/validators/src/trusted-agent-examples.ts` and existing contract/loop tests | Independently trusted synthetic fixtures/functions and PC/CT traceability. | Fixtures retain `simulated: true`, `conformanceClaim: "none"`; package-supplied code is inert. |
| BI07 proposed `scripts/lib/portable-reference-package/` and trusted tools | After delivery, extend its projection seam with **new** `projections/cursor-contract.ts`, `cursor.ts`, `cursor-events.ts` and focused tests. | These parent modules do not exist in this checkout. Phase 0 must verify their real delivered API; do not create a second archive reader/assembler/inspector here. |
| `packages/integration-shared/src/canonical-json.ts` / `scripts/lib/canonical-json.mjs` | Existing import-boundary serializers for derived report identities. | Validate before serialization; no new canonicalizer or claimed RFC 8785 equivalence. |
| `apps/web/lib/routing/execution-adapter-types.ts`, registry and resolver | Consult existing required-capability refusal if a future execution surface needs platform routing. | Cursor is absent from the typed adapter set. This plan introduces no inference adapter kind, fallback or provider registration. |
| `packages/dpf-skill-pack/client-capabilities.json` and generated consumer | Preserve the single capability-profile owner. | Cursor has no current row. Add verified facts only through its normal reviewed source-plus-live-evidence procedure after assessment, never from this plan. |
| `apps/web/lib/mcp/transport-auth.ts`, `session-token.ts`, `load-tools.ts`, `mcp-governed-execute.ts` | Current principal/grant intersection, scoped discovery and DPF-owned action boundaries. | Do not export credentials, proxy denied readers or admit tools from file names. |
| `apps/web/lib/tak/tool-execution-receipt.ts` and existing TaskRun/TaskArtifact/DocumentBlob/DocumentVersion | Retain original writer provenance and immutable protected evidence. | Generated mapping/event reports are observations, not a second ledger or authority record. |

Add **new** `docs/architecture/cursor-portability.md` for the bounded user guide
and **new** `scripts/lib/portable-reference-package/projections/cursor-assessment.test.ts`
for fixture-driven report/claim checks. Runtime transcripts/results use existing
artifact retention with restricted original evidence, not a tracked dump of live
conversations or private configuration. The first implementation claims only the
exact paths verified after BI07 delivery; code outside those paths needs normal
scope/readiness review before edits.

## Explicit bounds and required semantics

The design's compressed numeric limits mean the following existing F958 contract,
not a new Cursor limit policy:

| Limit | Exact existing behavior / owner |
|---|---|
| JSON depth | Maximum 16; root depth is zero. |
| JSON traversal | Maximum 20,000 visited values. |
| JSON text content | Maximum 1,048,576 combined object-key and string-value JavaScript UTF-16 code units; this is not UTF-8 bytes. |
| Extensions | Maximum 32; mandatory extensions require one trusted exact-ID/exact-version semantic validator. |
| Reported import errors | At most 32; excess input is rejected, never silently truncated into a passing artifact. |
| Other artifact fields | Existing reference arrays at most 128, relevant ID/stage/capability lists at most 64, IDs at most 512 and descriptions at most 4096 characters. |

Source: `packages/validators/src/trusted-agent-contracts.ts`, especially
`isBoundedTrustedJson`, common strict schemas and `importTrustedArtifact`.
Preserve finite numbers, plain/null-prototype objects, dense arrays and rejection
of accessors, symbols, non-enumerable payload properties and cycles. Apply BI07's
observed compressed/decompressed/file/count limits and duplicate-key-safe parsing
before creating the object, then reuse this predicate; checking after unbounded
allocation is insufficient. The trusted importer supplies its own observation
time via `options.now`; an archive cannot set that time or bypass expiry checks.

Unknown or unsupported required controls, versions, flow, references and
extensions hold the affected semantic import/activity and conformance claim.
Documented support and a `mapped` content row do not discharge required runtime
evidence. Optional unknown data may round-trip within bounds, stays inert and
supplies no permission. No plan step may drop a required row, relabel it optional,
truncate evidence or silently select another tool/host/profile to avoid a hold.

## Phase 0 — Dependency and implementation entry

**Deliverable:** verified parent API/release, coverage and exact implementation
scope. No runtime action or code edit is performed by writing this plan.

1. Coordinator records/checks live plan coverage, obtains required independent
   plan review and makes the normal scoped implementation claim. A read projection
   that reports implementation allowed does not erase the user's narrower current
   plan-only assignment or the actual dependency/target-access holds.
2. Read BI07's actual delivery/acceptance and immutable release/tool artifacts.
   Reconcile its delivered inspector/projection interface with this plan's proposed
   paths; retain source digests and API identity. If undelivered, keep dependent
   implementation/reproduction held and preserve completed design/plan work.
3. Do not implement BI07's missing parser/package/runner here. If its actual API
   differs, resolve the named compatibility issue with its existing owner through
   normal source/readiness before changing this plan's scope.
4. Claim exact future code/test/docs paths; consume the actual change-impact
   contract and add every testImpact and guardObligation to the work brief before
   Red. Unresolved advice requires exhaustive verification, not an exemption.

The current **document** scope contract is resolved, with no testImpact or
guardObligations and a required doc-index check. It says nothing about the
proposed implementation's test coverage. This plan changes no UI, install path,
schema, live scheduler or canonical runtime.

## Phase 1 — Pure projection, loss report and inert staging

**Files:** new `cursor-contract.ts`, `cursor.ts`, their focused tests and guide.
**Flow:** `cursor-inspect-project`; **cases:** CUR-V01, CUR-V09, CUR-V11, CUR-V12.

1. Start failing fixture tests for the design's `cursor-projection/0.1.0` report:
   exact source package/inventory/archive identity, generator, original restrictions,
   source-to-output mappings, null/unobserved target facts, loss rows and separate
   origin/import/content/qualification results. Reject duplicate/ambiguous refs,
   unknown core meanings and incorrect evidence scope.
2. Implement projection only from the delivered validated BI07 representation.
   Reuse its complete inventory/integrity/dependency/rights checks. Preserve
   F958 references and mandatory/optional extension behavior. No new network
   lookup, policy expression evaluator, package installer or schema resolver.
3. Generate standard Skills instructions/resources plus their exact reference
   closure in a new inert directory outside every Cursor discovery root. Preserve
   BI07's archive path grammar: `.agents`/`.cursor` destination names are report
   mapping data, never archive member names or direct extraction destinations.
4. Do not materialize a native plugin wrapper, MCP configuration, hook, command,
   schedule or automatically discovered skill as a side effect of inspection.
   Standard/native plugin projections remain candidates only if every required
   component and variable translation can be represented losslessly after review.
5. Produce deterministic canonical report bytes with explicit required holds,
   optional limitations and unassessed target claims. Mutating archive code and
   listed hashes together must not replace the independently trusted tool.

**Exit:** CUR-V01 tests show deterministic bytes, complete source mapping, bounded
errors and no changes to home/project discovery/configuration, network, executable
loading or authority. This is a pure projection milestone, not the BI's runtime
reproduction or a qualified-profile release.

## Phase 2 — Resolve an actual target and compatibility decision

**Deliverable:** a protected target-observation/compatibility artifact through
existing evidence carriers; no selected target value is supplied by this plan.
**Flow:** `cursor-bind-target`; **cases:** CUR-V02–CUR-V12 prerequisites.

1. Reconcile available authorized environment and recorded target access. Do not
   install software, open accounts, obtain credentials, enable integrations or
   adopt an SDK to manufacture availability. Missing required access/environment
   is a named hold under its owner, not an instruction for the human to run commands.
2. Once admitted access exists, observe exact build, IDE/CLI/SDK/local/cloud/
   self-hosted surface, OS, model/composition, policy/configuration sources, hook
   identities, MCP endpoint/transport and dependency versions. Local filesystem
   execution is not a claim of local inference or identical cloud handling.
3. Inventory all reachable file, shell/interpreter/subprocess, network/Fetch/browser,
   MCP/custom-tool and delegated-worker effect paths. For each mandatory requirement,
   name its enforcement owner, authority/check-at-use binding, denial/approval/
   mutation/failure behavior, evidence producer and supported observation method.
4. Record one of two evidence-driven dispositions: the exact bounded composition
   can enter assessment because every required path has adequate prerequisites,
   or it is incompatible/unassessed with named unsupported/unknown requirements.
   Both are truthful results; incompatibility does not satisfy the positive runtime
   reproduction criterion. No downgrade to a content-only success claim.
5. Choose any routine implementation binding only after those facts are known.
   Prefer the smallest supported mapping. If no available surface can meet a
   mandatory requirement, retain the hold. Do not add a routed Cursor provider,
   permissive fallback or new control framework to hide the gap. A material new
   dependency/service/host integration returns through existing design and adoption
   gates before implementation; this plan does not preauthorize it.

**Exit:** exact composition and unresolved limits are attributable. Documentation
comparisons alone, an installed version string, claimed sandbox flag or generic
hook schema acceptance cannot produce a supported-profile claim.

## Phase 3 — Minimal event binding and shared-case reproduction

**Files:** new `cursor-events.ts`, focused mutation/recovery/assessment tests;
target-specific fixture/harness inputs only after phase 2 fixes their real format.
**Flow:** `cursor-observe-hold`; **cases:** CUR-V02–CUR-V10.

1. Write failing event-normalization tests first using bounded recorded/synthetic
   examples, preserving absent fields and provenance. Map only authenticated
   observable events into the existing F958 interface; model-visible transformed
   output and lifecycle summaries remain distinct from original target receipts.
2. Bind original request/task/attempt, parent/child, actor, target/account, exact
   arguments, work/profile, purpose, scope, policy generation and GPP revisions.
   Require current authorization at actual use; material mutation invalidates the
   decision. Missing correlation or original evidence remains unknown.
3. Exercise allowed, denied and ambiguous cases without an effect while required
   approval is missing. Generic `ask` acceptance is not approval enforcement;
   event-specific dedicated paths and missing/late hook behavior need actual proof.
4. Run hook crash/timeout/malformed/no-hook and alternative-path cases under the
   admitted target boundaries. Missing required mediation must prevent the
   dependent activity; do not try another command, shell, tool or descendant.
5. Use synthetic reversible effects under the admitted test authority for lost
   transport, surviving child/late effects and restart. Preserve original identity
   across cancellation/resume. Only supported original-writer/target evidence may
   settle effects; no receipt fabrication, read proxy, blind replay or timeout-based
   clearance. Existing no-review-retry holds remain untouched.
6. Record actual pass/fail/inconclusive/unsupported/unrun outcomes with exact source,
   target composition, request and observation identities. Infrastructure failure
   is inconclusive/unrun, not a product failure or pass. Keep the accountable owner
   and unresolved late-effect obligation when a case cannot close.

**Exit:** every applicable required path has a traceable observation or remains
held. F958 fixture tests alone cannot pass this runtime phase. This plan does not
prescribe a new effect engine or dispatch a native/provider review as a test.

## Phase 4 — Updates, JSI, portable evidence and acceptance

**Files:** new assessment/report tests and guide; existing artifact/evidence
carriers hold exact observations and permitted release material.
**Flow:** `cursor-compare-revalidate`; **cases:** CUR-V08–CUR-V12.

1. Diff immutable old/new package and target compositions. Changes to instructions,
   dependency, model, policy, authority, hook or tool surface invalidate affected
   observations. Reassess instead of inheriting an old pass from a product name.
2. Preserve source restrictions, license/notice disposition, exact source mapping
   and protected evidence. Scan primary content, filenames, nested optional data
   and indirect references; do not export credentials, private endpoints, grants,
   customer/organization data, memory or live transcript/approval bodies.
3. Keep GAID identity, JSI scheme/subject/profile/assessor/evidence status and
   current authorization separate. Target assessment or attributable scheme-defined
   equivalence is required by JSI-PD-002; unavailable evidence remains unknown.
   Projection/import success does not confer assessed or qualified status.
4. Produce the portable mapping and complete case ledger with independent
   reproduction clearly distinguished from author observations. Shared cases are
   candidate assessment work, not a frozen universal denominator.
5. Coordinator obtains normal exact-source postimplementation/acceptance/outcome
   reconciliation and publication gates. Close this BI only if the original four
   criteria are met on a named observed composition, with unsupported mandatory
   behavior holding the affected activity/claim. No PR request is included here;
   preserve the existing official GitHub permission refusal and do not recreate
   denied publication through another principal, CLI, credential or browser.

## Explicit CUR-V to acceptance mapping

The twelve AC-CUR references retain the unchanged meanings at design7171. They
refine the four original intake criteria; they are not independent scope approval.
Every row below is **UNRUN** and names the phase that must produce actual evidence.

| Case | Required observation from the design | AC-CUR mapping | Phase |
|---|---|---|---|
| CUR-V01 | Deterministic safe content mapping, hostile package/unknown-version refusal and inert staging. | AC-CUR-001, AC-CUR-002, AC-CUR-003, AC-CUR-004, AC-CUR-009 | 1 |
| CUR-V02 | Allowed/prohibited/ambiguous actions remain distinct; required approval absence means no effect. | AC-CUR-005, AC-CUR-006, AC-CUR-010, AC-CUR-011 | 2/3 |
| CUR-V03 | Absent/crashed/timed-out/malformed/late hook preserves the mandatory hold. | AC-CUR-004, AC-CUR-005, AC-CUR-006, AC-CUR-010, AC-CUR-011 | 2/3 |
| CUR-V04 | Material argument, principal, target/account, policy or profile mutation invalidates the affected decision. | AC-CUR-006, AC-CUR-010, AC-CUR-011 | 3 |
| CUR-V05 | Every reachable alternative/delegated path has proven required mediation or is unavailable. | AC-CUR-004, AC-CUR-005, AC-CUR-010, AC-CUR-011, AC-CUR-012 | 2/3 |
| CUR-V06 | Accepted request with lost transport retains identity; supported original proof precedes permitted replay. | AC-CUR-007, AC-CUR-010, AC-CUR-011 | 3 |
| CUR-V07 | Parent exit cannot close surviving descendants or late effects. | AC-CUR-007, AC-CUR-010, AC-CUR-011 | 3 |
| CUR-V08 | Revocation, expiry or changed configuration invalidates affected authority/qualification claims. | AC-CUR-006, AC-CUR-008, AC-CUR-010, AC-CUR-011, AC-CUR-012 | 2/3/4 |
| CUR-V09 | Update/restoration preserves requirement/dependency/restriction deltas without compensating remote effects. | AC-CUR-001, AC-CUR-007, AC-CUR-009, AC-CUR-010, AC-CUR-011 | 1/3/4 |
| CUR-V10 | Missing/conflicting/transformed/truncated/redacted events remain unknown and attributable. | AC-CUR-007, AC-CUR-010, AC-CUR-011 | 3/4 |
| CUR-V11 | JSI transfer/equivalence, secret/private-data and redistribution checks bind exact content/destination. | AC-CUR-008, AC-CUR-009, AC-CUR-010, AC-CUR-011, AC-CUR-012 | 1/2/4 |
| CUR-V12 | PC/CT source traceability, actual author observations and independent reproduction remain distinct; unsupported/unverified required semantics hold claims. | AC-CUR-003, AC-CUR-004, AC-CUR-010, AC-CUR-011, AC-CUR-012 | 1/2/4 |

All AC-CUR-001–012 are covered above. CUR-V02–CUR-V10 reuse the nine research case
families, rather than treating them as already executed tests. PC-01–08 and
CT-01–08 stay owned by F958; record their actual source identity/results separately
from this package/host evidence. No author can label its own reproduction independent.

## Future commands and verification contract

These are prospective source checks after phase 0 admission and file creation;
**none has run for a Cursor implementation**. Reconcile actual delivered BI07 API
and changed-file impact before execution. A missing proposed module/test is not a
passing check, and a setup failure must not be called a code defect.

```text
pnpm exec tsx --test scripts/lib/portable-reference-package/projections/cursor-contract.test.ts scripts/lib/portable-reference-package/projections/cursor.test.ts scripts/lib/portable-reference-package/projections/cursor-events.test.ts scripts/lib/portable-reference-package/projections/cursor-assessment.test.ts
pnpm --filter @dpf/validators exec vitest run src/trusted-agent-contracts.test.ts src/trusted-agent-reference-loop.test.ts
pnpm --filter @dpf/validators typecheck
node scripts/run-tsc.mjs --noEmit -p scripts/tsconfig.portable-reference-tools.json
node scripts/gen-doc-index.mjs --check
node scripts/check-doc-links.mjs
pnpm gate:context
```

Use BI07's trusted Node 24 tool baseline for the pure projection, without implying
that any Cursor runtime/SDK was selected. Source tests exercise bounded mapping
and event handling only. Actual runtime commands, environment leases, target
access and supported evidence readers are fixed from the admitted phase 2
composition; do not invent CLI flags or use documentation examples as an executed
test. The record must include exact commands/actions, raw protected observation
references, expected/actual outcomes and limitations for each applicable case.

No source-local test can substitute for actual target control/descendant/effect
proof. Do not build a manual live image, run a provider probe, start a native
review, mutate an installed account or broaden an authority scope to complete
this ledger. Required unavailable facts remain explicit blockers under their owner.

## Risks and rollback

The largest risk is substituting discovery for enforcement. Keep projected,
structurally valid, semantically ready, observed and qualified facts distinct.
Unknown mandatory behavior remains closed. A changed host or package cannot keep
an old pass without checking which evidence was invalidated.

Projection rollback removes only its explicitly owned inert output, preserving
source package identities, local user edits/configuration and evidence. Later
admitted activation rollback restores only the source/configuration bytes owned
by that change; it cannot restore expired grants, stop unobserved descendants,
reverse a remote effect or supply a missing original receipt. Keep uncertain work
and its accountable owner until genuine supported reconciliation settles it.

No migrations or running service changes are planned. BI07's shared primitives
and F958's meanings remain with their owners. If compatibility requires a new
platform primitive or materially different architecture, stop at that concrete
gap and return through the existing design/coverage process; do not hide it in a
Cursor-only framework. Completion requires real reproduction and acceptance,
not this plan, a projection-only milestone or a metadata readiness projection.
