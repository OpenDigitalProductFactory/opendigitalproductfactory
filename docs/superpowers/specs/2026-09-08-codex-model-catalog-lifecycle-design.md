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

- **Codex CLI 0.153.4 app-server:** generated JSON schema and a live
  `initialize` → `model/list` exchange establish the current account-specific
  contract. Adopt as serving authority.
- **OpenAI/ChatGPT HTTP catalogs:** already used by DPF for direct and ChatGPT
  provider discovery, but rejected for Codex entitlement because the CLI
  account surface demonstrably differs.
- **DPF known-model catalog:** retain as bootstrap metadata for catalog-based
  providers; reject as freshness evidence for a subscription CLI.

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
