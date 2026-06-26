# Implementation Plan — AI Coworker Management Consolidation

**Status:** Founder-reviewed 2026-06-26; scope decisions locked (design §10). BIs filed under `EP-COWORKER-RT`.
**Date:** 2026-06-26
**Design:** [`docs/superpowers/specs/2026-06-26-coworker-management-consolidation-design.md`](../specs/2026-06-26-coworker-management-consolidation-design.md)
**Epic:** `EP-COWORKER-RT` (founder decision 2026-06-26 — extend the existing Coworker Runtime + Persona/Grant-audit epic).

This plan is sequenced so each phase is independently shippable and each closes specific cells of the design's §5 validation table. The four founder decisions (clean display name + role-kind chip; fold prompt/skills editing onto the record; surface **and** hot-wire the central priority dial; extend `EP-COWORKER-RT`) are reflected below.

---

## Phase 1 — Identity & Naming Standard (foundation, low blast radius)

*Closes §5 rows: "name shown" (1 displayName, 0 casing variants) and "orphan/hardcoded references" (→0).*

- **BI-1.1 (chore/schema)** Add `Agent.displayName String` (required) and `Agent.kind String` to `schema.prisma`; migration backfills `displayName` from `agent_registry.json.displayName` else Title-cased `name`. Add `kind` + `displayName` to the AGENTS.md §3 strongly-typed-enum table.
- **BI-1.2 (chore/data)** Populate `displayName` + `kind` + canonical `slug` for **all 68** agents in `agent_registry.json`; register `AGT-SOC-*` (4 agents) and resolve `storefront-advisor` / `coworker` (register or remove). Reconcile `slugId` → single `slug`.
- **BI-1.3 (refactor)** Point `ROUTE_AGENT_MAP` (and prompt persona slugs, WSID `scope.roles`) at the canonical `slug`; delete the hardcoded `AGT-SOC-*` array in `apps/web/lib/ea/security-posture-extract.ts` and read from the registry.
- **BI-1.4 (tool)** Promote the Persona-Audit lint (`2026-04-27` spec) from Draft to an **enforced CI check**: every `Agent` has non-empty `displayName` + one-line role; `slug` unique & lower-kebab; `displayName` Title Case; **every `ROUTE_AGENT_MAP` key resolves to a registry agent**; no registry-bypassing hardcoded agent lists.
- **BI-1.5 (refactor)** Make every coworker UI read `displayName` (roster, record header, chat panel, ops-map, identity page); fix the raw-cased sensitivity badge.

*Verification:* unit tests on the lint + slug/displayName normalizers; live click-through showing one consistent name per coworker across surfaces.

## Phase 2 — Editable coworker record

*Closes §5 rows: edit prompt / edit skills/tools "on-record, ≤2 clicks".*

- **BI-2.1 (feature)** Capabilities tab → in-place grant/revoke of skills (`SkillAssignment`) and tools (`AgentToolGrant`) with the least-privilege/entitlement-review guard; write server actions.
- **BI-2.2 (feature)** Persona/Prompt on the record: render the *effective* composed prompt; inline edit writes the scoped `PromptTemplate`. Surface the persona job-description sections on Overview.
- **BI-2.3 (feature)** Overview summary chip row (model tier · priority · #skills · #tools · autonomy tier · health) + Workday-style Related-Actions ("…") menu on roster rows and the record header.

*Verification:* RTL tests (jsdom) on the editable tabs; live grant/revoke + prompt-edit happy path on the canonical install.

## Phase 3 — Golden-Triangle central default + per-coworker override (and wire it)

*Closes §5 rows: edit priority on-record; set Cost/Quality/Time for whole workforce from 1 surface.*

- **BI-3.1 (feature)** Central "Workforce Priority" control writing `saveGoldenTrianglePlatformDefault` / `…OrgDefault`; Priority tab per-coworker override (`saveCoworkerGoldenTrianglePosture`) that always renders the inheritance chain ("inherited from Platform · override here").
- **BI-3.2 (feature)** **Hot-path wiring (Slice 3.5):** `getEffectivePostureForAgent()` feeds `inferContract()` / `prepareRoute()`; derive `AgentModelConfig.budgetClass` from the effective posture (retire the parallel field). Relabel the composer `CoworkerPriorityDock` as the per-conversation last-mile override.
- **BI-3.3 (chore)** Receipt/telemetry: confirm the existing `buildGoldenTriangleReceipt` captures which scope (platform/org/coworker/conversation) governed each decision.

*Verification:* unit tests proving cold-start byte-identical when no posture set; live test that a central change alters a coworker's dispatched budgetClass.

## Phase 4 — Surface consolidation + workforce summary

*Closes §5 rows: find ≤2 clicks; full detail on 1 surface.*

- **BI-4.1 (refactor)** Demote `/platform/ai/prompts` and `/platform/ai/skills` to catalogs (global library/observatory); per-coworker editing now lives on the record.
- **BI-4.2 (refactor)** `/platform/ai/assignments` → keep as the **bulk grid** (cross-coworker priority/model); fold single-coworker editing into the record. Fold `/platform/identity/agents` principal status into the record Governance tab (redirect the standalone page).
- **BI-4.3 (feature)** Directory upgrades: strong search (`displayName`/`slug`/`agentId`/alias) + family/kind/priority/health filters.
- **BI-4.4 (feature)** Workforce Summary panel: counts by family/kind, coverage %, priority distribution, naming-health, provider health.

*Verification:* the full §5 click/surface table re-measured on the canonical install; UX-fit decision recorded; release-QA affected phases.

---

## Cross-cutting

- **Gates:** every phase carries unit tests + `pnpm --filter web build` + live UX exercise (AGENTS.md §5); UI-impacting BIs carry a `UX-Fit-Decision:` trailer; schema BIs carry a clean migration apply.
- **Build surface:** suitable for Build Studio per-BI, or external (Claude Code) per the 4-peer-surface rule — author's choice at promote time.
- **Sequencing note:** Phase 1 is a prerequisite for clean references in 2–4 but ships value alone. Phases 2/3/4 are independent after Phase 1.
- **Overlap watch:** coordinate Phase 3 with any in-flight Golden-Triangle BIs; Phase 1 BI-1.4 supersedes the standalone Persona-Audit lint rollout.
