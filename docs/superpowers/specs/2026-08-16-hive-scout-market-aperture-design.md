# Hive Scout Market Aperture — daily inbound product intelligence

**Date:** 2026-08-16
**Status:** active
**Backlog:** BI-B8E4317D (umbrella) · blocker context BI-FC28F1E3 · epic EP-5EA15B45
**Kernel decision:** DI-8BAB077F38A4 (`ingest-side-source-list` over `turn-side-external-access`, high confidence, no commandment conflict)

## 1. Problem

The operator asked for a daily activity: *"finding these new releases in this space and bringing these to bear here"* — standing awareness of the product/market space, converted into changes to our own design.

The substrate already exists and runs. `external-catalog-scout` (AGT-WS-SCOUT) executes daily on the `ScheduledAgentTask` cadence (`17 8 * * *`), genuinely fetches its upstream catalog README on every run (the fetch throws on failure, so a green run implies a real fetch — verified against live `ToolExecution` rows 2026-08-16), and has produced 47 backlog items through the observation → governed-suggestion → triage loop. The gap is **aperture, not machinery**:

- The scout reads exactly one source — an agent-project catalog — and that source is saturated: recent daily runs report 32 gaps, 32 duplicates, 0 created.
- The wider web paths are off: no Brave key exists on the live install (so `search_public_web` throws `ExternalAccessNotConfiguredError`), and the scheduled-task runner (`apps/web/lib/actions/agent-task-scheduler.ts`) passes no `externalAccessEnabled` to tool resolution, so `requiresExternalAccess` tools — including the keyless `fetch_public_website` — are invisible to every scheduled coworker turn while unified mode is off. (Both facts verified live 2026-08-16; evidence recorded on BI-FC28F1E3.)
- Container-level egress works: real fetches from the live portal container returned 200 from the catalog host and from candidate market sources.

## 2. Design

Widen the scout's aperture on the **proven ingest-side fetch path** — the same server-side fetch the catalog pass already uses — rather than wiring per-turn external access into scheduled runs. The kernel weighed both options (ledger DI-8BAB077F38A4); the ingest-side option won decisively on schema grounding, evidence density, blast radius, and governance compliance: the turn-side option would change external-access posture for every scheduled task holding a web grant, which is BI-FC28F1E3's decision to make, not this feature's side effect.

### 2.1 Operator-editable market-source list

- New module `apps/web/lib/actions/hive-scout/market-sources.ts` owns the source list and the market pass.
- Seeded defaults: a curated list of public product/market surfaces (release notes, changelogs, engineering/product blogs, and launch aggregators adjacent to DPF's space — AI-operated business platforms, SMB operations suites, agent products). Every seeded default was verified fetchable (HTTP 200) from the live portal container on 2026-08-16. Sources behind WAFs that reject server-side fetches (observed: one launch aggregator returning 403) are excluded rather than scraped around.
- Operator override: one `PlatformConfig` row, key `hive-scout.market.sources`, JSON array of `{ key, title, url }`. Malformed config falls back to defaults (logged in the run result). `hive-scout.market.enabled` (boolean, default true) turns the pass off. This mirrors the existing `hive-scout.review.*` PlatformConfig namespace the scout already uses.
- The list is capped (12 sources) so a config mistake cannot turn the daily run into a crawler. Fetches follow the existing catalog fetch discipline: identified User-Agent, bounded timeout, no retries beyond the platform's existing pattern, public http/https only.

### 2.2 Deterministic market pass inside `runHiveScoutIngest`

For each configured source, the pass:

1. Fetches the page/feed server-side (same `fetcher` seam as the catalog pass — tests inject a fake).
2. Strips markup to text and bounds it (hash window and stored excerpt are capped).
3. Computes a content hash and compares it against the hash stored on the source's `RawSource.locator` (a structured locator: `{ kind: "hive-scout-market", url, contentHash, fetchedAt }`) — so each run knows whether a source **changed** since the last pass. Idempotent on `sourceKey` (`hive-scout:market:<url-hash>`); re-runs never duplicate rows.
4. Upserts the citable `RawSource` (title, url, excerpt, retrievedAt, locator). Findings cite this row's URL — a structured, re-checkable locator, satisfying the never-fabricate guardrail.
5. Returns bounded material (`{ key, title, url, changed, excerpt }`, or `{ key, url, error }` on per-source failure) in the tool result. Per-source failures never fail the run; the catalog pass's failure semantics are unchanged.

`IngestResult` gains a `marketSources` block (`attempted`, `fetched`, `changed`, `failed`, `material`). The MCP handler message and the scheduled-run summary (`extractHiveScoutSummary`) surface the same counts, so the daily surface shows what was actually read — a green status now carries its own liveness evidence.

### 2.3 The output shape: design challenges, not a digest

The scheduled prompt (`packages/db/src/hive-scout-config.ts`, reseeded onto the live row by `ensureHiveScoutScheduledTask` on every boot/self-upgrade) directs the turn to review the changed material and ask, per source:

> *What does this product or release make effortless that our platform's model would not catch?*

Evidence for this shape: a competitive read of a consumer agent product, tested against the interaction-shape-graph spec, produced four real amendments (PR #4355) — including a `stepRole` the metric would otherwise have penalised. A release digest would have produced none of them. Structural correctness and ease of use are different measurements; the second is where this platform's thesis lives.

Findings route:

- **Backlog:** at most two governed suggestions per run via `create_backlog_item` (defaults to `triaging` — never auto-promoted), each citing its `RawSource` URL and framing a concrete challenge to an existing DPF spec or surface. The scout's existing `backlog_write` grant already covers this tool; no grant changes.
- **Doctrine:** a finding that amends a spec is filed as a backlog suggestion referencing the spec path, in the PR #4355 amendment shape.
- **No finding is a valid outcome** — the prompt instructs the scout to say so rather than force one.

### 2.4 What does not change

- No new scheduler, coworker, tool, grant, migration, or UI surface. The cadence stays on the existing `ScheduledAgentTask` row.
- The catalog pass and its ambiguity-review machinery are untouched.
- `search_public_web` stays Brave-gated and scheduled-turn external access stays off — those remain BI-FC28F1E3's scope.
- Zero code is imported from any scanned source (the scout's standing charter, restated in the prompt).

## 3. Research & Benchmarking

Standing market/competitive intelligence is an established category; three reference points shaped this design:

1. **changedetection.io** (open source, github.com/dgtlmoon/changedetection.io) — watch a URL list, strip markup, diff text, notify on change. **Adopted:** change-detection-before-reasoning (fetch → text → hash → only reason over what changed) and the curated watch-list with per-source tolerance for failure. **Rejected:** its headless-browser scraping tier — WAF circumvention is an arms race the platform should not enter; sources that refuse server-side fetches are excluded, not scraped.
2. **Huginn** (open source, github.com/huginn/huginn) — scheduled agents fetch feeds/pages and route events through user-defined pipelines. **Adopted:** the scheduled fetch-and-route shape mapped onto DPF's existing `ScheduledAgentTask` + governed-suggestion pipeline rather than a new event system. **Rejected:** free-form pipeline construction — DPF routes findings through one governed door (backlog triage), not arbitrary user pipelines.
3. **Commercial CI platforms** (Klue/Crayon class) — track competitor surfaces, but their output is a human-curated battlecard/digest. **Adopted:** citation discipline (every claim carries a re-checkable locator). **Rejected:** the digest itself as the deliverable — this spec's deliverable is a *challenge to our own design*, which a summary format structurally cannot produce.

## 4. Guardrails

- **Cite sources.** Every finding carries its `RawSource` URL; the locator stores the content hash and fetch time so a claim is re-checkable. No fabricated pricing or feature claims.
- **Never import code** from a scanned source. Observation → suggestion only.
- **Suggestions go to triage** (`create_backlog_item` default status), never auto-promoted.
- **OSS identity-leak guard:** the seeded source list is functional configuration (public product URLs, precedent: the catalog URL already in code). Evaluative findings in repo artifacts genericize the subject ("a consumer agent product…", PR #4355 style); no customer/company/person names of the operator's business in public artifacts.
- **License respect:** stored excerpts are bounded snippets for change detection and citation, not content republication.

## 5. Acceptance (from BI-B8E4317D)

- External web access verified by a real fetch, not a green task status — done 2026-08-16, recorded on BI-FC28F1E3.
- A daily run yields product/market findings, each carrying a citation.
- At least one finding expressed as a concrete challenge to an existing spec or surface (PR #4355 shape), not a summary.
- Zero code imported from scanned sources.
- Durable findings contributed to the hive.
