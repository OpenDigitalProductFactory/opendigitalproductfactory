# Portal Architecture Hardening Findings

> **Status:** analysis-only architecture review (research & documentation).  
> **Date:** 2026-08-09 (live backlog / MCP re-check during the same investigation window; some activity timestamps land 2026-08-10 UTC).  
> **Scope:** Holistic portal architecture quality — stability, scalability, reliability, upgradeability, supportability — plus related concerns (resilience, security, observability, maintainability, AI-action integrity).  
> **Non-implementation:** This document does **not** change production behavior, open migrations, refactor runtimes, or re-open the memory/build optimization implementation work under the analysis banner. Recommendations map to existing BIs/epics; they do **not** create a new umbrella program.
>
> **Program home (organized 2026-08-10):** Live epic **`EP-413F2602`** (Whole-Platform Architecture Hardening). Session sequencing: [`docs/superpowers/plans/2026-08-09-architecture-hardening-session-plan.md`](../superpowers/plans/2026-08-09-architecture-hardening-session-plan.md). Program BI: `BI-C04CAD7F`. New gap BI for silent caps: `BI-72C3FBA2`. Roadmap BI: `BI-D938AB7A`.

---

## 1. Purpose

After recent work to free host memory and optimize the build process (context: BuildKit lifecycle and install resource bounding — see `BI-C85D1B0A`, `BI-4F3AB6B3`), this review asks a broader question:

**Where can we harden the portal architecture overall so DPF matches or exceeds what best-in-class platforms emphasize — without inventing parallel programs that ignore existing ownership?**

Secondary goal: treat **architectural drift** (doctrine vs code, dual homes, stale claims, unenforced contracts, substrate forks) as a first-class output with severity and mitigation shape.

---

## 2. Method

1. **Re-ground in prior platform architecture evidence** (especially the 2026-06-22 platform adequacy review and 2026-07-27 roadmap/backlog map).
2. **Re-verify live and source state** where those snapshots may be stale — live DPF MCP backlog (`list_epics`, `list_backlog_items`, `get_backlog_item`, `search_knowledge`) plus repo inspection (schema model count, readiness module, application-boundary registry, silent-cap patterns, OTel flag).
3. **Score against classic quality dimensions** named in the objective, using external lenses already used in-repo (ISO/IEC 25010, Twelve-Factor, NIST CSF framing from the prior review).
4. **Prefer mapping findings to existing owners** (`EP-413F2602`, `EP-PLATFORM-SUBSTRATE-CONVERGENCE`, `EP-UPGRADE-LIFECYCLE`, `EP-DR-HARDENING-2026-05-23`, the four sparse cross-cutting gates from 2026-07-27) over filing duplicate umbrellas.
5. **Label hypothesis vs fact.** Snapshot counts and BI statuses expire; any number here is evidence with an expiry.

This is a review artifact, not a build-gate artifact. No production build, UX walkthrough, or migration apply was run for this document.

---

## 3. Evidence base & prior-review lineage

| Artifact | Why consulted |
| --- | --- |
| [`docs/architecture/2026-06-22-platform-adequacy-architecture-review.md`](2026-06-22-platform-adequacy-architecture-review.md) | Primary prior holistic review (resilience, security, observability, scalability, AI integrity, commercial readiness). |
| [`docs/architecture/2026-07-27-platform-adequacy-roadmap-backlog-map.md`](2026-07-27-platform-adequacy-roadmap-backlog-map.md) | Maps adequacy recommendations to sparse live BIs; guardrails against umbrella duplication. |
| [`docs/architecture/orientation.md`](orientation.md) | Living stack / migration / archetype orientation. |
| [`docs/architecture/package-boundaries.md`](package-boundaries.md) | Portable vs server package rule + guards. |
| [`docs/architecture/platform-substrate-boundaries.md`](platform-substrate-boundaries.md) | Capability-activated topology + static/runtime ratchets. |
| [`docs/architecture/application-boundaries.md`](application-boundaries.md) | Modular-monolith dependency direction (BI-2E9F6D37 landed). |
| [`docs/superpowers/audits/2026-07-24-agents-md-runtime-assumption-audit.md`](../superpowers/audits/2026-07-24-agents-md-runtime-assumption-audit.md) | Doctrine vs runtime-fact drift on the instruction plane. |
| [`docs/superpowers/specs/2026-05-09-deployment-contracts.md`](../superpowers/specs/2026-05-09-deployment-contracts.md) | Canonical deploy/lifecycle contracts every substrate must wrap. |
| [`docs/operations/disaster-recovery.md`](../operations/disaster-recovery.md) | DR runbook presence (DR epic item done). |
| [`docs/professions/qa-engineer/wiki/iso-25010-quality-model.md`](../professions/qa-engineer/wiki/iso-25010-quality-model.md) | In-repo ISO 25010 vocabulary. |
| Root [`AGENTS.md`](../../AGENTS.md) | Single-source-of-truth, canonical runtime, build gate, migration safety. |
| Live MCP (2026-08-09 investigation) | Status of mapped BIs/epics; open hardening backlog. |
| Source spot-checks | Prisma model count; `archetype-readiness.ts`; `take: 1_000` federation path; OTel exporter flag; application-boundaries exceptions. |

### 3.1 What moved since 2026-06-22 / 2026-07-27

| Area | Prior snapshot | Re-verified 2026-08-09 |
| --- | --- | --- |
| Silent backup trial-restore alert (`BI-EA67A758`) | Open P1 | **Done** (critical `PlatformNotification` + `pg_restore --list` validation on main) |
| Archetype readiness matrix (`BI-C1C706F1`) | Newly filed, triaging | **In progress**; executable `packages/storefront-templates/src/archetype-readiness.ts` exists with tiers + `evaluateArchetypeReadinessClaim` |
| Operator readiness surface (`BI-1A222A7A`) | Not in July map | **In progress** under `EP-PLATFORM-SUBSTRATE-CONVERGENCE` |
| Sole-platform evidence gate (`BI-903F5A94`) | Newly filed | **In progress** (plan coverage recorded; not done) |
| Whole-account export (`BI-4C16947C`) | Newly filed | **In progress** (not done) |
| Universal AI action envelope (`BI-35E9EE62`) | Newly filed | **In progress** (not done) |
| Whole-platform hardening epic | Not yet as `EP-413F2602` | **In progress** — `EP-413F2602` with 13 items (2 done, 1 in-progress umbrella, rest open/deferred) |
| Application bounded contexts | Gap | **First cohort landed** — `application-boundaries.md` + `scripts/application-boundaries.json` (8 contexts; **65** accepted reverse-import exceptions) |
| Substrate convergence PSC-001…003 | Planned | **Done** (topology budgets, connector kernel, capability-driven Compose) |
| PSC-004…011 | Open | Still **open** (durable execution, Prisma decomposition, observability profile, typed contribution registry, …) |
| Prisma model breadth | ~424 (June review narrative) | **589** models in `packages/db/prisma/schema.prisma` (source count; treat as snapshot) |
| Archetype catalog | 95 leaves / 21 categories (July doc sweep) | **~106** top-level `archetypeId`s / **24** category modules under `packages/storefront-templates/src/archetypes/` |
| Memory / build footprint | Not central to June review | Active: `BI-C85D1B0A` (BuildKit session lifecycle), `BI-4F3AB6B3` (born-bounded install resources), `BI-A0A0568F` (TTS idle) |

**Lineage verdict:** The June commercial/GTM thesis and the July sparse-gate decision remain valid. Progress is real on DR alerting, readiness substrate, package/application boundaries, and substrate measurement — but the **sole-platform evidence gates are still incomplete**, and breadth (models, archetypes, vertical epics) continues to outrun operational depth.

---

## 4. Executive verdict

DPF remains a **strong foundation with unusually deep governance and delivery doctrine** for an SMB-facing local-first platform. Relative to best-in-class architectures, it is **ahead on intentional control-plane design** (MCP grants, Work Capsules, self-upgrade ownership, principle-driven decisions, fitness guards) and **still behind on day-2 sole-platform evidence** (aggregated readiness verdict, restore-grade exit, universal mutation envelope, production observability, resource bounding by default).

The dominant architectural risk is unchanged in kind from June, sharpened in form:

1. **Breadth outrunning evidence-backed depth** (catalog and schema growth vs readiness matrix consumption).
2. **Fragmented resilience/upgrade evidence** (many good pieces; no owner-facing sole-platform verdict yet — `BI-903F5A94`).
3. **Unbounded host and query surfaces** (compose/WSL without born-in limits; silent `take: 1_000` cliffs; idle BuildKit multi-GiB RSS).
4. **Drift between doctrine, baselines, and lived runtime** (contingency markers, exception debt, dual claim surfaces).

**Do not** open a second “platform redesign” umbrella. Prefer finishing and wiring the existing hardening spine:

- `EP-413F2602` (architecture hardening program)
- `EP-PLATFORM-SUBSTRATE-CONVERGENCE` (topology, connectors, footprint)
- `EP-UPGRADE-LIFECYCLE` + `EP-DR-HARDENING-2026-05-23` (upgrade/DR)
- The four July gates: `BI-C1C706F1`, `BI-903F5A94`, `BI-4C16947C`, `BI-35E9EE62`

---

## 5. Quality-dimension findings

Ratings are relative to **sole-platform / appliance-grade SMB install**, not generic SaaS multi-tenant scale (unless noted). “Best-in-class focus” states what leaders emphasize; “DPF posture” is evidence-backed current state.

### 5.1 Stability

| | |
| --- | --- |
| **Best-in-class focus** | Fail-closed invariants, deterministic recovery, bounded blast radius, no silent data loss, predictable failure modes. |
| **Current posture** | **Medium-high for foundation; medium for fleet.** Strong: migration-safety guard, package-boundary guard, application-boundary guard, substrate non-increasing ratchets, self-upgrade fail-closed migrate-before-swap doctrine, trial-restore path with operator alert (now done). Weak: residual deferred DR/self-upgrade landmines; host resource ratchet without install-time ceilings; silent query caps. |
| **Evidence** | `docs/architecture/application-boundaries.md`; `scripts/check-package-boundaries.mjs`; migration-safety guard doctrine in `orientation.md`; `BI-EA67A758` done; open `BI-D47955AF`, `BI-ADCD66D1`, `BI-72EE3573`. |
| **Gaps / hardening** | Close deferred upgrade/DR blockers that can wedge or mis-promote; make “born-bounded” the default (`BI-4F3AB6B3`); ban silent full-batch caps without cursor/warn (architecture-review scalability standing rule; live example `apps/web/lib/federation/demand-response.ts` `take: 1_000`). |
| **Owners** | `EP-UPGRADE-LIFECYCLE`, `EP-DR-HARDENING-2026-05-23`, `EP-413F2602` / `BI-4F3AB6B3`, architecture review skill + future fitness suite `BI-1F3E083E`. |

### 5.2 Scalability

| | |
| --- | --- |
| **Best-in-class focus** | Explicit scale ceilings, horizontal growth paths, bounded queries, incremental/delta processing, isolation of expensive work, capacity budgets as product features. |
| **Current posture** | **Medium for one-install-per-business; unproven for multi-tenant hosted.** Local-first + edge-node doctrine is coherent for sovereign SMB installs. Schema breadth (589 models) and always-on service set create **vertical complexity scale** even when tenant count is 1. Federation path still has a hard 1_000 mirror batch without cursor. |
| **Evidence** | Prisma model count snapshot 589; `platform-substrate-boundaries.md` budgets; `BI-C85D1B0A` measured idle BuildKit ~2.75 GiB + dual policy builders; federation `take: 1_000`; architecture skill text explicitly calls this cliff class. |
| **Gaps / hardening** | (1) Resource budgets as release gate (`BI-4F3AB6B3` workstream 5). (2) Build-session lifecycle so idle build substrate does not own multi-GiB forever (`BI-C85D1B0A`). (3) Query/pagination fitness checks as part of `BI-1F3E083E`. (4) Prisma bounded-context ownership (`BI-PSC-006`) before model count becomes ungovernable. (5) Keep scaling claim honest: one install per business ≠ multi-tenant SaaS. |
| **Owners** | `EP-PLATFORM-SUBSTRATE-CONVERGENCE`, `EP-413F2602`, `BI-PSC-006`. |

### 5.3 Reliability (incl. resilience / recoverability)

| | |
| --- | --- |
| **Best-in-class focus** | Backup integrity, tested restore, multi-store consistency, RPO/RTO stated and drilled, chaos/failure injection, degraded modes. |
| **Current posture** | **Medium; improving.** Postgres backup + daily trial-restore + critical notifications + DR runbook exist. Gaps: off-host backup, PITR, and any non-Postgres derived-store restore paths remain future work; portal recover-from-backup UX deferred (`BI-3849A48B`); sole-platform readiness **verdict** still in progress (`BI-903F5A94`); self-upgrade still has open failure and mid-flight observation work. |
| **Evidence** | `EP-DR-HARDENING-2026-05-23` — most original items done; remaining mostly deferred recover/promote/self-heal; `docs/operations/disaster-recovery.md`; `BI-903F5A94` in progress; `BI-AF4D4F23` background-operation observation in progress. |
| **Gaps / hardening** | Finish sole-platform evidence gate as the **aggregation** of existing DR/upgrade probes (do not re-implement DR). Expand trial-restore beyond Postgres when graph/vector become load-bearing for the install. Restore-grade account export (`BI-4C16947C`) is part of reliability *and* trust. |
| **Owners** | `BI-903F5A94`, `EP-DR-HARDENING-2026-05-23`, `EP-UPGRADE-LIFECYCLE`, `BI-4C16947C` / `EP-DATA-GOVERNANCE`. |

### 5.4 Upgradeability

| | |
| --- | --- |
| **Best-in-class focus** | Forward-only schema evolution, shadow testing, atomic promote/rollback, identity of deployed bytes, unattended remediation, seed reconciliation. |
| **Current posture** | **Medium-high design; medium execution reliability.** Strengths: image identity == bytes doctrine; governed `/ops/self-upgrade`; migrate pre-swap; migration-safety expand/contract rules; substrate stabilization items done. Weaknesses: deferred shadow-DB preflight (`BI-204DE05B`), seed snapshot merge-base (`BI-3DA77DD7`), open self-upgrade failure BIs and host-identity wedge history (`BI-D47955AF`), contributor-preview migration skew (`BI-4DB4B415`). |
| **Evidence** | Live `EP-UPGRADE-LIFECYCLE` item list; orientation migration safety; deployment contracts spec. |
| **Gaps / hardening** | Prioritize unattended-safe remediation (`BI-9A00FBC4`), dispatch/retry (`BI-ADCD66D1`), observation contract (`BI-AF4D4F23`), then shadow preflight. Treat every deferred “landmine” item as upgradeability debt with explicit severity, not backlog noise. |
| **Owners** | `EP-UPGRADE-LIFECYCLE` (primary), fleet-safe schema design under migration-safety. |

### 5.5 Supportability (incl. operability & maintainability)

| | |
| --- | --- |
| **Best-in-class focus** | One operator narrative (“is this install healthy?”), structured logs/metrics/traces, runbooks, progressive disclosure for non-technical owners, low cognitive load for support staff. |
| **Current posture** | **Medium.** Runtime-health surfaces, `PlatformNotification`, backup health card, DR runbook, and agent process spine are strong for a young platform. OTel export remains feature-flagged off (`DPF_GEAR_OTEL_EXPORT` in `apps/web/lib/gear-interface/otel-exporter.ts`). Platform/admin complexity still leaks. Instruction-plane runtime assumptions require contingency markers (`2026-07-24` audit). |
| **Evidence** | OTel exporter + June review gap; `BI-PSC-008` open (core truth vs deep observability profile); AGENTS runtime-assumption audit; complexity-shield standards. |
| **Gaps / hardening** | (1) Sole-platform readiness verdict as the support front door (`BI-903F5A94`). (2) Decide OTel graduation vs lean optional profile (`BI-PSC-008`) — do not leave Phase-0 forever. (3) Continue UI progressive disclosure so support is not “read the monorepo.” (4) Living architecture inventory gate (`BI-FDA5DC4C`). |
| **Owners** | `BI-903F5A94`, `BI-PSC-008`, `EP-DOCS-SYSTEM`, `BI-FDA5DC4C`. |

### 5.6 Security & data protection (related)

| | |
| --- | --- |
| **Best-in-class focus** | Defense in depth, encryption at rest, least privilege, continuous control evidence, portable exit, regulated attestations when claimed. |
| **Current posture** | **Medium for non-regulated; not regulated-grade.** MCP scopes + tool grants + `ToolExecution` receipts are differentiators. Business data encryption remains host/volume-level; whole-account export incomplete; recursive compliance epic open (`EP-CF64D652`). |
| **Evidence** | June review Critical Gap 6; `BI-4C16947C` in progress; `EP-CF64D652` 9 open items. |
| **Gaps / hardening** | Keep regulated claims gated by readiness matrix; finish portability; advance control-evidence automation rather than parallel compliance engines. |
| **Owners** | `EP-DATA-GOVERNANCE`, `EP-CF64D652`, `BI-C1C706F1` claim gate. |

### 5.7 Observability (related)

| | |
| --- | --- |
| **Best-in-class focus** | Traces/metrics/logs as product, SLOs, uniform alerting spine, synthetic probes. |
| **Current posture** | **Medium-low production; foundation present.** Alerting spine improved (trial-restore). OTel still off by default. No platform-wide SLO contract. Fitness suite for load/resilience not built (`BI-1F3E083E` open). |
| **Owners** | `BI-PSC-008`, `BI-1F3E083E`, `BI-903F5A94`. |

### 5.8 AI-action integrity (signature risk)

| | |
| --- | --- |
| **Best-in-class focus** | Every mutation attributed, reversible or compensated, human-gated by risk class, uniformly enforced. |
| **Current posture** | **Medium-high design; incomplete universal enforcement.** Propose→approve→commit and Work Case receipts are real. Universal envelope + reversibility matrix still **in progress** (`BI-35E9EE62`). |
| **Owners** | `BI-35E9EE62` / `EP-2984B02B` and child domain gaps only after contract lands. |

### 5.9 Maintainability & evolvability (related)

| | |
| --- | --- |
| **Best-in-class focus** | Bounded contexts, acyclic deps, living docs, debt budgets with expiry, continuous architecture fitness. |
| **Current posture** | **Medium-high trajectory.** First application-boundary cohort + package boundaries + substrate budgets are best-in-class *as control design*. Debt: 65 reverse-import exceptions; ActorContext transport-neutral services still open (`BI-963F4226`, `BI-58810028`); debt burn-down budgets with expiry open (`BI-7B803E60`); high-coupling refactor open (`BI-B970B01D`). |
| **Owners** | `EP-413F2602` children; do not spawn a parallel “clean architecture” epic. |

---

## 6. Best-in-class comparison

External lenses already used in DPF reviews (re-cited, not a vendor bake-off):

| Lens | What leaders emphasize | Where DPF is **strong** | Where DPF is **behind** | Where DPF is **drifting** |
| --- | --- | --- | --- | --- |
| **ISO/IEC 25010** (product quality) | Explicit trade-offs across reliability, security, maintainability, performance efficiency, flexibility | Vocabulary in QA wiki; architecture review skill operationalizes scalability + data form | Performance efficiency under concurrent build/agent load not fitness-tested; safety/regulated characteristics incomplete | Schema/archetype growth without readiness evidence looks like “functional suitability” wins over reliability |
| **Twelve-Factor** | Config, backing services, logs as streams, disposability, parity, admin processes | Deployment contracts; secrets contract; self-upgrade as first-class admin process; local/prod process discipline via compose | Logs/metrics not yet a first-class export pipeline (OTel off); process disposability weak when BuildKit/WSL hold RAM indefinitely | Host-coupled defaults and port literals if unmarked in doctrine (runtime-assumption audit) |
| **NIST CSF 2.0** (govern/identify/protect/detect/respond/recover) | Named owners + evidence per function | Strong govern/protect design (grants, receipts, migration guards) | Detect/respond uneven; recover incomplete beyond Postgres; no full CSF owner map | Citing CSF without mapping owners was already noted in June — still true |
| **Appliance / local-first OS** (synology-like, “IT in a box”) | Born-bounded resources, one health pane, backup that just works, safe upgrade | Directionally correct (self-upgrade, backup card, readiness gates filed) | Not yet “set and forget” on resource or sole-platform verdict | Vertical feature depth marketed/catalogued faster than appliance ops |
| **Governed agent platforms** | Uniform mutation envelope, audit, least privilege | MCP grants + ToolExecution + HITL envelope are differentiators | Envelope not universal; reversibility matrix incomplete | Domain tools that mutate records outside envelope = integrity drift |

**Net:** Best-in-class is less about a single stack choice and more about **enforced ceilings, evidence aggregation, and uniform contracts**. DPF already *designs* those; the hardening work is making them **default, complete, and owner-visible**.

---

## 7. Architectural drift inventory

| ID | Drift surface | Severity | Evidence | Mitigation shape |
| --- | --- | --- | --- | --- |
| D1 | **Sole-platform claim vs evidence** — doctrine and GTM language can still outrun the readiness matrix consumption | **High** | `BI-C1C706F1` / matrix code in progress; claim helper exists but public/docs automation incomplete; catalog grew to ~106 leaves / 24 categories | Finish matrix + operator surface (`BI-1A222A7A`); wire claim gate into docs/sales surfaces; **no** new umbrella |
| D2 | **DR/upgrade fragments without aggregated verdict** | **High** | Many DR items done; `BI-903F5A94` still in progress | Complete evidence gate; map remaining deferred DR items as explicit degradations in the verdict |
| D3 | **Silent batch caps** (`take: 1_000` without cursor/warn) | **High** (scale cliff) | `apps/web/lib/federation/demand-response.ts`; assurance `finding-read.ts` also uses `take: 1000` | Fix seed paths + add fitness/guard for unbounded collections; file child BIs under existing federation/assurance owners — not a new platform epic |
| D4 | **Unbounded install footprint** — compose without CPU/memory limits; WSL ceiling not born-in | **High** | `BI-4F3AB6B3` body (compose zero limits; 2026-08-04 host exhaustion evidence) | Implement born-bounded install + release gate; extend existing installer helper |
| D5 | **Idle build substrate vs product runtime** | **Medium-High** | `BI-C85D1B0A` live measurements (dual builders, multi-GiB RSS, 100+ GiB cache) | Session lifecycle + budgeted prune (in progress context); keep under substrate convergence |
| D6 | **Application reverse-import debt** (65 exceptions) | **Medium** | `scripts/application-boundaries.json` + application-boundaries.md | Burn down via `BI-B970B01D` / ActorContext migration; exceptions with review dates; debt budgets `BI-7B803E60` |
| D7 | **Schema growth vs bounded-context ownership** | **Medium** | 589 models; `BI-PSC-006` still open | Advance Prisma ownership decomposition; FK/orphan ratchets `BI-5881E707` |
| D8 | **OTel / observability dual mode** — code present, product posture off | **Medium** | `otel-exporter.ts` flag default off; `BI-PSC-008` open | Explicit decision: graduate or demote to optional profile; avoid zombie Phase-0 |
| D9 | **Doctrine vs runtime facts on instruction plane** | **Medium** | `2026-07-24-agents-md-runtime-assumption-audit.md`; contingency markers partially adopted | Continue marking + relocating runtime facts (BI-0020D511 lineage); do not re-assert pins as doctrine |
| D10 | **AI mutation envelope not universal** | **Medium-High** | `BI-35E9EE62` in progress | Land contract + matrix; child BIs for non-conforming domains only |
| D11 | **Portability story incomplete** | **Medium** (trust) | `BI-4C16947C` in progress; June exit-story gap | Finish under `EP-DATA-GOVERNANCE`; no parallel export path |
| D12 | **Epic rollup hygiene risk** (status vs open children) | **Low-Medium** | July map noted `EP-FIELD-OPS-SUBSTRATE` rollup mismatch class; epic `status=done` with open items still possible elsewhere | Prefer live item counts over epic.status for readiness; optional hygiene chore under process spine |
| D13 | **Vertical readiness duplication shape** | **Medium** | `BI-IMP-BEED6502` (~95% shared shapes); many vertical epics open | Build shared spine once; configure per archetype — maps to PSC readiness + vertical epics, not new meta-program |

---

## 8. Prioritized hardening recommendations

Order prefers **risk to sole-platform trust** and **reuse of existing owners**. No new umbrella epic.

| Priority | Action | Map to |
| --- | --- | --- |
| P0 | Complete sole-platform operational readiness **verdict** from existing probes | `BI-903F5A94` |
| P0 | Finish archetype readiness matrix **consumption** (operator + claim surfaces) so catalog growth cannot overclaim | `BI-C1C706F1`, `BI-1A222A7A`, `BI-PSC-010` |
| P0 | Born-bounded resources + BuildKit session lifecycle (memory/build class) | `BI-4F3AB6B3`, `BI-C85D1B0A` |
| P1 | Whole-account restore-grade export | `BI-4C16947C` |
| P1 | Universal AI business-record envelope + reversibility matrix | `BI-35E9EE62` |
| P1 | Clear open self-upgrade reliability blockers (dispatch, observation, host-identity, unattended remediation) | `EP-UPGRADE-LIFECYCLE` open set |
| P2 | Remove silent collection caps; add pagination/cursor or fail-loud | Federation + assurance call sites; future fitness suite |
| P2 | Transport-neutral ActorContext canary (Finance) and reverse-import burn-down | `BI-963F4226`, `BI-58810028`, `BI-71345FF0`, `BI-B970B01D` |
| P2 | Observability product decision (OTel vs lean profile) | `BI-PSC-008` |
| P3 | System-level architecture fitness / load / resilience suite | `BI-1F3E083E` |
| P3 | Living architecture inventory + debt budgets with expiry | `BI-FDA5DC4C`, `BI-7B803E60` |
| P3 | Prisma bounded-context decomposition | `BI-PSC-006`, `BI-5881E707` |

**Guardrails (from 2026-07-27 map — still binding):**

- Do not create a new umbrella epic unless live overlap is rechecked and the July kernel decision is superseded.
- Do not treat this document as execution SoT — query live backlog before acting.
- Do not mark an archetype sole-platform-ready from template presence alone.
- Use `packages/storefront-templates/src/archetype-readiness.ts` as the executable readiness source.
- Do not bypass `EP-DATA-GOVERNANCE` for export/portability.

---

## 9. Assumed / limits

- Live MCP backlog and source were re-checked during this investigation; **statuses change**. Re-query before executing.
- No full monorepo route audit, load test, or production UX walkthrough was performed.
- Memory/build optimization is **context and mapped backlog**, not re-implemented here.
- Commercial/GTM thesis from June is **not** re-authored; readiness matrix remains the claim control.
- Prisma model count (589) and archetype counts (~106 / 24) are **source snapshots** for this review date, not permanent marketing numbers.
- Some `EP-UPGRADE-LIFECYCLE` listing was truncated at 20 of 42 items in one MCP call; conclusions use the sampled open/in-progress set plus key named BIs, not a claim of exhaustive epic closure.

---

## 10. Spot-check claims (verification anchors)

These three material claims are deliberately checkable against primary evidence:

1. **`BI-EA67A758` is done** — live MCP `get_backlog_item` returns `status: done` with resolution citing `PlatformNotification` + `pg_restore --list` on main (supersedes June “open P1” snapshot).
2. **Archetype readiness executable substrate exists** — `packages/storefront-templates/src/archetype-readiness.ts` exports `ARCHETYPE_READINESS_TIERS` and `evaluateArchetypeReadinessClaim` (supports July map pointer).
3. **Federation demand-response still uses a silent 1_000 cap** — `apps/web/lib/federation/demand-response.ts` `findMany({ … take: 1_000 })` with no cursor (architecture scalability cliff class called out in the architecture-review skill).

---

## 11. Conclusion

The platform does not need another philosophy document as much as it needs **completion and wiring of the hardening spine already on the board**. Best-in-class focus areas — enforced resource and query ceilings, restore-tested reliability, safe upgrade, supportable health narratives, and universal AI mutation integrity — are already named in existing epics and the four sparse July gates.

**Strongest near-term architectural ROI:** finish evidence aggregation and claim control (P0), ship born-bounded + build-session lifecycle (P0), then portability + universal action envelope (P1), while burning application-boundary and silent-cap debt as continuous hardening rather than a reboot.

---

*End of analysis. No production behavior change required by this document.*
