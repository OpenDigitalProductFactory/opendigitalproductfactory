# 2026-05-11 Licensing, Permit, and Jurisdictional Readiness Foundation Plan

**Epic:** `EP-LIC-C64FC2` Licensing, Permit, and Jurisdictional Readiness: Archetype-Aligned Compliance Foundation

**Goal:** Turn the licensing/permitting design into a buildable, phased platform capability rooted in Compliance, with clean ties to archetypes, finance, staff, and marketing.

## 1. Scope For The First Delivery Track

The first delivery track should establish licensing readiness, not full licensing automation.

Included:

- schema foundation for requirement references and license records
- Compliance workspace for organization licenses, person credentials, display obligations, fees, and issues
- coworker investigation prompts and operational issue creation
- bootstrap reference seed for USA, UK, and Australia
- cross-links into Finance, Staff, and Marketing

Deferred:

- broad Canada/EU/South America seed coverage beyond initial design research
- portal submission automation across authority sites
- deep profession-specific workforce workflows
- payment execution beyond linked fee tracking and reminders

## 2. Work Breakdown

### BI-LIC-7D476E

**Research & spec the licensing, permit, and legality investigation capability**

Size: M

Deliverables:

- final spec review and acceptance (status moved from "Draft for review" → "Accepted" in the spec header)
- spec Open Questions §19 each resolved or explicitly punted with reason
- authoritative source inventory for priority jurisdictions
- archetype-to-investigation heuristic inventory

Exit criteria:

- spec accepted by product owner
- spec Open Questions #1–#8 each have an owner + decision date
- official bootstrap source list captured for USA, UK, Australia

### BI-LIC-F36A08

**Design the domain model for jurisdictional license requirements and organization/person credentials**

Size: L (touches schema + canonical enums + identity convergence rule)

Implementation targets:

- resolve spec Open Question #1 (shared `JurisdictionReference` vs. parallel `LicenseRequirementReference`) BEFORE writing the migration; record the decision in this file
- add reference model for requirement intelligence (per resolution of Open Question #1)
- add organization-held licensing records (`OrganizationLicenseProfile` 1:1 with `Organization`; reuse, do not parallel)
- add person-held credential records — holder MUST be `principalAliasId`; no `employeeProfileId` FK (AGENTS.md §11 Principal convergence)
- add display obligation and fee schedule records (resolve spec Open Questions #3, #4 before commit)
- add issue model for readiness blockers
- define canonical enum constants in `apps/web/lib/licensing.ts` and mirror them in `apps/web/lib/mcp-tools.ts` IN THE SAME COMMIT, before any data uses them (AGENTS.md §3)
- author the migration backfill inline in the migration file, not in a separate script (AGENTS.md §2)

Exit criteria:

- migration applies cleanly on fresh and populated installs
- schema does not overload tax-remittance tables
- cross-domain ownership is explicit
- vitest invariant prevents any direct FK from a license/credential record to `EmployeeProfile`, `User`, or `CustomerContact`
- enum values in `licensing.ts` and `mcp-tools.ts` match exactly

### BI-LIC-3621D8

**Add archetype-aware coworker investigation flow for licensing and permit readiness**

Size: L

Implementation targets:

- prompt/routing context for licensing investigation (prompts live in `prompts/<category>/<slug>.prompt.md` per AGENTS.md §2, NOT hardcoded TS)
- classification of existing vs new vs expansion setup
- archetype-aware question guidance (archetype is bootstrap, not running config — investigation re-opens only on net-new questions)
- live-verification as a background job (spec §12.1) — reuse existing function-queue substrate per Open Question #5
- coworker improvement-loop telemetry emitted per spec §12.2
- live-verification issue creation
- agent `tool_grants` seeded `active` for the bundled compliance coworker (the platform-bundled coworker should not require admin "Register")

Exit criteria:

- coworker uses dedicated dialog UX (no guidance cards on operational pages)
- operational pages remain factual
- investigation can persist findings into structured records
- background verification job exists and dialog is non-blocking
- improvement-loop telemetry visible at `/platform/ai/authority` (or equivalent surface)

### BI-LIC-247DB1

**Add compliance workspace surfaces for licensing, display obligations, fees, and staff qualifications**

Size: L

Implementation targets:

- `/compliance` licensing workspace (theme-aware styling per AGENTS.md §12 — no hardcoded colors)
- organization licenses list/detail
- staff credentials list/detail (holder display goes through `Principal` → `PrincipalAlias` resolution)
- display obligations view (reuse `ComplianceEvidence` if Open Question #3 resolves that way)
- fee/renewal readiness view with finance handoff per Open Question #4
- open issues and evidence links

Exit criteria:

- inspectable operational state exists outside the coworker conversation
- Compliance becomes the source of truth for licensing posture
- all UI uses `var(--dpf-*)` CSS custom properties; no hardcoded colors or inline hex
- Playwright e2e covers the licensing workspace's happy path on the Docker-served app

### BI-LIC-AA90DB

**Seed and refresh jurisdiction bootstrap data for licensing and permit investigation**

Size: M

Implementation targets:

- seed format for requirement/authority bootstrap data (decides AFTER Open Question #1 lands — schema follows the resolution)
- first coverage set for USA, UK, Australia
- provenance and freshness fields (`sourceUrls`, `lastResearchedAt`, `lastVerifiedAt`, `confidence`, `staleAfterDays`)
- refresh-from-research fallback pattern
- "seed miss" telemetry — absence of a seed entry MUST surface a seed-coverage backlog item, never a silent skip (project memory: silent seed skips audit, 2026-04-17)
- hive contribution payload spec for `LicenseRequirementReference` rows: PII-free, obfuscated-pseudonym contributor, reviewable before transmission

Exit criteria:

- coworker has enough seed data to start intelligently
- seed is clearly non-authoritative (presence ≠ legal conclusion)
- "seed miss" path tested with a vitest case for an unseeded jurisdiction
- hive contribution payload reviewable at `/platform/hive` (or equivalent) before any outbound call
- seed file lives in `packages/db/data/` and is loaded by `packages/db/src/seed.ts` per AGENTS.md §2; runtime changes use the live DB, not seed edits

## 3. Recommended Build Order

1. `BI-LIC-7D476E` finalize research/spec acceptance
2. `BI-LIC-F36A08` schema and model foundation
3. `BI-LIC-AA90DB` bootstrap seed format and initial data
4. `BI-LIC-247DB1` Compliance workspace operational surfaces
5. `BI-LIC-3621D8` coworker investigation behavior and cross-route prompts

Rationale:

- schema must exist before the workspace or coworker can persist truth
- the seed should exist before the coworker investigation flow is considered useful
- the operational workspace should exist before the coworker starts filling it

## 4. Data Stewardship Rules

- do not repurpose tax registration tables for licensing
- do not store licensing truth only in chat memory or notes
- do not make marketing or finance the canonical owner of license status
- use Compliance as the main operational home
- preserve person-held versus organization-held distinction

## 5. Verification Requirements (AGENTS.md §5 Build Gate)

Work is not complete on any slice until ALL four gates pass:

1. **Unit tests** — `npx vitest run` for affected files.
2. **Production build** — `cd apps/web && npx next build` with zero errors. TypeScript errors only surface here, not in vitest or IDE checks.
3. **UX verification** — exercise the affected path against the Docker-served app (the install's configured URL), not stale `next dev` sessions. Rebuild containers when needed: `docker compose build --no-cache portal portal-init sandbox && docker compose up -d`.
4. **Migration applies cleanly** — fresh install AND populated install. Reversibility: any new model added in BI-LIC-F36A08 must have a vetted backout path documented in the migration's commit message.

Additional acceptance for this epic:

- coworker dialog stays in dedicated coworker UX (no guidance cards on operational pages)
- compliance operational page remains factual
- theme-aware styling rules are followed on any new UI (AGENTS.md §12 — no hardcoded colors)
- Playwright e2e covers the Phase 1 workspace happy path (project memory: Playwright testing for Build Studio)
- improvement-loop telemetry is visible for the licensing coworker
- spec §20 acceptance criteria all pass

## 6. Follow-On Phases

### Phase 2

- Canada bootstrap coverage
- renewal reminders and fee tracking improvements
- better staff qualification linkage

### Phase 3

- EU bootstrap and regulated-profession overlays
- richer marketing trust-signal consumption
- broader finance handoff and payable workflows

### Phase 4

- South America bootstrap coverage
- deeper authority-specific automation and managed refresh

## 7. Smallest Next Slice

The smallest good next execution slice is:

- resolve spec Open Question #1 (shared vs parallel reference model)
- implement the schema foundation from `BI-LIC-F36A08` per that resolution
- alongside the first USA/UK/Australia seed format from `BI-LIC-AA90DB`

That gives the platform a stable persistence model and the minimum reference intelligence needed before any Compliance UX or coworker behavior is added.

## 8. Dependencies And Coordination

This epic does not stand alone. Before BI-LIC-F36A08 commits schema:

- **Principal convergence rule (AGENTS.md §11).** `Principal` and `PrincipalAlias` are in place (packages/db/prisma/schema.prisma:219). The licensing schema MUST route holder identity through them; the convergence rule applies to entities introduced after 2026-05-09, and today is 2026-05-11. No exception.
- **`EP-ARCH-8D4F2A` Archetype Model V2.** Spec §11 archetype heuristics work against the current archetype shape, but become richer with V2. Resolve spec Open Question #8 before BI-LIC-3621D8 starts: block on V2, design around current shape, or ship a thin slice that upgrades when V2 lands.
- **`TaxJurisdictionReference` shape ownership.** If Open Question #1 resolves toward extraction of a shared `JurisdictionReference`, the tax-remittance team needs to be in the loop — that becomes a refactor that touches two completed epics (EP-TAX-6C82D1, EP-TAX-41A6F2) plus this one.
- **Background job substrate.** Reuse `apps/web/lib/queue/functions/` (existing pattern) unless a stronger case lands. Confirm before BI-LIC-3621D8.
- **Hive contribution pipeline.** Existing `contribute_to_hive` plumbing (project memory: PR #137 fix for silent-failure gaps). Confirm it accepts a `LicenseRequirementReference` payload kind, with `autoApproveWhen` configured for pre-authorized flows.

## 9. PR And DCO Governance

Per AGENTS.md §4:

- All work lands via PR against `main`; no direct pushes; one concern per branch / per PR.
- Topic branch names: `feat/licensing-<slice>` (e.g., `feat/licensing-schema`, `feat/licensing-coworker`, `feat/licensing-seed-usa-uk-au`).
- Every commit signed-off: `git commit -s`. DCO bot blocks merge until every commit has `Signed-off-by:`.
- Squash-and-delete on merge: `gh pr merge <n> --squash --delete-branch`.
- Concurrent sessions: one worktree per topic; seed MCP config in each new worktree (`scripts/seed-worktree-mcp.ps1`).
- Pre-commit hook gates typecheck on `.ts/.tsx/.mts/.cts` commits.
- Local typecheck only covers TS errors; the production build gate (§5.2) is non-negotiable before pushing.
