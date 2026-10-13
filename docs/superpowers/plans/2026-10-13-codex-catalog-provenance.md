# Codex catalog provenance repair — BI-59E37E39

## Objective and existing design

OBJ-CATALOG-TRUTH: automatic discovery tracks the serving connection's returned
models without turning catalog history into availability claims.

Extend the existing
[catalog lifecycle design](../specs/2026-09-08-codex-model-catalog-lifecycle-design.md)
and its authenticated, private-home app-server collector in
`apps/web/lib/routing/codex-cli-model-catalog.ts`. The previous capacity repair is
merged and live; it is not edited or re-tested through this source unit.

The defect is missing provenance validation, not a proven explanation for the
absence of GPT-6.1 Sol. Codex CLI 0.157.0 was observed on the canonical sandbox.
Its [version-matched models manager](https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/models-manager/src/manager.rs)
initializes bundled metadata and can return it after a failed remote refresh.
DPF currently accepts a successful model/list response without distinguishing
that fallback. Private CODEX_HOME and ephemeral login isolate credentials but
do not make bundled metadata authoritative.

## Inherited acceptance criteria

The live BI's acceptance remains open and is quoted verbatim:

- AC-1: Every successful authoritative subscription inventory uses shared persistence, presence reconciliation and auth-eligibility admission; errors and empty/malformed inventories preserve last-known-good state and do not claim freshness.
- AC-2: Only models present in the authoritative run are profiled, so absent/retired rows are not resurrected; two confirmed absences and runtime-refusal retirement remain intact.
- AC-3: Presence timestamps change only on actual sightings, not missed-discovery bookkeeping; existing lifecycle fields are reused unless steward proves a migration necessary.
- AC-4: Connections separates connection, inventory freshness and workload restrictions; model count never equates historical profiles with usable models; technical inventory is disclosed under existing UX design.
- AC-5: Tests cover new model arrival without source edits, removals/relisting, failure/empty response, stale pins, auth admission, pricing/metadata preservation and prior readiness behavior; served verification uses canonical runtime.

This delivery strengthens AC-1 and AC-2 at the CLI boundary. Existing lifecycle,
account binding, pricing, capacity, pin, and UI contracts are retained. Passing
this unit does not establish desktop parity, paid execution, or full BI acceptance.

## Contract and bounded implementation

The upstream [cache contract](https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/models-manager/src/cache.rs)
already records remote fetch/revalidation time, client version, opaque provider
and auth identity, and model metadata in models_cache.json. Use that existing
CLI artifact inside the invocation's new private home; never introduce a DPF
cache, table, model-ID registry, or host upgrade.

1. Reproduce successful RPC output with no remote evidence. Add failing tests
   before implementation, including bundled fallback, malformed or stale evidence,
   model mismatch, pagination, empty final inventory, and preservation of secrets.
   Exercise the actual container runner with mocked Node filesystem/process
   boundaries so a test does not merely fabricate a trusted protocol marker.
2. Validate the private CLI artifact without exposing its identity or raw errors.
   Correlate bounded, non-secret provenance with each model/list response before
   admitting its models. Require invocation-local freshness, a nonempty scope,
   a client version, and correspondence to remote model IDs. Unknown SDK layouts,
   missing cache, malformed evidence, or unsupported discovery fail closed.
   Preserve the existing initialization, selected-account login, private-home
   cleanup, timeout, size, cursor, and reauthentication boundaries.
3. Reject a complete empty/hidden-only result. No unverified or empty result may
   reach existing account verification, presence reconciliation, or pin clearing.
   Consolidate repeated page requests while retaining the same pagination protocol.
4. Update the canonical lifecycle design's authority claim and verification
   requirements with these findings and the exact upstream source links.

API-key mode is not presumed to provide remote discovery: upstream discovery
policy can intentionally return bundled-only data. It must satisfy the same
evidence boundary or report an unverified catalog. Numeric CLI capacities stay
unknown when absent; API limits are never borrowed.

## Verification and publication

Graph advice links `apps/web/lib/routing/codex-cli-model-catalog.test.ts` and
`apps/web/lib/inference/codex-cli-catalog-auth.test.ts`; run both plus existing
provider-account discovery and catalog lifecycle tests. All source-local output
must identify this worktree. Run both web TypeScript programs, style-drift and
module guards, regenerate the doc index, and run the exact-head policy preflight.
Record unrun shared/native/live gates honestly under the already recorded scoped
DEV publication contract. Freeze a clean DCO-signed source packet for independent
assessment; normal hooks, protected cloud checks and the merge queue remain required.

After canonical deployment, the sole coordinator may exercise one supported
metadata-only selected-account discovery and verify remote provenance plus
last-good preservation. No parallel refresh, unchanged 403 replay, inference,
provider activation, local pause change, or manual model injection is authorized
by this plan. The installed SDK/account may still omit GPT-6.1 Sol; report that
observed difference separately rather than manufacturing parity.

## Risks, rollback, and delivery boundary

SDK cache layout or persistence may change or be unavailable. Conservatively
retain the last catalog and report unverified discovery; never treat a file-read
failure as evidence that the account has no models. Opaque identity remains
private, and stderr remains drained without disclosure. A single PR revert is
the rollback; existing rows and credential state remain readable.

This is one atomic delivery: producer-side provenance, consumer admission,
regression coverage, and the existing design correction cannot ship independently
without either leaving false freshness or rejecting every valid catalog. Reuse
BI-59E37E39, not a duplicate backlog item.

## Backlog coverage

Workroom WC-271EDE26; delivery-medium@1.0.0; base
4f5def81786cd51816eb880740049a8a629b1faa. One atomic deliverable maps to
BI-59E37E39 with no independent dependencies. Immutable plan coverage will be
recorded through record_plan_backlog_coverage before implementation and its
receipt retained in the Workroom.

Traceability references for that receipt:

- requirementRefs: AC-1; AC-2; AC-5
- contractRefs: apps/web/lib/routing/codex-cli-model-catalog.ts
- flowRefs: selected-account login -> model/list -> remote provenance -> existing inventory persistence
- verificationRefs: apps/web/lib/routing/codex-cli-model-catalog.test.ts; apps/web/lib/inference/codex-cli-catalog-auth.test.ts
