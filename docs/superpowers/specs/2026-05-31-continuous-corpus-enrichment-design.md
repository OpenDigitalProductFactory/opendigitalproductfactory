# Design: Onboarding-seeded, continuously enriched org WWWD corpus

> **Amended 2026-07-23** by [`2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md`](2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md).
> The confirmation ladder defined here (unconfirmed/confirmed/ruled) is extended there from *material authority* to *dimension weight* — reuse of this mechanism, not a second authority model.

- **Epic:** EP-CORPUS-BOOTSTRAP
- **Status:** DRAFT - founder review before execution
- **Date:** 2026-05-31
- **Architectural review:** 2026-05-31, Codex chief-architect pass
- **Author:** Claude (Opus) with founder (Mark), revised by Codex
- **Builds on:** PR #1360 (mission capture + WWWD seeding), PR #1369 (decision-skill + archetype-seed enrichment)
- **Related backlog:** BI-7C9D6198, BI-C97C0873, BI-34936764, BI-8A58C65A, BI-846C297F, BI-DFE51858, BI-741B6329, BI-06B2EC05, BI-230C9EF7
- **Related specs/docs:** [Decision Perspective & Persona Voice](../../user-guide/ai-workforce/decision-perspective.md), [Platform Kernel Wiki](2026-05-09-platform-kernel-wiki-design.md), [Principles as Wiki Kind](2026-05-12-principles-as-wiki-kind-design.md)

## Architecture review summary

This design is architecturally aligned if the "corpus enrichment pipeline" is treated as a thin facade over the existing wiki and decision-perspective substrate, not as a new corpus store.

The canonical stores already exist:

- `RawSource` is the source/provenance anchor.
- `WikiPage` and `WikiPageRevision` are the human-readable org-overlay corpus.
- `WikiPageSource` links corpus pages to their sources.
- `WikiIngestEvent` is the append-only ingest audit trail.
- `DecisionPerspectiveProfile`, `DecisionPerspectiveProfileVersion`, and `PerspectiveMaterial` are the decision-gate material projection.
- `storeWikiPage` embeds published/draft-eligible pages for recall.
- `recallWikiContext` is the current conversational WWWD lever.
- `resolveProfileMaterial` exposes the decision-gate coverage-gap signal.

The main architectural correction is that intake origin is not the same thing as `RawSource.sourceType`. The live `RawSource.sourceType` registry is `paper | article | spec | doc | framework | external-url`. Intake origins such as `data-entry`, `qa`, `integration`, `research`, and `gap-detection` belong in `RawSource.locator`, `PerspectiveMaterial.sourceRef`, and ingest telemetry, unless the registry is deliberately expanded in the same implementation PR.

## 1. Context and problem

After PR #1360 and PR #1369, a fresh install completes onboarding with a seeded per-org WWWD ("What Would We Do") corpus: a company mission, an organization `DecisionPerspectiveProfile`, and a small set of archetype-aware org-overlay wiki pages. That is a strong first enrichment, but it is still a one-time event driven mostly by the business-context form.

The founder's intent is broader: onboarding should richly define, clarify, and capture the business from multiple sources:

- structured setup fields
- coworker/operator Q&A
- uploaded documentation such as a business plan
- AI-coworker research
- data from tools the company already uses, such as QuickBooks suppliers
- coverage gaps discovered during real usage

The problem this design solves: many heterogeneous sources arrive at many different times. They must all enrich one governed per-org corpus in a trustworthy, reviewable, idempotent, non-duplicating way.

## 2. Goals and non-goals

### Goals

- One governed `enrichOrgCorpus(input)` contract every source feeds, during onboarding and afterward.
- Continuous enrichment triggered by context that is provided, noticed, or needed.
- Provenance, evidence grading, human review of low-trust material, freshness, staleness, deduplication, and supersession.
- Maximum reuse of `RawSource`, `WikiPage`, `PerspectiveMaterial`, and existing queue/review infrastructure.
- Clear separation between first-party business facts, derived document extraction, and AI/web research.

### Non-goals

- Replacing external tools such as QuickBooks with native DPF functionality. That is a downstream product north star.
- Building the org-profile resolution entry point consumed by Build Studio. That is BI-230C9EF7.
- Re-architecting WWMD/kernel doctrine. This epic is organization/WWWD-scoped.
- Creating a new corpus table, vector store, or knowledge model parallel to WikiPage.
- Promoting AI-researched claims into authoritative org doctrine without human review.

## 3. Standards and governance posture

This design adopts three standards signals:

- [W3C PROV](https://www.w3.org/TR/prov-primer/) models provenance around entities, activities, and agents. DPF maps those to `RawSource`/`WikiPage`, `WikiIngestEvent`, and `userId`/`agentId`.
- [NIST AI RMF Generative AI Profile 600-1](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) emphasizes lifecycle risk management, provenance, evaluation, and trustworthy generative AI operations.
- [ISO/IEC 42001:2023](https://www.iso.org/standard/42001) frames AI governance as an AI management system with documented processes, risk management, traceability, transparency, and continuous improvement.

DPF implication: enrichment is not "memory." It is governed knowledge acquisition. Every promoted material must answer: what source produced it, what process transformed it, who or what initiated it, what confidence/trust class it has, and whether it has been reviewed.

## 4. Architectural spine

```
SOURCES: context is provided, noticed, or needed

  data entry     Q&A         documents       research        integrations       gaps
      \           |             |              |                |               /
       \          |             |              |                |              /
        ---------------- normalize to EnrichmentInput -----------------------
                                      |
                                      v
                         enrichOrgCorpus(input)
                                      |
                   upsert RawSource + WikiIngestEvent
                                      |
                         proposeWikiDiff / adapters
                                      |
              route by trust, confidence, and source origin
                    |                                   |
                    v                                   v
          publish/promote when safe              draft/review queue
                    |                                   |
                    -------- WikiPage + revision --------
                                      |
                         PerspectiveMaterial projection
                                      |
                          storeWikiPage embedding
                                      |
             recallWikiContext / Decision Perspective Gate
                                      |
                       coverage gap or stale material
                                      |
                         enqueue enrichment work
```

The spine has three clusters:

1. **Pipeline contract:** BI-7C9D6198 adds the `enrichOrgCorpus(input)` facade, text/buffer ingest, idempotency, and material projection.
2. **Source adapters:** BI-C97C0873, BI-34936764, BI-8A58C65A, BI-846C297F, and BI-DFE51858 normalize each feeder into the contract.
3. **Continuous loop and governance:** BI-741B6329 wires triggers/gap detection, and BI-06B2EC05 hardens provenance, review routing, freshness, deduplication, and supersession.

## 5. Enrichment contract

```ts
type EnrichmentOrigin =
  | "data-entry"
  | "qa"
  | "document"
  | "research"
  | "integration"
  | "gap-detection"
  | "scheduled-refresh";

type EnrichmentTrust = "first-party" | "derived" | "researched" | "system-inferred";

type EnrichmentInput = {
  organizationId: string;
  text: string;
  origin: EnrichmentOrigin;
  trust: EnrichmentTrust;
  title: string;
  source: {
    // Must map to the existing RawSource registry unless that registry is
    // intentionally expanded in the same implementation PR.
    rawSourceType: "doc" | "external-url" | "article" | "spec" | "framework" | "paper";
    sourceKey: string; // deterministic, org-prefixed, globally unique
    sourceRef: Record<string, unknown>;
    url?: string | null;
    retrievedAt?: Date | null;
    license?: string | null;
  };
  requestedPageKinds?: ("stance" | "heuristic" | "principle" | "summary")[];
  actor?: {
    userId?: string | null;
    agentId?: string | null;
  };
  routeContext?: string | null;
};

type EnrichmentDisposition = "published" | "draft" | "skipped" | "text-only-source";

async function enrichOrgCorpus(input: EnrichmentInput): Promise<{
  rawSourceId: string;
  ingestEventId: string;
  disposition: EnrichmentDisposition;
  pageIds: string[];
  materialIds: string[];
  supersededMaterialIds: string[];
  warnings: string[];
}>;
```

### Source-key contract

`RawSource.sourceKey` is globally unique, not scoped by organization. Every org-scoped enrichment source must use a deterministic org-prefixed key:

```ts
org/${organizationId}/${origin}/${stableSourceFingerprint}
```

Examples:

- `org/org_123/data-entry/business-context:v3`
- `org/org_123/document/doc_abc/version_2`
- `org/org_123/research/market-sizing:2026-05-31:hvac-austin`
- `org/org_123/gap-detection/sha256:<normalized-question>`

This prevents cross-org collisions and makes re-ingest idempotent.

## 6. Routing policy

**DECISION (2026-05-31, founder): draft by default so we can review.** Every `enrichOrgCorpus` output starts as `draft` / `candidate` for human review — including first-party field edits and Q&A. The **only** auto-publish path is the initial onboarding seed (the bootstrap in `seed-org-wwwd-corpus.ts`, which remains `published`/`approved`/`promoted`). Evidence grades still differ by source (below) for weighting, but review/promotion is a human action until the review UX has earned trust. Revisit then.

| Origin/trust | Default disposition | Evidence grade | Review status | Promotion state |
| --- | --- | --- | --- | --- |
| Initial onboarding seed (bootstrap) | Published | A or B | approved | promoted |
| First-party setup field (later edit) | Draft for review | A or B | draft | candidate |
| First-party Q&A answer | Draft for review | B | draft | candidate |
| Uploaded document extraction | Draft by default; publish only high-confidence narrow claims | B or C | draft unless reviewed | candidate |
| AI/web research | Always draft | C | draft | candidate |
| Integration import summary | Draft until import batch review is accepted | B or C | draft | candidate |
| Gap-detection task | Draft prompt/task first; material only after answer/research | C until reviewed | draft | candidate |
| Scheduled refresh | Preserve current material until replacement is reviewed | same or lower | draft for changes | candidate |

The word "commit" must not mean "make authoritative." It means "persist the proposal into the corpus substrate." Authority is the combination of `WikiPage.status = published`, `PerspectiveMaterial.reviewStatus = approved`, and `PerspectiveMaterial.promotionState = promoted`.

## 7. Reuse map

| Need | Reuse | Gap to build |
| --- | --- | --- |
| Text/source ingest | `RawSource`, `WikiIngestEvent`, `upsertRawSource`, `recordIngestEvent` | Add text/buffer ingest; current `ingestRawSourceFromFile` is allow-listed filesystem only |
| Extraction/proposal | `proposeWikiDiff` | Let adapters provide already-normalized text without writing temporary files |
| Wiki persistence | `commitIngestProposal`, `WikiPage`, `WikiPageRevision`, `WikiPageSource` | Disposition-aware status handling and/or wrapper logic for published vs draft |
| Embeddings | `storeWikiPage` | Ensure draft/published policy matches recall requirements; fail open |
| Org seed pattern | `seed-org-wwwd-corpus.ts` | Generalize material projection beyond initial v1 seed |
| Profile material | `DecisionPerspectiveProfile`, `DecisionPerspectiveProfileVersion`, `PerspectiveMaterial` | Version-bump policy and candidate-vs-promoted material handling |
| Review | `WikiPage.status`, draft overlay review paths, wiki MCP tools | Route low-trust material into the existing review surface |
| Gap signal | `resolveProfileMaterial.coverageGap`, `recallWikiContext` null result | Noise controls, dedup, and org-scoped enrichment task enqueue |
| External import | `IntegrationCredential`, `IntegrationImportBatch`, staged records, `Supplier`/`Bill`/`PurchaseOrder` | Real QuickBooks connector plus review/dedup mapping |
| Async work | `apps/web/lib/queue/*` | Use existing jobs first; add an `EnrichmentTask` row only if queue payloads cannot support idempotency and review UX |

## 8. Material projection and version policy

Wiki pages are the editable source of truth for the org corpus. `PerspectiveMaterial` is the decision-gate projection of reviewed/published content.

Policy:

- Draft wiki pages may create candidate `PerspectiveMaterial` rows only if a review surface needs to preview decision impact.
- Only published/approved material can be `promotionState = promoted`.
- The org profile's `currentVersionId` should advance when promoted material changes in a way that affects decision behavior.
- Minor copy-only wiki edits can append a `WikiPageRevision` without bumping the decision profile version.
- Material fingerprints should be deterministic over promoted material IDs and content summaries, not over draft proposals.
- Superseded materials remain queryable for audit but must not be selected by `resolveProfileMaterial`.

BI-230C9EF7 remains the separate entry point that makes Build Studio start from the per-org profile by `ownerOrganizationId`; this spec prepares the material for that resolver but does not implement the resolver.

## 9. Continuous loop

Enrichment fires when context is:

- **Provided:** setup completion, document upload, integration sync, or an operator/coworker explicitly stating a business fact.
- **Needed/noticed:** a WWWD or coworker question produces `coverageGap`, empty org recall, low confidence, or repeated fallback to platform doctrine.
- **Scheduled:** freshness jobs revalidate stale researched material and integration summaries.

Noise controls are required:

- Deduplicate by normalized question/source fingerprint.
- Coalesce repeated gap signals into one enrichment task with occurrence count.
- Suppress automatic research for sensitive domains unless the operator explicitly asks.
- Rate-limit autonomous enrichment by org and source kind.
- Never let enrichment failure block the coworker response path; enqueue and continue.

## 10. Source adapters

### Business-context fields

Use for high-confidence first-party material. Existing onboarding seed already writes mission/who-we-serve/how-we-decide. The pipeline should generalize that shape for later field edits.

### Q&A answers

Coworker-led clarification should capture the exact question, answer, actor, route context, and timestamp. Sensitive or ambiguous answers land as draft.

### Document upload

Store originals in the DMS, extract text via existing parsers, then call `enrichOrgCorpus` with `origin = "document"` and `rawSourceType = "doc"`. Large documents run async and fail open.

### AI research

Research output must cite sources and land as draft. Market size, competitor claims, and legal/regulatory claims cannot be promoted without review. Research source pages should prefer `external-url` raw sources for cited pages and link those sources to the resulting draft wiki pages.

### Archetype content

Archetype-aware enrichment is derived starter material. It can seed useful stance pages, but copy should clearly say "starting stance" until the org confirms it.

### Integrations

QuickBooks/imported provider data first lands in import staging and structured target models. The corpus receives a summarized stance only after the import batch review/dedup posture is clear.

## 11. Phased plan

| Phase | BI | Size | Rationale |
| --- | --- | --- | --- |
| 0 - shipped baseline | PR #1360 / #1369 | - | Mission capture, org WWWD seed, skill/archetype enrichment |
| 1 - pipeline backbone | BI-7C9D6198 | L | Adds `enrichOrgCorpus`, text/buffer ingest, idempotency, and material projection |
| 2 - governance hardening | BI-06B2EC05 | M | Provenance, review routing, freshness, dedup, and supersession should land before volume |
| 3 - business-plan upload | BI-C97C0873 | M | Rich first-party document source and founder's lead example |
| 4 - market/scope Q&A | BI-34936764 | M | Cheap, high-signal first-party context during onboarding |
| 5 - continuous triggers | BI-741B6329 | L | Makes the corpus grow from real use and scheduled refresh |
| 6 - AI research | BI-8A58C65A | L | Useful only once draft/review/provenance guardrails exist |
| 7 - archetype supply-chain depth | BI-846C297F | S | Small extension of the archetype seed layer |
| 8 - QuickBooks/import connector | BI-DFE51858 | XL | Largest integration and review surface; sequence last unless prioritized |

Hard prerequisites: Phase 1 before any new feeder, and Phase 2 before autonomous research or external imports. Phases 3, 4, and 7 can move earlier or later after Phase 1 depending on budget.

## 12. Open questions for founder review

1. **Review posture — DECIDED (2026-05-31, founder): draft by default.** All `enrichOrgCorpus` output starts as `draft`/`candidate` for human review; the only auto-publish path is the initial onboarding seed (the bootstrap). Revisit once the review UX has earned trust. (See §6.)
2. **Document retention:** Should uploaded business plans be retained indefinitely in the DMS, or should the org choose retention per document?
3. **Gap-detection threshold:** Should a single unanswered question enqueue work, or should the system wait for repeated misses on the same topic?
4. **Autonomous research:** Should research run only when explicitly requested, or may repeated coverage gaps trigger draft-only research automatically?
5. **Accounting connector shape:** Should BI-DFE51858 start QuickBooks-specific, or define a generic accounting-provider contract first?
6. **Structured versus narrative:** Which market/scope facts deserve structured `BusinessContext` fields, and which should remain narrative wiki material?
7. **Version bumps:** What level of material change should advance `DecisionPerspectiveProfile.currentVersionId`?

## 13. Acceptance criteria

- `enrichOrgCorpus` accepts normalized text/buffer input with deterministic org-prefixed source keys and no temporary allow-listed file workaround.
- Existing file-path wiki ingest remains intact and CodeQL-safe.
- First-party, derived, researched, integration, and gap-detection inputs route to the correct draft/published and material candidate/promoted states.
- Every material carries source provenance, evidence grade, review status, promotion state, freshness, and source reference.
- Re-ingest is idempotent and supersedes or updates prior material instead of duplicating it.
- AI research and integration-derived summaries are draft by default and source-cited.
- Coverage gaps enqueue deduplicated enrichment work without blocking coworker responses.
- Promoted material updates can advance the org profile version according to the adopted version policy.
- Tests cover source-key idempotency, trust routing, draft review routing, material projection, supersession, and coverage-gap enqueue behavior.

## 14. Reference-doc feedback

The current wiki ingest docs describe file-based raw-source ingest well, but this epic needs a documented "runtime org enrichment" pattern: text/buffer source ingest, org-prefixed `RawSource.sourceKey`, intake-origin metadata in `locator`/`sourceRef`, and candidate-vs-promoted `PerspectiveMaterial` projection. Add this to the platform wiki spec or a short companion implementation note when BI-7C9D6198 lands.
