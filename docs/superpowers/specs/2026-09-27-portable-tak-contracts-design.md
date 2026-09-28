---
status: draft
---

# Portable TAK contracts and reference transitions

**Backlog:** BI-F9582C48 · **Epic:** EP-B932453F · **Workroom:** WC-895D0009
**Author:** Codex, under the operator's continuing implementation directive.
**Status:** proposed implementation design; independent review and plan coverage pending.

## Outcome and scope

Give implementers a small, executable exchange contract for a principle-directed
agent composition, with a reference transition function that demonstrates when
work may advance, must wait, or must reconcile an uncertain effect. The examples
run with the repository's pinned test tooling without a DPF server, database,
credential, model call or external side effect.

The normative owners remain [TAK](../../architecture/trusted-ai-kernel.md),
[GAID](../../architecture/GAID.md) and
[JSI](../../architecture/job-specific-intelligence.md). The principle-directed
amendment in [PR #5787](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/5787)
provides the requirement identifiers used below. This design depends on that
amendment; it does not introduce another standards family.

The portable module validates representations and controls reference transition
ordering. It does not authorize real tools, rank business choices, infer scope,
establish legal compliance, prove a caller's assertions, or supply durable storage.
An adapter must obtain events from authenticated authoritative sources and enforce
the actual action boundary. The DPF demo/integration, published adapter package,
Hermes and Cursor bindings remain owned respectively by BI-F3C2EC7A,
BI-07A2B207, BI-FEA232AF and BI-0E56BA38. Executable family-wide assessment is
BI-2AB781FA; this item provides contract and reference-function tests it can reuse.

## Existing substrate and findings

Source inspection at base `0d827752665f790d3c4d3eba789ae908c45d78ba`:

| Existing owner | What is reused | Boundary or gap |
|---|---|---|
| `packages/validators/src` | Browser-safe Zod validation, inferred types and pure domain functions, already consumed without a database | Add modules here; no new package, service or dependency. |
| `apps/web/lib/shared/outcome-disposition.ts` | The five canonical verdict/non-verdict values and retry posture | Move this pure module to validators and retain a compatibility re-export; do not invent a second disposition vocabulary. |
| `apps/web/lib/decision-perspective/decision-scope-admission.ts` | The closed WWMD/WWWD/WSID scope set | Move the constants, type and predicate into the portable contract owner; retain current admission behavior and UI routing in web. |
| `apps/web/lib/work-management/work-shapes.ts` | Versioned activity definitions, stages, stop conditions, budgets and source references | A portable projection refers to this authoritative definition. It does not become another registry or scheduler. |
| `apps/web/lib/decision/option-input-contract.ts` | Runtime option identity and feature validation | Retains ownership of DPF decision input. Exchange schemas carry decision/profile references and eligible-option identities; no competing score engine. |
| `apps/web/lib/mcp-governed-execute.ts` | Grant/scope checks, preexecution checks, reservation before consequential dispatch | Remains the DPF execution boundary. A portable recommendation cannot bypass it. |
| `apps/web/lib/tak/tool-execution-receipt.ts` | GAID-bound reservation, input fingerprint, result finalization | Current exception handling can finalize `tool_threw` as failed; that is not proof that the target performed no effect. The portable projection must preserve uncertainty. |
| `packages/db/prisma/schema/ai-coworker.prisma` | Existing `ToolExecutionReceipt` linked uniquely to `ToolExecution` | No new ledger or schema migration in this item. Do not persist the reference function's state as a new authority record. |
| `packages/db/prisma/schema/decision-governance.prisma` | Decision interactions and versioned decision-perspective profiles | Export references to canonical identity/version; no copied profile database. |

`apps/web/lib/tak/decision-block.ts` is a conversational decision-button carrier,
not an authorization record. The portal authority projection is also not a
substitute for the governed execution boundary. Neither is promoted into one here.

The receipt schema currently uses string fields for execution status. This item
does not add persisted status values or claim to repair that runtime behavior.
The DPF adapter must explicitly map a proven target outcome; legacy `failed`
without evidence of no effect maps to unknown for consequential attempts.

## Research & Benchmarking

Primary sources checked 2026-09-27. Comparisons inform the design; they are not
dependency adoption or claims that these projects conform to TAK.

| Source | Adopt | Reject or limit |
|---|---|---|
| [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12/json-schema-core) | Portable structural schemas with stable identifiers and explicit version | Structural validity cannot prove permission or external effects. No remote schema fetching from untrusted input. |
| [Zod JSON Schema conversion](https://zod.dev/json-schema) | Generate Draft 2020-12 structure from the existing Zod owner | No independently hand-maintained JSON schema and no `unrepresentable: any`. Cross-field checks remain separately identified semantic validation. |
| [Temporal workflow execution](https://docs.temporal.io/workflow-execution) | Recorded execution identity and recovery discipline | No added scheduler; a local transition is not exactly-once delivery to an unrelated target. |
| [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts) | Explicit pause/resume and replay-aware effects | A checkpoint or resumed approval is not current authorization. No added agent framework. |

The existing platform consolidation design identified persistence leaking into
portable contracts. Current `@dpf/types` has no database dependency, and
`@dpf/validators` depends on Zod. Keep this boundary: no Prisma, Next, filesystem,
network or model imports in the portable modules.

## Requirements and traceability

These are implementation acceptance identifiers, not new normative clauses.

| ID | Requirement | Normative contract | Flow | Verification |
|---|---|---|---|---|
| PC-01 | Validate five versioned artifact kinds and report malformed inputs without throwing | TAK-PD-002; GAID-PD-001; JSI-PD-001 | Import/validate | CT-01 valid/invalid corpus |
| PC-02 | Reject unknown versions, core fields and mandatory extensions; never silently erase required semantics | JSI-PD-002 | Negotiate/import | CT-02 evolution matrix |
| PC-03 | Preserve owning scope, profile revision, hard-constraint disposition and eligible option identity | TAK-PD-001..004 | Evaluate/propose | CT-03 scope and eligibility cases |
| PC-04 | Bind authorization and attempts to the exact effect, actor, target account, work/profile revision and policy generation | TAK-PD-006; GAID-PD-001 | Prepare/dispatch | CT-04 mutation/revocation cases |
| PC-05 | Reserve before dispatch; reconcile uncertain effects before another submission | TAK-PD-007 | Dispatch/reconcile | CT-05 lost-response/crash cases |
| PC-06 | Enforce declared step/attempt bounds and distinguish waiting, infrastructure uncertainty and refusal | TAK-PD-005,008 | Advance/stop | CT-06 bounds/non-verdict cases |
| PC-07 | Preserve restricted evidence references and explicit retention/destination constraints without exporting raw secrets | TAK-DG-001..004 | Import/export | CT-07 privacy projection cases |
| PC-08 | Run examples without DPF; preserve existing runtime identities and behavior | GAID-PD-001; JSI-PD-002 | Standalone example/DPF projection | CT-08 boundary and compatibility tests |

## Contract structure

Author the following discriminated artifact schemas in
`packages/validators/src/trusted-agent-contracts.ts`. Infer TypeScript types from
the schemas. An export function produces the structural JSON Schema in memory;
distribution/check-in of a standalone bundle belongs to BI-07A2B207.

All artifacts have a literal initial `schemaVersion: "0.1.0"`, a discriminating
`kind`, an opaque `id`, a versioned canonical `sourceRef`, and explicit extensions.
References are identifiers plus versions/digests; they are never bearer tokens.
Consumers must resolve them through their own authenticated, scope-aware adapter.

1. **Work definition:** activity key/version, purpose, declared owning scope,
   accountable principal reference, ordered stages and allowed transitions,
   required evidence references, tool capability references, explicit step and
   attempt limits, review/stop conditions. Source is the existing work shape.
   Human-language stage conditions are descriptive, not executable policy.
2. **Operating profile:** GAID subject/principal references, composition revision,
   instruction/skill/model/tool-set revisions, doctrine references by scope,
   data and processing destination constraint references, qualification references.
   A listed capability is a declaration, not a grant.
3. **Qualification reference:** scheme/version, assessed subject and composition,
   status as the source scheme's value, evidence references and assessor identity,
   validity window and target harness scope. An import cannot promote qualification.
   Unknown scheme status remains opaque and cannot become a permission.
4. **Decision:** work/profile/evidence versions, owning scope, eligible option IDs,
   selected option when proceeding, canonical disposition, reason codes and
   accountable resolver reference for a wait. Hard-constraint refusal prevents a
   selected option being treated as actionable. No numerical scoring is added.
5. **Effect receipt:** decision and authorization references; a binding of effect
   ID, actor, tool/operation revision, target resource and account, argument digest,
   purpose, work/profile revisions and policy generation; attempt ID; observation
   state; timestamps; evidence references. Observation is one of `not-submitted`,
   `succeeded`, `no-effect`, `unknown`. A timeout/exception cannot establish no-effect.

The portable observation vocabulary is an explicit exchange projection, not a
second definition of the database's execution-status field. No new closed-set
database column is introduced. Persisted-model changes, if later needed by the
DPF integration, must use the repository's Prisma enum/migration procedure.

All objects are strict. Bound strings and collections: identifiers/references
at most 512 characters, human descriptions at most 4,096, at most 64 stages or
options, 128 evidence references, 32 extensions, and 64 capabilities per artifact.
Reject excess explicitly; never truncate. Reject non-finite numbers, zero/negative
budgets, duplicate stage/option/extension identifiers and dangling stage links.
Limits are defensive implementation ceilings for 0.1.0, not tested throughput.
EP-B932453F owns revisions; EP-MBSE-WORKROOM-SPINE owns broader portfolio scaling.

## Versioning and extensions

The importer first checks the envelope and exact supported version, then the
artifact structure, extension capabilities and cross-field semantics. Unknown
versions fail with `unsupported-version`; there is no best-effort coercion.
An extension declares a namespaced ID, exact version, whether it is mandatory,
and bounded JSON data. Duplicate IDs fail. Unknown mandatory extensions fail with
`unsupported-extension`; unknown optional extensions are retained but never
interpreted as authority. Known mandatory extensions must have a registered
semantic validator; a name in a supported list alone is insufficient.

Changes to required semantics require an explicitly supported version and test
fixtures for both generations. No migration silently strips restrictions or
changes qualification. Core structural schemas remain separate from semantic
validators so exported JSON Schema does not misleadingly imply that it checks
cross-record references, policy freshness or signatures.

## Reference transition function

Add a pure module `packages/validators/src/trusted-agent-reference-loop.ts`.
It accepts validated state plus an adapter-supplied event and returns the next
state and an explicit command. It performs no tool call and stores no record.
Unexpected events, changed bindings, invalid input and exhausted budgets return
structured results, never a permissive fallback.

```text
validate composition and work; establish owning scope
collect permitted evidence and a scoped decision from the owning resolver
if decision is not proceed: return its typed disposition and resolver
bind selected eligible action and request current authorization
if authorization is denied or unresolved: return refusal or typed wait
request durable reservation for the exact effect and attempt
after reservation, request mediated dispatch with a fresh authorization check
if the effect is uncertain: command reconcile using the same effect identity
if no-effect is proven and a bounded retry remains: request fresh authorization
if success is observed: command record outcome against the existing receipt
otherwise retain uncertainty and its accountable owner; never auto-resubmit
```

States are `ready`, `awaiting-decision`, `awaiting-authorization`,
`awaiting-reservation`, `awaiting-dispatch`, `awaiting-reconciliation`, and
`stopped`. Events carry correlation to the expected work, composition, effect
and attempt. A wrong-order or duplicate event cannot dispatch an effect again.
State contains counters and references, not source payloads or credentials.

The dispatch command names the required atomicity contract: the adapter rechecks
current grants, revocation, data/destination constraints and the exact binding at
its mediated-use boundary. A prior `authorized` event is not a reusable token.
If the adapter cannot supply the claimed atomicity, it must refuse that claim or
use the documented containment mode; the function cannot close a network race.
Any exception after possible submission yields unknown. Durable reservation and
target-supported idempotency/reconciliation remain adapter responsibilities.

An uncertain attempt has precedence over a new proposal for the same effect.
Reconciliation may observe an already-performed effect after authority revocation;
this is evidence gathering, not renewed permission to submit it. A subsequent
attempt after proven no-effect must pass current authorization again. The effect
identity remains stable and the attempt identity changes. Budget exhaustion holds
for its named owner; it never manufactures a denial of the business objective.

## Privacy, integrity and storage

The default exchange includes only allow-listed references and digests, not raw
arguments, model context, evidence bodies, personal data or credentials. References
can themselves be sensitive, so export remains subject to source access, purpose,
destination and retention rules. No universal retention period is invented:
artifacts carry the owner's policy reference and expiry when applicable. Missing
required restrictions is an admission error, not public-by-default.

A digest detects differences only after authenticated provenance is established;
it is not a signature. This slice does not invent a signing service. The adapter
must authenticate origin, pin the definition revision, verify the bound argument
digest using its declared canonicalization and protect receipt access. Structural
validation never attests that an untrusted submitted receipt is true.

DPF integration reads its canonical Organization, Principal, profile, workroom,
DecisionInteraction and ToolExecutionReceipt. The exchange is a bounded read
projection. No duplicate ledger, grant store, retention worker or model cache is
created. Standalone examples use in-memory fixtures explicitly labeled simulated.

## Implementation and verification boundaries

One BI owns the schemas, semantic validation, reference transitions, compatibility
re-exports, standalone examples and their tests as an atomic reference contract.
Shipping just a schema while omitting its required semantic checks would give a
false interoperability claim. The later DPF effect adapter is independently
shippable and already has BI-F3C2EC7A coverage; it is not silently included here.

Proposed paths (new unless described above):

- `packages/validators/src/trusted-agent-contracts.ts` and `.test.ts`
- `packages/validators/src/trusted-agent-reference-loop.ts` and `.test.ts`
- `packages/validators/src/trusted-agent-examples.ts`
- `packages/validators/src/outcome-disposition.ts` (move current pure owner)
- `packages/validators/src/decision-scope.ts` (move current closed scope owner)
- `packages/validators/src/index.ts` (exports)
- the two original web vocabulary files (compatibility imports/re-exports only)
- `docs/architecture/trusted-agent-reference-contract.md` (consumer guide)

CT-01..08 include structural JSON Schema generation without permissive conversion,
unknown required extension with a familiar name but unsupported version, invalid
qualifications, wrong scope, forbidden high-scoring option, effect mutation,
expired/revoked authorization, reservation failure, lost acknowledgement,
duplicate completion, unknown effect across restart, reconciliation budget
exhaustion and renewed authorization after proven no-effect. Test authoritative
event handling as a reference contract, not as proof of an authenticated adapter.

Run the affected validator tests and typecheck, existing scope-admission and
outcome-disposition tests after compatibility moves, source guards and web
typecheck. Cloud CI owns the heavy production build. No UI, migration or live
tool dispatch changes are intended. The example must run without a DPF connection;
the later demo must separately prove runtime enforcement on the canonical install.

## Risks, rollback and acceptance

The main risk is consumers mistaking validated data or reference commands for
authority. Return values, guide and examples must state this boundary. Other risks
are duplicated vocabulary, weaker exported schemas, dropped restrictions,
ambiguous external effects and source-module import cycles. The tests above and
compatibility re-exports address these; no new runtime dependencies are allowed.

Rollback is a PR revert. Existing persisted records and live policy modes remain
unchanged. Independent design/spec approval, an architecture review, immutable
plan coverage and passing executable cases are prerequisites to marking
BI-F9582C48 complete. A merged design alone is not acceptance of the implementation.
