# Plan — Employee / Occupation Dimension: Role-Tailored Workspace, Coworker Privileges & Onboarding

| Field | Value |
| ----- | ----- |
| Status | Draft — phased plan for review |
| Date | 2026-07-16 |
| Design spec | [`docs/superpowers/specs/2026-07-16-employee-occupation-onboarding-and-role-tailored-workspace-design.md`](../specs/2026-07-16-employee-occupation-onboarding-and-role-tailored-workspace-design.md) |
| Epic (proposed) | `EP-EMPLOYEE-OCCUPATION` |
| Delivery | Per AGENTS.md §17 each BI is promoted through the evidence-gated lifecycle; surface chosen by fit (external Claude/Codex/Grok build or embedded Build Studio). Claude does not hand-write feature code where a BS build fits; substrate-heavy schema work may run as an external build. |

This plan sequences the spec into independently reviewable slices. Each phase names the exact substrate it touches so no slice re-derives context. Every UI-impacting slice runs `dpf-ux-fit-review` and carries a `UX-Fit-Decision:` trailer; every schema slice authors a Prisma migration with inline backfill (AGENTS.md §2, §12).

## Guiding constraints (carried from the spec)

- **One shell** — vary content, never fork a runtime (`employee-tool-intake` rule).
- **Occupation focuses; RBAC secures** — the `occupationAllows` gate only narrows within `can()`. **Every UI/coworker/nav slice ships the non-widening invariant test** (spec §5.4): for all tiles/routes/actions/tools, `!can(user, cap)` ⟹ not visible even with an occupation. Occupation may narrow, sort, explain, route — never authorize.
- **Compose** — extend the vertical-home resolver, the identity-access governance envelope, the WSID corpus, and the SetupOverlay narration; add no parallel systems.
- **Occupation = template, not principal** — no principal-convergence obligation.
- **Lifecycle is first-class** (spec §5.2, principle 8) — a change to `Position.occupationKey` is a **mover event** (invalidate cached resolution; re-run nav/workspace/roster/curriculum); a disabled/detached account is a **leaver event** (occupation coworker reachability disappears with base access). Onboarding is only the *joiner* event.
- **Explainability is a deliverable** (spec §5.9) — the "why this employee sees this" admin surface ships alongside the enforcement, not after.
- **Mobile + accessibility from the first slice** (spec §5.7, §5.3) — the first-login intro and focused workspace carry mobile first-viewport and keyboard/screen-reader/resume-later acceptance criteria from day one; no card sprawl.
- **Verify functionally** on the Live portal with a seeded demo business (`EP-ARCHETYPE-DEMO`), not build-green alone — including the mover re-scope and leaver revocation paths.

---

## Phase 0 — Decisions & persona anchors (no code)

**Goal:** close the §9 open questions and create the validation anchors before substrate lands.

- **P0.1 — Architect decisions.** Resolve: **base access profile** — spec §5.6 recommended Option B, and the kernel **ratified it** (`principle_decide` `DI-4F72F64B6C5B`, 2026-07-24: `add-hr600-workforce-member` composite 12.6 vs `reuse-existing-role` 5.6, high confidence, no commandment conflict; contributors Architecture-Over-Shortcuts, Least-Privilege-Deny-by-Default, Single-Source-of-Truth). **DECISION: add `HR-600` "Workforce Member"** as a dedicated base access role decoupled from the HR-000..HR-500 platform-management ladder. **Shipped** as `BI-6A79A315`: `HR-600` in `role_registry.json` (seeds to `PlatformRole`; roles are seed data, no schema migration), a minimal least-privilege floor in `permissions.ts` (`HR-600` gets only `view_workbooks`/`manage_workbooks`; denied all platform-management capabilities; `/workspace` is `capabilityKey:null` so a worker still reaches home and occupation focuses on top), the `workforce-member → HR-600` binding as single-source-of-truth in `packages/db/src/occupation-access.ts`, fail-closed `baseAccessProfile` validation in `seed-occupations.ts`, and least-privilege + referential-integrity tests. Still open (not blocking P2): coworker-roster storage (embed vs join, P3); completion tracking (`OnboardingTask` rows preferred, P4); occupation override policy (P6); the "show all my access" reveal grant (P2). Record via `dpf-decision-via-kernel` where a genuine trade-off remains.
- **P0.2 — Occupation-persona anchors.** Author `docs/personas/` files for the first occupation set within two proven archetypes: **clinic** (dental hygienist, front-desk coordinator) and **trades/field-service** (field service technician, dispatcher). Follow the persona template (owner voice, coworkers seeded-vs-simulated, archetype/category anchored to the catalog). These anchor Phases 3–5.

**Exit:** decisions recorded; ≥4 occupation personas committed under `docs/personas/`.

---

## Phase 1 — Occupation substrate (schema + seed + resolver read)

**Touches:** `packages/db/prisma/schema.prisma`, a new occupation seed data package (symmetric with `packages/storefront-templates/src/archetypes/*`), `packages/db/src/seed.ts`, `apps/web/lib/workforce/`.

- **P1.1 — `OccupationProfile` table + seed package.** Model per spec §5.1 (config, not principal; includes `baseAccessProfile`, `moverCurriculumId`). Seed the Phase-0 occupations for the clinic + trades archetypes. Strongly-typed `interaction` union declared in the same commit (AGENTS.md §3). Add the closed `OnboardingTask.kind` shape (`hr-onboarding`, `hr-offboarding`, `platform-intro`, `occupation-mover`) + `curriculumId` rather than overloading title strings (spec §6). **Seed referential-integrity tests (spec §7):** every seeded occupation must reference real archetypes, real coworker slugs, valid governance profiles, valid WSID families, valid curriculum ids, valid tile keys, and valid nav prefixes — the seed fails closed otherwise.
- **P1.2 — `Position.occupationKey` (nullable) + resolver helper.** Migration adds the column with inline backfill (null default; optional best-effort map from existing `jobFamily` strings where unambiguous). Add `resolveOccupationForEmployee(employeeProfile)` in `apps/web/lib/workforce/` walking `EmployeeProfile.positionId → Position.occupationKey → OccupationProfile`, returning `null` honestly when unresolved. Expose a single **invalidation seam** the mover event (Phase 5) can call so a changed `occupationKey` re-runs resolution with no stale cache — design it here even though the event handler lands in Phase 5.
- **P1.3 — MCP read surface.** Extend the existing employee/registry read tools (`list_positions`, `query_employees`) so occupation is visible to coworkers as reference data; add a read-only `list_occupations` if the registry warrants it (grant `registry_read`, provenance-free description per AGENTS.md §8).

**Verify:** unit tests for the resolver (all fallbacks); migration applies cleanly on the shared local-CI sandbox; seed produces the expected occupation rows. No UI yet.

**Exit:** an employee can be resolved to an occupation (or an honest null) server-side.

**Implementation status (landed 2026-07-17):** Phase 1 substrate implemented.
- `OccupationProfile` model + nullable `Position.occupationKey` (slug reference, not an FK — mirrors `StorefrontConfig.archetypeId`) — [`packages/db/prisma/schema.prisma`](../../../packages/db/prisma/schema.prisma); migration `20260717000000_add_occupation_dimension` (data-safe, hand-authored — worktree is source-only so `prisma migrate dev` runs in the sandbox).
- Registry data [`packages/db/data/occupation_registry.json`](../../../packages/db/data/occupation_registry.json) (dental-hygienist, front-desk-coordinator, field-service-technician, field-dispatcher) + fail-closed seed [`packages/db/src/seed-occupations.ts`](../../../packages/db/src/seed-occupations.ts) wired into `seed.ts` after `storefrontArchetypes`. Seed validates every occupation against the live archetype-category catalog and the seeded coworker slugs (`COWORKER_AGENT_SEEDS`); `interaction` is the closed `summon|assigned-only|read-only` enum.
- Resolver [`apps/web/lib/workforce/occupation.ts`](../../../apps/web/lib/workforce/occupation.ts): `resolveOccupationForEmployee` / `resolveOccupationForUser` / `getOccupationByKey`, DI-testable, with the `invalidateOccupationCache` seam P5's mover event consumes (employee→occupation walk stays uncached so a mover change is seen immediately).
- Tests: `seed-occupations.test.ts` (referential integrity + fail-closed) and `occupation.test.ts` (resolver fallbacks, JSON parsing, memo + invalidation).
- **Stewardship note:** `OnboardingTask.kind` from spec §6 maps onto the **existing** `OnboardingTask.checklistType` field — no new column. The `platform-intro` / `occupation-mover` values are introduced when P4/P5 create those rows; `baseAccessProfile` is a slug pending the P0.1 RBAC decision (seeded `workforce-member`); `wsidProfessionFamily` and roster `governanceProfileRef` are bound in P3.
- **Seed-fit applicability decision:** `archetype-scoped`. The seeded occupations are canonical fleet defaults scoped by archetype category (healthcare-wellness, trades-maintenance), symmetric with the storefront archetype seeds — not global-default, not install-local. (Recorded here durably in addition to the `Seed-Fit-Decision:` PR trailer the CI gate reads.)

---

## Phase 2 — Role-tailored workspace (extend the dormant vertical-home resolver)

**Touches:** `apps/web/lib/workspace-home/registry.ts` + resolver, `apps/web/lib/workspace-home/platform-loader.ts`, `apps/web/lib/govern/permissions.ts` (nav filter), `apps/web/app/(shell)/workspace/page.tsx`.

- **P2.1 — Occupation axis in the resolver.** Extend `resolveWorkspaceHomeContribution` to the five-tier order in spec §5.3 (archetype×occupation → category×occupation → archetype → category → platform). Reuse the existing typed contribution manifest, primitive library, and slot covenant unchanged. Register the **first occupation home contributions** (clinic hygienist, front-desk; field-service tech) — the registry is dormant, so these can be the first real contributions.
- **P2.2 — `occupationAllows` narrowing gate.** Add the fourth gate to `getShellNavSections`/`getWorkspaceSections` per spec §5.4 — narrows to the occupation `tileAllowlist`, never widens past `can()`, returns permissive when occupation is unresolved. Wire the existing worker/operator `dpf-nav-mode` switch as the role-authorized "show all my access" reveal.
- **P2.3 — Thread user/occupation into the command center.** Give `loadWorkspaceCommandCenter` an optional `{ occupationKey, userId }`; render per-occupation content when present, identical behavior when absent.

**Verify (functional):** on the Live portal with a seeded demo clinic, log in as a hygienist-position employee → `/workspace` resolves to the hygienist home with only clinical tiles; the reveal exposes broader access; command center shows occupation content. Repeat for field-service tech. **Desktop + mobile first-viewport** check (no card sprawl; slot covenant honored). Structural: resolver + gate unit tests **including the non-widening invariant test (spec §5.4) shipped in this slice** — the reveal must land in the same slice as the gate, or legitimate cross-work breaks.

**Exit:** two occupations in two archetypes render distinct, focused, honest workspace homes, verified on mobile, with the non-widening invariant proven.

---

## Phase 3 — Per-occupation coworker privileges

**Touches:** `apps/web/lib/tak/agent-routing.ts` (`resolveAgentForRoute`), the coworker launcher/summon surface, the identity-access governance layer (`AgentGovernanceProfile`, `DirectivePolicyClass` persona category), `OccupationProfile.coworkerRoster` seed.

- **P3.1 — Roster enforcement in `resolveAgentForRoute`.** Consult the signed-in employee's occupation roster; if the route's default coworker is out-of-roster, present the nearest in-scope coworker or an honest "not part of your role — request access" state instead of silently attaching an out-of-scope agent. Preserve the existing `canAssist` capability behavior underneath.
- **P3.2 — Roster-scoped launcher.** The coworker launcher/summon surface lists only roster coworkers for the occupation.
- **P3.3 — Governance composition.** Bind each `OccupationCoworkerGrant` to an `AgentGovernanceProfile` so the same coworker can present a different authority envelope per occupation (identity-access spec's "different humans, different envelope"). Link `OccupationProfile.wsidProfessionFamily` to the WSID corpus so the coworker's doctrine matches the job. No change to the role∩agent-grant tool intersection — the roster gates reachability, not raw tool authority.
- **P3.4 — Roster audit/explanation object (spec §5.5).** Roster resolution writes a lightweight explanation into the agent-panel context (`occupationKey`, matched grant, governance profile, fallback reason) that the Phase-5 admin surface reads. When no grant matches, fall back to a generic helper with **no action tools** and a clear "not configured for this role yet" state — never a silent out-of-scope attach.

**Verify (functional):** hygienist sees the clinical scheduling + patient-comms coworkers, not finance/platform-eng; an out-of-roster route does not silently attach an out-of-scope coworker; the same coworker shows the correct envelope for two different occupations. Structural: routing + roster unit tests.

**Exit:** occupation determines the reachable coworker roster, governed, no security regression.

---

## Phase 4 — Onboarding that teaches Priority & Proactivity

**Touches:** `apps/web/components/setup/SetupOverlay.tsx` + `SETUP_STEPS`, the COO narration path (`buildStepTrigger`), `apps/web/components/attention/NeedsYouBand.tsx` (teaching empty-state), a new employee first-login journey component, the orphaned `apps/web/components/employee/OnboardingPanel.tsx` + `OnboardingTask`.

- **P4.1 — Teach the flagship features in owner setup.** Enrich the `workspace` step (or insert a `flagship-features` step) so the COO explicitly teaches Priority (the "Needs you" inbox) and Proactivity (scheduled coworkers + proposals). Add a **teaching empty-state** so `NeedsYouBand` teaches even when the queue is empty (fixes the "renders nothing when empty" gap).
- **P4.2 — Condensed employee first-login journey.** New 3–5 step intro per spec §5.7, coworker-narrated via the existing `open-agent-panel` autoMessage mechanism, delivered by the occupation-matched primary coworker. Steps 1–3 common (welcome, Priority, Proactivity); step 4 job-slice ("what the portal does for a {occupation.label}"); step 5 one next action.
- **P4.3 — Completion tracking + wire the orphaned panel.** Persist per-user completion as **`OnboardingTask` rows** (`kind:"platform-intro"`, per-curriculum), deriving `platformIntroCompletedAt` only if perf requires (P0.1 decision). First-login detection = no completed platform-intro curriculum. Wire `OnboardingPanel` to a route as the employee onboarding checklist home. **Idempotency (spec §5.7):** refreshes resume the current step; a completed curriculum does not reappear; a later mover curriculum coexists without erasing joiner history.
- **P4.4 — Accessibility & interruption (spec §5.7).** The intro is keyboard-operable, screen-reader legible, dismissible with "resume later," and reachable from Help after completion — a work tool, not a modal trap. Mobile acceptance criteria included.

**Verify (functional):** a fresh non-owner employee's first login runs the condensed intro; Priority + Proactivity are taught (including empty-state); the job-slice names the occupation and its coworkers; completion persists (second login skips); "resume later" and keyboard/screen-reader paths work on desktop **and mobile**. Owner setup now teaches both features. Structural: first-login detection + idempotency + curriculum unit tests.

**Exit:** both onboarding moments teach the two flagship features; employees get a condensed, job-aware, accessible intro that survives refresh/resume.

---

## Phase 5 — Lifecycle (mover/leaver) & admin mapping UX

**Touches:** the resolver invalidation seam from P1.2, the HR position-change path, the identity-access revocation path, and the employee admin/profile surface. Delivers spec principle 8 (§5.2) and §5.9.

- **P5.1 — Mover re-scoping.** On a `Position.occupationKey` change, fire a **mover event** that invalidates cached occupation resolution and re-runs nav/workspace/coworker-roster resolution immediately; when the new occupation differs materially in workspace or coworker access, enqueue a small **`occupation-mover` curriculum** (reusing the P4 narration mechanism) without erasing the original joiner completion history.
- **P5.2 — Leaver revocation.** When the employee account is disabled/detached, occupation coworker reachability must disappear with the base account access — verify it cannot be reached by direct URL/API. Offboarding mechanics themselves stay owned by the HR lifecycle specs; this slice only guarantees occupation-derived grants revoke.
- **P5.3 — Admin "why this employee sees this" surface (§5.9).** An occupation panel on the employee profile/admin surface showing: position/department/manager + resolved `occupationKey` (and why it matched — key, fallback, or unresolved); base access profile + granted capabilities; default tile allowlist + emphasized nav + reveal eligibility; coworker roster with governance profile + interaction mode (reads the P3.4 explanation object); joiner/mover curriculum status + next task. Admins with `manage_user_lifecycle` map a `Position` to an occupation **from the seeded list for the org's archetype only** — no inline occupation invention.

**Verify (functional):** change one employee's `occupationKey` A→B → workspace, nav focus, roster, and mover curriculum update with joiner history intact; disable the account → occupation coworker reachability gone (URL/API included); the admin panel explains each employee's surface end-to-end. Structural: mover-invalidation + revocation + mapping-authority unit tests.

**Exit:** occupation is lifecycle-safe (joiner/mover/leaver) and every employee's surface is explainable from the admin profile.

## Phase 6 — Breadth, hardening & docs

- **P6.1 — Occupation breadth.** Add the next occupations per demand (e.g. office manager, dentist for clinic; apprentice for trades; retail associate for `retail-goods`), each with a persona anchor and a home contribution. Track silently-dropped coverage (`log` what's not yet covered — no silent caps).
- **P6.2 — Docs & standards.** Update the user guide (`docs/user-guide/market-archetypes.md` cross-refs), `docs/personas/README.md` (occupation-persona rules), and note the occupation dimension in the relevant `AGENTS.md` data-model context if a durable contract emerges.
- **P6.3 — Release QA.** Fold the two-occupation happy path **plus the mover/leaver paths** into the affected phases of `tests/e2e/platform-qa-plan.md`.

**Exit:** occupation dimension is documented, covered by QA, and extensible by adding a seed + persona + contribution.

---

## Sequencing & dependencies

```
P0 (decisions + personas)
      │
      ▼
P1 (occupation substrate + invalidation seam) ──► P2 (tailored workspace) ──► P4 (onboarding)
      │                                   │                     ▲
      └──────────────► P3 (coworker roster) ────────────────────┘
                                          │
                                          ▼
                         P5 (lifecycle mover/leaver + admin UX)
                                          │
                                          ▼
                                   P6 (breadth + docs)
```

- P1 is the hard prerequisite for everything; it exposes the invalidation seam P5 consumes.
- P2 and P3 can proceed in parallel after P1 (both read the occupation, touch different surfaces).
- P4 depends on P1 (occupation → coworker for narration) and reads P2/P3 output but can start its owner-setup half (P4.1) independently.
- P5 depends on P1 (seam), P2/P3 (surfaces to re-scope), and P4 (mover curriculum reuses the narration).
- P6 is continuous once P2–P5 land for the first archetype.

## Backlog mapping (filed 2026-07-16 under `EP-EMPLOYEE-OCCUPATION`)

All items are linked to the coordinating epic `EP-EMPLOYEE-OCCUPATION` and note their cross-composition in the body. Filed at `triaging` for Scrum-Master sizing.

| Phase | BI | Theme | Composes onto |
| ----- | -- | ----- | ------------- |
| P0 | `BI-36C6067F` | Occupation decisions + persona anchors | `EP-ARCHETYPE-DEMO` / persona library |
| P1 | `BI-442E2B42` | `OccupationProfile` substrate + `Position.occupationKey` + resolver + `OnboardingTask.kind` | `EP-EMPLOYEE-OCCUPATION` |
| P2 | `BI-C135D07B` | Occupation axis in vertical-home resolver + narrowing nav gate (non-widening test) | `EP-REDUCTION-GEAR-ARCH` |
| P3 | `BI-8A0E516C` | Occupation coworker roster + governance + audit/explanation object | `EP-COWORKER-INTERACTIVITY` |
| P4 | `BI-80682016` | Teach Priority/Proactivity + condensed, accessible, idempotent first-login | `EP-ATTENTION-SURFACE` / `EP-PROACTIVE-OPS` / `EP-ONBOARDING-INTAKE` |
| P5a | `BI-116C50EA` | Mover re-scope + leaver revocation (lifecycle-safe occupation) | `EP-COWORKER-INTERACTIVITY` / HR lifecycle |
| P5b | `BI-75E512D6` | "Why this employee sees this" admin mapping/operations UX | `EP-EMPLOYEE-OCCUPATION` |
| P6 | `BI-79FC782D` | Occupation breadth + docs + QA (incl. mover/leaver) | `EP-EMPLOYEE-OCCUPATION` |

## Risks

- **RBAC seam (P0.1) is load-bearing** — deferring the base-access-profile decision (spec §5.6 recommends Option B `HR-600`) blocks P2's gate semantics. Resolve in P0.
- **Registry activation** — the vertical-home registry has never rendered a real contribution in production; P2 is also its first live proving, so budget functional-verification time there.
- **Empty demo data** — occupation homes need seeded per-archetype businesses (`EP-ARCHETYPE-DEMO`) to verify; ensure the demo factory covers the two Phase-0 archetypes before P2 sign-off.
- **Over-restriction** — the `occupationAllows` gate must ship with the role-authorized reveal **and** the non-widening invariant test in the same slice, or legitimate cross-work breaks (anti-pattern (b) in spec §3.4).
- **Stale access on mover** — a role/occupation change that does not invalidate cached resolution leaves a worker seeing the prior job's surface/coworkers; P5.1's invalidation seam (designed in P1.2) is the guard.
