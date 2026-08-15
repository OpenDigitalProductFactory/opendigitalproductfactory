# Plan — Proactive, permissioned CRM enrichment

Date: 2026-08-14. BI: BI-B2497DFB. Composes with BI-6D10EB1F (CI/market-research),
BI-2D435AFC (v1 own-website enrichment), EP-1C37C089 (consequential-tool governance gate).

## Why

When a new prospect/account/contact is created with scant detail, the coworker should not
silently store the thin record (nor fabricate). It should recognize the gaps, proactively
OFFER to enrich from public sources, ASK permission + CONFIRM scope, research, and write the
augmented fields back **with provenance and no fabrication** — the proactivity setting made
concrete for the CRM intake path. The owner demonstrated the behavior by hand
(Greg Torosian → TeamLogic IT of Round Rock, account `ACCT-F6AF3F95`); the build must
reproduce it natively.

## Substrate this builds on (verified 2026-08-14)

- **Enrichment v1** — `apps/web/lib/mdm/enrichment.ts` `proposeAccountEnrichment` fetches the
  account's OWN stored website and files an `MdmStewardTask`; the load-bearing invariant is
  **propose-to-steward-queue, never direct-write; a human applies**. Surfaced as MCP
  `enrich_customer_account` (grant `web_search`). Gap: resolving a stale task only touches
  `updatedAt` — **no path writes suggested values back to the record**. This plan adds that
  apply-with-provenance-and-diff.
- **Proactivity** — `apps/web/lib/proactivity/`: `resolveProactivityPlan({activityFamily})`
  → `ProactivityPlan{ actionBoundary, maxAttempts, suggestionSuppressed, … }`. Levels are
  `quiet | balanced | assertive` (the BI's "proactive" = `assertive`). `quiet` →
  `actionBoundary:"advise"`, `maxAttempts:0` = silent. Read per turn via
  `getCoworkerProactivityPreference(agentId)`.
- **CRM** — `CustomerAccount` / `CustomerContact` (`packages/db/prisma/schema.prisma`).
  Provenance via `registerCustomerAccountSource({sourceSystem:"coworker-tool"})`
  (`apps/web/lib/mdm/crosswalk.ts`) → `MasterDataSourceRef`.
- **Governance** — every consequential write routes through `governedExecuteTool`
  (`apps/web/lib/mcp-governed-execute.ts`): user-cap → agent-grant → coworker authority
  (allow / deny / require-approval envelope) → audit/receipt. EP-1C37C089 is the future
  unifier (spec only, unmerged); `governedExecuteTool` is today's enforcement path.
- **Web research** — public-web-design pack: `search_public_web`, `fetch_public_website`,
  `analyze_public_website_branding` (grant `web_search`, `requiresExternalAccess`). These are
  the coworker's multi-source research surface; each records `recordExternalEvidence`.
- **Steward queue** — `MdmStewardTask` (kind is a free String; code comments already
  anticipate a single-record `enrichment` kind). No new Prisma model → no migration cascade.

## Scope (one PR)

New module `apps/web/lib/crm/enrichment/` (deterministic, DB-free cores + thin service):

1. `types.ts` — `EnrichmentField`, `EnrichmentFinding{field,value,source,sourceRef,confidence}`,
   `EnrichmentSourceKind` (`website|linkedin|web-search`), `CompletenessResult`,
   `EnrichmentScope{sources,fields}`, `EnrichmentOffer`, `EnrichmentProposal`.
2. `completeness.ts` — `scoreAccountCompleteness` / `scoreContactCompleteness` →
   `{score, filled, missing, belowThreshold}` with a threshold constant. **(AC1, AC5 basis)**
3. `no-fabrication.ts` — `isMaterializableValue(field,value)`: rejects masked/placeholder
   values (email `g***@…`, `x***`, `redacted`, empty). The AC4 heart. **(AC4)**
4. `enrichment-proposal.ts` — pure `buildEnrichmentProposal({record, findings, scope,
   proactivity})`: drop findings failing the no-fab guard, keep only findings inside the
   confirmed scope, compute the scant→enriched diff, attach per-field provenance, split
   remaining requested-but-unfound fields into `unresolvedGaps` (confirm-what's-needed).
   **(AC3, AC5, AC6)**
5. `enrichment-offer.ts` — `buildEnrichmentOffer({recordKind, completeness, plan})` →
   `EnrichmentOffer | null`; returns `null` (suppressed) when the plan is `advise`/quiet or the
   record is complete; names the sources + fields it would touch. **(AC1, AC2, AC8)**
6. `enrichment-service.ts` — prisma: `fileEnrichmentProposal` (upsert `MdmStewardTask`
   kind `enrichment`, structured `reasons`), and `applyEnrichmentProposal(taskId, {resolvedBy})`
   which writes accepted fields to the record, registers provenance
   (`sourceSystem:"coworker-tool"`), records the diff on the account activity timeline, and
   resolves the task `resolved_enriched`. **(AC5, AC7)**

Wiring:

7. `proactivity-types.ts` + `proactivity-resolver.ts` — add `crm-record-enrichment` family
   (balanced default; explanation). **(AC8)**
8. `apps/web/lib/mdm/steward.ts` — `StewardTaskKind` += `enrichment`; `StewardResolution`
   += `resolved_enriched`.
9. New pack `apps/web/lib/mcp/packs/crm-enrichment-pack.ts`: `propose_crm_enrichment`
   (grant `web_search`,`crm_read`; fetches own website + accepts coworker-gathered findings
   for linkedin/web-search, builds + files the governed proposal, returns the diff +
   confirm-gaps) and `apply_crm_enrichment` (grant `crm_write`; applies an approved proposal).
   Register in `pack-registry.ts`; add `TOOL_TO_GRANTS` entries in `agent-grants.ts`. **(AC2, AC7)**
10. `crm-sales-pipeline-pack.ts` / `crm-contacts-pack.ts` — additive `enrichmentOffer` in the
    create-tool success `data` so the coworker sees the offer immediately post-create. **(AC1)**

## Acceptance-criteria → artifact map

- AC1 gap detection / silent-at-quiet → `completeness.ts` + `enrichment-offer.ts` + create-handler offer.
- AC2 permission + scope confirm → `EnrichmentScope`; `propose_crm_enrichment` only touches
  scoped sources/fields; write requires the separate approved `apply_crm_enrichment`.
- AC3 multi-source + provenance → `EnrichmentFinding.source/sourceRef`; own-website fetch +
  coworker web-research findings; `registerCustomerAccountSource`.
- AC4 no-fabrication → `no-fabrication.ts` + masked-email regression test.
- AC5 intake correction + visible diff → proposal diff + steward task `reasons` + apply timeline note.
- AC6 confirm-what's-needed → `unresolvedGaps` surfaced in tool result + steward task.
- AC7 governed write-back → `apply_crm_enrichment` routes through `governedExecuteTool` (crm_write);
  provenance audited.
- AC8 proactivity binding → `crm-record-enrichment` family; offer eagerness follows the level end-to-end.

## Non-goals

- Live crawling of LinkedIn/search inside the tool: the coworker gathers findings with its
  granted `search_public_web`/`fetch_public_website` tools and hands structured findings to
  `propose_crm_enrichment`; the tool owns the governed write, not the crawl.
- New admin UI apply button (apply is exposed as the governed MCP tool for this slice).
- The EP-1C37C089 unified constitutional gate (separate epic); this routes through the
  existing `governedExecuteTool` authority path.

## Verification

Unit tests per module (completeness, no-fabrication incl. masked-email regression, proposal
builder, offer suppression by proactivity level, service apply with mocked prisma) + proactivity
resolver family test. `tsc` + vitest green on touched files; local merged-CI gate before push;
DCO PR against origin/main.
