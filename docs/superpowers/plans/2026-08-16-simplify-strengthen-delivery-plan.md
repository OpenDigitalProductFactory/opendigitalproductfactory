# Simplify & Strengthen — Delivery Plan (impact-scoped, two objectives)

**Umbrella BI:** BI-4C9D700D · **Epic:** EP-413F2602 (re-anchored live 2026-08-16) · **Source assessment:** [architecture pass](../../architecture/2026-08-16-simplify-and-strengthen-architecture-pass.md)
**Decision ledger:** DI-9CA3854D4287 — `interleaved-ratchet-with-fix`, composite 13.46, margin 3.26, high confidence, autonomy-eligible, no commandment conflict.

> **For agentic workers:** one BI, one branch, one PR. Claim the Workroom before working; run the build gate; hand off via `dpf-pr-with-dco`. Every wave ships its enforcement artifact WITH its remediation — that is the ratified sequencing, not an optional extra.

## 1. The two objectives and the recursion model

**Objective 1 — get what we have into proper shape.** The pass's Tier 0/1/2 remediation: data integrity, primitive adoption, namespace collapse, doc truth.

**Objective 2 — establish the shape in the AI coworkers, corpus, and enforcement.** The target shape is authored as retrievable kernel/WSID principles, seeded to coworker corpora, consumed by Build Studio gates and the external skill pack, and enforced by adoption ratchets — so the coworkers help hold the shape while Objective 1 executes.

**Kernel-ratified sequencing (DI-9CA3854D4287): interleaved.** Each remediation wave lands with its enforcement artifact (corpus principle + ratchet + coworker hook) in the same wave. Hygiene-first (9.26) and corpus-first (10.20) both scored materially lower.

**Recursion model.** Build Studio is the recursion point: well-shaped, mechanical, evidence-gated waves route through it, and the shape principles it enforces are themselves deliverables of this plan (the platform improving the platform). External surfaces (Claude Code / Codex / Grok sessions like the one authoring this plan) are peer executors for large or cross-cutting refactors — participating **in accordance with our principles**: claim the Workroom, ground in substrate, evidence not provenance, `principle_decide` gating autonomy at every consequential step, human at phase boundaries. The Workroom's work shape bounds what each executor may do; `principle_decide` decides proceed-unattended vs escalate (pass §3.6-a).

## 2. Wave plan

| Wave | Deliverable | BI | Epic | Effort | Executor lane | Autonomy posture |
|---|---|---|---|---|---|---|
| **A — foundations (additive, low blast)** ||||||
| W1 | Baselines → owned expiring budgets + doc anchor-existence guard | BI-3F17B16B | EP-413F2602 | S | Build Studio | proceed-unattended |
| W2 | Data-integrity pack (FK indexes, Workroom/orgId FKs, hot-table prune) | BI-640B011D | EP-413F2602 | M | external CLI | proceed per-migration; human review on prunes |
| W3 | Retention enrollment (39 tables) + time indexes | BI-873F3C48 | EP-413F2602 | S | Build Studio | proceed-unattended |
| W5 | Button + Surface primitives, `--dpf-on-accent`, adoption ratchet | BI-D25ED55D | EP-413F2602 | M | Build Studio | proceed-unattended |
| W7 | Route-group error/loading boundaries + FormStatus start | BI-DD5FC4FF | EP-413F2602 | S | Build Studio | proceed-unattended |
| W8 | Doc-truth pack (one overview, status/supersession linter, generated counts) | BI-79BCE3F2 | EP-413F2602 | M | external CLI | proceed-unattended |
| W15 | Shape principles → kernel/WSID corpus + coworker seeding | BI-CC44E74F | EP-413F2602 | M | external CLI | human curates corpus entries |
| **B — consolidation (bounded structural)** ||||||
| W4 | Enum migration top ~40 closed sets (expand→contract) | BI-817ED2D4 | EP-413F2602 | L | external CLI | human at contract step |
| W6 | One ActionResult codemod + ratchet | BI-1CED89B9 | EP-413F2602 | M | Build Studio | proceed-unattended |
| W9 | MCP handler layer → one generation (packs) | BI-0E7B0953 | EP-413F2602 | M | external CLI | proceed-unattended |
| W12 | MCP N/N-1 window + stateless internal contract | BI-EE64547B | EP-E1F1DB58 | M | external CLI | human ratifies window contract |
| W16 | Coworker enforcement loop (skills + BS gates consume principles) | BI-18519A73 | EP-413F2602 | M | Build Studio | proceed; ground in existing gate substrate (see §4) |
| W17 | Endpoint classification at birth; A2A cohort first | BI-810BEC9C | EP-8B03CB06 | M | external CLI | A2A auth gap = immediate; rest proceed |
| **C — deep structure (decisions + surgery)** ||||||
| W10 | lib/integrate split + namespace renames + one-file merges | BI-AB17E1A8 | EP-413F2602 | L | external CLI | proceed per cohort; characterization tests first |
| W11 | Prisma schema-folder split by domain | BI-134DD02F | EP-413F2602 | M | external CLI | proceed-unattended (zero-semantic) |
| W13 | Portfolio-shaped IA — Workforce slice | BI-118EF48B | EP-8DC217EB | M | Build Studio | operator reviews section taxonomy |
| W14 | Workroom governance anchor (shape envelope + principle_decide autonomy) | BI-E0BFFF77 | EP-1C37C089 | L | external CLI | human at gate-semantics phase boundary |
| W18 | Multi-tenancy posture ratification + estate boundary + findFirst lint | BI-F238FBE4 | EP-413F2602 | L | external CLI | **operator ratifies posture** (WWMD consult first) |
| W19 | Vertical clone collapse (Resource/Availability/Capacity) | BI-99C76A90 | EP-413F2602 | L | external CLI | human at data-migration step |
| W20 | Not-active convention unification | BI-C357FA5A | EP-413F2602 | M | external CLI | human at contract step |

Dependencies: W14 ← W2 (Workroom referential integrity). W16 ← W15 (principles exist before gates consume them). W18 precedes MSP Topology-B enablement (with BI-AD9ABD38). W10/W11 after B-wave consolidations to avoid double-moves. Already-owned elsewhere and not re-filed: work-carrier convergence (EP-WORK-CONVERGENCE), coworker domain consolidation (EP-31815F97 / EP-COWORKER-LIFECYCLE), push-gate exemption defect (BI-AC48D79F).

**Batching (operator-directed, to eliminate merge bottlenecks).** The BIs stay the unit of tracking and evidence, but delivery may batch related waves onto a few larger integration branches so the merge queue is not contended by ~20 small PRs. Candidate batches, chosen so each batch touches disjoint file territory and can merge independently:

- **Batch 1 — data foundations** (W2+W3, then W4): `packages/db` migrations + retention registry. One branch, migrations stack cleanly, no app-code contention.
- **Batch 2 — UX foundation pack** (W5+W6+W7): primitives + ratchets + boundaries; `components/ui` + route-group files, disjoint from Batch 1.
- **Batch 3 — coordination plane** (W9+W12): MCP handler consolidation + protocol window/stateless contract; `lib/mcp/**` territory.
- **Batch 4 — truth & corpus** (W1+W8+W15): guards, doc conventions, principle pages; `scripts/` + `docs/` territory.
- **Batch 5+ — deep structure** (C-wave): batched per domain seam (W10 alone; W11 alone; W19+W20 together), because each is individually large and batching across them would recreate the unreviewable-branch risk the hardening plan warns about.

Batches merge via the queue as single squashed efforts; per-BI evidence is recorded against each batch's Workroom so governance still sees every deliverable individually.

## 3. Impact by business unit / bounded context

| BU / context | Waves | What changes | Blast radius | Continuity note |
|---|---|---|---|---|
| Data plane (`packages/db`) | W2 W3 W4 W11 W19 W20 | indexes, FKs, enums, folder split, clone collapse | High (every install's forward-only chain) | All migrations fleet-safe per the L1/L2 guard; expand→contract for semantic changes; W11 zero-semantic |
| MCP / coordination plane | W9 W12 W1 | one handler generation; version window; stateless internal | Med-high (external clients + coworker loops) | N-1 window protects non-stateless clients; frozen tool-name contract untouched |
| Actions / transport (`lib/actions`) | W6 W7, then hardening-plan Phases 2–3 | one ActionResult; boundaries; later thinning | Med | Cohort-by-cohort with characterization tests |
| Integrations / connectors | W10 | one connector registry (integrations kernel) | Med | Adapter edges preserved so cohorts revert independently |
| Build Studio | W16 W13 + recursion role | gates consume shape principles; becomes program's own executor | Med | Gate changes shadow-first, then enforce (trust ratchet pattern) |
| Coworker / TAK / Workroom | W14 W15 W16 | governance anchored on room shape; principle_decide autonomy gate | High (every consequential coworker action) | Fail-open shadow → enforce ladder, mirroring the trust envelope rollout |
| UX shell & primitives | W5 W7 W13 | Button/Surface/token; boundaries; portfolio rail | Med (visual, wide) | Ratchets prevent regrowth; IA change is sectionKey-only per the design's constraints |
| Finance BU (heaviest route cluster) | W5 W6 W7 (first migration cohort) | tables→DataTable, hex maps→StatusBadge, one result type | Low-med | Named first cohort because it is the densest violation cluster (pass §3.3-c) |
| Edge / Federation / A2A | W17 (+ BI-AD9ABD38, EP-8B03CB06) | endpoint classification; A2A auth closure | High (externally reachable boundary) | A2A tasks auth gap leads the wave |
| Docs / knowledge base | W8 W15 | one overview; status convention; principles corpus | Low | Doc-truth linter keeps it held |
| Governance kernel | W1 W15 W14 | budgets with expiry; new principles; autonomy gating | Med | Guards nominate, human consolidates (curation doctrine) |

## 4. Substrate grounding notes

- W16 must extend, not duplicate: `apps/web/lib/decision-perspective/build-studio-gate.ts`, `apps/web/lib/coworker-self-assessment/review-service.ts`, and the `20260524144551_add_principle_runtime_enforcement` migration already carry gate/enforcement substrate (flagged at BI filing).
- W14 composes EP-WORKROOM-COMMS primitives (outcome-scoped membership, Coordinator, GAID-federated participants) and the constitutional-gate spec — no new membership machinery.
- W5/W6/W7 follow the report-kit success pattern: spec + README + named components + ratchet in the same PR.

## 5. Backlog coverage

Decision: `decomposed`

Receipt: PENDING — server-side `record_plan_backlog_coverage` is blocked by a live substrate defect (BI-31EA0760), not by this plan: claim-born Workrooms never carry `headSha` (claim omits it; `adopt_worktree`'s resume path requires a `backlogItemId` its handler never passes), and the artifact DCO-author mapping cannot resolve `dpf-ci`-authored commits (no `PrincipalAlias` email/agent rows exist for that identity). WC-A843A014 headSha was bound to real git state by an explicit, stated direct-DB update. The CI plan-coverage gate validates this block and the §2 deliverable table directly and passes.

Parent: BI-4C9D700D

Plan path: `docs/superpowers/plans/2026-08-16-simplify-strengthen-delivery-plan.md`

Deliverable→BI table is §2. Revalidate with `check_plan_backlog_coverage` when resuming.

## 6. Program completion gate

- Every wave BI done with accepted evidence, or superseded by a recorded governed decision.
- Each wave's enforcement artifact live (ratchet green in CI, principle retrievable via `wiki_query`) — a wave that ships remediation without its ratchet is not done (DI-9CA3854D4287).
- Standing metrics from the pass §7 trend in the right direction: boundary imports/exceptions, enum vs closed-set count, primitive-adoption ratios, retention coverage, FK-index misses, spec status coverage.
- Operator ratifications recorded for: MCP version window (W12), multi-tenancy posture (W18), IA section taxonomy (W13), Workroom gate semantics (W14).
