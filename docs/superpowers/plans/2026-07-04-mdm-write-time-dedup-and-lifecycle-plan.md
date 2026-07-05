---
title: MDM Write-Time Dedup & Lifecycle/Merge — Implementation Plan
authoredAt: 2026-07-04
authoredBy: claude
planFor: BI-2CC07AE8
epic: EP-4A12A7CB
spec: docs/superpowers/specs/2026-07-04-mdm-write-time-dedup-and-lifecycle-design.md
status: approved
---

# MDM Write-Time Dedup & Lifecycle/Merge — Implementation Plan

Implements WG-1..WG-4 (BI-2CC07AE8, BI-CCC8506C, BI-F6F2A00E, BI-5123C9E6)
under EP-4A12A7CB against the approved 2026-07-04 spec. The refiled MDM-3/4/6/7
BIs (BI-FEA49EC1, BI-16450BB2, BI-1E03B447, BI-1ABF6443) are NOT in this plan.

## Definition of done

Spec §7 acceptance criteria hold on a live install — the Emma3D duplicate
cannot be silently re-created from UI or coworker tool, and the two existing
Emma3D prospects can be merged with full FK + soft-ref repointing, tombstone,
and audit snapshot.

## Binding decisions

- Gate placement: explicit guarded-create service + coverage-guard test
  (kernel 2026-07-04, tie broken by operator directive; spec §4).
- Merge shape: shared orchestrator + domain adapters with declared soft
  references + DMMF completeness test (kernel 2026-07-04, high confidence).
- Merge severity: tombstone only (kernel 2026-06-06, carried forward).
- No unique constraint on account name/domain; partial unique on
  `CustomerSite (accountId, nameNormalized)` with in-migration remediation.

## Substrate notes (verified 2026-07-04 on origin/main 799e6e3bc)

Soft `customerAccountId String?` pointers (owning model — FK-relation
presence to be confirmed per-model via DMMF during Phase 4): ServiceTicket,
DiscoveryRun, InventoryEntity, InventoryRelationship, PortfolioQualityIssue,
MasterDataSourceRef, DiscoveryConnection, EdgeNode, RemoteAction,
SecurityEvent, Detection, SecurityCase, JournalLine. `customerSiteId
String?`: ServiceTicket, DiscoveryRun, InventoryEntity,
InventoryRelationship, PortfolioQualityIssue, DiscoveryConnection, EdgeNode.

## PR slicing

Two PRs, each independently green and shippable:

1. **PR-1 (WG-1 + WG-2 + WG-3):** schema migration (normalized columns,
   pg_trgm, site partial unique), dedup-gate service + tests, wiring into all
   registered create paths, MCP tool contract + descriptions, `+ New Account`
   picker. One concern: "no silent duplicate creates."
2. **PR-2 (WG-4):** lifecycle status values (enum registration in backlog.ts +
   mcp-tools.ts same commit), mergedIntoId columns, merge orchestrator +
   customer-account/customer-site adapters + completeness test, admin merge
   surface, `merge_customer_accounts` tool, default-read exclusions. One
   concern: "duplicates can be merged."

## Phase detail

### Phase 1 — schema + gate (WG-1)
- Migration `add_mdm_normalized_columns_and_trgm`: `CREATE EXTENSION IF NOT
  EXISTS pg_trgm`; add `nameNormalized`/`domainNormalized` to CustomerAccount,
  `nameNormalized` to CustomerSite + CustomerContact (all `TEXT NOT NULL
  DEFAULT ''`); backfill via UPDATE using SQL-side lower/regexp approximating
  `standardizeName` (documented divergence acceptable — the reconcile sweep
  converges rows to the TS canonical form); remediate duplicate site names
  per account (append ` (2)`); partial unique index on site; GIN
  `gin_trgm_ops` index on account nameNormalized; plain indexes elsewhere.
  `-- @migration-safety` attestations per guard.
- `apps/web/lib/mdm/dedup-gate.ts`: `checkDuplicates`, `resolveOrCreate`
  helper, `GATED_CREATE_PATHS` registry; raw SQL candidate fetch
  (`$queryRaw` with `similarity()`); scoring via existing match-candidate.
- Reconcile sweep reusing the §6.2 orphan-sweep slot: recompute normalized
  columns where drifted.
- Tests: gate verdicts (clear/possible/likely), tombstone exclusion,
  coverage-guard, normalized backfill idempotence.

### Phase 2 — create-path wiring (WG-2)
- `createCustomerAccount(input, dedup?: DedupResolution)` → gate-first;
  returns `{duplicates}` instead of throwing, for UI consumption.
- Contact create sites: gate the two *user-intent* paths (api/v1 contacts
  route, finance.ts walk-in) with use-existing semantics; sign-up/social-auth
  paths keep email-unique behavior (identity flows, not master-data intent)
  but write nameNormalized.
- MCP `create_customer_account`: `duplicateResolution`/`duplicateReason`
  params; `duplicates_found` structured error; description rewrite (required
  vs optional per field + when NOT to create). Update mcp-tools-crm tests.

### Phase 3 — picker UI (WG-3)
- `NewCustomerButton`: submit → server action returns candidates → inline
  candidate list, Use-this-account navigates, Create-anyway with reason gate
  for likely-duplicate. Theme-aware styling (AGENTS.md §12).

### Phase 4 — lifecycle + merge (WG-4)
- Migration: `mergedIntoId` (self-FK) on CustomerAccount + CustomerSite;
  status unions extended (`superseded`, `archived`) in backlog.ts +
  mcp-tools.ts same commit.
- `apps/web/lib/mdm/merge.ts` orchestrator +
  `apps/web/lib/mdm/merge-adapters/customer-account.ts` (+ customer-site).
  Hard-relation list from schema; soft refs from the substrate-notes sweep.
- Collision planners: child sites repointing into survivor with name
  collision → merge site-into-site (reference-data-merge precedent);
  ContactAccountRole duplicate (contactId, accountId) → keep earliest
  startedAt, end the loser row; AccountInvite/BootstrapToken pass-through.
- Admin merge surface on account detail + `merge_customer_accounts` MCP tool
  (steward capability, sideEffect true).
- Default-read exclusions: list surfaces, typeahead, coworker list tools.
- Tests: orchestrator invariants, adapter completeness (DMMF diff), collision
  plans, tombstone read exclusion, tool contract.

## Verification

- Unit: vitest per file. Build gate: `pnpm --filter web typecheck` in
  worktree; production build + migration apply via CI (worktree is
  source-only per readiness classification).
- Functional (live install, post-merge deploy): drive `+ New Account` with
  "Emma 3D"; drive coworker create via tool; merge the live Emma3D
  duplicates. Preflight per dpf-verify-on-live-install before claiming.

## Risks

- **Fleet-safe migrations**: site partial-unique must remediate first (guard
  enforces). pg_trgm ships in postgres:16-alpine contrib — no image change.
- **SQL vs TS normalization drift**: backfill approximates in SQL; sweep +
  gate rewrite converge. Documented in-file.
- **Soft-ref completeness**: DMMF test covers the FK side; the soft side is
  declared in adapters and reviewed in PR — a soft ref added later without
  adapter registration is the residual risk, mitigated by the schema comment
  convention and the conformance sweep.

## Slice 2 (2026-07-05): market-gap closure — update-dedup, batch scan, unmerge

Filed from the post-ship market-gap analysis (8 BIs on EP-4A12A7CB); built in
PR feat/mdm-gaps-update-batch-unmerge: BI-AEA97829 (update-path gate w/
excludeId + parseDedupResolution + PATCH coverage registration), BI-7BF995B9
(batch-scan.ts + DuplicateAccountsPanel + find_duplicate_customer_accounts),
BI-F7B6D55E (repointedIds lineage in MergeResult + unmergeRecords +
UnmergeCustomerAccountButton + unmerge_customer_accounts). Remaining filed,
not built: BI-130EF887 (attribute history), BI-37F52B70 (match tuning),
BI-A4B73F87 (multi-source), BI-77489158 (DQ scorecard), BI-2D435AFC
(enrichment).
