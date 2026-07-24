# WWMD Corpus Recontextualization — Review, Plan & Phase-1 Execution

**Date:** 2026-07-04
**Scope:** The founder-kernel "what would Mark do?" (WWMD) corpus under `docs/founder-kernel/wiki/` — genericize the universally-true content, contextualize the rest to DPF, and back-propagate the distilled "vector" the newer principle work already introduced. WWWD (per-org business overlay, seeded at install/onboarding) is out of scope for this pass but shares the method — see §7.
**Status:** Phase 1 + high-value slices of Phases 2–3 **executed in this PR** (§0). Remaining phases planned, not yet built.

---

## 0. Execution status (this PR)

Lands the highest-value, lowest-risk recontextualizations and records the review that scopes the rest. **No `principle` page was edited, so the golden-decisions gate does not apply** (it triggers only on `principleDimensionVector` changes).

**Landed:**

| Page | Kind | Disposition applied |
|---|---|---|
| `stances/ea-is-meteorology` | stance | **Genericized** → "Deliver forecasts, not raw models." Reframed as the founding shape of DPF decision governance: WWMD/WWWD/WSID are forecast questions; a coworker that dumps the model instead of a scored recommendation-with-confidence made the architect's mistake. |
| `heuristics/be-a-meteorologist` | heuristic | Generalized to any coworker reporting a judgment to an operator. |
| `stances/contextualize-dont-transform` | stance | **Genericized** + "How this applies to DPF onboarding": onboarding = map the new company's operating model into DPF → that map becomes the org's WWWD overlay. |
| `heuristics/contextualize-before-transforming` | heuristic | Extended to platform onboarding / WWWD-overlay seeding. |
| `stances/dont-integrate-ea-platform` | stance | **Generalized** off ServiceNow: retitled "Consolidate on one canonical data model — don't integrate two systems of record." ServiceNow/CMDB kept as the *war-story* (disclosure preserved); DPF one-platform-model framing added. |
| `stances/trust-the-cmdb-or-rebuild-it` | stance | Surgical DPF tie: "CMDB" = the record of what you run; DPF's canonical data model is the same record, and every WWMD/WWWD/WSID recommendation is only as trustworthy as it. |
| `wiki/index.md` | index | Updated one-line descriptions for the three changed stances. |
| `manifest.json` | — | `kernelVersion` 0.4.0 → 0.4.1 (content batch; `pageCount` unchanged). |

**Reviewed and deliberately left unchanged** (already principle-level and DPF-aligned — war-stories, not ServiceNow-framed):

- `stances/digital-product-is-the-unit-of-organization` — already the DPF primitive; names "agents and AI co-workers." The model the rest should look like.
- `stances/persistent-product-teams-over-projects` — universal org/funding lesson; DPROM-grounded.
- `stances/it4it-is-substrate` — framework-integration principle; no ServiceNow.

**Conventions honoured:** slugs unchanged (inbound `[[wikilinks]]` intact); backtick-wrapped `` `[[slug]]` `` form kept; apostrophes HTML-encoded (`&#39;`) to match the corpus; `raw-sources/` untouched; every referenced wikilink and source target verified to exist.

---

## 1. What the corpus is

The founder kernel (`docs/founder-kernel/`) is the wisdom layer that ships with DPF. It seeds into `WikiPage` rows and renders as the "Governing material" drill-in on the reframed `/wiki` Decision Governance page. Authoring contract: [SCHEMA.md](../../founder-kernel/SCHEMA.md) + [AUTHORING.md](../../founder-kernel/AUTHORING.md).

Two populations mixed together: ~85 DPF-native engineering principles (**leave alone**) and Mark's EA/ServiceNow thought-leadership — 7 stances + 7 heuristics + 5 entities + 2 derived principles (**in scope**).

## 2. The core problem (confirmed)

A subset teaches genuine wisdom in ServiceNow/EA-consultant terms (employer disclosure, CMDB/CSDM/IT4IT as the frame not the example, audience = "executives in an EA engagement"). **Review finding:** less pervasive than the screenshot suggested — most stances already demote ServiceNow to war-story. The genuinely SN/EA-narrow pages were exactly two (`ea-is-meteorology`, `dont-integrate-ea-platform`), both fixed here, plus CMDB-flavoured `trust-the-cmdb` (surgically tied).

## 3. The distilled "vector" — method already proven

> **Product-centric, one cohesive data model, and — in the age of agentic AI — the deliverable is guidance and action on the *whole*, not reports, diagrams, or integrations between silos.**

Two principle pages already carry this and are the templates: [optimize-for-the-whole.md](../../founder-kernel/wiki/principles/optimize-for-the-whole.md) (genericized form) and [native-cohesion-over-interfacing.md](../../professions/data-architect/wiki/native-cohesion-over-interfacing.md) (contextualized form). The rest of the EA content had not been brought to that bar; this pass starts closing it.

## 4. Method: genericize vs contextualize (one call per page)

- **GENERICIZE** — lesson is universally true; lift it out of the ServiceNow story, demote SN to one example.
- **CONTEXTUALIZE** — lesson lands hardest as a concrete DPF instantiation; rewrite the example in DPF terms, keep the SN origin as cited provenance.

**Hard constraints:** don't touch `raw-sources/` (immutable receipts; SN origin stays cited); kernel pages are PR-only; preserve every `[[wikilink]]` (dangling = publish-blocking lint); only **principle** edits trip the golden-decisions gate (none here).

## 5. Per-page disposition — see §0 for what landed; follow-ups below

**Stances:** `trust-the-cmdb` deeper pass optional; `it4it-is-substrate` optional trim; the other four done or already-aligned.
**Heuristics (follow-up):** `reuse-the-camera-in-your-pocket`, `find-at-least-one-champion` (re-scope to human/onboarding), `pitch-simple-adjust-per-audience`, `auto-populate-or-its-wrong`, `model-what-naturally-happens`.
**Entities (follow-up):** `csdm` → reframe as "DPF's canonical data model (CSDM-lineage)"; reconcile with `entities/ea-reference-model`.
**Principles (follow-up, 2 in scope):** `one-data-model` (contextualize SN *examples*; vector unchanged but golden-decisions gate still runs since it loads the live corpus) and any principle the Phase-4 sweep surfaces.

## 6. Execution (phased)

- **Phase 1 — exemplar rewrites. DONE** (`ea-is-meteorology`+`be-a-meteorologist`, `contextualize-dont-transform`+`contextualize-before-transforming`).
- **Phase 2 — data-spine cluster.** Partially done (`trust-the-cmdb` tie + `dont-integrate-ea-platform` generalize). Remaining: `csdm`, `one-data-model` (run golden-decisions gate), `model-what-naturally-happens`, `auto-populate-or-its-wrong`, `reuse-the-camera-in-your-pocket`.
- **Phase 3 — operating-model + adoption heuristics.** `it4it-is-substrate` trim (optional); adoption heuristics re-scoped.
- **Phase 4 — principles ServiceNow sweep.** `grep -il servicenow wiki/principles/*.md`; recontextualize SN-specific examples (prose-only, but gate runs per AUTHORING §8B).
- **Phase 5 — rebuild & verify per batch.** seed → build-kernel-embeddings (deploy-time) → manifest bump → `wiki_lint` (clear dangling/orphan/stale) → golden-decisions gate **only if a principle changed** → coworker-retrieval spot-check.
- **Phase 6 — PR per phase**, DCO-signed, babysat to green. (This PR = Phase 1 + high-value Phase 2/3 slices.)

## 7. WWWD parallel (noted, not this pass)

Same treatment for the org-overlay layer (`WikiPage` rows with `organizationId != null`, authored via the "How your business decides" surface — empty on a fresh install). The `contextualize-dont-transform` rewrite here is the bridge: onboarding *is* "map the new company's operating model into DPF before transforming it," and that map *becomes* the org's WWWD overlay. Follow-on: seed-at-onboarding starter business stances + an elicitation flow (`dpf-elicit-tacit-knowledge`).

## 8. Open items

- **Voice:** stances stay first-person "Mark" (WWMD voice); principles/heuristics neutral. Applied. SCHEMA §8 agrees.
- **`csdm`/`ea-reference-model` reconciliation** (Phase 2).
- **Principle count:** confirm portal-shown extras are DPF-engineering (out of scope) — Phase-4 sweep.
