# WWWD Corpus & Onboarding Contextualization — Review & Plan

**Date:** 2026-07-06
**BI:** BI-44526F3E (sized L, triaged build, linked to EP-0AF96937)
**Scope:** The org-level "what would WE do?" (WWWD) decision corpus — how a new company's onboarding produces it, how existing installs get it retroactively, and how coworkers' business decisions actually consult it. Companion to the WWMD recontextualization (PRs #2591/#2623).
**Status:** Executing — operator authorized full overnight execution 2026-07-06 ("execute all"). Phases A+B land together in one PR (the boot backfill runs the Phase-B generator through the shared seed chain); Phase C is its own PR. Open-question calls taken with the recommendations: backfill via boot reconcile (no extra hub button), C1 as coworker conversation, honest starter framing kept.

**Live-verification finding (post Phase A deploy):** the first backfill run on the reference install failed with a P2003 FK violation — `seedOrgWwwdCorpus` points `fallbackProfileId` at `dpf-organizational-principles`, which only ever existed as an in-code constant ([default-profile.ts](apps/web/lib/decision-perspective/default-profile.ts)); no seed materializes the row (`seed-decision-perspective.ts` creates `mark-dpf-platform` + `wsid-*` only). **This FK throw, swallowed by the fail-open completion chain, is the root cause of the WWWD substrate being dormant on every install — fresh ones included.** Fix: the seeder now upserts the fallback profile row before the org profile (same-BI follow-up PR).

**Follow-on — decision-ledger caller attribution (BI-0EEBA669, operator ask post-verification):** every ledger write now carries a `caller` block in `outcomePayload` — the client product token derived from the MCP request User-Agent (`claude-code/…`, `codex-…`, `grok-…`), the resolved auth identity (`apiTokenId`, `authSource`), and the coworker `agentId`/`threadId` when in-portal — threaded route → `ToolExecutionContext` → both ledger writers (`kernel-consult-ledger`, `org-business-gate`). `/wiki/decisions` gains a Caller column, a "Consults by caller" rollup (a client absent from the rollup never consulted the kernel — the operator's Grok question), and caller detail on the drill-in. No schema change; pre-attribution rows fall back to `callingSurface`/unattributed.

---

## 1. What WWWD actually is (verified against code + live install, 2026-07-06)

Unlike WWMD, WWWD is **not** a repo corpus. It is a **database overlay**:

- **Pages:** `WikiPage` rows with `organizationId != null`, `isKernel=false` ([schema.prisma:9812](packages/db/prisma/schema.prisma:9812), unique on `(organizationId, slug)`, optional `kernelPageId` override link).
- **Retrieval:** two-pass org→kernel search with override masking (`searchWikiPages`, [embeddings.ts:224](apps/web/lib/wiki/embeddings.ts:224)); `wiki_query` is org-aware.
- **Container:** `DecisionPerspectiveProfile` `org-perspective-<orgId>` (kind=organization) + `PerspectiveMaterial` rows linking the pages.
- **The governed door:** `evaluate_org_business_decision` ([org-business-gate.ts](apps/web/lib/decision-perspective/org-business-gate.ts), BI-230C9EF7/EP-8AF1C996) — resolves the org's own profile via `resolveOrgProfileId`, scores only its material, falls back to platform doctrine as *advisory only*, records every call to the `DecisionInteraction` ledger with `orgProfileSelected`. Coworker-reachable (grant `work_capsule_read`, baseline — [agent-grants.ts:208](apps/web/lib/tak/agent-grants.ts:208)).

**The "generic starter template" also already exists** — but as code, not docs: `seedOrgWwwdCorpus` ([seed-org-wwwd-corpus.ts](apps/web/lib/onboarding/seed-org-wwwd-corpus.ts)) runs once at setup completion ([setup-progress.ts:20](apps/web/lib/actions/setup-progress.ts:20)) and seeds **4 pages** (`org-mission` principle + `org-who-we-serve` / `org-how-we-decide` / `org-supply-chain` stances) from the captured mission + archetype-keyed boilerplate ([archetype-business-context.ts](apps/web/lib/onboarding/archetype-business-context.ts), 9 industry profiles). A continuous-enrichment façade also exists (`enrichOrgCorpus`, [enrich-org-corpus.ts](apps/web/lib/wiki/enrich-org-corpus.ts), EP-CORPUS-BOOTSTRAP) with document/market-context/research feeders wired — everything lands draft-by-default (founder decision BI-1378).

So the design question is **not** "should there be a starter corpus or an onboarding flow" — thin versions of both exist. The gaps are activation, depth, and routing.

## 2. The five verified gaps

| # | Gap | Evidence |
|---|-----|----------|
| **G1** | **Existing installs have nothing.** The seed only fires at fresh setup completion; there is no backfill/reconcile. | Live install (Arcamanus): **0** org-overlay WikiPages, **no** `org-perspective-*` profile, `BusinessContext.mission` null (psql, 2026-07-06). |
| **G2** | **The hub can't see the seeded stance.** `/wiki` counts `PerspectiveMaterial` on the hardcoded fallback `dpf-organizational-principles` (an in-code constant, not even a DB row) instead of resolving `org-perspective-<orgId>` — so "no stance of your own yet" shows even after a successful seed. Same for the WWWD open-review count. | [wiki/page.tsx:104,110](apps/web/app/(shell)/wiki/page.tsx:104); `resolveOrgProfileId` exists ([material.ts:333](apps/web/lib/decision-perspective/material.ts:333)) but the hub doesn't call it. |
| **G3** | **Coworkers are never told to use the governed door.** The `DECISION_ROUTING_BLOCK` routes business calls to "the organization's recorded stance in the context below" (prompt prose) — written before `evaluate_org_business_decision` shipped. `principle_decide` remains profile-unaware (its `governingProfile` is post-scoring metadata; scoring mixes org+kernel principles). | [decision-routing-block.ts:19-24](apps/web/lib/tak/decision-routing-block.ts:19); mcp-tools.ts `principle_decide` handler (~L13036: org from `organization.findFirst()`, no profile filter). |
| **G4** | **The seeded corpus is generic boilerplate, not the company's operating model.** Onboarding *already persists* the map the bridge stance calls for — `seedPortfolioDecomposition` (their portfolios → Portfolios), `seedMarketOffer` (what they sell → DigitalProducts), `projectArchetypeSupply` (their supply), BOM wiring — but none of it is reflected into WWWD pages the gate can cite. | [setup-progress.ts:34-41](apps/web/lib/actions/setup-progress.ts:34); `contextualize-dont-transform` (#2591): *the map becomes the org's WWWD overlay*. |
| **G5** | **No elicitation feeder.** `enrichOrgCorpus` defines a `qa` source type with zero callers; onboarding captures only mission/description/targetMarket form fields. | [enrich-org-corpus.ts:91-97](apps/web/lib/wiki/enrich-org-corpus.ts:91); callers = business-document, market-context, market-research, research-execution only. |

## 3. Decision (kernel-routed)

`principle_decide` on the three deliverable shapes — deepen-starter / elicitation-flow / **activate-then-both** — recommended **activate-then-both** (composite 9.76, margin 6.31, high confidence, no commandment conflict, structured coverage strong). Rationale echoed by the ledger: verify-substrate-first and architecture-over-shortcuts dominate; the substrate exists, so activating and grounding it beats building new surfaces first.

## 4. Design principle: the map IS the corpus

From the recontextualized bridge pages (`stances/contextualize-dont-transform`, `heuristics/contextualize-before-transforming`, #2591): onboarding maps the company's operating model into DPF's structure — their products → `DigitalProducts`, their portfolios → `Portfolios`, their tools/data → the one platform model — and **that map becomes the org's WWWD overlay**. Adoption follows the map; transformation follows adoption. Phase B operationalizes exactly this: generate WWWD pages *from* the persisted map rather than from archetype prose alone. The archetype boilerplate stays as the day-one floor (it is honest, editable starter text); the map-derived pages are the contextualization pass on top.

## 5. Phased plan

### Phase A — Activate & repair the dormant substrate (no new concepts)

1. **A1 — WWWD reconcile/backfill.** Extract an idempotent `ensureOrgWwwdSeeded(organizationId)` that runs the existing seed chain (`applyMissionPrompt` → `seedOrgWwwdCorpus` → `seedPortfolioDecomposition` → `seedMarketOffer` → `projectArchetypeSupply` → `seedRiskPosture` → `applyRiskEnvelopeToOrgProfile`) for an **already-onboarded** org, and wire it into the boot-time reconcile path (precedent: capabilityCategory reconcile). All seeds are already documented idempotent/fail-open. Existing installs (this one included) get their starter corpus on next upgrade. Guard: only when setup is complete and the org exists; never during first-run.
2. **A2 — Hub sees the org's own stance.** `/wiki` (and the WWWD discipline card inputs) resolve the profile via `resolveOrgProfileId` and count material/open reviews there, falling back to `dpf-organizational-principles` only when no org profile exists. Chip language distinguishes "starter stance seeded — review and make it yours" from genuinely empty.
3. **A3 — Route business decisions through the governed door.** Update `DECISION_ROUTING_BLOCK` + `prompts/platform-identity/decision-routing.prompt.md` (+ PromptTemplate reseed) so the ORGANIZATION'S BUSINESS CALL branch instructs: call `evaluate_org_business_decision` with the options; lead with its recommendation and whether it came from *your organization's recorded stance* vs *platform defaults* (`orgProfileSelected`). Keep the never-substitute-WWMD boundary language verbatim. `principle_decide` stays as-is (platform/WWMD surface); profile-aware re-scoring inside it stays out of scope (the retracted C2b — the gate is the door).
4. **A4 — Functional verification on the live install.** After upgrade: psql shows 4+ overlay pages + org profile; hub shows the stance; a coworker business question produces a `DecisionInteraction` row with `orgProfileSelected=true`.

### Phase B — Contextualize: generate the operating-model pages from the persisted map

1. **B1 — Map-derived page generator** (new module beside the seeder, e.g. `seed-org-operating-model-pages.ts`): reads what onboarding already persisted and writes org-overlay stances that *cite concrete nouns*:
   - `org-what-we-sell` — from the market offer / Products & Services Sold portfolio (their offerings → `DigitalProducts`).
   - `org-how-we-are-organized` — from `BusinessContext.portfolioDecomposition` (their structure → `Portfolios`, who does the work → Workforce).
   - `org-tools-and-data` — from the archetype supply projection (+ integrations when present): the "their tools → the one platform model" leg of the map.
   Each page: first-person org voice, abstract, backtick-wrapped `[[wikilinks]]` to the org's own pages and (where apt) kernel entities, `&#39;`-encoded apostrophes, stable slugs, published status (bootstrap exception, same as the existing seed), an explicit "refine as reality is captured" footer. No `principleDimensionVector`s on org pages — the golden-decisions gate fires only on principle-vector edits, and org pages ship without vectors.
2. **B2 — Wire in** after the portfolio/market seeds in `finalizeSetupCompletion` and in the A1 reconcile; regenerate only when the page body is still seed-fingerprinted (never clobber operator edits — reuse the seed's changed-body check, plus skip when a `WikiPageRevision` exists with changeKind ≠ ingest).
3. **B3 — Surface check.** `/wiki/stance` and the governing-material drill-in list the new pages; the WWWD card chip counts them. (`dpf-ux-fit-review` pass on any copy changes; no new routes.)

### Phase C — Elicit: the onboarding interview and the ask-when-silent loop

1. **C1 — Onboarding Q&A feeder.** The onboarding coworker (AGT-WS-ONBOARD persona) asks 3–5 plain-language operating-model questions ("what do you sell and to whom", "who does the work", "what systems run the business today"); each confirmed answer flows through `enrichOrgCorpus({sourceType:"qa", trust:"first-party"})` → draft pages for operator review (BI-1378 contract preserved). Conversation surface, not a new wizard step.
2. **C2 — Ask-when-silent loop.** When `evaluate_org_business_decision` defers/escalates because the org is silent (`orgProfileSelected=false` or coverage gap), the ledger row becomes a `/wiki/review` finding inviting the operator to answer the question once — the answer feeds C1's same enrichment path. This closes the loop the Decision Governance hub (EP-0AF96937) was built to host.
3. **C3 — (verify-only)** confirm the existing research/document feeders grade provenance correctly against the new pages; no new build expected.

### Out of scope (explicitly)

- Profile-aware re-scoring inside `principle_decide` (consolidation C2b was retracted 2026-05-31; the gate is the governed door).
- Multi-tenant caller→org identity (BI-EF3F4A2D) — this plan rides the single-org resolution.
- Org-scoped principle dimension vectors / golden-decision baselines.
- Editing `docs/founder-kernel/wiki/` — WWMD side is closed (#2591/#2623).

## 6. Execution & verification

- One PR per phase (A, B, C1+C2), each DCO-signed, source-local gates + CI green, ushered to merge per standing rule; live verification after self-upgrade per phase (psql + coworker drive per A4/B3/C2).
- Phase A is independently valuable and lowest-risk; B depends on A1's reconcile hook; C depends on A3's routing so elicited content is actually consulted.

## 7. Open questions for the operator

1. **Backfill trigger:** auto-run in the boot reconcile (recommended — idempotent, fail-open, this install gets fixed on next upgrade) vs. an explicit "seed my starting stance" hub button? (Both is cheap: reconcile + hub affordance for re-run.)
2. **C1 interview surface:** onboarding-coworker conversation (recommended; no new wizard surface) vs. an added setup-wizard step?
3. **Voice check:** seeded starter pages currently say "derived from how this kind of business tends to operate" — keep that honest framing on map-derived pages too, or tighten to pure first-person once operator-reviewed?
