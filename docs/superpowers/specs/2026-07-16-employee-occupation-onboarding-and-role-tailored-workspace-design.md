# Employee / Occupation Dimension: Role-Tailored Workspace, Per-Occupation Coworker Privileges, and Onboarding That Teaches Priority & Proactivity

| Field | Value |
| ----- | ----- |
| Status | Draft — for chief-architect review |
| Date | 2026-07-16 |
| Author | Claude Code (deep research pass) |
| Epic (proposed) | `EP-EMPLOYEE-OCCUPATION` (composes onto `EP-REDUCTION-GEAR-ARCH`, `EP-COWORKER-INTERACTIVITY`, `EP-ONBOARDING-INTAKE`, `EP-ATTENTION-SURFACE`, `EP-PROACTIVE-OPS`, `EP-WSID`) |
| Scope | The **occupation** dimension for a customer's in-trench employees: a role-tailored workspace surface, a per-occupation coworker roster, and a condensed first-login onboarding that teaches the two flagship UX features (Priority, Proactivity) with a job-specific slice. |
| Out of scope | Implementation, schema migration authoring, route rewrites, customer-portal changes, changes to the DPF platform-management RBAC security model, HR lifecycle mechanics already owned by the HR specs. |
| Companion plan | [`docs/superpowers/plans/2026-07-16-employee-occupation-onboarding-and-role-tailored-workspace.md`](../plans/2026-07-16-employee-occupation-onboarding-and-role-tailored-workspace.md) |

---

## 1. Purpose and problem statement

The founder directive: *"The onboarding process needs to teach the users about the two main UX features for priority and proactivity — at main portal setup and for each new user when they first log on as an employee. Employee onboarding needs a condensed way to introduce the platform. There are common aspects, but also job-specific aspects aligned to each archetype — a dental hygienist and a field service tech each need to know what the portal does for them. This may reveal persona gaps. The company-wide operations page needs to be tailored for a specific job; not all portal features need to be there. Add this employee-and-role dimension, with specific privileges to interact with certain AI coworkers."*

This spec addresses six coupled needs:

1. **Teach the two flagship UX features** — *Priority* (the Attention Surface / "Needs you" inbox) and *Proactivity* (proactive AI coworkers) — at two moments: portal setup, and each employee's first login.
2. **A condensed employee platform intro** — short, not the full COO-led owner tour.
3. **Common-core + job-specific onboarding** aligned to archetypes.
4. **A role-tailored operations/workspace surface** — the company-wide `/workspace` reshaped for a specific job, showing only the features that job needs.
5. **The employee + role (occupation) dimension** as durable substrate.
6. **Per-occupation coworker interaction privileges** — which AI coworkers a given job may summon/message.

### 1.1 The central finding: two different "role" systems are conflated today

DPF already has a role system, but it is the **platform-management** role system — the six `PlatformRole` values `HR-000`…`HR-500` (CDIO / Executive Sponsor, Portfolio Manager, Digital Product Manager, Enterprise Architect, ITFM Director, Operations Manager; `packages/db/data/role_registry.json`, `apps/web/lib/govern/permissions.ts:14-16`). These describe *who runs the Digital Product Factory itself*. A **dental hygienist is not a "Portfolio Manager."** The customer's in-trench employees have **occupations** — dental hygienist, field service technician, front-desk coordinator — and the platform has **no first-class model for occupation**:

- `Position` (`packages/db/prisma/schema.prisma:384-396`) carries free-text `title` / `jobFamily` / `jobLevel` with **zero behavioral wiring** — nothing downstream reads them.
- The industry-archetype system stops at the **business-type leaf** (`archetypeId` like `hvac-contractor`, `dental-practice`; `packages/storefront-templates/src/archetypes/`). There is **no occupation leaf** inside an archetype.
- "Persona" in the schema is exclusively an **AI voice/prompt** concept (`AgentPromptContext` `route-persona`, `DeliberationRoleProfile.personaGuidance`) — not a human-occupation concept.

**This is the persona gap the directive predicted.** The design introduces **Occupation** as the missing dimension and threads it through three behavioral axes (workspace surface, feature subset, coworker roster) plus the onboarding journey — composing onto existing substrate, never forking it.

---

## 2. Current-state audit (grounded)

### 2.1 The two flagship features exist; nothing teaches them

**Priority = the Attention Surface** ("Needs you" inbox). Epic `EP-ATTENTION-SURFACE`. Deliberately **no composite priority score** — tiered triage ordering (`apps/web/lib/attention/triage.ts`), read-model projections over nine sources (`apps/web/lib/attention/types.ts:12-21`), aggregated by `loadAttentionItems` (`apps/web/lib/attention/aggregate.ts`). Surfaces as `<NeedsYouBand/>` on the `/workspace` home (`apps/web/app/(shell)/workspace/page.tsx:47`) and the full inbox at `/workspace/inbox`. Nav label "Needs you" (`apps/web/lib/navigation/portal-navigation-model.ts:105-113`).

**Proactivity = proactive AI coworkers.** Epic `EP-PROACTIVE-OPS`. Substrate: `ScheduledAgentTask` (`schema.prisma:6512-6530`), `TaskRun.source="proactive"` (`schema.prisma:5312-5325`), and `AgentActionProposal` (`schema.prisma:4021-4039`). Created via the calendar scheduler (`apps/web/components/workspace/CalendarAgentScheduler.tsx`); surfaces as "Scheduled coworker" signals in the command center (`apps/web/lib/workspace/command-center.ts:1106`) and as `agent-proposal` rows in the attention inbox.

**Teaching gap (confirmed):** there is **no product-tour / coach-mark / spotlight / walkthrough framework** anywhere in `apps/web` (no Joyride/driver.js/Shepherd, no `data-tour` attributes). Feature teaching is entirely conversational via the COO **and only during owner setup**. Worse, `NeedsYouBand` renders **nothing when empty** (`NeedsYouBand.tsx:20`), so a fresh employee with an empty queue never learns the feature exists.

### 2.2 Onboarding exists only for the first owner

The **COO-led setup tour** (`docs/superpowers/specs/2026-03-21-coo-led-onboarding-design.md`) walks the *first owner* through real portal pages while the `onboarding-coo` agent narrates. Mechanics: `SetupOverlay` (`apps/web/components/setup/SetupOverlay.tsx`) mounts when an active `PlatformSetupProgress` exists, and on each step dispatches an `open-agent-panel` event carrying an `autoMessage` (`buildStepTrigger`, `SetupOverlay.tsx:25-60`) so the coworker gives live guidance. Steps are `SETUP_STEPS` (`apps/web/lib/actions/setup-constants.ts:6-28`), each mapped to a real route.

**Gaps (confirmed):**
- First-run is detected at the **org level** (`isFirstRun()`, `apps/web/lib/actions/setup-progress.ts:53-75`) and the tour is bound to `PlatformSetupProgress.userId` — the **owner only**. A second, non-owner employee's first login gets **nothing**: they land directly in `/workspace`.
- There is **no per-user onboarding-completion flag** on `User` — the only completion marker is `PlatformSetupProgress.completedAt`.
- The HR **`OnboardingPanel.tsx`** (`apps/web/components/employee/OnboardingPanel.tsx`) + `OnboardingTask` model + `completeOnboardingTask` action exist and function, but the panel is **wired to no route** (orphaned). It is a natural home for an employee onboarding checklist.

### 2.3 The workspace is archetype-tailorable but role-flat, and the registry is dormant

The internal home is `/workspace` (`apps/web/app/(shell)/workspace/page.tsx`). The **Vertical Workspace Home design** (`docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md`, accepted under `EP-REDUCTION-GEAR-ARCH`) already specifies a **typed contribution registry + resolver** that tailors the home by `StorefrontArchetype`. It is fully built and validated (`apps/web/lib/workspace-home/registry.ts`, `resolveWorkspaceHomeContribution` at `registry.ts:132`) **but has zero production contributions registered** (`defaultWorkspaceHomeRegistry = createWorkspaceHomeRegistry()` with an empty default, `registry.ts:44,59`; all `semanticArchetypeIds` registrations live in test files). So every install renders the fixed `PlatformWorkspaceHome` fallback today.

What is already role-varied (via the coarse six platform roles, not occupation):
- **Tiles/work-areas**: `getWorkspaceSections(user)` filters `ALL_TILES` by capability (`apps/web/lib/govern/permissions.ts:279-345`).
- **Nav**: `getShellNavSections` applies a **3-gate filter** — user capability (`can()`), org-archetype capability (`orgGateOpen`), and audience mode `worker|operator|customer|diagnostic` (`govern/permissions.ts:308-313`; `PortalAudienceMode` at `portal-navigation-model.ts:3`; persisted via the `dpf-nav-mode` cookie).

What is **not** role/occupation-varied:
- The registry resolver keys on **org archetype only** (`registry.ts:139-176`) — there is no `platformRole`/occupation input.
- `BusinessCommandCenter` is **org-wide** — `loadWorkspaceCommandCenter(prismaClient)` takes no user context (`apps/web/lib/workspace-home/platform-loader.ts:40`).

Critically, the vertical-home spec explicitly says *"No routing decision should be based only on role"* and leaves the operator-switch authority predicate abstract — it never modeled an **occupation-within-archetype** axis. That is the seam this spec extends.

### 2.4 Coworker access is route-driven, not role/occupation-scoped

- **Which coworker** a user sees is a pure function of **route** (`ROUTE_AGENT_MAP` + `resolveAgentForRoute`, `apps/web/lib/tak/agent-routing.ts:90,679`) — one persona per route prefix. Role only sets `canAssist` (whether it helps) via `can(userContext, capability)` — it never picks a different coworker or hides one.
- **Tool grants** are a role∩agent-grant intersection: a tool runs only if the operator's platform role satisfies `requiredCapability` **and** the agent holds the mapped grant (`getAvailableTools`, `apps/web/lib/mcp-tools.ts:4730-4756`; `TOOL_TO_GRANTS` + `isToolAllowedByGrants`, `apps/web/lib/tak/agent-grants.ts`).
- **Per-role/per-occupation coworker interaction privileges are ABSENT.** `summon_coworker`/`request_coworker` are **agent→agent** only (`apps/web/lib/tak/coworker-collaboration.ts`). `Agent` has **no FK** to `Department`/`Position`/`EmployeeProfile`. The closest existing user→agent primitive is `DelegationGrant` (`schema.prisma:2064`) — per-instance delegation, not a durable "this occupation may summon these coworkers" policy.

### 2.5 Prior art to compose onto (do not rebuild)

- **Unified identity-access-agent-governance** (`docs/superpowers/specs/2026-03-13-unified-identity-access-agent-governance-design.md`): `Team`/`TeamMembership`, `AgentGovernanceProfile` (autonomy/HITL), `DelegationGrant`, and `DirectivePolicyClass` whose `configCategory` **already includes `persona`** — designed so "different humans experience the same agent with different authority envelopes." This is the governance spine the occupation→coworker roster attaches to.
- **`EP-COWORKER-INTERACTIVITY`** (open): shipped grant taxonomy + role-scoped coworker toolsets (`BI-B2F7ABF5`, `BI-F75E897A`).
- **`EP-WSID`** (done): per-profession knowledge corpus, ~23 profession families — the coworker's *professional doctrine* already varies by profession; occupation links to a WSID family.
- **`EP-ONBOARDING-INTAKE`** (open): business/org onboarding via Derive→Ingest→Confirm→Ask, including roster CSV → `EmployeeProfile` (`BI-9B1E403D`, done). Individuals arrive as bulk rows — this spec gives each row a first-login journey.
- **`EP-ARCH-8D4F2A` / `EP-ARCHETYPE-DEMO`**: archetype model V2 + realistic demo business per archetype.
- **Persona library** (`docs/personas/`): Dale (HVAC owner), Linda (clinic), Marisol (retail) — all **owner** personas; the occupation personas *within* an archetype are the documented gap.

---

## 3. Research & benchmarking (AGENTS.md §10)

### 3.1 Commercial systems

- **Microsoft Dynamics 365 — Role Centers.** Each business role gets a tailored home page (cards, queues, KPIs, activities) driven by the assigned security role. The direct analog to a role-tailored `/workspace`. **Adopt:** occupation → a curated home surface. **Reject:** Dynamics couples the home tightly to its RBAC security role; we keep the *security* boundary (platform-management RBAC) separate from the *occupation* focus layer.
- **SAP Fiori — Business Roles → Launchpad Spaces & Pages.** A business role maps to a "space" containing "pages" of app tiles; users only see apps their role composes. **Adopt:** occupation as a reusable bundle that resolves to a page of tiles/coworkers, seeded centrally. **Reject:** Fiori's catalog/group/tile-mapping ceremony — DPF already has a typed contribution registry that is lighter.
- **Workday — role-based dashboards/worklets.** Worklets surface only role-relevant tasks. **Adopt:** the "only what this job needs" default.
- **ServiceNow — role-based Workspaces + Guided Setup + Next Experience onboarding.** Role-scoped agent/workspace surfaces plus a guided-tour onboarding layer. **Adopt:** the pairing of a role-tailored surface *with* a guided onboarding layer — exactly this spec's two halves.
- **Salesforce — Permission Sets + In-App Guidance/Trailhead.** Additive permission sets on top of a base profile; in-app prompts teach features contextually. **Adopt:** occupation as an *additive, composable* layer over a base worker role (not a monolithic profile). **Reject:** Salesforce's static tooltip walkthroughs — DPF teaches via a coworker, not a tooltip.

### 3.2 Open-source systems

- **ERPNext — Role Profiles + Workspaces + Module Onboarding.** A "Role Profile" bundles multiple roles; each module has a workspace and a guided "onboarding" step list. The closest full analog to occupation (bundle) + role-tailored workspace + guided onboarding. **Adopt:** the three-in-one shape. **Reject:** ERPNext's free-form workspace page-builder (DPF uses typed contributions per §5.5 of the vertical-home spec).
- **Odoo — Groups → tailored menus + industry modules.** Access groups drive which menus/apps appear; industry packs tailor the install. **Adopt:** occupation narrows the visible surface the way groups narrow menus.
- **Keycloak — realm roles, composite roles, groups.** Composite roles aggregate finer roles; groups attach role sets to users. **Adopt:** occupation modeled as a composable set of capability/coworker grants (a "composite"), not a flat enum.
- **Frappe Workspaces** (already cited by the vertical-home spec): declarative block-based work surfaces. **Adopt:** declarative, typed composition.

### 3.3 Feature-teaching / product-tour technology

Shepherd.js, driver.js, react-joyride, Intro.js are the standard spotlight/coach-mark libraries. **Pattern adopted:** anchored, dismissible, progress-tracked step sequences over live UI. **Pattern rejected:** static, text-only tooltips as the *primary* teacher. DPF's differentiator is a **coworker-narrated** intro — the same `open-agent-panel` autoMessage mechanism the COO tour already uses — so the learner meets their AI coworkers *by being taught by one*. We may use a lightweight anchor/spotlight primitive for visual highlighting, but narration is the coworker's.

### 3.4 Patterns adopted / rejected / anti-patterns / gaps filled

**Adopted:** occupation → tailored home (Dynamics Role Centers, Fiori Spaces); occupation as a composable bundle over a base worker role (ERPNext Role Profile, Keycloak composite, Salesforce permission sets); guided onboarding paired with the tailored surface (ServiceNow, ERPNext); occupation seeded centrally per archetype, symmetric with `packages/storefront-templates/src/archetypes/*`; coworker-narrated teaching over static tooltips.

**Rejected:** static tooltip-only tours; a runtime page-builder for occupation homes; a global occupation enum (there are thousands of occupations — use a seeded, archetype-scoped registry); a separate employee runtime *shell* (forbidden by `docs/superpowers/specs/2026-03-15-employee-tool-intake-design.md`: *"preserve one workspace shell for all roles"*).

**Anti-patterns identified:** (a) **conflating admin RBAC with business-job roles** — DPF's current state, where the six HR-* platform-management roles are the only role axis; (b) **hard-hiding features** so a worker cannot reach legitimate cross-work — use progressive disclosure + role-authorized reveal, not deletion of access; (c) occupation *widening* the security envelope — occupation must only ever *focus/narrow* within what the platform-role RBAC already permits (except the coworker roster, which is an explicit additive grant governed by the coworker's own `AgentGovernanceProfile`).

**Gaps this design fills:** the missing occupation dimension bridging HR data (`EmployeeProfile`/`Position`) to the three behavioral axes; the missing feature-teaching layer for Priority & Proactivity; the missing per-occupation coworker roster; the missing per-employee (non-owner) first-login journey.

---

## 4. Design principles

1. **Occupation focuses; RBAC secures.** The platform-management RBAC (`can()` over the six `PlatformRole`s + org-archetype capabilities) remains the **security boundary**. Occupation is a **focus + curation** layer that *narrows* the surface to what the job needs and *adds* a governed coworker roster. Occupation never grants a platform-management capability the role lacks.
2. **One shell, tailored content.** Do not fork a per-occupation runtime. Vary tiles, home slots, nav emphasis, and coworker roster within the single `/workspace` shell (per employee-tool-intake).
3. **Compose, don't rebuild.** Extend the vertical-home resolver (archetype → archetype×occupation), the identity-access governance envelope (occupation→coworker), the WSID corpus (occupation→profession family), and the SetupOverlay narration mechanism (owner tour → employee intro). No parallel systems.
4. **Occupation is a template, not an identity.** `OccupationProfile` is seeded config (like `StorefrontArchetype`), not an identity-bearing entity — so it is **not** a `Principal` and does not trigger the principal-convergence obligation (AGENTS.md §11). Employees remain the only workforce principals.
5. **Teach by encountering a coworker.** Feature teaching is coworker-narrated, job-matched, and honest about empty states (teach the feature even when its queue is empty).
6. **Progressive disclosure.** Default employee view = 3–5 essential things for their job; more is reachable, not absent, when the role authorizes it.
7. **Honest unconfigured state.** If an occupation has no tailored contribution yet, fall back to the archetype home, then the platform home — and say so to admins, never fake a tailored surface.

---

## 5. Architecture

### 5.1 The occupation model (new substrate — minimal)

Introduce **`OccupationProfile`** — a reusable, archetype-scoped template describing a job. Seeded from a code data package symmetric with `packages/storefront-templates/src/archetypes/*` and mirrored into a DB table (like `StorefrontArchetype`).

```ts
type OccupationProfile = {
  occupationKey: string;              // stable slug, e.g. "dental-hygienist", "field-service-technician"
  label: string;                      // "Dental Hygienist"
  summary: string;                    // one line: what this job does with the portal
  archetypeCategories: string[];      // industries where it appears, e.g. ["healthcare-wellness"]
  archetypeIds?: string[];            // optional narrower business-type scope, e.g. ["dental-practice"]
  baseWorkerRole: PlatformRoleId;     // the RBAC floor this occupation sits on (see §5.6)
  wsidProfessionFamily?: string;      // link to the WSID professional corpus (EP-WSID)
  featureSurface: {
    tileAllowlist: WorkspaceTileKey[];       // which ALL_TILES this job sees by default
    navEmphasis: string[];                   // route prefixes to foreground
    workspaceHomeOccupationId?: string;      // occupation-scoped home contribution (see §5.3)
  };
  coworkerRoster: OccupationCoworkerGrant[]; // which coworkers this job may summon (see §5.5)
  onboardingCurriculumId: string;            // the condensed intro to run on first login (see §5.7)
};

type OccupationCoworkerGrant = {
  agentSlug: string;                  // seeded coworker identity (packages/db/src/seed.ts)
  interaction: "summon" | "assigned-only" | "read-only";
  governanceProfileRef?: string;      // reuse AgentGovernanceProfile authority envelope
};
```

`OccupationProfile` is **not** a `Principal`. It is validated against a closed seeded set per archetype (no free global enum). Adding an occupation is a data + seed change reviewed like an archetype.

### 5.2 Binding employees to occupation (one schema hook)

The only change to the HR substrate: add a nullable `occupationKey` to **`Position`** (which already carries `title`/`jobFamily`/`jobLevel` with no wiring). Employees resolve their occupation transitively:

```
EmployeeProfile.positionId → Position.occupationKey → OccupationProfile
```

This keeps `EmployeeProfile`/`Position`/`Department` canonical (AGENTS.md §11), adds no new identity entity, and lets an org map many positions to one occupation. When an occupation cannot resolve (position unset, or `occupationKey` null), the employee gets the archetype home and the generic worker roster — an honest fallback, not a broken surface.

### 5.3 Role-tailored workspace: extend the vertical-home resolver

The vertical-home resolver (`resolveWorkspaceHomeContribution`, keyed on archetype) gains an **occupation input** and a wider resolution order. This is an *extension* of `EP-REDUCTION-GEAR-ARCH` substrate, not a new resolver.

```ts
type WorkspaceHomeResolutionInput = {
  organizationId: string;
  archetypeId: string;        // semantic slug (existing)
  category: string;           // existing
  occupationKey?: string;     // NEW — from the signed-in employee
  platformRole: PlatformRoleId | null;
};
```

Resolution order (most specific wins; every step falls through honestly):

1. `archetypeId` × `occupationKey`  → occupation-specific home for this exact business type.
2. `category` × `occupationKey`      → occupation home generic across the industry.
3. `archetypeId`                     → existing archetype vertical home (unchanged).
4. `category`                        → existing category vertical home (unchanged).
5. platform fallback                 → existing `PlatformWorkspaceHome`.

Occupation contributions reuse the **same typed contribution manifest, primitive library, and slot covenant** the vertical-home spec already defines (§5.5 there: today/now slot, exceptions slot, coworker-handoffs slot). An occupation contribution simply supplies a job-scoped slot set + `tileAllowlist`. Because the vertical-home substrate is dormant (zero registered contributions), the first occupation homes and the first archetype homes can land together — the registry is ready.

**Thread user context into the command center.** The org-wide `loadWorkspaceCommandCenter(prismaClient)` gains an optional `{ occupationKey, userId }` so per-occupation content (a hygienist's patient queue vs a tech's dispatch board) can render. Absent context, it behaves exactly as today.

### 5.4 Feature subset per occupation (progressive disclosure, not deletion)

The occupation `tileAllowlist` + `navEmphasis` define the **default focused view**. Enforcement composes with the existing 3-gate nav filter (`getShellNavSections`) as a **fourth, narrowing gate**:

```
visible(tile) = can(user, tile.capability)          // RBAC security floor (unchanged)
             && orgGateOpen(tile.orgCapability)      // org-archetype gate (unchanged)
             && audienceMode.includes(tile.mode)     // worker/operator mode (unchanged)
             && occupationAllows(tile, occupation)   // NEW — focus/curation
```

`occupationAllows` returns true when the tile is in the occupation's allowlist **or** the occupation is unresolved (fallback = show role-permitted set). It never returns true for a tile the RBAC floor already denies. A role-authorized "Show all my access" reveal (reusing the existing worker/operator `dpf-nav-mode` switch) lets a user who legitimately has broader access step out of the focused view — progressive disclosure, not a locked box.

### 5.5 Per-occupation coworker privileges

Today coworker visibility is route-driven and role only sets `canAssist`. Add an **occupation coworker roster** enforced at two points:

1. **`resolveAgentForRoute`** consults the signed-in employee's `OccupationProfile.coworkerRoster`. If the route's default coworker is not in the roster, the panel shows the roster's nearest in-scope coworker (or an honest "this coworker isn't part of your role — request access" state) instead of silently attaching an out-of-scope agent.
2. **The coworker launcher / summon surface** lists only roster coworkers for that occupation.

Governance composes with the identity-access spec rather than a parallel gate:
- Each `OccupationCoworkerGrant` references an **`AgentGovernanceProfile`** (autonomy/HITL envelope) so the *same* coworker can present a different authority envelope to a hygienist vs an office manager — the "different humans, different envelope" goal the identity-access spec already states.
- The `DirectivePolicyClass` `persona` config category (already in that spec) is the natural home for occupation-scoped coworker directives.
- The coworker's **WSID profession family** (via `OccupationProfile.wsidProfessionFamily`) aligns the coworker's professional doctrine to the job.

This is additive privilege (a roster grant), but every actual tool call still passes the existing role∩agent-grant intersection (`getAvailableTools`) and the coworker's own governance — the roster decides *reachability*, not raw authority.

### 5.6 Occupation vs the platform-management roles (the RBAC seam)

The six `HR-000…HR-500` roles stay exactly as they are — they govern *platform administration*. In-trench business employees sit on a **base worker role** (`OccupationProfile.baseWorkerRole`). Two clean options for the base, to be decided at plan time with the chief architect:

- **Option A (recommended): reuse the existing worker audience + a minimal platform role floor.** Most business employees map to the least-privileged platform role and the `worker` audience mode; occupation supplies all business-work curation and the coworker roster. Smallest change; no new RBAC value.
- **Option B: add one `HR-600` "Workforce Member" platform role.** A clean 7th role that explicitly means "customer's in-trench employee," decoupling business employees from the platform-management ladder. Larger change (touches `PlatformRoleId`, `PERMISSIONS`, seeds) but conceptually cleaner.

Either way, occupation — not the platform role — is what makes a hygienist's surface a hygienist's surface. The spec records this as a decision for §9.

### 5.7 Onboarding: teach Priority & Proactivity, condensed and job-aware

Two onboarding moments, one reusable narration mechanism.

**(a) Portal setup (owner).** Extend the COO-led tour: the existing `workspace` step (`SETUP_STEPS`) is enriched — or a dedicated `flagship-features` step is inserted — that explicitly teaches **Priority** (the "Needs you" inbox) and **Proactivity** (scheduled coworkers + proposals), narrated by the COO via the existing `buildStepTrigger` autoMessage path. Fix the empty-state hiding: during onboarding, `NeedsYouBand`/the teaching surface shows a **teaching empty-state** ("This is where work that needs *you* will appear — ranked by urgency, each with a reason") instead of rendering nothing.

**(b) Per-employee first login (new).** A **condensed, occupation-aware intro** — the "first-day welcome" — replacing the current nothing. It is short (3–5 steps), coworker-narrated, and split common-core + job-slice:

| Step | Content | Common vs job |
| ---- | ------- | ------------- |
| 1. Welcome | "You're now set up on {org}'s platform. Here's the 3-minute version." | Common |
| 2. Priority | Show the "Needs you" inbox; teach the tiered "what's most pressing, and why" model. | Common |
| 3. Proactivity | Introduce their AI coworkers acting ahead of them (scheduled coworkers, proposals awaiting a yes). | Common |
| 4. Your job on the portal | "Here's what the portal does for a **{occupation.label}**" — the tailored home, the tiles that matter, and the coworkers on their roster. | **Job-specific** (driven by `OccupationProfile`) |
| 5. Done | One next action ("open your board"). | Common |

Narration is delivered by the **occupation-matched coworker** (via `OccupationProfile.coworkerRoster` → the primary coworker), reusing the `open-agent-panel` autoMessage mechanism. So the employee learns Priority/Proactivity *and* meets their coworkers in one flow.

**Persistence & tracking:** reuse the orphaned HR **`OnboardingPanel` + `OnboardingTask`** substrate. Add a small set of platform-intro curriculum tasks (learn-priority, learn-proactivity, meet-coworkers, job-tour) keyed by `onboardingCurriculumId`, and mark completion per **user** (an `EmployeeProfile.platformIntroCompletedAt` timestamp, or an `OnboardingTask` of a new `kind:"platform-intro"`). First-login detection = employee has no completed platform-intro curriculum. This also finally wires `OnboardingPanel` to a route.

### 5.8 Persona gaps this design closes (and the library extension)

- **Human-occupation persona** — created as `OccupationProfile`.
- **Occupation personas *within* an archetype** — the persona library (`docs/personas/`) holds only owner personas (Dale/Linda/Marisol). Extend it with **employee/occupation personas per archetype**, each a case-study + test fixture, e.g. under the clinic archetype: dental hygienist, front-desk coordinator, office manager, dentist; under trades-maintenance: field service technician, dispatcher, apprentice. These anchor the occupation home contributions and the job-slice onboarding copy (they are the validation drift guard the vertical-home spec §7.1 already demands).
- **Admin-RBAC vs business-occupation conflation** — resolved by §5.6.
- **Archetype leaf lacks an occupation level** — resolved by the archetype-scoped occupation registry (§5.1).

---

## 6. Data-model stewardship (AGENTS.md §11)

- **Reuse, don't fork:** `EmployeeProfile`, `Position`, `Department`, `Team`/`TeamMembership`, `OnboardingTask`, `AgentGovernanceProfile`, `DelegationGrant`, `DirectivePolicyClass`, `StorefrontArchetype`, the workspace-home registry, WSID corpus.
- **New tables (2):** `OccupationProfile` (+ its seed data package) and the coworker-roster rows (embed on `OccupationProfile` or a thin `OccupationCoworkerGrant` join, decided at plan time). Both are **config/template**, not identity — no `Principal` (§11 principal-convergence not triggered).
- **New columns (1–2):** `Position.occupationKey` (nullable FK-by-slug); `EmployeeProfile.platformIntroCompletedAt` (or an `OnboardingTask.kind`).
- **Enums (AGENTS.md §3):** `occupationKey` is a **seeded registry**, not a hardcoded global enum (thousands of occupations); it is validated per archetype at seed time, the way `archetypeId` is. `interaction` on the coworker grant *is* a small closed enum (`summon|assigned-only|read-only`) and must be declared as a strongly-typed union in the same commit as its first use.
- **`Organization` canonical identity** untouched.

---

## 7. Verification strategy (AGENTS.md §5 — structural is not sufficient)

Structural (necessary): unit tests for the extended resolver (all five resolution tiers + occupation-unresolved fallback), the `occupationAllows` narrowing gate (never widens past RBAC), the coworker-roster enforcement in `resolveAgentForRoute`, and the onboarding-completion detection. Type-level assertion that occupation contributions satisfy the existing slot covenant. Theme-aware component tests (no hardcoded colors).

Functional (required for ship): on the **Live portal** (`http://localhost:3000`, per `project_portal_address`) with a seeded demo business per `EP-ARCHETYPE-DEMO`:
1. Seed at least two occupations in one archetype (e.g. dental hygienist + front-desk coordinator in a `dental-practice`), each bound to a `Position` and an `EmployeeProfile` with its own `User`.
2. Log in as each employee's first login; drive the condensed intro end-to-end; confirm Priority and Proactivity are taught (including the teaching empty-state), the job-slice names the occupation, and completion persists (second login skips it).
3. Confirm each employee's `/workspace` resolves to the occupation-tailored home, shows only the occupation's tiles by default, and the role-authorized reveal still exposes broader access.
4. Confirm the coworker panel lists only the occupation's roster and attaches the right coworker per route; confirm an out-of-roster coworker is not silently attached.
5. Submit a structured dynamic-analysis report (drove X → observed Y → signed off Z) per `feedback_dynamic_analysis_is_evidence`. Desktop + mobile.

The `dpf-ux-fit-review` skill runs before any UI-impacting slice, and each PR carries a `UX-Fit-Decision:` trailer (AGENTS.md §12).

---

## 8. How this composes with existing epics

| Existing epic | This design's relationship |
| ------------- | -------------------------- |
| `EP-REDUCTION-GEAR-ARCH` (vertical workspace home) | **Extends** the resolver with an occupation axis; registers the first occupation contributions. |
| `EP-COWORKER-INTERACTIVITY` (grant taxonomy, role-scoped toolsets) | **Adds** the occupation→coworker roster on top of the shipped role-scoped toolsets. |
| `EP-ONBOARDING-INTAKE` (business onboarding, roster CSV → EmployeeProfile) | **Continues** the story: each imported employee now gets a first-login journey and an occupation. |
| `EP-ATTENTION-SURFACE` (Priority) / `EP-PROACTIVE-OPS` (Proactivity) | **Teaches** both features in onboarding; fixes the empty-state hiding for teaching. |
| `EP-WSID` (profession corpus) | **Links** occupation → profession family so the coworker's doctrine matches the job. |
| `EP-ARCH-8D4F2A` / `EP-ARCHETYPE-DEMO` | **Consumes** archetype model V2 + demo businesses as the seed substrate and verification fixtures. |

---

## 9. Decisions and open questions

**Decisions taken in this spec:**
- Occupation is a **template/config** dimension (not identity/principal), seeded per archetype, bound to employees via `Position.occupationKey`.
- Occupation **focuses and adds a coworker roster**; it never widens the platform-management RBAC security envelope.
- The role-tailored home is an **extension of the existing vertical-home resolver**, not a new surface.
- Onboarding teaches Priority & Proactivity via the **existing coworker-narration mechanism**, condensed for employees and split common-core + job-slice.
- Persona library extends to **occupation personas within archetypes**.

**Open questions for plan/architect:**
1. **Base worker role** — Option A (reuse least-privileged platform role + worker audience) vs Option B (add `HR-600` Workforce Member). §5.6.
2. **Coworker roster storage** — embed on `OccupationProfile` vs a thin `OccupationCoworkerGrant` join table (favor the join for queryability + per-install override).
3. **Completion tracking** — `EmployeeProfile.platformIntroCompletedAt` column vs `OnboardingTask.kind:"platform-intro"` rows (favor reusing `OnboardingTask` to also wire the orphaned panel).
4. **Occupation override per install** — do customers relabel/re-scope a seeded occupation (like `customVocabulary`), or is the seed authoritative until real pressure? (Favor seed-authoritative first; DB override later, mirroring the vertical-home vocabulary decision.)
5. **Which permission grant authorizes the "show all my access" reveal** — inherit the vertical-home spec's deferred operator-switch predicate decision.

---

## 10. Reporting protocol

This spec pass produces: this design doc; a companion phased plan; a proposed epic `EP-EMPLOYEE-OCCUPATION` with BIs composing onto the epics in §8; and occupation-persona anchors under `docs/personas/`. No implementation in this pass — per the delivery-surfaces doctrine, filed BIs are promoted through the evidence-gated lifecycle (external build or Build Studio, chosen by fit).
