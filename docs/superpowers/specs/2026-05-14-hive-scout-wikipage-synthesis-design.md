# Hive Scout → WikiPage Synthesis Design

| Field | Value |
| --- | --- |
| Date | 2026-05-14 |
| Status | Draft v2 — reconciled against `origin/main` 2026-05-14 |
| Author | Mark Bodman (founder) + Claude (design partner) |
| Inspiration | Andrej Karpathy, *On LLM-maintained wikis* (<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>) |
| Depends On | [EP-WIKI-001 — Platform Kernel Wiki + Per-Org Overlay (2026-05-09)](2026-05-09-platform-kernel-wiki-design.md), [Hive Scout Autonomous Coworker (2026-05-11)](2026-05-11-hive-scout-autonomous-coworker-design.md) |
| Related repo areas | `apps/web/lib/actions/hive-scout/ingest-500-agents.ts`, `apps/web/lib/wiki/proposal.ts`, `apps/web/lib/wiki/proposal-commit.ts`, `apps/web/lib/wiki/raw-source.ts`, `packages/db/prisma/schema.prisma` (`WikiIngestEvent`, `RawSource`) |

---

## 0. Relationship to Recently Shipped Work

The first draft of this spec (2026-05-14 v1) was written against a worktree behind `origin/main`. Between drafting and review, four PRs landed that materially change what this spec needs to specify. Names of the shipped surfaces below are the authoritative call signatures from `origin/main`.

### 0.1 EP-WIKI-001 Phase 2.2 is live: the proposal engine exists

PR #581 shipped [apps/web/lib/wiki/proposal.ts](apps/web/lib/wiki/proposal.ts) — a pure three-pass extraction engine `proposeWikiDiff(input: ProposeWikiDiffInput)` that takes a `ProposalSource` (title + body text) plus an `ExistingSlugSnapshot` and an injected `InferenceCallable`, and returns a `WikiDiffProposal` with three structured arrays: `ClaimProposal[]`, `StanceProposal[]`, `HeuristicProposal[]`. The engine targets the `PROPOSABLE_KINDS` enum: `entity | stance | heuristic | principle | summary | decision | runbook`. It marks each row with `proposeNew: boolean`, `confidence: [0,1]`, and a `supportingExcerpt` for reviewer verification.

**Implication for this spec:** v1 proposed a custom `mcp__dpf__propose_wiki_write` MCP tool with a hand-rolled payload. That is now redundant. Hive Scout should call `proposeWikiDiff` directly in-process — the engine already does the page-kind selection that v1 §4.2 specified manually.

### 0.2 EP-WIKI-001 Phase 2.3a is live: the commit pipeline exists

PR #606 shipped [apps/web/lib/wiki/proposal-commit.ts](apps/web/lib/wiki/proposal-commit.ts) — `commitIngestProposal(db, input: CommitProposalInput)` translates a `WikiDiffProposal` into `WikiPage` upserts, `WikiPageRevision` appends (`changeKind = "ingest"`), `WikiPageSource` citations, `WikiPageLink` edges, and one `WikiIngestEvent` audit row per commit. Guardrails already enforced:

- Kernel writes (`organizationId = null`) refused at the storage boundary.
- Body-delta cap (default 30%) on updates.
- Confidence threshold (default 0.5); low-confidence rows surface as `skippedLowConfidence` for reviewer visibility.
- All new pages land as `status = "draft"`.

**Implication for this spec:** v1 §4.5 and §5.2 specified the proposal flow's persistence behavior. That is now redundant. Hive Scout calls `commitIngestProposal` and inherits the guardrails.

### 0.3 Hive Scout ambiguity review is live with the exact classifier this spec assumed

PRs #617 and #620 shipped the ambiguity-review path in [apps/web/lib/actions/hive-scout/ingest-500-agents.ts](apps/web/lib/actions/hive-scout/ingest-500-agents.ts). The classifier emits `AmbiguityReviewClassification` with values `new_archetype | existing_skill_gap | duplicate_pattern | out_of_scope | needs_human_review` — identical to v1 §4.2's mapping. The review annotates `BacklogItemActivity.payload` with the decision rationale, novelty, value-stream, etc.

**Implication for this spec:** the upstream classifier is exactly what v1 assumed. The bridge step is shorter than v1 designed: take the classification that already exists and route it.

### 0.4 `WikiIngestEvent` exists; revision-level `taskRunId` is the wrong place

[schema.prisma:7230](packages/db/prisma/schema.prisma) ships `WikiIngestEvent { id, organizationId, sourceId, touchedPageIds[], agentId, userId, kernelVersion, createdAt }`. This is the existing per-commit audit primitive. `WikiPageRevision` itself has no `taskRunId`.

**Implication for this spec:** v1 §5.3 proposed adding `WikiPageRevision.taskRunId`. The correct location is `WikiIngestEvent.taskRunId` — one nullable FK on the per-commit row, not on every revision. AI Operations Map projection queries one row per commit, not one row per page touched.

### 0.5 Operator-driven wiki write MCP surface is landing in PR #637

On `origin/main` the wiki-facing MCP surface is `wiki_query` and `wiki_lint` (read-only) — no write tool yet. **Open PR #637** (`feat(wiki): coworker-driven UX for ingest + review`) introduces:

- `wiki_ingest` MCP tool with `mode: "propose" | "commit"` — wraps `proposeWikiDiff` and `commitIngestProposal` behind one tool surface.
- `publish_wiki_overlay_pages` MCP tool — batch status flip on overlay drafts (registry_write grant).
- `list_wiki_overlay_drafts` MCP tool — read-only draft enumerator (registry_read grant).
- `ingest-article-from-url.skill.md` — operator chains `fetch_public_website` → `wiki_ingest(propose)` → render → `wiki_ingest(commit)` in chat with one-word confirmations.
- `review-wiki-drafts.skill.md` — operator walks each draft, gives keep/edit/drop, the skill batches through the publish tool.

**Implication for this spec:** Hive Scout's bridge should call the `wiki_ingest` MCP tool when #637 is merged, in preference to direct in-process function calls. Reason: preserves the grant boundary (registry_write), keeps the bridge symmetric with the operator-driven path, and inherits future improvements to the MCP wrapper. Until #637 merges, Slice 3 calls `proposeWikiDiff` + `commitIngestProposal` directly — the underlying functions are the same.

### 0.6 RawSource still file-ingest-only

`RawSource` rows are still created only by Phase 2.1's `ingestRawSourceFromFile`. Hive Scout's catalog parser produces structured entries but does not yet upsert `RawSource` rows. The commit pipeline requires `CommitProposalInput.rawSourceId` and `sourceKey`, so this is a hard prerequisite for the bridge.

**Implication for this spec:** v1 Slice 1 (add `RawSource` creation in hive-scout) remains correct and is the unavoidable first move.

---

## 1. Purpose

DPF runs the Karpathy LLM-wiki pattern end-to-end at the substrate level: proposal engine (`proposeWikiDiff`), commit pipeline (`commitIngestProposal`), lint detectors, kernel/org overlay, founder-kernel seed, Qdrant embedding, and operator review surfaces. EP-WIKI-001 phases 2.2, 2.3a, and 6b are live on `main` as of 2026-05-14.

DPF also runs an external-pattern scout: Hive Scout's deterministic catalog parser plus the now-live ambiguity-review pass produce a per-entry classification and rationale that today writes through to `BacklogItem` only.

**The remaining gap:** Hive Scout's classified output is not yet composed into a `ProposalSource` and fed into the wiki proposal pipeline. The substrate is ready; the bridge is one queue-function code path away.

This spec specifies that bridge: when Hive Scout's ambiguity review classifies an entry as wiki-relevant, the same `TaskRun` composes a proposal source from the catalog entry and the ambiguity-review rationale, calls `proposeWikiDiff`, calls `commitIngestProposal` with org scope, and records the resulting `WikiIngestEvent` against the originating `TaskRun` for AI Operations Map visibility.

## 2. Current State

| Substrate | Status on `origin/main` |
| --- | --- |
| `WikiPage`, `WikiPageRevision`, `WikiPageLink`, `WikiPageSource`, `WikiIngestEvent`, `RawSource` models | Shipped ([schema.prisma](packages/db/prisma/schema.prisma)) |
| `proposeWikiDiff(input)` proposal engine | Shipped ([proposal.ts](apps/web/lib/wiki/proposal.ts), PR #581) |
| `commitIngestProposal(db, input)` commit pipeline | Shipped ([proposal-commit.ts](apps/web/lib/wiki/proposal-commit.ts), PR #606) |
| Founder-kernel seed pipeline (file → RawSource → proposal → commit) | Shipped (Phase 2.1) |
| Lint detectors (5 of 7) | Shipped ([lint-detectors.ts](apps/web/lib/wiki/lint-detectors.ts)) |
| Overlay edit UI `/wiki/edit/<slug>` | Shipped (PR #611, Phase 6b) |
| `draft-kernel-edit-pr` skill (manual founder kernel edits via PR) | Shipped (PR #612) |
| Hive Scout deterministic catalog ingest | Shipped |
| Hive Scout ambiguity review (`new_archetype`/`existing_skill_gap`/`duplicate_pattern`/`out_of_scope`/`needs_human_review`) | Shipped (PR #617, #620) |
| Hive Scout `TaskRun` identity (2026-05-11 Slice 1) | Shipped (per closeout PR #627) |
| **Hive Scout → `RawSource` upsert** | **NOT shipped** |
| **Hive Scout → `proposeWikiDiff` invocation** | **NOT shipped** |
| **Hive Scout → `commitIngestProposal` invocation** | **NOT shipped** |
| **`WikiIngestEvent.taskRunId` linkage** | **NOT shipped** (no field) |
| **AI Operations Map projector for `WikiIngestEvent`** | **NOT shipped** |
| `wiki_propose_edit` MCP tool / Phase 2.3 adapter | NOT shipped — out of scope on `main`; this spec stays in-process |

The remaining work is a focused four-slice bridge.

## 3. Why the Recent Work Applies

### 3.1 EP-WIKI-001 P1: compounding artifact, not retrieval index

The wiki is the artifact, raw sources are the receipts. Hive Scout produces both shapes naturally: each catalog entry is a citable external pattern (raw source) and each ambiguity review is a judgment about its relevance (the artifact-update signal). Today only the latter lands, and only as a backlog item.

### 3.2 EP-WIKI-001 P4: source-cite enforcement

Every published wiki page already requires at least one `WikiPageSource`. Hive Scout's catalog entries map cleanly onto `RawSource`. Writing through preserves the audit chain that `commitIngestProposal` enforces.

### 3.3 Hive Scout autonomous coworker (2026-05-11)

The 2026-05-11 design granted Hive Scout governed `TaskRun` identity, AI Operations Map visibility, and structured ambiguity-review output. Adding wiki write-through reuses all three: same task, same identity, same evidence stream — additional output channel.

### 3.4 TAK §12.1 self-edit prohibition

Every wiki write produced through the bridge inherits `commitIngestProposal`'s posture: kernel writes refused at the storage boundary, drafts only, body-delta capped, low-confidence rows skipped. The HITL approval gate is the existing `/wiki/edit/<slug>` overlay review surface plus the published-status promotion path. No new approval surface is introduced.

## 4. Target Architecture

### 4.1 Layered output, single run

One Hive Scout `TaskRun` produces four artifact classes:

1. `BacklogItem` proposals (existing).
2. `BacklogItemActivity.payload` ambiguity-review rationale (existing).
3. `RawSource` row per evaluated catalog entry (new — §4.3).
4. Zero or more `WikiIngestEvent` audit rows, each representing a `proposeWikiDiff` + `commitIngestProposal` pass that produced `WikiPage(s)` at `status = "draft"` (new — §4.4).

Backlog suggestions stay the human-actionable surface; wiki proposals are the knowledge-accumulation surface. Operator review can accept either, both, or neither.

### 4.2 Classification → wiki action

The shipped ambiguity-review classifier already produces the right enum. Routing:

| `AmbiguityReviewClassification` | Wiki bridge action |
| --- | --- |
| `new_archetype` | Compose `ProposalSource`; call `proposeWikiDiff` then `commitIngestProposal`. Let the engine decide which page kinds emerge. |
| `existing_skill_gap` | Same as above; the engine's `proposeNew = false` rows attach claims/stances/heuristics to existing entity pages. |
| `duplicate_pattern` | Skip the proposal engine entirely. Upsert `RawSource` and call `attachSource(db, { pageId, sourceId })` directly against the matching existing entity page identified during ambiguity review. One-row provenance update, no new revision. |
| `out_of_scope` | No wiki write. |
| `needs_human_review` | No wiki write. Backlog item still files. |

This delegates all page-kind selection to the live proposal engine. The Hive Scout coworker does **not** pre-classify into `entity`/`summary`/`stance`/`heuristic` — that's the engine's job.

### 4.3 `RawSource` shape for catalog entries

For every entry evaluated by the ambiguity review, upsert a `RawSource` (idempotent on `sourceKey`):

- `sourceKey`: `hive-scout:500-ai-agents:<canonical-slug-of-entry>` (stable across runs).
- `sourceType`: `"external-url"`.
- `title`: catalog entry name.
- `url`: entry URL.
- `license`: upstream license string (currently MIT for the 500-AI-Agents-Projects catalog).
- `retrievedAt`: run timestamp.
- `abstract`: empty on first upsert; proposal engine's abstract pass fills it on first wiki use.
- `organizationId`: install's primary org (single-org-per-install per platform memory).
- `isKernel`: `false` (Hive Scout never writes kernel-tier sources).

### 4.4 `ProposalSource` shape for Hive Scout-driven proposals

For `new_archetype` and `existing_skill_gap` classifications, build a `ProposalSource` from:

- **Title:** the catalog entry name.
- **Body:** a structured composition of (a) the catalog entry's upstream description, (b) the ambiguity-review rationale, (c) the inferred archetype name, (d) IT4IT value-stream placement, (e) any cross-references to matched existing slugs the ambiguity review surfaced.

The proposal engine extracts whatever it extracts. The Hive Scout side does not pre-shape claims/stances/heuristics; it provides the source text and lets the engine do its job.

### 4.5 Cross-reference discipline via the engine

The v1 spec hand-rolled an orphan-avoidance rule. The proposal engine already produces `WikiPageLink` references through wikilink resolution in `commitIngestProposal`; matched-slug cross-references in §4.4(e) flow through automatically. The existing lint detectors (orphan, dangling-xref) cover the residual cases at next lint run.

### 4.6 Provenance: `WikiIngestEvent.taskRunId`

Add one nullable column `taskRunId String?` to `WikiIngestEvent`. The Hive Scout bridge populates it; the founder-kernel seed leaves it null. AI Operations Map projection queries `WikiIngestEvent.taskRunId = <TaskRun.id>` to surface wiki-write counts per autonomous run.

`WikiPageRevision` is unchanged. Per-page-touched joinback flows through `WikiIngestEvent.touchedPageIds`.

## 5. Runtime Shape

### 5.1 Preferred call surface: `wiki_ingest` MCP tool (once PR #637 lands)

When PR #637 merges, Hive Scout's bridge calls the `wiki_ingest` MCP tool in `propose` mode and then `commit` mode, against the same `registry_write` grant the operator-driven `ingest-article-from-url` skill uses. This keeps the autonomous and operator-driven ingest paths symmetric and inherits future tool improvements.

Until #637 merges, Slice 3 calls `proposeWikiDiff` + `commitIngestProposal` directly from the existing Hive Scout queue function ([hive-scout-ingest.ts](apps/web/lib/queue/functions/hive-scout-ingest.ts)) and ingest action ([ingest-500-agents.ts](apps/web/lib/actions/hive-scout/ingest-500-agents.ts)). The underlying engine is identical; the only difference is whether the call crosses the MCP boundary.

No new `AgentToolGrant.grantKey` is introduced by this spec. The Hive Scout coworker reuses the `registry_write` grant the wiki-write MCP tools already check (per #637).

### 5.2 Per-entry control flow

For each catalog entry the ambiguity review classifies as wiki-relevant:

1. Upsert `RawSource` (idempotent on `sourceKey`).
2. Branch on classification:
   - `duplicate_pattern`: call `attachSource` against the matched existing page id. Done.
   - `new_archetype` or `existing_skill_gap`: build `ProposalSource` per §4.4, snapshot existing slugs, call `proposeWikiDiff` with the production inference adapter.
3. Filter the resulting `WikiDiffProposal` for confidence (default threshold inherited from `commitIngestProposal`).
4. Call `commitIngestProposal({ rawSourceId, sourceKey, proposal, organizationId, agentId: hiveScoutAgentId, userId: null, taskRunId, kernelVersion })`. Pass `taskRunId` through to the new `WikiIngestEvent.taskRunId` field.
5. Append the `WikiIngestEvent.id` to the `TaskRun`'s structured run summary.

Batching: process classifications sequentially per run to keep the inference adapter back-pressure simple; concurrency tuning is a follow-up.

### 5.3 Budget guardrails

The 2026-05-11 design's use-it-or-lose-it policy (§6) governs whether the proposal-engine inference passes run at all. When the run is invoked as a burn-rate-assist task, cap:

- Maximum entries advancing to `proposeWikiDiff` per run (default 10).
- Cheapest capable model first; promote to reasoning tier only if the cheap pass returns `parseErrors`.
- Stop when marginal novelty falls below a threshold the ambiguity review already produces (existing `noveltyScore` on `AmbiguityReviewDecision`).

### 5.4 AI Operations Map projection

Extend [load-map-data.ts](apps/web/lib/ai-operations-map/load-map-data.ts) to project `WikiIngestEvent` rows where `taskRunId` is non-null. Surface per `TaskRun` node:

- count of `WikiIngestEvent` rows produced,
- count of pages created vs updated (from `touchedPageIds` cross-referenced against revision versions),
- deep link to the wiki review queue filtered by event id.

## 6. Lint Interaction

The five shipped detectors apply unchanged. Notes specific to Hive Scout-originated pages:

- **orphan:** scout-originated `summary` rows inherit cross-refs from matched-slug resolution in §4.4(e). If a true new archetype has no inbound link at draft time, the detector flags it; operator review fills the gap via the existing overlay edit form.
- **dangling-xref:** `commitIngestProposal`'s wikilink resolution already validates references at commit time, so this detector rarely fires from scout output.
- **stale:** scout `summary` pages inherit `RawSource.retrievedAt` from the catalog fetch; staleness fires after 180 days, prompting the next scout cycle to re-evaluate. This is the Karpathy "temporal degradation" mitigation.
- **kernel-drift:** N/A — Hive Scout cannot write kernel rows.
- **stance-extraction-needed:** scout `summary` pages are not subject to stance-extraction at first commit (they describe external patterns, not Mark's judgment). Existing detector exempts non-summary pages and pages without a stance-extraction-needed annotation.

The deferred `contradiction` and `missing-xref` detectors (Phase 4b3) will pick up cross-source disagreements the bridge introduces; the bridge does not need to anticipate them.

Hive Scout-originated drafts flow into the same `/wiki/edit/<slug>` overlay review surface (Phase 6b) and the same `review-wiki-drafts` operator skill introduced in PR #637. Operators do not distinguish autonomous vs. operator-driven drafts at review time; the `WikiIngestEvent.agentId` and `taskRunId` (Slice 2) carry the provenance for anyone who wants to filter.

## 7. Implementation Slices

### Slice 1: `RawSource` upsert in Hive Scout

Goal: shape the data plane so the bridge has citations.

Scope:
- Extend [ingest-500-agents.ts](apps/web/lib/actions/hive-scout/ingest-500-agents.ts) to upsert `RawSource` per parsed entry, idempotent on `sourceKey`, per §4.3.
- Surface the `RawSource.id` on the ambiguity-review record for use in Slice 3.
- Idempotence test in the existing manual-run harness ([hive-scout-manual-run.ts](apps/web/scripts/hive-scout-manual-run.ts)).

Acceptance:
- Weekly Hive Scout run produces one `RawSource` per evaluated entry.
- Repeat runs do not create duplicates.
- No regression in existing backlog item creation.

### Slice 2: `WikiIngestEvent.taskRunId`

Goal: link wiki commits to the originating autonomous run.

Scope:
- Prisma migration: add `taskRunId String?` to `WikiIngestEvent` plus an index on `(taskRunId, createdAt)`.
- Thread `taskRunId` through `commitIngestProposal`'s `CommitProposalInput` and `recordIngestEvent` helper.
- Founder-kernel seed continues to leave it null.

Acceptance:
- Migration applied, types regenerated.
- Existing kernel-seed path produces null `taskRunId` rows.
- Test confirms passing `taskRunId` round-trips to the DB row.

### Slice 3: Wire Hive Scout to `proposeWikiDiff` + `commitIngestProposal`

Goal: the actual bridge.

Scope:
- In the Hive Scout ingest action, after ambiguity review, run §5.2 per-entry control flow.
- `duplicate_pattern` branch: direct `attachSource` against matched page id.
- `new_archetype` / `existing_skill_gap` branch: `proposeWikiDiff` → `commitIngestProposal`.
- Pass `taskRunId` from the scheduled `TaskRun` (Slice 1 of 2026-05-11 design, already shipped).
- Inference adapter selection respects the burn-rate-assist policy from 2026-05-11 §6.

Acceptance:
- One Hive Scout run produces one `TaskRun`, N `BacklogItem` rows, M `RawSource` rows, K `WikiIngestEvent` rows (K ≤ count of `new_archetype` + `existing_skill_gap` + `duplicate_pattern` classifications).
- Created wiki pages land as `status = "draft"`, never `published`, never kernel.
- Existing weekly Inngest schedule still passes.

### Slice 4: AI Operations Map projector for `WikiIngestEvent`

Goal: make the write-through visible.

Scope:
- Extend [load-map-data.ts](apps/web/lib/ai-operations-map/load-map-data.ts) projection per §5.4.
- Deep link from the map node to the wiki review queue filtered by `taskRunId`.

Acceptance:
- Map node shows wiki proposal counts on Hive Scout run nodes.
- Operator can drill from map → wiki proposals → approve/reject via existing `/wiki/edit/<slug>` flow.

## 8. Risks and Open Questions

| Risk | Mitigation |
| --- | --- |
| Proposal engine produces low-quality pages from thin catalog descriptions | `commitIngestProposal` confidence threshold drops low-signal rows; `skippedLowConfidence` surfaces them for reviewer awareness. All commits land as draft. |
| Inference cost grows linearly with catalog size | §5.3 budget guardrails: capped entries per run, cheapest-capable model first, stop on novelty floor. Burn-rate-assist policy (2026-05-11 §6) governs whether the inference passes run at all. |
| Hive Scout produces duplicate `RawSource` rows across runs | Idempotence key `sourceKey = hive-scout:500-ai-agents:<canonical-slug>` makes upsert safe. |
| Body-delta cap (30%) rejects valid scout-driven updates to existing pages | `commitIngestProposal` already surfaces these as errors rather than silently dropping. Reviewer either approves manually via overlay edit or accepts the draft as new revision. Adjust per-call override only with explicit justification. |
| AI Operations Map projector adds query load | `WikiIngestEvent` is small per run (≤10 by §5.3 cap); indexed `(taskRunId, createdAt)` query is cheap. |
| `duplicate_pattern` branch trusts the ambiguity-review matched-page id without confidence check | Add minimum `noveltyScore` threshold for the duplicate path; default to requiring `noveltyScore < 0.2` before attaching to an existing page. |

Open questions:

- Should the bridge attach a `WikiPageSource` citation to the matched existing entity page even when classification is `existing_skill_gap`, in addition to the proposal-engine-driven updates? Likely yes; defer to Slice 3 review.
- Does the burn-rate-assist policy unlock auto-publish of `duplicate_pattern` updates (no draft step needed since no new content)? Recommend yes for the founder install only; configurable per org otherwise.

## 9. Recommended Next Move

Ship **Slice 1** (`RawSource` upsert in Hive Scout) first as a standalone PR. It is:

- The only unavoidable prerequisite for the bridge.
- Reversible and behavior-neutral on its own.
- Useful even without Slices 2–4, because it lights up source-citation analytics and feeds the `stale` lint detector once any wiki write does reach scout-originated sources.

Slices 2 (`WikiIngestEvent.taskRunId` migration) and 3 (the actual bridge invocation) should land together — Slice 2 alone has no observable effect, and Slice 3 needs it. Slice 4 (Operations Map projection) lands the same week as Slice 3 to close the visibility loop.

## 10. Recommendation

The Karpathy pattern is implemented at the substrate level. EP-WIKI-001 phases 2.2 and 2.3a are the production proposal+commit pipeline. The 2026-05-11 Hive Scout coworker is the production external-source scout. The four-slice bridge above is the smallest credible work to make Hive Scout the first non-kernel input to that pipeline — proving end-to-end that the platform's autonomous external cognition can compound into the wiki the same way founder-authored sources do.

Nothing here introduces new architectural primitives. It connects two production substrates with one Prisma column, one source-upsert call, one `proposeWikiDiff` invocation, one `commitIngestProposal` invocation, and one Operations Map projector.
