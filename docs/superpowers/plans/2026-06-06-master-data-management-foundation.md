---
title: Master Data Management Foundation — Implementation Plan
authoredAt: 2026-06-06
authoredBy: claude
planFor: BI-C5F3CB36
epic: EP-MDM
spec: docs/superpowers/specs/2026-05-31-master-data-management-alignment-design.md
status: draft
---

# Master Data Management Foundation — Implementation Plan

Implements **BI-C5F3CB36** under **EP-MDM**, against the approved
[Master Data Management Alignment Design](../specs/2026-05-31-master-data-management-alignment-design.md).

## Definition of done

The plan is complete when BI-C5F3CB36's acceptance criteria (spec §9) hold on a
live install: imported customer records link to an existing `CustomerAccount`
without creating duplicates; possible duplicates surface as steward-visible
candidates with reasons; conflicting source values show survivorship rationale;
reference-data changes show usage impact before deactivate/merge; canonical reads
carry a `TrustAssessment` envelope; a steward merge produces an auditable
`ToolExecution` with a pre-merge snapshot and repointed (never orphaned)
crosswalk rows; survivorship rules are governed, versioned config.

## Resolved decisions (binding on this plan)

- **Crosswalk integrity = typed-FK hybrid.** Typed nullable FK columns
  (`customerAccountId`, `supplierId`) on `MasterDataSourceRef` for the two
  high-volume domains (DB cascade); polymorphic `(domain, canonicalId)` pointer
  for low-volume domains. (spec §6.2, kernel 2026-06-06)
- **Merge severity = permanent tombstone.** No hard-delete path, ever. A merge is
  link + supersede with a pre-merge snapshot. (spec §6.6, kernel 2026-06-06)

## Substrate grounding (verified 2026-06-06)

| Concern | Real substrate (file:line) | Plan posture |
|---|---|---|
| Canonical customer | `CustomerAccount` — `packages/db/prisma/schema.prisma:2250` | Typed FK target; never duplicated |
| Canonical supplier | `Supplier` — `schema.prisma:7682` | Typed FK target |
| Import intake / candidates | `IntegrationImportStagedRecord` — `schema.prisma:1429` | Reuse as import-candidate queue; crosswalk is the resolved mapping |
| Survivorship config precedent | `EaDqRule` (5609), `PolicyRule` (6825), `ApprovalRule` (7939) | Store survivorship as governed rule-as-JSON, same shape family |
| Trust vocabulary | `TrustDimensionKey` — `apps/web/lib/trust-vector/types.ts:19-32` | Add 3 net-new keys; reuse 6 existing |
| Trust envelope | `apps/web/lib/trust-vector/{types,score}.ts`, `surface-data-provenance.ts` | Publishing contracts emit `TrustAssessment` |
| Reference-data admin | `apps/web/app/(shell)/admin/reference-data/page.tsx`; actions `apps/web/lib/actions/reference-data-admin.ts` (+ `.test.ts`) | Extend with merge; reuse soft-delete + CI uniqueness indexes |
| Identity crosswalk (out of scope) | `PrincipalAlias` (AGENTS.md §11) | organization / customer-contact resolve here, NOT via `MasterDataSourceRef` |
| Enum registration | `apps/web/lib/backlog.ts`, `apps/web/lib/mcp-tools.ts` | Register `domain`/`status`/`trustTier` values (hyphens) |

## Relationship to EP-DATA-ARCH (parallel data-architecture capability)

EP-DATA-ARCH (Self-Maintaining Data Architecture,
`docs/superpowers/specs/2026-06-06-data-architecture-self-maintenance-design.md`)
runs in parallel. It governs the data **model** (mirror `schema.prisma` into the
EA tool as a live ERD, stewarded by AGT-BUILD-DA). MDM governs the data
**records** (canonical instances, crosswalk, dedup, survivorship). They are
distinct layers and stay as **two epics** — but share substrate at three seams:

1. **Trust dimensions are shared (Phase 0).** EP-DATA-ARCH §6.4 files drift
   findings for uniqueness, relationship integrity, and FK-index/validity issues —
   the same three net-new `TrustDimensionKey`s MDM Phase 0 adds. **Phase 0 is a
   single coordinated BI both epics consume**, owned in the neutral
   graph-trust-vector spec. File once; both epics depend on it.
2. **One "domain" notion.** EP-DATA-ARCH's steward proposes
   `proposedProperties.domain` clustering on EA elements; MDM Phase 1's
   `MasterDataDomain` registry must be a **governed overlay** on that map
   (declaring which domains are managed master data), not an independent taxonomy.
   Phase 1 coordinates with EP-DATA-ARCH BI-6E5BF91F (steward domain clustering).
3. **Findings reuse `EaConformanceIssue`.** MDM record-level integrity findings
   (polymorphic-domain crosswalk orphans, uniqueness violations) extend the
   existing `EaConformanceIssue` + drift machinery rather than a parallel MDM issue
   queue. The Data Architect steward may surface MDM crosswalk orphans.

Non-seams (kept separate): MDM's record crosswalk/dedup/survivorship has no
EP-DATA-ARCH analog; EP-DATA-ARCH's Prisma extractor/ERD mirror has no MDM analog.

## Child BI ledger (filed 2026-06-06 under EP-MDM)

| Phase | Label | BI id | Size | Blocked by |
| --- | --- | --- | --- | --- |
| 0 | trust-dimension registry (shared w/ EP-DATA-ARCH) | BI-7535C218 | small | — |
| 1 | domain registry | BI-AC85936F | small | — |
| 2 | customer-account crosswalk + candidates | BI-247A03E1 | large | 0, 1 |
| 3 | steward queue | BI-A03F059A | large | 2 |
| 4 | survivorship v1 | BI-4E6C0819 | large | 2 |
| 5 | reference-data/locations merge | BI-969ACC4A | medium | — |
| 6 | supplier pilot | BI-3227FA4C | medium | 2, 3 |
| 7 | publishing contracts | BI-C5E81603 | medium | 0, 2, 4 |

## Phasing — each phase becomes a child BI under EP-MDM

Phases are dependency-ordered. **Phase 0 is the only hard blocker on the rest.**
Phases 1 and 5 can ship independently of 2–4/6–7.

### Phase 0 — Trust-dimension registry extension (cross-spec prerequisite) — BLOCKS all consumers
- **Deliverable:** Add `validityConformity`, `uniqueness`, `relationshipIntegrity`
  to the `TrustDimensionKey` union and any label/weight maps; update the
  2026-05-26 graph-data-trust-vector spec's registry section to match.
- **Files:** `apps/web/lib/trust-vector/types.ts`, `apps/web/lib/trust-vector/wording.ts`,
  `apps/web/lib/trust-vector/score.ts`; spec `docs/superpowers/specs/2026-05-26-graph-data-trust-vector-design.md`.
- **Verification:** Unit test asserts the three keys are accepted by `TrustDimension`
  construction and render labels; existing trust-vector tests still pass.
- **Risk/rollback:** Additive union members — low blast radius. Rollback = revert the
  three additions; no consumers exist yet until later phases.
- **Child BI:** `MDM-0 trust-dimension registry extension` (size: small). **Shared
  coordinated dependency for both EP-MDM and EP-DATA-ARCH** (see "Relationship to
  EP-DATA-ARCH" above) — file once, both epics consume; flag overlap with open
  graph-trust-vector / data-architecture work before push.

### Phase 1 — Code-level domain registry (no schema) — independent
- **Deliverable:** `MasterDataDomain` type + per-domain config (canonical model,
  canonical id field, identity attributes, required quality dimensions, allowed
  source systems, merge policy, steward `capabilityId`, publishing read model).
- **Files:** new `apps/web/lib/mdm/domain-registry.ts` (+ test). No Prisma change.
- **Verification:** Unit test: every registry entry resolves a real Prisma model name
  and a real `PlatformCapability` id; identity-bearing domains (organization,
  customer-contact) are marked crosswalk-via-PrincipalAlias and rejected from the
  `MasterDataSourceRef` path.
- **Risk/rollback:** Pure code, no runtime wiring yet. Rollback = delete the module.
- **Child BI:** `MDM-1 domain registry` (size: small). Not blocked by Phase 0.

### Phase 2 — Customer-account pilot: crosswalk + duplicate-candidate detection — needs Phase 0,1
- **Deliverable:** `MasterDataSourceRef` model (typed-FK hybrid per §6.2) +
  migration + enum registration; in-place duplicate-candidate detection for two
  existing `CustomerAccount`s (net-new substrate only for the case
  `IntegrationImportStagedRecord` does not cover); standardization helpers (name,
  domain, email/phone) before match scoring.
- **Files:** `packages/db/prisma/schema.prisma` (+ migration under
  `packages/db/prisma/migrations/`), `apps/web/lib/backlog.ts`,
  `apps/web/lib/mcp-tools.ts`, new `apps/web/lib/mdm/crosswalk.ts`,
  `apps/web/lib/mdm/match-candidate.ts` (+ tests).
- **Verification (functional):** On a live install, import/create two
  near-duplicate customer rows → a candidate appears with match score + reasons;
  a confirmed link writes one `MasterDataSourceRef` with `customerAccountId`
  populated and equal to `canonicalId`; the CHECK constraint rejects a mismatched
  pair. No duplicate `CustomerAccount` is created.
- **Risk/rollback:** New table + FK to a high-volume domain. Blast radius contained
  to additive table; rollback = down-migration drops `MasterDataSourceRef`. Verify
  no enum drift between `backlog.ts`/`mcp-tools.ts` (AGENTS.md §3).
- **Child BI:** `MDM-2 customer-account crosswalk + candidates` (size: large).

### Phase 3 — Steward queue admin surface (link / reject / create-new) — needs Phase 2
- **Deliverable:** Admin/steward page listing duplicate candidates + source
  conflicts with reasons; actions link / reject / create-new. **No destructive
  merge yet** — merge ships in a follow-on once snapshot/reversal is wired.
  Steward decisions gated by `PlatformCapability`, each recorded as a
  `ToolExecution` (+ receipt) — no bespoke steward-action log.
- **Files:** new route under `apps/web/app/(shell)/admin/` (mirror the
  reference-data page pattern), client panel components, server actions in
  `apps/web/lib/actions/`.
- **Verification (functional):** Drive the page on a live install — a steward links
  a candidate (crosswalk row written), rejects another (candidate closed with
  rationale), and creates-new; each action produces a `ToolExecution` carrying the
  steward `capabilityId`; a non-steward is denied at the action boundary.
- **Risk/rollback:** UI + governed actions, additive. Rollback = remove route +
  actions; crosswalk data persists harmlessly.
- **Child BI:** `MDM-3 steward queue (non-destructive)` (size: large).

### Phase 4 — Survivorship v1 (rules-as-JSON) — needs Phase 2
- **Deliverable:** Field-level survivorship rules for customer name, website,
  source-status mapping, primary contact, primary site/address, stored as governed
  rule-as-JSON (precedent: `EaDqRule.rule` / `PolicyRule` / `ApprovalRule`), scoped
  by `domain` + attribute class, versioned + deactivatable, with usage-impact
  preview before change. Survivorship rule set is itself a mastered reference-data
  domain (§5.5).
- **Files:** survivorship rule model/rows (reuse existing rule substrate where it
  fits before adding net-new), `apps/web/lib/mdm/survivorship.ts` (+ test),
  steward UI surfacing the chosen winner + rationale.
- **Verification (functional):** Conflicting source values on a linked customer
  resolve per rule; the steward view shows the winning value and the rule that
  decided it; changing a rule shows usage impact before it takes effect; a rule
  change is versioned (not a silent code redeploy).
- **Risk/rollback:** Config-driven; rollback = deactivate the rule set (reverts to
  human-override-only). Guard against a hardcoded constant re-deciding on deploy.
- **Child BI:** `MDM-4 survivorship v1` (size: large).

### Phase 5 — Reference-data / locations merge (finish the deferred merge) — independent
- **Deliverable:** Extend `/admin/reference-data` with duplicate **merge/replace**
  for regions and cities + usage-impact preview before merge — implementing the
  merge the 2026-03-17 admin reference-data spec explicitly deferred (only
  deactivate/reactivate shipped). Reuse existing soft-delete (`status`) and the
  case-insensitive uniqueness indexes (`Region_countryId_name_ci`,
  `City_regionId_name_ci`). Merge repoints address references from the losing row
  to the survivor (tombstone the loser; never delete).
- **Files:** `apps/web/app/(shell)/admin/reference-data/page.tsx`,
  `apps/web/components/admin/{RegionPanel,CityPanel}.tsx`,
  `apps/web/lib/actions/reference-data-admin.ts` (+ `.test.ts`).
- **Verification (functional):** On a live install, merge "Calfornia" → "California":
  usage-impact preview lists affected addresses; on confirm, addresses repoint to
  the survivor, the loser is tombstoned (status inactive/superseded, excluded from
  typeahead), and the action is audited. Existing reference-data tests still pass.
- **Risk/rollback:** Touches a live admin surface and real address FKs. Mitigate
  with usage-impact preview + tombstone (reversible). Rollback = reactivate the
  tombstoned row and reverse repointing from the audit snapshot.
- **Child BI:** `MDM-5 reference-data/locations merge` (size: medium). Not blocked by
  Phase 0 (no trust-dimension dependency); good early independent win.

### Phase 6 — Supplier pilot (reuse crosswalk + steward queue) — needs Phase 2,3
- **Deliverable:** Reuse `MasterDataSourceRef` (`supplierId` typed FK) + steward
  queue for `Supplier`, including AI provider finance profiles and imported
  vendor/bill records.
- **Files:** extend `apps/web/lib/mdm/*`, register `supplier` domain config, steward
  UI handles the supplier domain.
- **Verification (functional):** Two near-duplicate suppliers produce a candidate;
  link writes a crosswalk row with `supplierId` populated = `canonicalId`; steward
  flow works identically to customer-account.
- **Risk/rollback:** Mostly config + reuse; low net-new code. Rollback = unregister
  supplier domain.
- **Child BI:** `MDM-6 supplier pilot` (size: medium).

### Phase 7 — Publishing contracts (stable read models + TrustAssessment) — needs Phase 0,2,4
- **Deliverable:** Expose canonical mastered records via stable read models for
  coworkers/dashboards/integrations, each carrying a `TrustAssessment`
  (`kind: "data-trust-vector"`) on `DataSourceProvenance.trust` when the record is
  incomplete/stale/inferred/source-conflicted. No bespoke MDM payload shape.
- **Files:** `apps/web/lib/mdm/read-model.ts` (+ test),
  `apps/web/lib/surface-data-provenance.ts`, consumer wiring for at least one
  coworker/dashboard surface.
- **Verification (functional):** A coworker/dashboard reading a customer with a
  source conflict receives the canonical value plus a `TrustAssessment` naming the
  `conflictContradiction` dimension; a complete confirmed record carries a
  high-tier assessment.
- **Risk/rollback:** Additive read layer. Rollback = stop emitting the envelope;
  callers fall back to raw reads.
- **Child BI:** `MDM-7 publishing contracts` (size: medium).

## Cross-cutting risks

- **Enum drift** between `backlog.ts` and `mcp-tools.ts` for `domain`/`status`/
  `trustTier` — register in the same commit, hyphens not underscores (AGENTS.md §3).
- **Polymorphic orphans** on the low-volume domains — the orphan-reconciliation
  sweep (§6.2) must exist before those domains carry production data.
- **Identity boundary** — never let `organization`/`customer-contact` reach
  `MasterDataSourceRef`; that's a `PrincipalAlias` job. Registry (Phase 1) enforces.
- **Live-surface phases (3, 5)** touch real admin pages — drive them functionally on
  a live install per `structural-verification-is-not-functional`; tests passing is
  not sign-off.

## Sequencing summary

```
Phase 0 ──┬─> Phase 2 ──┬─> Phase 3 ──┐
          │             ├─> Phase 4 ──┼─> Phase 7
          │             └─> Phase 6 (also needs 3)
Phase 1 ──┘  (registry feeds 2,3,6)
Phase 5  (independent — earliest shippable win)
```

## Next step after this plan

File the 8 child BIs (MDM-0 … MDM-7) under EP-MDM with the sizes above and
`Blocked by:` references per the sequencing graph, then promote the first
unblocked slices (MDM-0, MDM-1, MDM-5) to Build Studio.
