# Platform Adequacy Roadmap Backlog Map

Date: 2026-07-27

Source review: [2026-06-22 platform adequacy architecture review](2026-06-22-platform-adequacy-architecture-review.md)

Source PR: https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3642

## Purpose

This document converts the platform adequacy architecture review into durable follow-up work. It is intentionally not a new implementation plan and not a substitute for the live backlog. The backlog remains the system of record; this file explains how the review's recommendations map to existing and newly filed `BI-*` items.

The operator question was whether the recommendation and findings should survive this task if the conversation is lost. This map is the recovery artifact: future agents can start here, then use the live backlog items below for execution.

## Decision

WWMD / `principle_decide` was run on 2026-07-27 with four options:

| Option | Result |
| --- | --- |
| `file_sparse_cross_cutting_gates` | Recommended, composite 16.512, margin 5.943, high confidence |
| `annotate_existing_only` | Composite 10.569 |
| `file_one_large_umbrella` | Composite 9.274 |
| `draft_doc_only` | Composite 4.892 |

Signal quality was usable, structured coverage was strong, semantic fallback ratio was 0, and no commandment conflict fired.

Decision: file only genuinely missing cross-cutting gates, and map everything else to existing BIs and epics. Do not create a large umbrella BI or a doc-only roadmap.

## New Live Backlog Items

These four items were filed in the live backlog as `status=triaging`, `proposedOutcome=build`, `effortSize=large`, `type=portfolio`, `workType=feature`, `source=user-request`.

| BI | Title | Epic | Why it exists |
| --- | --- | --- | --- |
| `BI-C1C706F1` | Archetype readiness matrix and sales-claim gate | `EP-PLATFORM-SUBSTRATE-CONVERGENCE` | The review needs an evidence-backed matrix that separates template-ready, ops-ready, connector-ready, regulated-ready, and sole-platform-ready before public or sales-facing claims can imply one-platform adequacy. |
| `BI-903F5A94` | Sole-platform operational readiness evidence gate | `EP-UPGRADE-LIFECYCLE` | DR, backup, restore, self-upgrade, migration safety, and health evidence exist as separate workstreams; owners need one readiness verdict for relying on DPF as the primary operating system. |
| `BI-4C16947C` | Whole-account export and restore-grade data portability | `EP-DATA-GOVERNANCE` | Table-level exports are not enough for sole-platform trust. Owners need a restorable, verifiable account-level exit package. |
| `BI-35E9EE62` | Universal AI business-record action envelope and reversibility matrix | `EP-2984B02B` | Existing proposal, attention, and Work Case receipts are not yet proven universal across every AI path that mutates business records. |

## Existing Coverage

The following review recommendations already have owning backlog or epic coverage and should not be refiled as duplicates.

| Review Area | Existing Owner | Current Disposition |
| --- | --- | --- |
| Typed archetype contribution substrate | `BI-PSC-010` | Open under `EP-PLATFORM-SUBSTRATE-CONVERGENCE`; this is the keystone dependency for readiness matrix rollups. |
| Vertical workspace home substrate | `BI-1CCC6264`, `BI-3E8D2CF5`, `BI-CE6AF925` | Substrate and HVAC slice are done or open as targeted follow-up under `EP-REDUCTION-GEAR-ARCH`. |
| Field operations presence, dispatch, assets, and evidence packets | `BI-FIELDOPS-001`, `BI-FIELDOPS-004`, `EP-FIELD-OPS-SUBSTRATE`, `EP-TRADES-FIELD-SERVICE` | Live backlog covers the field-ops substrate and trade-specific readiness. Note: `EP-FIELD-OPS-SUBSTRATE` currently reports status `done` while its five items are still open, so epic rollup hygiene should be checked before using the epic status as readiness evidence. |
| Incumbent application coverage and gap-to-backlog | `BI-E4162824`, `BI-F4EE0E48`, `BI-69B957E4`, `BI-A19FE7A2`, `EP-ASSET-INTELLIGENCE` | Existing asset-intelligence work covers current-app intake, coverage verdicts, gap-to-backlog, and cost/entitlement binding. |
| MDM readiness and survivorship | `BI-MDM-201`, `BI-MDM-202`, `BI-MDM-203`, `EP-MDM` | Open BIs cover identity source observations, survivorship, protected value provenance, publish/retraction, and graduated autonomy. |
| Data governance foundation | `BI-DG-005`, `BI-DG-006`, `BI-DG-008`, `BI-DG-014`, `BI-DG-015`, `BI-DG-016`, `EP-DATA-GOVERNANCE` | Existing work covers data-domain classification, derived-data contracts, deletion propagation, subject requests, operation journals, and the admin data workspace. New export work should reuse this substrate. |
| Backup and DR hardening | `BI-EA67A758`, `BI-3849A48B`, `EP-DR-HARDENING-2026-05-23` | The silent backup corruption/trial-restore alert item is now done. Remaining DR items still need to feed the new sole-platform evidence gate. |
| Self-upgrade lifecycle and migration safety | `BI-204DE05B`, `BI-76651B7`, `BI-D47955AF`, `EP-UPGRADE-LIFECYCLE` | Upgrade and migration evidence exists as live work, including current blockers. The new gate should aggregate these instead of replacing them. |
| Regulated-boundary policy packs | `BI-F6018DB3`, `EP-DATA-GOVERNANCE` | Existing work covers vertical sensitive-data and regulated-boundary policy packs. Regulated commercial claims should be governed by `BI-C1C706F1` rather than a separate duplicate at this stage. |

## Execution Sequence

Recommended order:

1. Start with `BI-C1C706F1` and `BI-PSC-010`.
   The readiness matrix is the claim-control spine. Without it, platform language, public docs, and vertical readiness work can continue to overstate or understate what is actually ready.

2. Build `BI-903F5A94`.
   Sole-platform adequacy needs one owner-readable operational verdict across upgrade, backup, restore, migration, alerting, and rollback evidence.

3. Build `BI-4C16947C`.
   Data portability is a trust boundary. It should reuse `EP-DATA-GOVERNANCE` primitives rather than creating a parallel export path.

4. Build `BI-35E9EE62`.
   AI action integrity must become universal before DPF can safely present coworkers as operating-system-level actors for business records.

5. Continue vertical depth through existing readiness epics.
   Vertical workspace homes, field-ops substrate, MDM, incumbent coverage, finance/billing readiness, and archetype-specific packs are already in the live backlog. Execution should extend those lanes rather than creating another central meta-program.

## Gap Analysis By Platform Adequacy Dimension

| Dimension | Adequacy Position | Gap To Close |
| --- | --- | --- |
| Resilience | Architecture is moving toward install-survivable operation, but evidence is fragmented across DR, self-upgrade, and migration work. | `BI-903F5A94` must turn the fragments into a sole-platform readiness verdict. |
| Scalability | The monorepo and substrate model can scale across archetypes if the platform keeps shared engines instead of vertical forks. | `BI-C1C706F1` and `BI-PSC-010` must keep archetype contributions typed and readiness-gated. |
| Reusability | Shared substrate exists for workspace homes, field operations, data governance, MDM, and Work Case actions. | New work should reuse those substrates and file child gaps only where a domain cannot conform. |
| Archetype Coverage | Coverage is broad, with many vertical readiness epics now present. Depth is uneven. | Use the readiness matrix to distinguish what is template-ready versus actually ops-ready or sole-platform-ready. |
| Operator Trust | The system has strong direction, but owner-facing evidence for safety, exit, and AI mutation control is not yet complete. | Close the operational gate, restore-grade export, and universal action-envelope gaps before claiming one-platform adequacy. |
| Regulated Readiness | Sensitive-data and regulated-boundary policy work exists, but commercial assurance is not a universal claim yet. | Gate regulated claims through the readiness matrix and `BI-F6018DB3`; do not market regulated readiness without evidence. |

## Guardrails For Future Agents

- Do not create a new umbrella epic unless live epic overlap is rechecked and the kernel decision is superseded.
- Do not treat this document as the source of truth for execution state. Query the live backlog before acting.
- Do not mark an archetype sole-platform-ready from seed/template presence alone.
- Use `packages/storefront-templates/src/archetype-readiness.ts` as the executable source for readiness tiers and claim checks.
- Do not mark an install sole-platform-ready without a passing `evaluateSolePlatformReadiness` verdict from `apps/web/lib/operate/sole-platform-readiness.ts`.
- Do not bypass `EP-DATA-GOVERNANCE` for export or portability work.
- Do not bypass Work Case, Attention Surface, or action-receipt substrate for AI business-record mutations.
- If public-site, docs, or sales language changes before a surface consumes the claim helper directly, use a manual claim review against `evaluateArchetypeReadinessClaim`.

## Recovery Notes

This map was produced from worktree:

`D:/DPF-worktrees/platform-adequacy-roadmap-backlog`

Branch:

`doc/platform-adequacy-roadmap-backlog`

Work Capsule:

`WC-A8D21315`

Created live BIs:

- `BI-C1C706F1`
- `BI-903F5A94`
- `BI-4C16947C`
- `BI-35E9EE62`

Kernel recommendation:

`file_sparse_cross_cutting_gates`
