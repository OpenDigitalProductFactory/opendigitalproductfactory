---
status: active
---

# Codex model-catalog lifecycle — BI-067EE115

**Epic:** EP-413F2602  
**Extends:** `2026-09-01-codex-subscription-model-eligibility-design.md`

## Problem and live evidence

The daily `model-discovery-refresh` job can report `ok` while Codex discovery
has fallen back to `KNOWN_PROVIDER_MODELS`. On 2026-09-08 the live job ran at
03:10 and re-stamped `codex-mini-latest`, `gpt-5.3-codex`, and `gpt-5.4`
with `rawMetadata.source=known_catalog`. Codex CLI 0.153.4 rejected forced
`gpt-5.4` for the connected ChatGPT account, while an unpinned execution
selected `gpt-6-astra`. Build Specialist and Change Reviewer remained pinned
to `codex/gpt-5.4`, so the stale fallback became a repeated runtime failure.

The installed CLI exposes the account-authoritative inventory through its
app-server JSON-RPC `model/list` method. A live probe returned six visible
models, their default marker, modalities, descriptions, and reasoning efforts.
That is the existing adapter's true serving boundary; the ChatGPT/OpenAI HTTP
catalog and DPF's known-model registry are not equivalent entitlement sources.

The source baseline for this diagnosis is repository ref
`9b434cd228002e326223ec6c3d7c07c445f73e28`:

- `apps/web/lib/inference/ai-provider-internals.ts:1125-1161` documents and
  implements the zero-result fallback from dynamic discovery to
  `KNOWN_PROVIDER_MODELS`, including for Codex.
- `apps/web/lib/inference/model-revalidation.ts:44-82` treats a resolved
  `{ error }` result as a successful refresh because it does not inspect the
  return value from `autoDiscoverAndProfile`.
- `apps/web/lib/queue/functions/model-discovery-refresh.ts:47-58` consequently
  records `ok` whenever the revalidation promise resolves.
- `apps/web/app/(shell)/platform/ai/providers/page.tsx:149` projects the
  provider-registry timestamp as catalog freshness.
- `apps/web/lib/routing/codex-cli-adapter.ts:43-75` distinguishes auth and
  rate-limit failures but has no unsupported-model classifier.

The runtime observations were reproduced on deployed ref
`3a98f9e879c20c14ab73b9aeb09cbab01982bc49`: the `ScheduledJob` row for
`model-discovery-refresh` reported `ok`; Codex-discovered rows carried
`rawMetadata.source=known_catalog`; `codex exec --model gpt-5.4` was rejected;
and the same authenticated sandbox returned `gpt-6-astra`, `gpt-5.6-sol`,
`gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, and
`gpt-5.3-codex-spark` from `initialize` → `model/list`.

## Decision

For the `codex` provider running through `codex-cli`, discovery SHALL query
`codex app-server` inside the same sandbox and with the same injected account
credential used for inference. The returned `model/list` page is authoritative
for that connection. Static known-model fallback remains available to providers
whose contract is catalog-based, but it SHALL NOT refresh, reactivate, or report
success for Codex subscription inventory.

The result flows through the existing `DiscoveredModel`, `ModelProfile`,
missed-discovery retirement, preference-finalization, and `ScheduledJob`
contracts:

1. A successful CLI list upserts returned models and reconciles absence.
2. Two absent authoritative cycles retire a model using the existing counter.
3. An explicit CLI unsupported-model response is classified as
   `model_not_found`, causing immediate model retirement through the existing
   fallback handler.
4. Once a stale pin points at a retired/missing model and at least one freshly
   listed active replacement exists, both pin fields are cleared. No replacement
   is hard-pinned; normal capability and quality routing resumes.
5. Per-provider failures are retained in the revalidation summary. A scheduled
   run with any failed provider records `partial`, not `ok`.
6. The Providers page's catalog freshness reads `model-discovery-refresh`,
   rather than the unrelated provider-registry timestamp.

The model-list call is the reachability proof for catalog admission: it is
served by the installed CLI after account initialization and identifies the
models that CLI will accept. Daily paid inference smoke calls are deliberately
rejected because they spend capacity and can mutate provider limits merely to
reconfirm the catalog.

## Objective and acceptance

**OBJ-CODEX-CATALOG-LIFECYCLE:** Keep Codex subscription routing synchronized
with the installed CLI/account while failing visibly when authoritative
discovery is unavailable.

| Acceptance ID | Objective IDs | Acceptance statement |
|---|---|---|
| AC-1 | OBJ-CODEX-CATALOG-LIFECYCLE | `model/list` parsing admits current visible models such as `gpt-6-astra`, preserves provider metadata, and excludes hidden entries. |
| AC-2 | OBJ-CODEX-CATALOG-LIFECYCLE | Codex discovery failure never falls back to `KNOWN_PROVIDER_MODELS`, advances `lastSeenAt`, or records a successful scheduled refresh. |
| AC-3 | OBJ-CODEX-CATALOG-LIFECYCLE | Authoritative absence uses the existing two-cycle retirement rule; explicit unsupported-model stderr retires immediately as `model_not_found`. |
| AC-4 | OBJ-CODEX-CATALOG-LIFECYCLE | Stale Codex model pins clear only when an account-listed active replacement exists; failure or an empty inventory leaves configuration untouched. |
| AC-5 | OBJ-CODEX-CATALOG-LIFECYCLE | The Providers page reports the model-discovery job's real last run and status. |
| AC-6 | OBJ-CODEX-CATALOG-LIFECYCLE | Focused tests, graph-linked tests, production build, and a live sandbox `model/list` probe pass. |

## Ordered implementation

1. Add failing parser/transport tests for paginated app-server `model/list`,
   malformed output, timeout, and hidden models.
2. Add failing discovery tests proving Codex cannot use static fallback and
   that authoritative absence reaches the existing retirement reconciler.
3. Add failing pin tests for retired, present, replacement-absent, and
   non-Codex configurations.
4. Add failing adapter classification tests for the observed `gpt-5.4`
   unsupported-model response.
5. Implement the thin app-server adapter, wire discovery/reconciliation, and
   return per-provider revalidation outcomes.
6. Bind the Providers freshness label to `model-discovery-refresh` and verify
   the route without adding controls or visible prose.
7. Run affected Vitest suites, typecheck/build and repository guards, then
   verify the live app-server inventory from the canonical sandbox.

All steps are one atomic fix: admitting the new list without retiring stale
models leaves invalid endpoints; retiring without truthful job status preserves
false success; clearing pins without an authoritative replacement can strand
the workforce.

## Research and benchmarking

- **Codex CLI 0.153.4 app-server (chosen):** generated JSON schema and a live
  `initialize` → `model/list` exchange establish the current account-specific
  contract. Adopt as serving authority.
- **OpenAI/ChatGPT HTTP catalogs (rejected):** already used by DPF for direct
  and ChatGPT provider discovery, but rejected for Codex entitlement because
  the CLI account surface demonstrably differs.
- **DPF known-model catalog (rejected for Codex freshness):** retain as
  bootstrap metadata for catalog-based providers; reject as freshness evidence
  for a subscription CLI.

## Compatibility, risks, and rollback

No migration or new persistence concept is required. API-key/direct OpenAI,
ChatGPT, Claude, Grok, and local-provider discovery remain unchanged. The main
risk is app-server protocol drift; parsing is defensive, timeout-bounded, and
turns drift into a visible partial refresh without modifying last-seen state or
pins. Rollback is one PR revert; previously persisted model and configuration
rows remain readable.

## Documentation impact

This design is the durable operator/developer contract. No user guide change is
needed: the visible Providers page keeps the same layout and wording, but its
date becomes truthful. No principle, route map, schema, migration, or
AI-coworker prompt changes.

## October 11 repair: inventory truth and Connections disclosure

BI-59E37E39 extends this design and the delivered BI-7F2FBDA3 eligibility
repair. It does not replace the approved, unfinished BI-71ABBD95 multi-account
design or its BI-7AA4EB6B compact-UX child. That design remains in the
`provider-multi-account` worktree and is not yet on main. Preserve the bounded
Responses inference verification in BI-F1C8F5A8 (awaiting acceptance).

### Observed defects and limits

At source revision `4bf3422a1daf24eb0a0dfe93380966b1ba36f22a`, successful
ChatGPT-backend discovery upserts models without returning their IDs or running
presence reconciliation and restricted-model readmission. Empty backend results
do not try the existing CLI fallback. New tests against that actual module
produce two failures and two passes before repair.

A DEV refresh returned six discovered, six new, and twelve profiled models;
the reloaded page still called all twelve profiles ready. The action assigns
`newCount = discovered`, while auto-discovery and the UI each profile historical
rows. Profile updates preserve model status; resurrection of retired rows has
not been established. Absent-row counter updates advance `lastSeenAt` because
the column uses `@updatedAt`, so future absence updates must explicitly preserve
the previous sighting timestamp. Historical timestamps cannot be reconstructed.

The running sandbox uses Codex CLI 0.157.0. Its direct, initialized `model/list`
returned GPT-6 Astra/Sol/Luna and GPT-5.6 Sol/Terra/Luna, with no next page and no
GPT-6.1 Sol. The desktop client therefore is not evidence of entitlement through
this sandbox connection. The cause of that upstream difference is unresolved;
do not insert model IDs or upgrade the shared sandbox to manufacture parity.

OpenAI's [app-server contract](https://learn.chatgpt.com/docs/app-server)
describes account/client-specific model availability; use the returned catalog.
Local installed inventories retain their existing non-retirement exception
([Ollama tags](https://docs.ollama.com/api/tags)). No new persistence is needed.

### Repair scope and ordered implementation

The working [Connections prototype](../mockups/2026-10-11-connections-catalog-health.html)
extends the approved account-summary/disclosure direction. The bounded delivery
changes the current single-provider detail surface; multi-account creation,
schema, routing, billing and migration remain owned by the existing initiative.

1. Preserve reproduction tests and research evidence before implementation.
2. Refactor successful inventory persistence into one helper used by every
   discovery path. Only nonempty successful inventories reconcile absence and
   readmit restricted models. Empty, malformed, authentication and transport
   failures preserve the last good catalog and report an error.
3. Preserve absent models' sighting timestamps, two-confirmed-miss retirement,
   permanent refusal reasons, local-provider exceptions and existing pin rules.
4. Profile only IDs returned by that refresh; return actual insert counts and
   profiling counts from the same operation. Remove duplicate UI profiling.
   Preserve existing pricing and evaluated capability metadata.
5. Describe profile counts as profiles, not usable or ready models. Keep
   connection verification distinct from inventory freshness. Place model cards
   and technical details behind the existing diagnostics disclosure; keep
   actionable connection failures visible.
6. Run focused lifecycle, pricing, pin, authentication and readiness regression
   tests, package typecheck, shared CI, and served theme/viewport UX verification.

Around twenty percent of this repair's implementation effort is allocated to
consolidating discovery completion and removing duplicate work. Rollback is one
PR revert; no schema or credential migration and no install advance are included.
The inventory result and its UI projection are one atomic delivery: shipping
only the projection would conceal inconsistent refresh behavior, while shipping
only reconciliation would retain misleading readiness claims.

### Objective and acceptance

The live BI acceptance criteria, quoted for medium delivery coverage:

- AC-1: Every successful authoritative subscription inventory uses shared persistence, presence reconciliation and auth-eligibility admission; errors and empty/malformed inventories preserve last-known-good state and do not claim freshness.
- AC-2: Only models present in the authoritative run are profiled, so absent/retired rows are not resurrected; two confirmed absences and runtime-refusal retirement remain intact.
- AC-3: Presence timestamps change only on actual sightings, not missed-discovery bookkeeping; existing lifecycle fields are reused unless steward proves a migration necessary.
- AC-4: Connections separates connection, inventory freshness and workload restrictions; model count never equates historical profiles with usable models; technical inventory is disclosed under existing UX design.
- AC-5: Tests cover new model arrival without source edits, removals/relisting, failure/empty response, stale pins, auth admission, pricing/metadata preservation and prior readiness behavior; served verification uses canonical runtime.

AC-2 describes the intended preservation contract. Inspection confirmed repeated
historical profiling, not resurrection of retired status; test status preservation
without treating that unproven symptom as an observed defect.

OBJ-CATALOG-TRUTH: automatic discovery tracks the serving connection's returned
models without turning catalog history into availability claims.

| Requirement | Flow/contract | Verification |
| --- | --- | --- |
| AC-REPAIR-1: all successful subscription discovery paths reconcile and return IDs | discover → persist → reconcile → readmit | actual-module backend and CLI fallback tests |
| AC-REPAIR-2: failed/empty inventory preserves last good state | refresh failure contract | empty, authentication, malformed and transport tests |
| AC-REPAIR-3: misses preserve sighting time and established retirement policies | inventory lifecycle | two misses, permanent refusal, local exception, pin regression tests |
| AC-REPAIR-4: refresh counts and profiling describe this refresh | discovery action/result → UI | existing/new count, fresh-ID-only and pricing tests |
| AC-REPAIR-5: overview hides technical catalog and avoids availability claims | provider overview → diagnostics | UI regressions and measured served UX evidence |

### Background phase forecast contract — 2026-10-12

The Build Studio phase forecast must compose its preview options through the
shared `backgroundRouteOptions` helper. The existing `buildPhaseRouteOptions`
module re-exports this helper for background plan and review callers, preserving
their imports while keeping inference independent of build orchestration. These
phases consume a completed response and do not require
token streaming. Leaving the preview on the interactive default incorrectly
excludes otherwise eligible endpoints whose streaming capability is unknown or
false, then reports a blocked phase that differs from the actual caller.

This reuses the existing background contract; it does not assign streaming
capability to a model or change provider clearance. Internal sensitivity and all
other routing requirements remain enforced. Interactive requests still require
streaming unless their own contract says otherwise. Regression verification
uses real contract inference and endpoint exclusion logic for both unknown and
false streaming, plus a public-only endpoint that remains excluded from internal
reviews. Forecast correctness does not establish settlement of an earlier
provider call or successful execution on the served runtime.

### Startup capability reconciliation and lifecycle ownership — 2026-10-12

`packages/db/scripts/reconcile-catalog-capabilities.ts` applies static capability
metadata at portal startup. Catalog lifecycle defaults apply only when creating
a missing profile. Existing active, degraded, retired and disabled states belong
to discovery, runtime refusal and operator decisions; a capability repair must
preserve those states and their retirement timestamps and reasons. A static
catalog entry also cannot retire an existing active profile. This extends AC-2
through the startup path as well as the authoritative inventory refresh path.

Live evidence on October 12 confirmed that startup catalog writes changed the
status of historical retired rows while retaining their retirement timestamps.
The routing loader still excludes rows with a retirement timestamp, so this
evidence establishes inconsistent lifecycle presentation rather than routing
readmission. The earlier qualification above concerned historical profiling;
this later startup finding is separate and now reproduced by regression tests.

Every field compared by the reconciler must be selected from the persisted row.
The typed selection covers the complete mapping, preventing missing reads from
being mistaken for null drift or logged as false previous values. A stable
profile and catalog hash produce no profile update or change-log append; a
changed hash alone advances provenance once. The existing capability drift
comparison remains necessary even when the catalog hash matches. Discovery and
evaluated ownership, full admin protection and field-level overrides remain
intact. Ninety-day change-log pruning retains its existing maintenance contract.

Regression tests execute the real reconciliation loop with a select-aware DB
fixture, covering lifecycle preservation during capability repair, metadata
change logging, repeated boots, protected ownership, overrides, hash-only
changes and all creation defaults. This source repair does not establish live
discovery success, endpoint capacity evidence or completed model execution.
