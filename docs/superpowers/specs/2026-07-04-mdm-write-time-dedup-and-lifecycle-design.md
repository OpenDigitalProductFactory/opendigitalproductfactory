---
title: MDM Write-Time Duplicate Prevention & Customer-Domain Lifecycle/Merge Design
authoredAt: 2026-07-04
authoredBy: claude
status: approved
specKind: design
relatedSpecs:
  - docs/superpowers/specs/2026-05-31-master-data-management-alignment-design.md
  - docs/superpowers/specs/2026-05-26-graph-data-trust-vector-design.md
  - docs/superpowers/specs/2026-03-17-admin-reference-data-design.md
relatedPlans:
  - docs/superpowers/plans/2026-06-06-master-data-management-foundation.md
relatedPrinciples:
  - docs/founder-kernel/wiki/principles/single-source-of-truth.md
  - docs/founder-kernel/wiki/principles/schema-audit-before-features.md
  - docs/founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md
  - docs/founder-kernel/wiki/principles/remove-avoidable-failure-opportunities.md
externalReferences:
  - https://help.salesforce.com/s/articleView?id=sales.matching_rule_matching_criteria.htm
  - https://www.postgresql.org/docs/current/pgtrgm.html
  - https://www.informatica.com/products/master-data-management/multidomain-mdm.html
---

# MDM Write-Time Duplicate Prevention & Customer-Domain Lifecycle/Merge

## 1. Purpose

The approved 2026-05-31 MDM alignment design gave DPF the *scoring* substrate
(`lib/mdm/standardize.ts`, `lib/mdm/match-candidate.ts`), the *crosswalk*
(`MasterDataSourceRef`), and the *reference-data merge* (Region/City
`mergedIntoId` + `superseded`). What it never placed is the guard at the moment
of creation: today `createCustomerAccount` ([apps/web/lib/actions/crm.ts:68])
and the `create_customer_account` coworker tool perform a raw
`prisma.customerAccount.create` — no normalization, no match check. A slight
misspelling ("Emma3D" vs "Emma 3D", "Managing Digital" vs "Managing Digital
Ltd") silently creates a duplicate; the duplicate Emma3D prospect created
during the 2026-07-03 CRM engagement-lifecycle session is the live example.

Nor does any customer-domain entity have a lifecycle beyond a free status
string: there is no way to merge two `CustomerAccount`s, no superseded
tombstone, no FK repoint, no history-preserving rename path.

This spec closes both gaps as a **reusable capability**, not a CRM one-off:

1. **Write-time duplicate prevention** — a shared dedup gate every governed
   create path calls before insert, returning scored candidates and forcing a
   `use-existing / confirm-new` decision instead of a silent insert; DB
   uniqueness on normalized keys where genuinely safe.
2. **Lifecycle & merge** — `superseded`/`archived` states + `mergedIntoId` on
   customer master-data models, and a governed merge operation that re-points
   foreign keys AND soft references transactionally with a pre-merge snapshot.
3. **Surface it** — the `+ New Account` flow and coworker create tools present
   matches with minimal cognitive load; tool descriptions state
   required/optional so the coworker neither over-asks nor over-creates.

## 2. Substrate Verification (2026-07-04)

- **Shipped (origin/main):** MDM-0 trust dimensions + MDM-1 domain registry
  (#1623), MDM-2 `MasterDataSourceRef` crosswalk + duplicate-candidate scoring
  (#1633), MDM-5 reference-data merge backend (#1639). `scoreMatchCandidate` /
  `findMatchCandidates` exist and are tested.
- **Dormant:** `lib/mdm/match-candidate.ts` is imported by exactly one file —
  `lib/actions/reference-data-admin.ts`. No CRM create path, coworker tool, or
  API route calls it.
- **Write paths with no dedup:** `createCustomerAccount` /
  `createCustomerSite` (crm.ts), the `create_customer_account` MCP tool
  (mcp-tools.ts case at ~14989), `NewCustomerButton.tsx`, and five scattered
  `customerContact.create` sites (social-auth-actions.ts ×2, finance.ts:385,
  api/v1/customer/contacts/route.ts:190, api/storefront/sign-up/route.ts:36).
- **Schema:** only `Region`/`City` carry `nameNormalized` + `mergedIntoId` +
  `superseded`. `CustomerAccount` has neither a normalized-name column nor any
  uniqueness on name/website. `CustomerContact.email` is `@unique` (exact
  only). `ContactAccountRole.startedAt/endedAt` already models a contact
  joining/leaving an account — reuse, do not reinvent.
- **Soft references exist:** `ServiceTicket.customerAccountId` /
  `customerSiteId` are documented soft references with **no FK relation** — a
  merge engine that walks Prisma relations generically would silently orphan
  them (decisive input to §5.2).
- **Live backlog:** EP-MDM and the eight 2026-06-06 child BIs (BI-C5F3CB36 …)
  do **not** exist in this install's live backlog — the epic must be
  (re-)filed; MDM-3/4/6/7 never shipped anywhere.
- **No pg_trgm migration exists** anywhere in `packages/db/prisma/migrations`.

## 3. Benchmark Research

| Practice | Source | Takeaway applied here |
| --- | --- | --- |
| Write-time duplicate rules: matching rule (exact/fuzzy per field) + duplicate rule (alert vs block at save) | Salesforce Duplicate Management | The gate runs at create time and *presents* candidates; high-confidence matches block-by-default with an explicit override, mid-confidence alert. |
| Match rules route uncertain pairs to a steward, never auto-merge | Informatica MDM | Already DPF doctrine (spec §5.4 / match-candidate.ts header). The write-time gate only prevents; merging stays a governed human action. |
| Survivorship is field-level, driven by trust/recency | Informatica, Profisee | Deferred to MDM-4 (refiled); merge v1 keeps survivor's values, snapshot preserves loser's. |
| Match/merge vs match/link | Informatica | DPF's typed-FK crosswalk = link; the new merge op = merge. Both remain; link for source records, merge for true in-place duplicates. |
| Trigram (pg_trgm) GIN index for candidate generation at DB scale | PostgreSQL contrib | Candidate *generation* uses normalized columns + pg_trgm similarity in SQL; candidate *scoring* reuses the existing in-process `scoreMatchCandidate` (weights + reasons). Blocking-then-scoring is standard entity-resolution shape. |
| Governance products (Collibra) manage rules/stewardship/lineage, not matching | Collibra | Confirms no new governance island: steward capability gate + ToolExecution audit (already in the 2026-05-31 spec) carry governance. |

## 4. Resolved Decisions (kernel, 2026-07-04)

Both forks were scored via `principle_decide` (structured coverage strong):

- **Gate placement → `explicit-guarded-create`** (vs Prisma `$extends`
  interception vs DB-constraints-only). Kernel margin was a statistical tie
  (0.023); the tie is broken by the operator's own directive, which requires
  the check to *return likely existing matches and force a use-existing /
  confirm-new decision* — only an explicit service seam at the action/tool
  boundary can present that decision; global interception can only throw, and
  raw DB errors are unresolvable by a non-technical user. A **registry
  coverage test** (§5.1) recovers the "nothing can bypass" property the
  interception option offered.
- **Merge shape → `shared-orchestrator-domain-adapters`** (composite 4.52 vs
  4.15 per-entity / 3.17 generic-DMMF; margin 0.37, high confidence, no
  commandment conflict). One orchestrator owns the invariants (snapshot,
  tombstone, audit, crosswalk repoint, collision planning); each domain
  declares an explicit repoint list **including soft references**; a schema
  test diffs every adapter's declared list against Prisma DMMF relations so a
  newly added FK cannot be silently missed.

## 5. Design

### 5.1 Write-time dedup gate — `apps/web/lib/mdm/dedup-gate.ts`

One shared primitive, keyed by the existing `MasterDataDomain` registry:

```ts
type DedupResolution =
  | { kind: "use-existing"; existingId: string }
  | { kind: "confirm-new"; reason?: string };

type DedupCheckResult = {
  verdict: "clear" | "possible-duplicate" | "likely-duplicate";
  candidates: Array<{ id: string; label: string; score: number;
                      reasons: MatchReason[]; recommendation: MatchRecommendation }>;
};

checkDuplicates(domain, subject): Promise<DedupCheckResult>
```

- **Candidate generation (blocking):** SQL over persisted normalized columns —
  exact normalized-name equality, exact normalized web-domain equality, exact
  normalized email/phone (contacts), plus `pg_trgm` `similarity(nameNormalized,
  $q) > 0.3` via `ORDER BY similarity DESC LIMIT 10`. Tombstoned
  (`superseded`) rows are excluded.
- **Scoring:** the existing `scoreMatchCandidate` — same weights, same
  human-readable reasons, same `likely/possible/distinct` thresholds. No new
  scoring vocabulary.
- **Contract:** create paths call `checkDuplicates` first. `clear` → insert.
  `possible-duplicate` → present candidates; caller may pass
  `confirm-new` immediately (alert semantics). `likely-duplicate` → insert is
  refused unless the caller supplies an explicit `DedupResolution`
  (block-with-override semantics). `use-existing` returns the existing record
  and never inserts.
- **Decision audit:** UI-path decisions log via the existing
  `logSystemActivity`; coworker-path decisions are already wrapped in
  `ToolExecution`. `confirm-new` on a `likely-duplicate` records the override
  reason. No new table — the write-time candidate is ephemeral by design
  (2026-05-31 spec §6.3 reserves persisted candidates for in-place dedup).
- **Coverage guard:** a unit test enumerates the write paths registered for
  each gated domain (`GATED_CREATE_PATHS` registry co-located with the gate)
  and greps/imports to assert each named path calls the gate — the structural
  substitute for interception's can't-bypass property. New create paths for a
  gated domain must register or the test fails.

### 5.2 Normalized columns + DB uniqueness (fleet-safe)

- `CustomerAccount.nameNormalized` (from `standardizeName`) and
  `CustomerAccount.domainNormalized` (from `standardizeDomain(website)`),
  backfilled in-migration; `@@index` both; **GIN trigram index** on
  `nameNormalized`; `CREATE EXTENSION IF NOT EXISTS pg_trgm` in the same
  migration. **No unique constraint on account name or domain** — same-named
  distinct businesses and shared agency domains are legitimate; the gate (not
  a constraint) owns this case. This is the "where safe" boundary the
  operator's directive draws.
- `CustomerSite`: `nameNormalized` + partial unique
  `(accountId, nameNormalized) WHERE status <> 'superseded'` — within one
  account, two sites with the same normalized name are a true duplicate.
  Existing violators are remediated in the same migration (suffix `-2` and
  flag in notes) per the fleet-safe migration doctrine (AGENTS.md §2).
- `CustomerContact`: `email` is already `@unique` (keep). Add
  `nameNormalized` (from `standardizeName(firstName+lastName || name)`) +
  index for fuzzy alerts; no name uniqueness.
- Normalized columns are maintained by the shared create/update paths (the
  gate writes them); a reconcile sweep (`scripts/`-level, reusing the orphan
  sweep slot from spec §6.2) backfills drift.

### 5.3 Lifecycle states

Reuse the existing string-union pattern (AGENTS.md §3), extending
`CustomerAccount.status` with two values: `superseded` (merged away — always
paired with `mergedIntoId`) and `archived` (operator retired; no survivor).
The canonical unions live in `packages/db/src/customer-lifecycle.ts`
(`CUSTOMER_ACCOUNT_STATUSES`, `CUSTOMER_SITE_STATUSES`), alongside the
`EXCLUDE_TOMBSTONED` where-fragment default reads spread into their queries.
Existing values keep their meaning; `closed` remains the business-relationship
end-state, distinct from data-lifecycle archival. `CustomerSite.status` gains
the same two values. `CustomerContact` keeps `isActive` for auth; a contact
leaving an account is `ContactAccountRole.endedAt` (already modeled — no new
contact lifecycle field). Default reads (lists, typeahead, coworker list
tools) exclude `superseded`; detail reads of a tombstone follow
`mergedIntoId` with a "merged into X" banner. Attribute change over time
(company rename) keeps history via the pre-change value recorded in the
activity log entry — full temporal versioning is out of scope (§8).

### 5.4 Merge orchestrator + domain adapters — `apps/web/lib/mdm/merge.ts`

Kernel-ratified shape (§4):

```ts
type MergeAdapter = {
  domain: MasterDataDomain;
  hardRelations: RepointStep[];   // FK-backed: prisma model + field
  softReferences: RepointStep[];  // e.g. ServiceTicket.customerAccountId
  uniqueCollisionPlans?: CollisionPlanner[]; // e.g. per-account site names
  snapshot(tx, id): Promise<Json>;
};
mergeRecords(domain, loserId, survivorId, actor): Promise<MergeResult>
```

Orchestrator invariants (every domain, one implementation): validate pair
(same org scope, not same record, neither tombstoned), capture pre-merge
snapshot, repoint `hardRelations` + `softReferences`, run collision planners
(reference-data-merge.ts precedent), repoint `MasterDataSourceRef` rows,
tombstone loser (`status='superseded'`, `mergedIntoId=survivorId`), write the
audit `ToolExecution` (+ receipt carrying the snapshot) under the
`mdm-steward` capability — all in one transaction. Merge is tombstone-only,
never hard-delete (kernel 2026-06-06). **Adapter completeness test:** for each
adapter, diff `hardRelations` against Prisma DMMF relations pointing at the
canonical model; any FK not declared (or explicitly waived with a reason)
fails the test. Soft references cannot be derived — the adapter is their
single home, seeded from a repo-wide grep for `<model>Id` soft-ref comments.

First adapter: `customer-account` (the Emma3D case). `customer-site` follows
in the same slice (small relation set). `customer-contact` merge is
**deferred**: contacts are identity-bearing (PrincipalAlias territory, spec
§6.2) — a contact merge is a Principal convergence operation, not a row merge.

As built: orchestrator + adapters in `apps/web/lib/mdm/merge.ts`
(completeness guard `merge-adapters-completeness.test.ts`); admin surface in
`apps/web/lib/actions/customer-merge.ts` + the account-detail "Merge into…"
control with usage-impact preview; coworker door `merge_customer_accounts`
(crm_write grant, registered in the `mdm-stewardship` tool pack —
`apps/web/lib/mcp/packs/mdm-stewardship-pack.ts` — per the frozen inline
dispatcher ratchet). The account-merge collision planners are per-account site
names (nested site merge) and duplicate contact-role rows (drop the loser
copy). The v1 steward gate reuses the admin capability boundary
(`view_admin` server-side, `operate_customer` at the tool layer); the
dedicated `mdm-steward` PlatformCapability lands with the steward queue
(refiled MDM-3).

### 5.5 Surfaces

- **`+ New Account` (NewCustomerButton):** on submit, call the check; render
  candidates inline in the same modal (name, status, site count, match
  reasons) with two actions per row — "Use this account" (navigates to it)
  and one "Create new anyway" beneath (disabled for `likely-duplicate` until
  a confirmation checkbox names the reason). One decision, one screen, no
  navigation away.
- **Merge surface:** an admin-gated "Merge duplicates…" action on the account
  detail page (steward capability), with survivor picker + impact preview
  (counts per relation from the adapter) before confirm — mirroring the
  reference-data merge UX.
- **Coworker tools (MCP):** `create_customer_account` gains optional
  `duplicateResolution` (`use-existing:<id>` | `confirm-new`) +
  `duplicateReason`. First call without resolution when candidates exist
  returns `error:"duplicates_found"` with the scored candidates and one-line
  instructions ("If one of these is the same company, call
  get/use it; only pass duplicateResolution:'confirm-new' if the user
  confirms it is genuinely a different company."). Tool descriptions are
  rewritten to state required vs optional per field and when NOT to create —
  the description is the coworker's only manual (per the over-asking finding,
  PR #2564 lineage). A new `merge_customer_accounts` steward tool wraps
  `mergeRecords` for governed coworker use.

## 6. Delivery Slices (BIs under re-filed EP-MDM)

| Slice | Content | Size |
| --- | --- | --- |
| WG-1 | Normalized columns + pg_trgm migration + dedup-gate service + coverage-guard test | medium |
| WG-2 | Wire gate into crm actions + contact create sites + MCP tool contract/descriptions | medium |
| WG-3 | `+ New Account` candidate picker UI | small |
| WG-4 | Lifecycle states + merge orchestrator + customer-account/site adapters + admin merge surface + `merge_customer_accounts` tool | large |
| refile | MDM-3 steward queue, MDM-4 survivorship, MDM-6 supplier, MDM-7 publishing (carried from the 2026-06-06 plan; not built in this pass) | — |

## 7. Acceptance Criteria

- Creating "Emma 3D" (UI or coworker) when "Emma3D" exists returns the
  existing account as a scored candidate and refuses a silent insert; an
  explicit confirm-new with reason still works.
- The coworker tool, given "add prospect Emma 3D", uses the existing account
  instead of creating a duplicate, without asking the operator for fields the
  tool description marks optional.
- The two live duplicate Emma3D prospects can be merged: FKs and
  `ServiceTicket` soft refs repoint, the loser is tombstoned with
  `mergedIntoId`, excluded from lists, and the audit ToolExecution carries the
  pre-merge snapshot.
- Adapter completeness test fails if a new FK relation to `CustomerAccount`
  lands without being declared (or waived) in the adapter.
- Coverage-guard test fails if a registered gated create path stops calling
  the gate.
- All migrations pass the fleet-safe guard (remediation before constraint).

## 8. Non-Goals

- No automatic merge — ever (doctrine §5.4).
- No contact (identity-bearing) row merge — Principal convergence owns it.
- No full temporal/bitemporal attribute versioning; rename history lives in
  the activity log.
- No survivorship rules in this pass (MDM-4, refiled).
- No new candidate-persistence table; write-time candidates stay ephemeral.

## 8. Market-gap slice 2 (2026-07-05, BI-AEA97829 / BI-7BF995B9 / BI-F7B6D55E)

Post-ship gap analysis against Informatica MDM / Collibra / Reltio / Salesforce
Duplicate Management surfaced eight functional gaps (all filed on the epic);
this slice closes the three that protect data already in the system:

**Update-path dedup (BI-AEA97829).** The gate now also guards the identity
attributes on update: `PATCH /api/v1/customer/accounts/:id` (name/website) and
`PATCH /api/v1/customer/contacts/:id` (name) run the same check with
`excludeId` (a record never matches itself), return 409 `DUPLICATE_SUSPECTED`
with candidates on a likely-duplicate, honour the same
`duplicateResolution`/`duplicateReason` wire contract (canonical parser:
`parseDedupResolution` in dedup-gate.ts), and keep the normalized columns
fresh — the PATCH route previously left `nameNormalized` stale on rename.
Both PATCH routes are registered in `GATED_CREATE_PATHS` under the coverage
guard.

**Batch retroactive scan (BI-7BF995B9).** `lib/mdm/batch-scan.ts` self-joins
the normalized columns + pg_trgm (same blocking, same `scoreMatchCandidate`,
same surface-over-miss upgrade as the gate) to find duplicate pairs already in
the data. Surfaces: `DuplicateAccountsPanel` on /customer (renders nothing
when clean; resolution happens via the detail page's "Merge into…" so it stays
a pointer, not a second merge surface) and the read-only
`find_duplicate_customer_accounts` coworker tool (crm_read). On-demand
compute; persistence belongs to the steward queue (BI-FEA49EC1).

**Unmerge (BI-F7B6D55E).** `MergeResult` now records the repointed row IDS per
step (cap 1000/step; a capped step marks the lineage lossy and unmerge
refuses). `unmergeRecords(loserId)` reads the latest `account_merged` audit
Activity naming that loser, restores the tombstone to its snapshot status,
moves back exactly the recorded rows (crosswalk canonicalId restored in the
same write), and restores nested-merged sites to their recorded prior status.
Rows attached to the survivor after the merge stay with the survivor — correct
semantics, not a limitation. Known limitation: contact-role rows dropped by
the merge collision plan (exact duplicates of survivor rows) are not
recreated. Surfaces: "Undo merge" on the tombstone banner (admin) and the
`unmerge_customer_accounts` coworker tool (crm_write). customer-account only:
the audit Activity is the lineage store, and only account merges write one.
