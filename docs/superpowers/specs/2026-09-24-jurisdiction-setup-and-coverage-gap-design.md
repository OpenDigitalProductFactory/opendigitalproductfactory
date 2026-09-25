---
status: draft
---

# Laws that apply: a jurisdiction setup step, cited requirements, and an honest coverage gap

**Backlog item:** BI-50DF2A92 · **Epic:** EP-AUTONOMOUS-DECIDE · **Workroom:** WC-65514CFF
**Branch:** `feat/jurisdiction-setup-and-coverage-gap`

**Founder direction (2026-09-24):** "One of the installation steps should be for the governance and compliance AI Coworker to research the laws, and ask the person setting up the instance for this material if already known. Being proactive, the suggestions to perform this research is where the platforms value of being proactive and helpful, should shine."

## 1. Problem, as measured

On this operator install (a development install running an animal rescue that operates in Texas) on 2026-09-24:

| Fact | Value |
|---|---|
| `BusinessContext.operatesIn / sellsTo / employsIn / dataResidency` | all `{}` |
| `BusinessContext.stateCode`, `geographicScope`, `complianceScopeCapturedAt` | all null |
| `Organization.address` | null |
| `PlatformSetupProgress.steps["business-context"]` | `completed` |
| `LicenseRequirementReference` rows with a `stateProvinceCode` | 0 of 19 |
| `RegulatoryAutonomyPolicy` rows | 0 |
| `Regulation` "Animal Care Facility" (`archetypes:["pet-services"], jurisdictions:["us"]`) | present, and **not applicable** here because the nexus gate finds no declared `us` footprint |

Texas is recorded nowhere. The item that asked for this design contained two premises the code contradicts, and the design depends on the corrected version.

**Correction 1: the setup step does ask.** The `business-context` step (`/storefront/settings/business`, `BusinessContextForm.tsx:619-696`) has a "Compliance & regulatory scope" section, and `app/api/business-context/setup/route.ts:80-99` writes all four arrays. It was empty here because `advanceStep` (`lib/actions/setup-progress.ts:67-110`) marks a step complete whenever Continue is pressed, whether or not anything was saved. `storefront` and `mailroom` are the only steps completed from evidence. The question existed, was skipped, and the skip was recorded as done.

**Correction 2: the regulatory gate does not pass by default. It fails closed, but for the wrong reason.** `resolveRegulatoryAutonomyCeiling` (`regulatory-ceiling.ts:83-94`) returns `propose` + `humanControlRequired` whenever no policy matches, and no policy can ever match because `RegulatoryAutonomyPolicy` has no writer. It ignores the `undeclared` flag that `regulationApplies` already computes (`packages/db/src/regulation-applicability.ts:255-272`). So the build path is blocked with `regulatory_ceiling_requires_human` on every install, and the recorded reason is "no policy matched", not "we don't know where you operate". The **corpus** path is the one that fails open: `jurisdictionEligible` (`profession-corpus.ts:207-212`) serves every jurisdiction's pages when nothing is declared.

The two paths lead to the same conclusion the item reached: an undeclared jurisdiction is indistinguishable from a declared one. One path turns ignorance into "go ahead", the other into "ask a human", and neither says which it is doing.

**Correction 3: the region fields cannot hold Texas.** The four arrays take `PROFESSION_JURISDICTIONS` bloc slugs (`global | us | eu | uk`, `packages/db/src/wiki-taxonomy.ts:305`). The only sub-national field is `BusinessContext.stateCode`, which holds one value copied from the address. It serves US public-sector statutory defaults and is not a footprint. `LicenseRequirementReference.stateProvinceCode` exists, but nothing on the regulation path reads it.

## 2. What already exists (reused, not rebuilt)

- **Applicability engine:** `regulationApplies` has archetype, listing, data-handling and nexus gates, and already returns `undeclared`. `Regulation.applicability` is data-driven, so a new requirement is a data operation.
- **Requirement home:** `Regulation` + `Obligation` (`security-compliance.prisma`) already have version lineage, `sourceUrl`, `sourceType`, `agentId` and `domain`, and the compliance engine behind `/compliance` reads them.
- **Research tools:** `search_public_web` / `fetch_public_website` (`public-web-design-pack.ts`) record an `ExternalEvidenceRecord` with the query and URLs whenever a `routeContext` is present.
- **Researcher:** Compliance Officer `compliance-officer` (AGT-WS-COMPLIANCE) holds `web_search` and `statutory_reference_propose`. Licensing & Permit Specialist AGT-905 holds the same pair.
- **Propose/ratify precedent:** statutory rate acquisition (`2026-09-01-statutory-rate-acquisition-design.md`). An uncited proposal is refused before the write, a non-human ratifier is refused unconditionally, and consumers read only ratified rows. This design copies that split for law.
- **Licensing readiness** (`2026-05-11-licensing-permit-jurisdiction-readiness-design.md` §8, §12) sets out the investigation order (what the business does, then where, then legality, then org licenses, then staff credentials) and the rule "archetypes influence what to investigate, not what is true". This design is the setup-time entry point to that investigation and does not replace it.
- **WWWD material grade ladder:** `stance-promotion.ts:20-24` (unconfirmed B/0.6, confirmed A/0.9, ruled A/1.0) and `enrich-org-corpus.ts:57-85` (first-party A/0.85, derived B/0.65, researched C/0.4, always draft+candidate).

## 3. Research & Benchmarking

Desk comparison from maintainer knowledge; nothing was re-fetched in this session. Verify before citing externally.

| Comparable | How it decides what law applies | Adopt | Reject |
|---|---|---|---|
| **CISO Assistant** (intuitem, open source GRC) | The operator picks frameworks from a library. Each requirement then carries an applicability flag inside a compliance assessment | Applicability is a per-requirement, per-org judgment, stored separately from the requirement text | Operator-picked frameworks with no research step. The operator of a small rescue does not know what to pick, and that is the gap being fixed here |
| **Eramba** (open-source GRC) | Imports "compliance packages", then the operator records a compliance status per item | Imported requirement sets keep a link to their source | Status as free text with no evidence grade |
| **Harbor Compliance / Avalara Business Licenses** (commercial, see the licensing spec §4.2) | Researched jurisdiction databases, filtered by entity type and location, answered by a questionnaire | Location + activity as the lookup key, and a questionnaire that asks before researching | A vendor database as the authority. DPF cites the authority's own publication and grows the seed through the hive (licensing spec §8) |

**Standards followed:**
- **ISO 3166-2** subdivision codes (`US-TX`) for sub-national scope. The platform already uses ISO 3166-1 alpha-2 country codes.
- **ISO 37301:2021** (compliance management systems), which treats identifying compliance obligations as an input the organization must determine and keep current. That is why the coverage state is an ongoing record here and not a one-time wizard answer.
- **W3C PROV-O**-style attribution: every requirement records who asserted it (the operator or an agent), what it was derived from (source URL + excerpt) and when (retrieved / ratified). DPF does not adopt the RDF vocabulary itself: absorb, don't adopt.

## 4. Design

### 4.1 Coverage is a first-class state, not an empty array

A new pure function, `assessJurisdictionCoverage(context) → JurisdictionCoverage`, in `packages/db/src` next to `regulation-applicability.ts`:

```ts
type DimensionCoverage = "undeclared" | "declared";
type RequirementCoverage = "none" | "proposed-only" | "attested" | "cited";
type JurisdictionCoverage = {
  dimensions: Record<"operating" | "selling" | "employing" | "data-residency", DimensionCoverage>;
  subdivisions: string[];                 // ISO 3166-2, operating basis
  requirements: RequirementCoverage;      // strongest confirmed requirement on record for this footprint
  gap: boolean;                           // any dimension undeclared OR requirements === "none" | "proposed-only"
  reasons: string[];                      // plain-language, shown verbatim on review surfaces
};
```

It has three consumers. None of them changes what is allowed; each changes what is *said*:

1. **Regulatory ceiling.** When no policy matches and `coverage.gap` is true, `resolveRegulatoryAutonomyCeiling` keeps `ceiling: "propose"` but sets `reason` to a `jurisdiction_undeclared` code with the coverage reasons, in place of the generic default. Blocker text becomes "we don't know which laws apply to you yet", not "no policy matched".
2. **Corpus grounding.** `InstallRegionalProfile` keeps its no-filter behavior for undeclared dimensions. Filtering to nothing would also hide global material. Grounding does carry `jurisdictionCoverage: "undeclared"`, so the decision record states that jurisdiction-specific material was not narrowed.
3. **Review surfaces.** The existing `/compliance/gaps` page (`app/(shell)/compliance/gaps/page.tsx`) prints **"All obligations covered"** whenever its uncovered and partial counts are zero, including on an install whose footprint makes nothing applicable. This is the same vacuous pass at the UI layer. That page and the setup step show the gap as a coverage card ("Jurisdiction not declared: N requirements cannot be evaluated"), and "All obligations covered" is shown only when `coverage.gap` is false.

The **escalation** consumer (a regulated decision escalates on the regulatory condition, not on thin confidence) belongs to **BI-74B2A8CD**, the escalation contract. This design supplies the signal that item needs; it does not wire `directional-outcome.ts`. The acceptance line in BI-50DF2A92 that names `riskTier: regulated` refers to a tier that does not exist (`DECISION_RISK_TIERS = low|medium|high|critical`) and is re-homed to that item (§7).

### 4.2 Sub-national footprint

- Add `BusinessContext.operatingSubdivisions String[] @default([])` (ISO 3166-2). Only the operating basis gets subdivisions in this slice. Employment already has per-site jurisdiction on `WorkLocation` (migration `20260828210000`). Selling and data residency stay at bloc level until a real case needs more.
- Add optional `subdivisions?: string[]` to `RegulationApplicability` and `operatingSubdivisions` to `RegionProfile`. The nexus gate treats a regulation with `subdivisions` as applying only when an operating subdivision matches. A regulation with a subdivision constraint and no declared subdivisions is `undeclared`, not a miss.
- The step suggests values from `Organization.address` (`countryCode` → bloc slug, `stateCode` → `US-TX`). A suggestion is displayed with its source ("from your address") and is saved only when the operator confirms it. This follows the Compliance Officer's persona rule: "only what they confirm, never your own inference".

### 4.3 Requirement provenance on `Regulation`

`Regulation` gains:

- `provenance RegulationProvenance`, a closed Prisma enum: `platform_seed | operator_attested | researched_cited`. Existing rows are backfilled to `platform_seed`.
- `reviewState RegulationReviewState`, a closed enum: `proposed | confirmed | rejected`. Existing rows are backfilled to `confirmed`.
- `sourceExcerpt String?`, `retrievedAt DateTime?`, `proposedByAgentId String?`, `confirmedByUserId String?` (a relation with `ON DELETE SET NULL`), `confirmedAt DateTime?`.

Rules, as pure checks in the style of `checkStatutoryProposal` / `checkStatutoryRatification`:

- **Researched proposal.** Refused before the write unless it carries `sourceUrl`, `sourceExcerpt`, `retrievedAt` and an `applicability` with at least one subdivision or bloc. It lands as `researched_cited` + `proposed`.
- **Operator attestation.** Written from the step's form by a signed-in human. It lands as `operator_attested` + `confirmed`. A source URL is optional, and without one the row stays `operator_attested`.
- **Confirmation of a researched proposal.** Human-only, refused unconditionally for an agent actor. It moves the row to `confirmed` and keeps `researched_cited`.
- **Consumers.** `regulationApplies` callers and the compliance library read only `reviewState = confirmed`. A proposal is a research finding and never applies.

The grades differ because the evidence differs. "The founder told us" is a first-party claim about the organization's own obligations with no citation. "We read it on a state website" is a cited third-party authority, but agent-read. Once a human confirms it, the cited row is the stronger of the two:

| provenance | reviewState | WWWD `PerspectiveMaterial` grade / weight | reaches decisions |
|---|---|---|---|
| `researched_cited` | `proposed` | C / 0.4, draft + candidate | no |
| `operator_attested` | `confirmed` | B / 0.7, approved + promoted | yes |
| `researched_cited` | `confirmed` | A / 0.9, approved + promoted | yes |
| `platform_seed` | `confirmed` | unchanged (existing seed path) | yes |

The existing ladders are never downgraded (`stance-promotion.ts:131`). An operator-attested row upgrades to A when a citation is added and a human confirms it.

### 4.4 Landing in WWWD

When a row is confirmed or attested, a `PerspectiveMaterial` is upserted on the org's WWWD profile with `sourceType: "regulation"` and `sourceRef: { regulationId, version, provenance, sourceUrl? }` at the grade in §4.3. This is the traceability the acceptance criterion asks for ("at least one WWWD material row traces to a jurisdiction requirement with recorded provenance"). It reuses `ensureOrgDecisionPerspectiveProfile` and is not a parallel writer.

### 4.5 The setup step: "Laws that apply"

- A new step, `laws-that-apply`, is inserted immediately after `business-context`. It needs the address and archetype, and `ai-providers` benefits from knowing the jurisdiction for sovereignty. The route is a new `/compliance/jurisdiction` page, which is also the permanent home for installs that finished setup before this step existed.
- **Owner:** the Compliance Officer. `buildStepTrigger` gets a dedicated branch that hands the step to `compliance-officer` via the governed coworker interface, as `ai-providers` already does for AGT-902.
- **The proactive order** puts the operator's own knowledge ahead of paid research:
  1. Confirm the footprint (suggested from the address).
  2. Ask: "Do you already know the licenses, registrations or rules you operate under?" The operator's answers are written as `operator_attested`.
  3. **Offer** research without waiting to be asked: "I can research what <Texas> requires of a <animal rescue>, from official sources, and bring you each finding with its source to confirm." On yes, the Compliance Officer runs `search_public_web` / `fetch_public_website` under a route context (so `ExternalEvidenceRecord` rows are written) and files each finding with `propose_jurisdiction_requirement`. Research runs as background work (licensing spec §12.1), and the step does not wait for it.
- **Completion is from evidence**, via `completeSetupStepFromEvidence`, when the footprint has at least one declared dimension **and** one of these holds: an attested row exists, a confirmed row exists, or research was requested and is pending.
- **Skipping stays allowed.** A skip advances the step, and the coverage record keeps `gap: true` with the reason "skipped at setup". A skip never reads as a pass.
- **Tools:** a new MCP tool, `propose_jurisdiction_requirement`, behind a new grant `jurisdiction_requirement_propose` held by `compliance-officer` and AGT-905. A dedicated grant is used rather than widening `statutory_reference_propose`, because a statutory figure computes money and a requirement row changes applicability, which are different blast radii. **There is no confirm tool**, for the same reason the statutory design gives: an agent must not be able to confirm its own research.

### 4.6 Not fabricating law

Nothing in this change seeds a Texas or animal-rescue requirement. `Regulation` rows for this install come only from the operator or from cited research that a human confirms. Tests use fixture jurisdictions with obviously synthetic authorities (`XX-ZZ`, `https://authority.example/`), so no test fixture can be mistaken for a real statute.

## 5. Out of scope

- The escalation wiring (**BI-74B2A8CD**).
- A writer for `RegulatoryAutonomyPolicy`. Whether a confirmed requirement should mint an autonomy policy row is a separate governance decision. Until then, the ceiling stays `propose` with an honest reason.
- Hive contribution of confirmed requirements (licensing spec §18).
- Selling, employment and data-residency subdivisions.
- Re-verification cadence for confirmed rows. The `licence-currency-reverification` skill pattern is the model, and it is a follow-up.

## 6. Delivery slices

| # | Slice | Shape | Depends on |
|---|---|---|---|
| S1 | `assessJurisdictionCoverage` + the ceiling reason code + grounding annotation + `/compliance/gaps` coverage card | small | none |
| S2 | `operatingSubdivisions` + `RegulationApplicability.subdivisions` + nexus gate + address suggestion | medium (migration) | S1 |
| S3 | `Regulation` provenance/reviewState columns + propose/attest/confirm rules + `propose_jurisdiction_requirement` + grant | medium (migration) | S2 |
| S4 | WWWD material landing (§4.4) | small | S3 |
| S5 | `laws-that-apply` setup step + `/compliance/jurisdiction` + Compliance Officer trigger + evidence completion | medium (UI) | S2, S3 |

## 7. Acceptance (restated against the code)

1. After setup on a fresh install where the operator confirms a footprint, `operatesIn` is non-empty and `operatingSubdivisions` holds the confirmed ISO 3166-2 codes.
2. At least one `PerspectiveMaterial` row has `sourceType = "regulation"` and a `sourceRef.provenance`, and each is traced to a confirmed or attested `Regulation`.
3. An install with no declared footprint shows a coverage gap on `/compliance/gaps` and on the setup step, and never "All obligations covered". The regulatory ceiling's reason is `jurisdiction_undeclared`, not the generic default.
4. A researched proposal without a source URL, excerpt and retrieval date is refused before any row exists. An agent's attempt to confirm is refused.
5. No test fixture or seed names a real jurisdiction's requirement.
6. *(Re-homed to BI-74B2A8CD)* A decision gated by a confirmed regulatory requirement escalates on the regulatory condition.
