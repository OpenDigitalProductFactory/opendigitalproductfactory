# Plan — WWWD stance publish embeds on the write-path + self-heals on upgrade (BI-D4C1E05E)

**BI:** BI-D4C1E05E — *Publishing a WWWD stance does NOT embed it — the stance is silently invisible to the decision engine until a separate reembed.*
**Type:** bug · **Priority:** P1 · **Triage:** build · **Size:** small
**Related:** EP-1C37C089 (governance gate), BI-512FBD20 (reembed reconciler — becomes the self-heal engine), BI-8AC24F3D (`craft-override-promotion.ts` — the direct precedent), BI-7E1F128A (WWWD alignment).

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

---

## Problem (confirmed against source, 2026-08-15)

Two generic overlay write-paths flip an org-overlay page to `published` and promote craft/stance material, but **neither embeds the page**:

- `saveWikiOverlayEdit` (`apps/web/lib/actions/wiki-edit.ts`) — the action the portal Edit / craft / free-form stance editor calls. On the `draft→published` transition it calls `promoteCraftOverrideOnPublish` but never `storeWikiPage`.
- `publishWikiOverlayPages` (`apps/web/lib/actions/wiki-publish.ts`) — batch publish. Same: promotes material, does not embed.

The two *specialized* stance actions (`publishBusinessStance`, `confirmStanceVectors`) do call `storeWikiPage`, but wrapped in `try { … } catch { /* best-effort */ }` — a **silent** skip. The leaked live slug (`stances/how-do-we-manage-…`) is a free-form page authored via the **generic** editor → `saveWikiOverlayEdit`, which is why `vector_embedding` count stayed 301 and `wiki_query` never returned it.

This is the same defect class BI-8AC24F3D closed for material promotion: *a publish that structurally succeeds and functionally does nothing.* The fix follows that exact precedent — **one embed implementation, wired at every publish path** — and adds the fleet self-heal + coverage surfacing the BI requires.

## Approach

Mirror `promoteCraftOverrideOnPublish`: a single plain-module helper `embedPublishedOverlayPage`, called at every `→published` transition. Embedding failure is **observable, never silent** (loud greppable log + numeric outcome), matching the `searchWikiPages` degradation marker. Self-heal pre-existing gaps on upgrade via the already-self-verifying reembed reconciler, run as a non-fatal boot step. Surface embedded-vs-published coverage in the governance UI so "ACTIVE" cannot overstate readiness.

---

## Phases

### Phase 1 — Single embed seam on the write-path
**Deliverable:** `apps/web/lib/wiki/embed-published-overlay.ts` — `embedPublishedOverlayPage(page)` that maps a saved overlay row to `storeWikiPage` input and embeds it. Returns a typed `{ embedded: true } | { embedded: false; reason }`; on failure emits a loud, greppable `console.error("[embed-published-overlay] …")` naming the slug and the fix (`docker model pull ai/nomic-embed-text-v1.5`). Never throws to the caller (a publish must not roll back on embed failure) but never swallows silently either.
**Wire:**
- `wiki-edit.ts` — after `promoteCraftOverrideOnPublish`, inside the same `saved.status === "published" && previousStatus !== "published"` guard, call `embedPublishedOverlayPage`. Also embed on re-publish of an already-published page whose body changed (edit-then-save keeps the index fresh) — guard on `published` target, not only the transition, but skip when body unchanged.
- `wiki-publish.ts` — inside the `targetStatus === "published"` branch of the batch loop, call `embedPublishedOverlayPage` per row.
- `business-stance.ts` — `publishBusinessStance` delegates to `saveWikiOverlayEdit(status:"published")`, which now embeds via the shared seam, so its own direct `storeWikiPage` call is REMOVED (it would double-embed). The stance-alignment `projection` is not lost by this: `storeWikiPage` writes principle-payload fields only for `pageKind === "principle"`, so the projection is dropped by the embed regardless of caller — its durable home is the Postgres dimension column via the `saveWikiOverlayEdit` upsert, untouched.
- `stance-confirm.ts` — this path uses `upsertWikiPage` directly (NOT `saveWikiOverlayEdit`), so it is a genuinely separate write path and keeps its own `storeWikiPage` call; its silent `catch {}` is converted to the same LOUD, greppable `EMBED-SKIPPED` / `EMBED-FAILED` marker.
**Verify:** unit test `embed-published-overlay.test.ts` — warm embedder → `storeWikiPage` called with the right payload, returns embedded; embedder cold (`generateEmbedding` → null) → returns `{embedded:false}` and logs the marker, does not throw. Action-level: `wiki-edit.test.ts` asserts publishing a `stance` page invokes the embed seam.

### Phase 2 — Coverage-gap mode on the reconciler + wire into upgrade boot
**Deliverable:**
- `scripts/portal-migrate-boot.sh` — after catalog-capability reconciliation and before `exec "$@"`, add a **non-fatal** step running `reembed-wiki-store.ts`. On failure: `WARN` and continue (matches the model-catalog precedent — embedding-provider unavailability must not crash-loop the portal). *No new flag needed:* `reconcilePublishedWikiEmbeddings` is ALREADY coverage-gap-based (it computes `missing = published − present-in-vector-store` and embeds only the gap), so the existing script is a cheap no-op once coverage is complete and keeps its fail-loud provider precondition. **Full-corpus coverage (review S1):** the reconciler's page limit was an unraisable `Math.min(…, 500)` cap — as the fleet self-heal that would embed only an arbitrary 500-page subset on large installs and could permanently skip the unembedded stance. The cap is made raisable (default 500 for the fire-and-forget recall path), the maintainer/boot script passes a full-corpus limit, ordering is `updatedAt desc` so recent publishes win, and the point scan is scaled to the page limit.
**Verify:** `--dry-run --missing-only` on a seeded corpus reports the gap count without embedding. Boot-script unit test (`portal-migrate-boot` harness, `DPF_APP_DIR` + fake `pnpm`) asserts the reembed step runs and a non-zero exit only WARNs (boot still `exec`s). Functional: on the live install, publish a stance via the generic editor → confirm a new `vector_embedding` row + `wiki_query` returns it (the BI's dogfood AC).

### Phase 3 — Governance UI coverage indicator
**Deliverable:** `/coworker-decisions` surfaces embedded-vs-published for org-overlay stance/overlay pages (e.g. "23 published · 22 embedded · 1 pending"), driven by a read helper (`overlay-embedding-coverage.ts`) that counts published overlay pages vs their `vector_embedding` rows. A page that is published-but-unembedded is visibly flagged so ACTIVE cannot overstate readiness.
**Verify:** read-helper unit test (published vs embedded counts). Route render check via the contributor preview: the indicator shows the real gap before self-heal and closes to full after a reembed.

---

## Backlog coverage

- **Decision:** `atomic` — the write-path embed seam, the upgrade-time self-heal, and the coverage surfacing are one indivisible fix for a single defect. The write-path fix alone stops NEW gaps but leaves every existing install's unembedded pages dark; the reconcile alone heals history but lets new publishes re-open the gap; the UI indicator is meaningless without both. No phase is independently shippable as a fix to BI-D4C1E05E.
- **Parent BI:** BI-D4C1E05E
- **Receipt:** `cmstr1scj020n01qxgkrwzas7` (atomic; recorded 2026-08-15 via `record_plan_backlog_coverage`).

## Risks & rollback

- **Blast radius:** all publish paths for org-overlay pages, plus every portal boot. Mitigated: embed is best-effort-but-loud (never rolls back a publish, never crash-loops boot); the boot step is non-fatal; `--missing-only` is a cheap no-op when covered.
- **Embedder-down at publish:** page publishes, embed logs the loud marker, and the next boot's `--missing-only` reconcile (or a manual full reembed) closes the gap — the self-heal is the backstop, exactly as designed.
- **Re-embed cost on boot:** bounded by `--missing-only` (only the gap); full corpus re-embed stays an explicit maintainer command.
- **Rollback:** revert the boot-script line (self-heal off; write-path fix still stands) and/or the write-path wiring (reverts to prior behaviour) independently. No schema migration, so no data rollback needed.

## Definition of done (BI acceptance criteria)

- [ ] Publishing/saving any overlay page embeds it — new `vector_embedding` row + surfaces in `wiki_query`.
- [ ] Reembed coverage reconcile runs in the upgrade sequence, idempotently, self-healing pre-existing gaps.
- [ ] Reconcile stays self-verifying: numeric coverage, fails loud when the embedder is unavailable, never silent.
- [ ] Governance UI shows embedding coverage (embedded vs published).
- [ ] Regression test: write-path with embedder warm → embedded; cold → loud, never silently dropped.
- [ ] The operator's own (customer 0) `how-do-we-manage-…` stance becomes retrievable via this pipeline on next upgrade (dogfood), not a manual one-off.
