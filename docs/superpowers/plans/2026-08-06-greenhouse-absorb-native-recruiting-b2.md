# Greenhouse Absorb — native recruiting backend (BI-E64D11AE), batch 2

- **BI:** BI-E64D11AE — *Absorb: surface the Greenhouse pipeline on the native recruiting surface*, epic EP-ECOSYSTEM-ABSORPTION-ARCH.
- **Design:** [docs/superpowers/specs/2026-08-05-greenhouse-ats-absorption-design.md](../specs/2026-08-05-greenhouse-ats-absorption-design.md) §4 Phase 2 (Absorb), §2.1 (Seam A).
- **Builds on:** the merged native recruiting models (BI-F3AEBF68, PR #4053) + the import-review staging store + `MasterDataSourceRef`.

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Goal & boundary

The **backend of Absorb**: make the Greenhouse pipeline native-visible as one funnel, with no lossy promotion. Pure lib modules — no schema change, no new route, no UI (the pipeline UI page + connect page are batch 3, sequenced to keep the UX-Fit/route gauntlet out of this PR). Typed relations from the recruiting models to People-Core (Position/Department/EmployeeProfile) are deferred to coordinate with the HCM owners (design §9: BI-41901810, BI-HCM-003).

## Phases (all shipped together — atomic)

1. **Recruiting crosswalk** (`apps/web/lib/recruiting/recruiting-crosswalk.ts`) — generalizes Seam A: register/resolve/bulk-load `MasterDataSourceRef` soft-refs for `recruiting-*` domains (connector-agnostic; Fountain/Workday reuse it). *Verify:* upsert on the unique key, resolve hit/miss, bulk map.
2. **Dual-read pipeline read-model** (`apps/web/lib/recruiting/pipeline-read-model.ts`) — `getRecruitingPipeline` unions native `Application`s with Greenhouse-staged application records, deduping staged rows already crosswalked to a native row (one funnel; design §4 Phase 2 dual-read). *Verify:* union + counts, dedupe by crosswalk, displayFields projection, requisition filter.
3. **Hire → native promotion** (`apps/web/lib/recruiting/promote-hire.ts`) — `promoteGreenhouseHireToNative` turns a Greenhouse hire into a native `Candidate` + hired `Application`, crosswalked and idempotent; complements the batch-1 hire→worker `EmployeeProfile` landing. *Verify:* create + 2 crosswalks, idempotent re-run, candidate reuse, null-application fallback.

## Risks & rollback

- Read-model reads only; promotion writes native rows idempotently (crosswalk unique key). No existing table touched, no migration. Rollback = delete the three lib files; the crosswalk rows are inert `MasterDataSourceRef` soft-refs.
- Staged records carry only redacted `displayFields`, so the Greenhouse side of the funnel is low-fidelity by design (full-fidelity durable promotion via Harvest re-fetch is a follow-up).

## Completion gate

`dpf-local-merge-ci-before-push` (or the recorded infra override) + `dpf-pr-with-dco`. 12 unit tests, tsc + all 24 guards clean locally.

## Backlog coverage

- **Decision:** `atomic` — one BI (BI-E64D11AE); the three modules ship together as the absorb backend.
- **Receipt:** `cmsh1937t01g501pra63r66sj` (recorded 2026-08-06 against BI-E64D11AE).
- **Deliverables (none independently shippable):** recruiting-crosswalk → pipeline-read-model + promote-hire.
- **Deferred (separate batch):** pipeline UI page + connect UI page (UX-Fit/route gauntlet); typed People-Core relations (coordinate with HCM owners BI-41901810 / BI-HCM-003).
