# Employee / Occupation Dimension: Role-Tailored Workspace, Per-Occupation Coworker Privileges, and Onboarding That Teaches Priority & Proactivity

| Field | Value |
| ----- | ----- |
| Status | Draft — for chief-architect review |
| Date | 2026-07-16 |
| Author | Claude Code (deep research pass), Codex review/research amendments |
| Epic (proposed) | `EP-EMPLOYEE-OCCUPATION` (composes onto `EP-REDUCTION-GEAR-ARCH`, `EP-COWORKER-INTERACTIVITY`, `EP-ONBOARDING-INTAKE`, `EP-ATTENTION-SURFACE`, `EP-PROACTIVE-OPS`, `EP-WSID`) |
| Scope | The **occupation** dimension for a customer's in-trench employees: a role-tailored workspace surface, a per-occupation coworker roster, and a condensed first-login onboarding that teaches the two flagship UX features (Priority, Proactivity) with a job-specific slice. |
| Out of scope | Implementation, schema migration authoring, route rewrites, customer-portal changes, changes to the existing six DPF platform-management roles, HR lifecycle mechanics already owned by the HR specs. The base workforce access floor in §5.6 is in scope because occupation needs a safe security floor. |
| Companion plan | [`docs/superpowers/plans/2026-07-16-employee-occupation-onboarding-and-role-tailored-workspace.md`](../plans/2026-07-16-employee-occupation-onboarding-and-role-tailored-workspace.md) |

---

## 1. Purpose and problem statement

The founder directive: *"The onboarding process needs to teach the users about the two main UX features for priority and proactivity — at main portal setup and for each new user when they first log on as an employee. Employee onboarding needs a condensed way to introduce the platform. There are common aspects, but also job-specific aspects aligned to each archetype — a dental hygienist and a field service tech each need to know what the portal does for them. This may reveal persona gaps. The company-wide operations page needs to be tailored for a specific job; not all portal features need to be there. Add this employee-and-role dimension, with specific privileges to interact with certain AI coworkers."*

This spec addresses seven coupled needs:

1. **Teach the two flagship UX features** — *Priority* (the Attention Surface / "Needs you" inbox) and *Proactivity* (proactive AI coworkers) — at two moments: portal setup, and each employee's first login.
2. **A condensed employee platform intro** — short, not the full COO-led owner tour.
3. **Common-core + job-specific onboarding** aligned to archetypes.
4. **A role-tailored operations/workspace surface** — the company-wide `/workspace` reshaped for a specific job, showing only the features that job needs.
5. **The employee + role (occupation) dimension** as durable substrate.
6. **Per-occupation coworker interaction privileges** — which AI coworkers a given job may summon/message.
7. **Joiner/mover/leaver-safe lifecycle behavior** — first-login onboarding is only the first event; a later position/occupation change must re-scope the workspace and coworker roster without leaving stale access behind.

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

### 3.1 Standards and commercial systems

- **NIST RBAC / ANSI INCITS 359.** NIST records RBAC as an ANSI/INCITS standard and points implementers toward role engineering and RBAC standards. **Adopt:** keep raw authority expressed as auditable role/permission assignments. **Reject:** treating "occupation" as an informal UI-only label that can bypass authorization. Source: [NIST RBAC project](https://csrc.nist.gov/projects/role-based-access-control).
- **Microsoft Dynamics 365 Business Central — Role Centers.** Microsoft describes Role Centers as the user's entry point and home page, customized to the user's profile, and notes that the Role Center is a natural space for welcome/checklist onboarding content. **Adopt:** occupation → curated home + onboarding checklist on the same surface. **Reject:** binding the home directly to the same object that grants permissions; DPF needs a separate focus layer over a security floor. Source: [Designing Role Centers](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-designing-role-centers).
- **SAP Fiori — Business Roles → Launchpad Spaces & Pages.** SAP's spaces/pages model packages role-relevant apps into launchpad surfaces. **Adopt:** occupation as a reusable bundle that resolves to a page of tiles/coworkers, seeded centrally. **Reject:** Fiori's catalog/group/tile-mapping ceremony — DPF already has a typed contribution registry that is lighter. Source: [SAP spaces/pages best practices](https://help.sap.com/docs/SAP_S4HANA_CLOUD/4fc8d03390c342da8a60f8ee387bca1a/3885563c3c054af3a68220029e5a8fc3.html).
- **Microsoft Entra Lifecycle Workflows.** Entra models employee lifecycle work as joiner/mover/leaver workflows with triggers, scopes, templates, task history, and on-demand runs. **Adopt:** first-login onboarding as one lifecycle workflow; position/occupation changes are mover events that may reset or add curriculum. **Reject:** one-shot onboarding state with no lifecycle history. Source: [Understanding lifecycle workflows](https://learn.microsoft.com/en-us/entra/id-governance/understanding-lifecycle-workflows).
- **ServiceNow Employee Center / Guided Self-Service.** ServiceNow frames Employee Center around employee navigation, search, task management, and guided self-service experiences. **Adopt:** task-focused employee portal with guided, contextual self-service. **Reject:** a broad platform-operator dashboard for every employee. Sources: [Configuring Employee Center](https://www.servicenow.com/docs/r/employee-service-management/employee-experience-foundation/setup-emp-center.html), [Guided Self-Service](https://www.servicenow.com/docs/r/yokohama/employee-service-management/employee-experience-foundation/gss-guided-self-service-overview.html).
- **Salesforce — In-App Guidance.** Salesforce positions in-app guidance as contextual prompts/walkthroughs for training users where they work. **Adopt:** anchored guidance over live UI. **Reject:** static tooltip walkthroughs as the primary teacher; DPF's differentiator is coworker-narrated learning. Source: [Salesforce In-App Guidance](https://help.salesforce.com/s/articleView?id=sales.iag_create.htm&language=en_US&type=5).

### 3.2 Open-source systems

- **ERPNext — Role Profiles + Workspaces + Module Onboarding.** ERPNext Role Profiles store multiple roles so similar users can receive a bundle at once. This is the closest open-source analog to occupation bundle + role-tailored workspace + guided onboarding. **Adopt:** the three-in-one shape. **Reject:** ERPNext's free-form workspace page-builder (DPF uses typed contributions per §5.5 of the vertical-home spec). Source: [ERPNext Role and Role Profile](https://docs.frappe.io/erpnext/role-and-role-profile).
- **Odoo — Groups → tailored menus + industry modules.** Access groups drive which menus/apps appear; industry packs tailor the install. **Adopt:** occupation narrows the visible surface the way groups narrow menus.
- **Keycloak — realm roles, composite roles, groups.** Composite roles aggregate finer roles; groups attach role sets to users. **Adopt:** occupation modeled as a composable set of capability/coworker grants (a "composite"), not a flat enum.
- **Frappe Workspaces** (already cited by the vertical-home spec): declarative block-based work surfaces. **Adopt:** declarative, typed composition.

### 3.3 Feature-teaching / product-tour technology

Shepherd.js, driver.js, react-joyride, Intro.js are the standard spotlight/coach-mark libraries. **Pattern adopted:** anchored, dismissible, progress-tracked step sequences over live UI. **Pattern rejected:** static, text-only tooltips as the *primary* teacher. DPF's differentiator is a **coworker-narrated** intro — the same `open-agent-panel` autoMessage mechanism the COO tour already uses — so the learner meets their AI coworkers *by being taught by one*. We may use a lightweight anchor/spotlight primitive for visual highlighting, but narration is the coworker's.

### 3.4 Patterns adopted / rejected / anti-patterns / gaps filled

**Adopted:** occupation → tailored home (Dynamics Role Centers, Fiori Spaces); occupation as a composable bundle over a base worker role (ERPNext Role Profile, Keycloak composite, Salesforce permission sets); guided onboarding paired with the tailored surface (ServiceNow, ERPNext, Microsoft Entra); occupation seeded centrally per archetype, symmetric with `packages/storefront-templates/src/archetypes/*`; coworker-narrated teaching over static tooltips.

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
8. **Lifecycle events are first-class.** Joiner onboarding, mover re-scoping, and leaver revocation are separate events with history. A changed `Position.occupationKey` must re-evaluate workspace, nav, curriculum, and coworker roster immediately.
9. **Admin mapping must be explainable.** Operators need to see "why this employee sees this" from the employee profile: platform role/capability floor, position, occupation, active curriculum, visible tile set, and coworker roster.
10. **Mobile is not a later UX.** Field-service and front-line roles will often meet this surface on mobile. The first-login intro and focused workspace must have mobile acceptance criteria from the first implementation slice.

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
  baseAccessProfile: string;          // RBAC/capability floor this occupation sits on (see §5.6)
  wsidProfessionFamily?: string;      // link to the WSID professional corpus (EP-WSID)
  featureSurface: {
    tileAllowlist: WorkspaceTileKey[];       // which ALL_TILES this job sees by default
    navEmphasis: string[];                   // route prefixes to foreground
    workspaceHomeOccupationId?: string;      // occupation-scoped home contribution (see §5.3)
  };
  coworkerRoster: OccupationCoworkerGrant[]; // which coworkers this job may summon (see §5.5)
  onboardingCurriculumId: string;            // the condensed intro to run on first login (see §5.7)
  moverCurriculumId?: string;                // optional intro when an existing employee changes occupation
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

**Lifecycle rule:** `Position.occupationKey` is not just setup data. A change is a **mover event**. It invalidates any cached occupation resolution, re-runs nav/workspace/coworker roster resolution, and creates a small mover curriculum when the new occupation has materially different workspace or coworker access. Leavers follow the existing HR lifecycle path; this spec does not implement offboarding, but occupation grants must be revoked when the employee account is disabled or detached.

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

**No card sprawl.** Occupation homes are operational work surfaces, not marketing dashboards. Each contribution must fit the vertical-home slot covenant, use existing report-kit/status primitives, and pass a mobile first-viewport screenshot check. The default worker home should answer: "What needs me, what is next, and which coworker can help?"

### 5.4 Feature subset per occupation (progressive disclosure, not deletion)

The occupation `tileAllowlist` + `navEmphasis` define the **default focused view**. Enforcement composes with the existing 3-gate nav filter (`getShellNavSections`) as a **fourth, narrowing gate**:

```
visible(tile) = can(user, tile.capability)          // RBAC security floor (unchanged)
             && orgGateOpen(tile.orgCapability)      // org-archetype gate (unchanged)
             && audienceMode.includes(tile.mode)     // worker/operator mode (unchanged)
             && occupationAllows(tile, occupation)   // NEW — focus/curation
```

`occupationAllows` returns true when the tile is in the occupation's allowlist **or** the occupation is unresolved (fallback = show role-permitted set). It never returns true for a tile the RBAC floor already denies. A role-authorized "Show all my access" reveal (reusing the existing worker/operator `dpf-nav-mode` switch) lets a user who legitimately has broader access step out of the focused view — progressive disclosure, not a locked box.

**Non-widening invariant:** every implementation slice must carry a test of the form:

```ts
for (const tile of allTiles) {
  if (!can(user, tile.capabilityKey)) {
    expect(visibleWithOccupation(user, occupation, tile)).toBe(false);
  }
}
```

The same invariant applies to route nav, section nav, actions, and coworker tools. Occupation may narrow, sort, explain, and route. It may not authorize a capability.

### 5.5 Per-occupation coworker privileges

Today coworker visibility is route-driven and role only sets `canAssist`. Add an **occupation coworker roster** enforced at two points:

1. **`resolveAgentForRoute`** consults the signed-in employee's `OccupationProfile.coworkerRoster`. If the route's default coworker is not in the roster, the panel shows the roster's nearest in-scope coworker (or an honest "this coworker isn't part of your role — request access" state) instead of silently attaching an out-of-scope agent.
2. **The coworker launcher / summon surface** lists only roster coworkers for that occupation.

Governance composes with the identity-access spec rather than a parallel gate:
- Each `OccupationCoworkerGrant` references an **`AgentGovernanceProfile`** (autonomy/HITL envelope) so the *same* coworker can present a different authority envelope to a hygienist vs an office manager — the "different humans, different envelope" goal the identity-access spec already states.
- The `DirectivePolicyClass` `persona` config category (already in that spec) is the natural home for occupation-scoped coworker directives.
- The coworker's **WSID profession family** (via `OccupationProfile.wsidProfessionFamily`) aligns the coworker's professional doctrine to the job.

This is additive privilege (a roster grant), but every actual tool call still passes the existing role∩agent-grant intersection (`getAvailableTools`) and the coworker's own governance — the roster decides *reachability*, not raw authority.

**Audit and explanation:** roster resolution writes a lightweight explanation object into the agent panel context (`occupationKey`, matched roster grant, governance profile, fallback reason). Admins can inspect the same explanation from the employee profile. If no roster grants match, the panel falls back to a generic helper with no action tools and a clear "not configured for this role yet" state.

### 5.6 Occupation vs the platform-management roles (the RBAC seam)

The existing six `HR-000…HR-500` roles stay exactly as they are — they govern *platform administration*. In-trench business employees sit on a **base access profile** (`OccupationProfile.baseAccessProfile`). Two clean options for the base, to be decided at plan time with the chief architect:

- **Option A: reuse the existing worker audience + an existing platform role floor.** Smallest change; no new RBAC value. **Architectural concern:** the current six `HR-*` roles all mean platform-management responsibilities, and the apparent low roles still carry platform-facing capabilities. Reusing one risks semantic confusion and overexposure.
- **Option B (recommended): add one explicit `HR-600` "Workforce Member" platform role, or an equivalent first-class workforce access profile if the architect rejects another `HR-*` value.** This creates a clean security floor for in-trench employees, decoupling them from the platform-management ladder. Larger change (touches `PlatformRoleId`, `PERMISSIONS`, seeds, and AGENTS.md §3 enum guidance) but safer and clearer.

Either way, occupation — not the platform role — is what makes a hygienist's surface a hygienist's surface. The base access profile answers "what is this user allowed to do at all?"; occupation answers "what should this job see first, and which coworker should help?"

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

**Completion semantics:** prefer `OnboardingTask` rows for auditable step history and a derived `platformIntroCompletedAt` only if performance requires it. The first-login intro must be idempotent: refreshes resume the current step, a completed curriculum does not reappear, and a mover curriculum can be added later without erasing the original joiner completion history.

**Accessibility and interruption:** the intro must be keyboard-operable, screen-reader legible, dismissible with "resume later," and available from Help after completion. This is a work tool, not a modal trap.

### 5.8 Persona gaps this design closes (and the library extension)

- **Human-occupation persona** — created as `OccupationProfile`.
- **Occupation personas *within* an archetype** — the persona library (`docs/personas/`) holds only owner personas (Dale/Linda/Marisol). Extend it with **employee/occupation personas per archetype**, each a case-study + test fixture, e.g. under the clinic archetype: dental hygienist, front-desk coordinator, office manager, dentist; under trades-maintenance: field service technician, dispatcher, apprentice. These anchor the occupation home contributions and the job-slice onboarding copy (they are the validation drift guard the vertical-home spec §7.1 already demands).
- **Admin-RBAC vs business-occupation conflation** — resolved by §5.6.
- **Archetype leaf lacks an occupation level** — resolved by the archetype-scoped occupation registry (§5.1).

### 5.9 Admin mapping and operations UX

The implementation needs an operator-facing "why this employee sees this" surface, otherwise support and sales demos will turn into archaeology.

Add an occupation panel on the employee profile / employee admin surface showing:

- Position title, department, manager, and resolved `occupationKey`.
- The matched `OccupationProfile` and why it matched (`Position.occupationKey`, fallback, or unresolved).
- Base access profile / platform role and granted capabilities.
- Default tile allowlist, emphasized nav, and "show all my access" eligibility.
- Coworker roster with governance profile and interaction mode.
- Joiner/mover curriculum status and next required task.

Admins with `manage_user_lifecycle` can map a `Position` to an occupation from the seeded list for the org's archetype. They cannot invent a new occupation inline; adding a new reusable occupation remains a seed/spec change until real customer pressure justifies per-install overrides.

---

## 6. Data-model stewardship (AGENTS.md §11)

- **Reuse, don't fork:** `EmployeeProfile`, `Position`, `Department`, `Team`/`TeamMembership`, `OnboardingTask`, `AgentGovernanceProfile`, `DelegationGrant`, `DirectivePolicyClass`, `StorefrontArchetype`, the workspace-home registry, WSID corpus.
- **New tables (2):** `OccupationProfile` (+ its seed data package) and the coworker-roster rows (embed on `OccupationProfile` or a thin `OccupationCoworkerGrant` join, decided at plan time). Both are **config/template**, not identity — no `Principal` (§11 principal-convergence not triggered).
- **New columns (1–2):** `Position.occupationKey` (nullable FK-by-slug); optional `EmployeeProfile.platformIntroCompletedAt` only if the plan does not use derived completion from `OnboardingTask`.
- **OnboardingTask extension:** add a closed `kind`/`curriculumId` shape rather than overloading title strings. Suggested `kind` values: `hr-onboarding`, `hr-offboarding`, `platform-intro`, `occupation-mover`.
- **Enums (AGENTS.md §3):** `occupationKey` is a **seeded registry**, not a hardcoded global enum (thousands of occupations); it is validated per archetype at seed time, the way `archetypeId` is. `interaction` on the coworker grant *is* a small closed enum (`summon|assigned-only|read-only`) and must be declared as a strongly-typed union in the same commit as its first use.
- **`Organization` canonical identity** untouched.

---

## 7. Verification strategy (AGENTS.md §5 — structural is not sufficient)

Structural (necessary): unit tests for the extended resolver (all five resolution tiers + occupation-unresolved fallback), the `occupationAllows` narrowing gate (never widens past RBAC), the coworker-roster enforcement in `resolveAgentForRoute`, and the onboarding-completion detection. Type-level assertion that occupation contributions satisfy the existing slot covenant. Theme-aware component tests (no hardcoded colors). Schema/seed tests must prove every seeded occupation references real archetypes, real coworkers, valid governance profiles, valid WSID families, valid curriculum ids, valid tiles, and valid nav prefixes.

Functional (required for ship): on the **Live portal** (`http://localhost:3000`, per `project_portal_address`) with a seeded demo business per `EP-ARCHETYPE-DEMO`:
1. Seed at least two occupations in one archetype (e.g. dental hygienist + front-desk coordinator in a `dental-practice`), each bound to a `Position` and an `EmployeeProfile` with its own `User`.
2. Log in as each employee's first login; drive the condensed intro end-to-end; confirm Priority and Proactivity are taught (including the teaching empty-state), the job-slice names the occupation, and completion persists (second login skips it).
3. Confirm each employee's `/workspace` resolves to the occupation-tailored home, shows only the occupation's tiles by default, and the role-authorized reveal still exposes broader access.
4. Confirm the coworker panel lists only the occupation's roster and attaches the right coworker per route; confirm an out-of-roster coworker is not silently attached.
5. Submit a structured dynamic-analysis report (drove X → observed Y → signed off Z) per `feedback_dynamic_analysis_is_evidence`. Desktop + mobile.
6. Change one employee's `Position.occupationKey` from occupation A to occupation B; confirm the workspace, nav focus, coworker roster, and mover curriculum update without deleting the original joiner completion history.
7. Disable or detach the employee account; confirm occupation coworker reachability disappears with the base account access and cannot be reached by direct URL/API.

The `dpf-ux-fit-review` skill runs before any UI-impacting slice, and each PR carries a `UX-Fit-Decision:` trailer (AGENTS.md §12).

## 7.1 Implementation contracts

| Contract | Requirement |
| -------- | ----------- |
| Security floor | All actions still pass platform capability checks and agent tool-grant checks. Occupation never grants raw capability. |
| Focus layer | Occupation can narrow/default/sort/explain the workspace, nav, and coworker roster. |
| Lifecycle | Joiner, mover, and leaver events re-evaluate occupation-derived surfaces and leave auditable history. |
| Fallback | Unresolved occupation falls back honestly to archetype/platform surfaces and generic helper behavior. |
| Admin explanation | Every resolved employee surface has an inspectable explanation for support/admin users. |
| Mobile | First implementation slice includes mobile viewport evidence for first-login intro and focused workspace. |
| Seed integrity | Occupation seed data validates archetype, coworker, governance, WSID, curriculum, tile, and nav references. |

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
1. **Base worker role** — Option B is now the architectural recommendation: add `HR-600` Workforce Member or an equivalent first-class workforce access profile. Chief architect must choose the exact shape because it touches the strongly-typed role enum. §5.6.
2. **Coworker roster storage** — embed on `OccupationProfile` vs a thin `OccupationCoworkerGrant` join table (favor the join for queryability + per-install override).
3. **Completion tracking** — `EmployeeProfile.platformIntroCompletedAt` column vs `OnboardingTask.kind:"platform-intro"` rows (favor reusing `OnboardingTask` to also wire the orphaned panel).
4. **Occupation override per install** — do customers relabel/re-scope a seeded occupation (like `customVocabulary`), or is the seed authoritative until real pressure? (Favor seed-authoritative first; DB override later, mirroring the vertical-home vocabulary decision.)
5. **Which permission grant authorizes the "show all my access" reveal** — inherit the vertical-home spec's deferred operator-switch predicate decision.

---

## 10. Risks and mitigations

| Risk | Mitigation |
| ---- | ---------- |
| Existing platform roles are reused for employees and leak platform-management meaning or capabilities. | Prefer `HR-600`/workforce access profile; add non-widening tests and admin explanation. |
| Occupation registry becomes a brittle global taxonomy. | Scope occupations by archetype/category, seed only high-value jobs, and add per-install override later only with evidence. |
| Coworker roster is mistaken for tool authority. | Enforce roster as reachability only; all tool calls still pass `getAvailableTools` and governance profile checks. |
| First-login intro becomes a modal chore. | Keep it 3-5 steps, resumable, coworker-narrated, and available later from Help. |
| Role-tailored workspace hides legitimate work. | Provide "show all my access" for authorized users and make the focused mode reversible. |
| Field roles fail on mobile. | Treat mobile as a Phase-1 acceptance gate, not a polish pass. |

---

## 11. Reporting protocol

This spec pass produces: this design doc; a companion phased plan; a proposed epic `EP-EMPLOYEE-OCCUPATION` with BIs composing onto the epics in §8; and occupation-persona anchors under `docs/personas/`. No implementation in this pass — per the delivery-surfaces doctrine, filed BIs are promoted through the evidence-gated lifecycle (external build or Build Studio, chosen by fit).
