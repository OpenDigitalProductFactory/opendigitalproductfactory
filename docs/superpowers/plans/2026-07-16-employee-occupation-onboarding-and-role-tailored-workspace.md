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
- **Occupation focuses; RBAC secures** — the `occupationAllows` gate only narrows within `can()`.
- **Compose** — extend the vertical-home resolver, the identity-access governance envelope, the WSID corpus, and the SetupOverlay narration; add no parallel systems.
- **Occupation = template, not principal** — no principal-convergence obligation.
- **Verify functionally** on the Live portal with a seeded demo business (`EP-ARCHETYPE-DEMO`), not build-green alone.

---

## Phase 0 — Decisions & persona anchors (no code)

**Goal:** close the §9 open questions and create the validation anchors before substrate lands.

- **P0.1 — Architect decisions.** Resolve: base worker role (Option A reuse vs Option B `HR-600`); coworker-roster storage (embed vs join); completion tracking (`platformIntroCompletedAt` vs `OnboardingTask.kind`); occupation override policy; the reveal permission grant. Record via `dpf-decision-via-kernel` where a genuine trade-off exists.
- **P0.2 — Occupation-persona anchors.** Author `docs/personas/` files for the first occupation set within two proven archetypes: **clinic** (dental hygienist, front-desk coordinator) and **trades/field-service** (field service technician, dispatcher). Follow the persona template (owner voice, coworkers seeded-vs-simulated, archetype/category anchored to the catalog). These anchor Phases 3–5.

**Exit:** decisions recorded; ≥4 occupation personas committed under `docs/personas/`.

---

## Phase 1 — Occupation substrate (schema + seed + resolver read)

**Touches:** `packages/db/prisma/schema.prisma`, a new occupation seed data package (symmetric with `packages/storefront-templates/src/archetypes/*`), `packages/db/src/seed.ts`, `apps/web/lib/workforce/`.

- **P1.1 — `OccupationProfile` table + seed package.** Model per spec §5.1 (config, not principal). Seed the Phase-0 occupations for the clinic + trades archetypes. Validate `occupationKey` uniqueness and archetype scoping at seed time (fix-the-seed discipline). Strongly-typed `interaction` union declared in the same commit (AGENTS.md §3).
- **P1.2 — `Position.occupationKey` (nullable) + resolver helper.** Migration adds the column with inline backfill (null default; optional best-effort map from existing `jobFamily` strings where unambiguous). Add `resolveOccupationForEmployee(employeeProfile)` in `apps/web/lib/workforce/` walking `EmployeeProfile.positionId → Position.occupationKey → OccupationProfile`, returning `null` honestly when unresolved.
- **P1.3 — MCP read surface.** Extend the existing employee/registry read tools (`list_positions`, `query_employees`) so occupation is visible to coworkers as reference data; add a read-only `list_occupations` if the registry warrants it (grant `registry_read`, provenance-free description per AGENTS.md §8).

**Verify:** unit tests for the resolver (all fallbacks); migration applies cleanly on the shared local-CI sandbox; seed produces the expected occupation rows. No UI yet.

**Exit:** an employee can be resolved to an occupation (or an honest null) server-side.

---

## Phase 2 — Role-tailored workspace (extend the dormant vertical-home resolver)

**Touches:** `apps/web/lib/workspace-home/registry.ts` + resolver, `apps/web/lib/workspace-home/platform-loader.ts`, `apps/web/lib/govern/permissions.ts` (nav filter), `apps/web/app/(shell)/workspace/page.tsx`.

- **P2.1 — Occupation axis in the resolver.** Extend `resolveWorkspaceHomeContribution` to the five-tier order in spec §5.3 (archetype×occupation → category×occupation → archetype → category → platform). Reuse the existing typed contribution manifest, primitive library, and slot covenant unchanged. Register the **first occupation home contributions** (clinic hygienist, front-desk; field-service tech) — the registry is dormant, so these can be the first real contributions.
- **P2.2 — `occupationAllows` narrowing gate.** Add the fourth gate to `getShellNavSections`/`getWorkspaceSections` per spec §5.4 — narrows to the occupation `tileAllowlist`, never widens past `can()`, returns permissive when occupation is unresolved. Wire the existing worker/operator `dpf-nav-mode` switch as the role-authorized "show all my access" reveal.
- **P2.3 — Thread user/occupation into the command center.** Give `loadWorkspaceCommandCenter` an optional `{ occupationKey, userId }`; render per-occupation content when present, identical behavior when absent.

**Verify (functional):** on the Live portal with a seeded demo clinic, log in as a hygingist-position employee → `/workspace` resolves to the hygienist home with only clinical tiles; the reveal exposes broader access; command center shows occupation content. Repeat for field-service tech. Structural: resolver + gate unit tests.

**Exit:** two occupations in two archetypes render distinct, focused, honest workspace homes.

---

## Phase 3 — Per-occupation coworker privileges

**Touches:** `apps/web/lib/tak/agent-routing.ts` (`resolveAgentForRoute`), the coworker launcher/summon surface, the identity-access governance layer (`AgentGovernanceProfile`, `DirectivePolicyClass` persona category), `OccupationProfile.coworkerRoster` seed.

- **P3.1 — Roster enforcement in `resolveAgentForRoute`.** Consult the signed-in employee's occupation roster; if the route's default coworker is out-of-roster, present the nearest in-scope coworker or an honest "not part of your role — request access" state instead of silently attaching an out-of-scope agent. Preserve the existing `canAssist` capability behavior underneath.
- **P3.2 — Roster-scoped launcher.** The coworker launcher/summon surface lists only roster coworkers for the occupation.
- **P3.3 — Governance composition.** Bind each `OccupationCoworkerGrant` to an `AgentGovernanceProfile` so the same coworker can present a different authority envelope per occupation (identity-access spec's "different humans, different envelope"). Link `OccupationProfile.wsidProfessionFamily` to the WSID corpus so the coworker's doctrine matches the job. No change to the role∩agent-grant tool intersection — the roster gates reachability, not raw tool authority.

**Verify (functional):** hygienist sees the clinical scheduling + patient-comms coworkers, not finance/platform-eng; an out-of-roster route does not silently attach an out-of-scope coworker; the same coworker shows the correct envelope for two different occupations. Structural: routing + roster unit tests.

**Exit:** occupation determines the reachable coworker roster, governed, no security regression.

---

## Phase 4 — Onboarding that teaches Priority & Proactivity

**Touches:** `apps/web/components/setup/SetupOverlay.tsx` + `SETUP_STEPS`, the COO narration path (`buildStepTrigger`), `apps/web/components/attention/NeedsYouBand.tsx` (teaching empty-state), a new employee first-login journey component, the orphaned `apps/web/components/employee/OnboardingPanel.tsx` + `OnboardingTask`.

- **P4.1 — Teach the flagship features in owner setup.** Enrich the `workspace` step (or insert a `flagship-features` step) so the COO explicitly teaches Priority (the "Needs you" inbox) and Proactivity (scheduled coworkers + proposals). Add a **teaching empty-state** so `NeedsYouBand` teaches even when the queue is empty (fixes the "renders nothing when empty" gap).
- **P4.2 — Condensed employee first-login journey.** New 3–5 step intro per spec §5.7, coworker-narrated via the existing `open-agent-panel` autoMessage mechanism, delivered by the occupation-matched primary coworker. Steps 1–3 common (welcome, Priority, Proactivity); step 4 job-slice ("what the portal does for a {occupation.label}"); step 5 one next action.
- **P4.3 — Completion tracking + wire the orphaned panel.** Persist per-user completion (per P0.1 decision: `EmployeeProfile.platformIntroCompletedAt` or `OnboardingTask.kind:"platform-intro"`). First-login detection = no completed platform-intro curriculum. Wire `OnboardingPanel` to a route as the employee onboarding checklist home.

**Verify (functional):** a fresh non-owner employee's first login runs the condensed intro; Priority + Proactivity are taught (including empty-state); the job-slice names the occupation and its coworkers; completion persists (second login skips). Owner setup now teaches both features. Structural: first-login detection + curriculum unit tests.

**Exit:** both onboarding moments teach the two flagship features; employees get a condensed, job-aware intro.

---

## Phase 5 — Breadth, hardening & docs

- **P5.1 — Occupation breadth.** Add the next occupations per demand (e.g. office manager, dentist for clinic; apprentice for trades; retail associate for `retail-goods`), each with a persona anchor and a home contribution. Track silently-dropped coverage (`log` what's not yet covered — no silent caps).
- **P5.2 — Docs & standards.** Update the user guide (`docs/user-guide/market-archetypes.md` cross-refs), `docs/personas/README.md` (occupation-persona rules), and note the occupation dimension in the relevant `AGENTS.md` data-model context if a durable contract emerges.
- **P5.3 — Release QA.** Fold the two-occupation happy path into the affected phases of `tests/e2e/platform-qa-plan.md`.

**Exit:** occupation dimension is documented, covered by QA, and extensible by adding a seed + persona + contribution.

---

## Sequencing & dependencies

```
P0 (decisions + personas)
      │
      ▼
P1 (occupation substrate) ──► P2 (tailored workspace) ──► P4 (onboarding)
      │                                   │                     ▲
      └──────────────► P3 (coworker roster) ────────────────────┘
                                          │
                                          ▼
                                     P5 (breadth + docs)
```

- P1 is the hard prerequisite for everything.
- P2 and P3 can proceed in parallel after P1 (both read the occupation, touch different surfaces).
- P4 depends on P1 (occupation → coworker for narration) and reads P2/P3 output but can start its owner-setup half (P4.1) independently.
- P5 is continuous once P2–P4 land for the first archetype.

## Backlog mapping (filed 2026-07-16 under `EP-EMPLOYEE-OCCUPATION`)

All items are linked to the coordinating epic `EP-EMPLOYEE-OCCUPATION` and note their cross-composition in the body. Filed at `triaging` for Scrum-Master sizing.

| Phase | BI | Theme | Composes onto |
| ----- | -- | ----- | ------------- |
| P0 | `BI-36C6067F` | Occupation decisions + persona anchors | `EP-ARCHETYPE-DEMO` / persona library |
| P1 | `BI-442E2B42` | `OccupationProfile` substrate + `Position.occupationKey` + resolver | `EP-EMPLOYEE-OCCUPATION` |
| P2 | `BI-C135D07B` | Occupation axis in vertical-home resolver + narrowing nav gate | `EP-REDUCTION-GEAR-ARCH` |
| P3 | `BI-8A0E516C` | Occupation coworker roster + governance composition | `EP-COWORKER-INTERACTIVITY` |
| P4 | `BI-80682016` | Teach Priority/Proactivity + condensed employee first-login | `EP-ATTENTION-SURFACE` / `EP-PROACTIVE-OPS` / `EP-ONBOARDING-INTAKE` |
| P5 | `BI-79FC782D` | Occupation breadth + docs + QA | `EP-EMPLOYEE-OCCUPATION` |

## Risks

- **RBAC seam (P0.1) is load-bearing** — deferring the base-worker-role decision blocks P2's gate semantics. Resolve in P0.
- **Registry activation** — the vertical-home registry has never rendered a real contribution in production; P2 is also its first live proving, so budget functional-verification time there.
- **Empty demo data** — occupation homes need seeded per-archetype businesses (`EP-ARCHETYPE-DEMO`) to verify; ensure the demo factory covers the two Phase-0 archetypes before P2 sign-off.
- **Over-restriction** — the `occupationAllows` gate must ship with the role-authorized reveal in the same slice, or legitimate cross-work breaks (anti-pattern (b) in spec §3.4).
