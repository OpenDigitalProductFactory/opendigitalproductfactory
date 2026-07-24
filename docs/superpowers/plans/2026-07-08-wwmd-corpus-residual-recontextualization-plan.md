# WWMD Corpus — Residual Recontextualization: Review & Plan

**Date:** 2026-07-08
**Scope:** The founder-kernel WWMD corpus under `docs/founder-kernel/wiki/` — finish the ServiceNow/EA → DPF recontextualization the prior pass (PRs #2591, #2623) left uneven. WWWD (per-org overlay at onboarding) is explicitly **out of scope for this pass** — deferred follow-on per the operator's "do this for WWMD for now."
**Status:** Review + plan. Not yet a filed BI. §5 covers filing/execution.
**Supersedes:** [2026-07-04-wwmd-corpus-recontextualization-plan.md](2026-07-04-wwmd-corpus-recontextualization-plan.md) — that plan predates the two merges; this one is re-grounded against current `origin/main`.

---

## 0. The reframe (read this first)

The `/wiki` screenshot that triggered this shows the **stale live portal**, not un-done work. The live install only updates via self-upgrade, and it is behind `origin/main`. On `origin/main` the two genuinely ServiceNow-narrow stances are **already rewritten**:

| Live portal (stale) shows | `origin/main` actually says |
|---|---|
| "Don't integrate a third-party EA platform with ServiceNow…" | **"Consolidate on one canonical data model — don't integrate two systems of record"** — ServiceNow demoted to an explicit `### The war-story` subsection; body opens "This is the conviction DPF is built on." |
| "EA is meteorology — provide forecasts, not raw models" | **"Deliver forecasts, not raw models"** — body reframed around WWMD/WWWD/WSID as "forecast questions" and "how every coworker reports to an operator." |

So the first action is **not** authoring — it's recognizing that a self-upgrade will make the live surface match main for those two. The prior pass was real and good on those two.

**But it was uneven.** A cluster of pages still teaches in pure EA-consultant terms with zero DPF tie-in. That residual is this plan.

## 1. Evidence — where ServiceNow framing still dominates the *body*

Measured on `origin/main` (body mentions of ServiceNow/CMDB/executive/pitch/briefing/engagement, excluding `sources:` and cited raw-source links, vs. count of DPF/coworker/operator refs):

| Page | SN-terms | DPF-refs | Verdict |
|---|---|---|---|
| `stances/it4it-is-substrate` | 3 | **0** | ❌ **Pure consultant voice** — "I pitch it as a framework for managing IT," "100+ engagements since 2013," executive-sponsor briefings. No DPF tie-in at all. **The clear miss.** |
| `stances/trust-the-cmdb-or-rebuild-it` | 9 | 1 | ⚠️ Has one good "generalises past the CMDB → DPF's own model" paragraph, but title, abstract, and the whole "Why" still lead CMDB/ServiceNow-first. |
| `heuristics/pitch-simple-adjust-per-audience` | 4 | 0 | ⚠️ Executive-pitch / federal-CIO / FITARA tactic. Never mentions a coworker adjusting framing for an operator. |
| `heuristics/find-at-least-one-champion` | 3 | 0 | ⚠️ Human change-management tactic (hand out the printed IT4IT book). Genuinely human — re-scope, don't over-DPF-ify. |
| `heuristics/auto-populate-or-its-wrong` | 5 | 1 | 🟡 Already has a DPF paragraph; only the lead is CMDB-first. Light tightening. |
| `entities/csdm` | — | 2 | 🟡 Already has a "How DPF uses it" section mapping to Prisma `DigitalProduct`/`Portfolio`/`Service`. Reasonable; optional reframe only. |
| `stances/digital-product-is-the-unit-of-organization` | 1 | 0 | 🟡 Already the canonical DPF primitive; body's 25-yr Dell/Troux/HPE/SN arc is legit *provenance*. Leave, or one-line DPF anchor. |

**False positives (do not touch):** `principles/consult-scopes-before-asking`, `consult-specs-first` — "consult" = "consult scopes/specs" (DPF engineering doctrine), not "consultant." `trust-the-data-spine` — already the genericized DPF sibling. These are clean; the earlier "0 of 92 principles are SN-narrow" verdict holds.

## 2. The distilled vector (unchanged from prior pass — restated so authoring stays on-target)

> **Product-centric, one cohesive data model, and — in the age of agentic AI — the deliverable is guidance and action on the *whole*, not reports, diagrams, or integrations between silos.**

The two exemplars remain the templates:
- **Genericize** → [principles/optimize-for-the-whole.md](../../founder-kernel/wiki/principles/optimize-for-the-whole.md): lift the lesson to a substrate-agnostic rule; ServiceNow becomes *one example*.
- **Contextualize** → [principles/native-cohesion-over-interfacing.md](../../professions/data-architect/wiki/native-cohesion-over-interfacing.md): rewrite the primary example in DPF terms; keep the SN origin as cited provenance.

The already-done `dont-integrate-ea-platform` and `ea-is-meteorology` are now *also* reference-quality exemplars — mirror their structure (generic Position → DPF anchor → SN kept as `### The war-story`).

## 3. Per-page disposition (residual only)

| Page | Disposition | Concrete change |
|---|---|---|
| **`stances/it4it-is-substrate`** | **Contextualize (primary work item)** | IT4IT genuinely *is* DPF's operating-model spine — its seven value streams (Evaluate…Consume) already route the platform. Add a "How DPF uses it" section that says so (tie to the value-stream routing that exists in the platform). Move the "I pitch it as…" / executive-briefing content **out** of the stance and into `pitch-simple-adjust-per-audience` where a pitch tactic belongs. Keep the 100+-engagements line only as first-person provenance, demoted below the DPF framing. |
| **`stances/trust-the-cmdb-or-rebuild-it`** | **Contextualize** | Retitle away from "CMDB" → the trusted **data spine** (align with existing `principles/trust-the-data-spine`). Lead with the generic three-pillar rule (Ingestion / Insight / Governance); demote the ServiceNow TPM/CSDM origin to a war-story block. Promote the existing "every WWMD/WWWD/WSID recommendation inherits the lie if the spine is untrusted" paragraph to the top of "Why." Keep slug stable (retitle via frontmatter only — ~160 inbound wikilinks). |
| **`heuristics/pitch-simple-adjust-per-audience`** | **Genericize** | Recast as: a coworker leads with the simplest framing the *operator* can ingest and adjusts per audience — the persona/voice rule. Absorb the IT4IT executive-pitch example relocated from `it4it-is-substrate` as *one* illustration, not the subject. |
| **`heuristics/find-at-least-one-champion`** | **Keep, re-scope (light)** | Genuinely a human change-management tactic. Scope it to the `human`/onboarding population; add one line that in a DPF adoption the "champion" is the operator who actually starts using a coworker. Do **not** force-fit an agent framing. |
| **`heuristics/auto-populate-or-its-wrong`** | **Genericize (light)** | Already 80% there. Flip the lead from CMDB-first to "any record a coworker recalls from"; keep the CMDB as the ITSM instance. |
| `entities/csdm` | **Optional** | Already contextualized. Only touch if we reframe the title to "DPF's canonical data model (CSDM-lineage)"; otherwise leave. Low value. |
| `stances/digital-product-is-the-unit-of-organization` | **Optional** | Leave, or add a single sentence anchoring to the Prisma `DigitalProduct` row as the canonical primitive. Provenance arc is fine as-is. |

## 4. Hard authoring constraints (verified against SCHEMA.md / AUTHORING.md and the prior pass)

1. **`raw-sources/` is immutable.** The ServiceNow origin stays *cited*; it just stops being the *frame*.
2. **Slugs are stable.** Retitle via frontmatter `title:` only — never rename a file. `dangling-xref` is publish-blocking, and there are ~160 inbound `[[wikilinks]]`.
3. **Corpus conventions:** wrap wikilinks in backticks `` `[[slug]]` `` (renderer keys on the code-span form); HTML-encode apostrophes as `&#39;`. Match the existing files or a reviewer flags inconsistency.
4. **Voice:** stances stay first-person "Mark" (SCHEMA §8); heuristics/principles neutral.
5. **The golden-decisions gate (CI "Decision Baseline", `apps/web/lib/decision/golden-decisions.test.ts`) fires ONLY on `principle`-page `principleDimensionVector` edits.** **This residual pass touches only stances, heuristics, and one entity — zero principle-vector edits — so the gate does not apply.** (If we later touch `one-data-model` examples, it does; not in this scope.)
6. Bump `manifest.json` `kernelVersion` per content batch (`pageCount` only for genuinely new pages — none here). Embeddings regen is deploy-time, not CI.

## 5. Execution (phased, one PR per phase, DCO-signed, babysat to green)

**Phase 0 — File the work.** Open a `doc`/content BI under the decision-governance epic **EP-0AF96937** (`dpf-file-backlog-item`). Small scope — a single BI covering the residual is right; no new epic.

**Phase 1 — The one clear miss.** `it4it-is-substrate` contextualize + relocate its pitch content into `pitch-simple-adjust-per-audience`. Highest value; these two move together (content leaves one, lands in the other). No principle vectors.

**Phase 2 — Data-spine retitle.** `trust-the-cmdb-or-rebuild-it` (retitle + reframe) + `auto-populate-or-its-wrong` lead-flip. Verify no `[[stances/trust-the-cmdb-or-rebuild-it]]` inbound link breaks (slug unchanged; only title changes).

**Phase 3 — Adoption heuristic re-scope + optional tidy.** `find-at-least-one-champion` re-scope; optionally `csdm` / `digital-product-is-the-unit-of-organization` one-liners if we decide they're worth it (defer if not).

**Per phase — rebuild & verify:**
1. Re-seed: `pnpm --filter @dpf/db exec tsx packages/db/src/seed.ts` (idempotent; advances revision only on body change).
2. Bump `manifest.json` `kernelVersion`.
3. Lint: `wiki_lint` MCP tool / `/admin/wiki/lint` — clear `dangling-xref` (blocking), check `orphan`/`stale`.
4. Confirm a coworker retrieval surfaces the rewritten page (`dpf-verify-on-live-install`) — deferred to operator on live, since live only updates via self-upgrade.
5. **No golden-decisions run needed** (no principle edits) — see §4.6.

## 6. WWWD — the deferred parallel (noted, not this pass)

The operator flagged the same treatment "when a new company installs and onboards." That is the org-overlay layer: per-org `WikiPage` rows (`organizationId != null`), authored via the "How your business decides" surface, **empty on a fresh single-tenant install**. The bridge is already in place: the merged `contextualize-dont-transform` rewrite frames onboarding as "map the new company's operating model into DPF before transforming it" — that map *becomes* the org's WWWD overlay. Treat WWWD as a separate thread: a seed-at-onboarding starter set of business stances + an elicitation flow (`dpf-elicit-tacit-knowledge`), planned once this residual WWMD pass lands. See `[[wwwd-corpus-lever-is-org-wikipages]]`.

## 7. Bottom line

- **Not** "the corpus is still all ServiceNow" — the live surface is stale; a self-upgrade fixes the two headline stances.
- The **real residual** is ~4 pages, led by `it4it-is-substrate` (the only page with *zero* DPF tie-in) and the CMDB→data-spine retitle.
- Zero principle-vector edits → **no decision-baseline risk**, low-blast-radius, ~1–2 small PRs.
