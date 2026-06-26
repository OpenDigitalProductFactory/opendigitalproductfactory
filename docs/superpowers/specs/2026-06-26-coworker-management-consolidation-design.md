# AI Coworker Management Consolidation — One Record, One Name, One Priority Dial

**Status:** Reviewed & approved for implementation (founder, 2026-06-26). Scope locked — see §10. Filed under `EP-COWORKER-RT`.
**Date:** 2026-06-26
**Author:** Claude Code (research + design pass)
**Relates to / extends:** `EP-AI-WORKFORCE-001` (HRIS surface), `EP-COWORKER-RT` (persona/grant audit), `EP-PLATFORM-CONSOLIDATION` (UI primitives), Golden-Triangle work (#2245, #2337)
**Predecessor specs to read first:**
- [`2026-06-13-ai-coworker-hris-management-surface-design.md`](2026-06-13-ai-coworker-hris-management-surface-design.md) — the roster + 6-tab record IA spine (built, `EP-AI-WORKFORCE-001`)
- [`2026-04-27-coworker-persona-audit-design.md`](2026-04-27-coworker-persona-audit-design.md) — the only existing identity contract (persona ↔ registry join keys; **Draft**)
- [`2026-06-09-wsid-coworker-professional-corpus-design.md`](2026-06-09-wsid-coworker-professional-corpus-design.md) — authoritative statement of the `agent_id` / `agent_name` / prompt-slug divergence
- [`2026-06-23-coworker-panel-header-simplification-design.md`](2026-06-23-coworker-panel-header-simplification-design.md) — where the Golden-Triangle priority dock + posture live today

---

## 1. Problem (validated against live code, not assumed)

The founder's complaint, in his words: *"Our AI coworker names and detail is all over the place… some are caps, some have agent in their name, some specialist, some a little vague. Likewise the prompts and skills for them are scattered in separate lists, so I can't see them holistically. I'd like to see this detail summarized… clean this up so it limits so many surfaces and it's easier to manage."*

A four-stream code audit confirms every part of this. The platform has **rich substrate** for coworker management (the HRIS roster + employee record already shipped under `EP-AI-WORKFORCE-001`), but three structural gaps remain:

### 1.1 Identity is fragmented across four+ stores, with no canonical human name

| Store | Key(s) used | Casing / convention | Role in system |
| --- | --- | --- | --- |
| `packages/db/data/agent_registry.json` | `agent_id` (`AGT-WS-BUILD`), `agent_name` (`build-specialist`) | UPPER-KEBAB id + lower-kebab name | Seed source of truth (68 agents) |
| Prisma `Agent` (`schema.prisma:1960`) | `agentId`, `slugId`, `name` | mixed | Runtime record. **Has no `displayName` column** (verified) |
| `apps/web/lib/tak/agent-routing.ts` `ROUTE_AGENT_MAP` | lowercase slug (`build-specialist`, `coo`) | lower-kebab | Route→agent binding; **slugs do not always match registry `agent_id`** |
| GAID / `PrincipalAlias` (AGENTS.md §11) | `agentId` | — | Identity/trust spine |
| `docs/professions/registry.json` + WSID `scope.roles` | `agent_name` + alias list | — | Profession-doctrine binding |

Consequences observed in the codebase:
- **Seven+ inconsistent suffixes** carried *inside the name*: `-agent` (`finance-agent`), `-specialist` (`marketing-specialist`), `-orchestrator` (`coo-orchestrator`), `-engineer`, `-architect`, `-coordinator`, `-advisor`, `-scout`, `-coo`, or none. The suffix often **lies about the role** — `build-specialist` is actually an *orchestrator* that delegates to `AGT-BUILD-DA/SE/FE/QA`.
- **No canonical display name.** `Agent.displayName` does not exist; `agent_registry.json.displayName` is populated on **exactly one** of 68 agents (`AGT-905`). The UI shows whatever raw `name`/`slugId` it has.
- **Casing chaos** in adjacent fields too (the panel-header spec found `Internal` vs raw `internal` sensitivity badges rendered side by side).
- **Undefined-but-referenced** identities (`storefront-advisor`, `coworker` appear in `ROUTE_AGENT_MAP` with no registry entry) and **registry-bypassing hardcodes** (`AGT-SOC-*` agents are hardcoded in `apps/web/lib/ea/security-posture-extract.ts`, not in the registry).
- The two existing identity designs only **work around** this: WSID declares `agent_name` canonical *for its own binding* and carries an alias list; the Persona Audit adds `displayName`/`agent_id` frontmatter join keys but is **Draft**, **CI-lint-time only**, and binds **persona↔registry only** (not `ROUTE_AGENT_MAP`, not GAID).

### 1.2 Prompts, skills, and priority are on separate surfaces — not joined to the coworker

- **Prompts** live at `/platform/ai/prompts` (`PromptTemplate`, global, by category/slug) and inline in `ROUTE_AGENT_MAP.systemPrompt`. The record only **links out** and shows `AgentPromptContext`. Binding to a coworker is **implicit by naming convention** (`prompts/route-persona/<agent_name>.prompt.md`) — there is no foreign key and no single view that shows a coworker *with* its effective prompt.
- **Skills** live at `/platform/ai/skills` (a global observatory) and are bound to coworkers via `SkillAssignment.agentId`, but the record's Capabilities tab is **read-only by design** — the HRIS spec deferred "edit grants/skills in place" to a V2 (its open question O-2).
- **Golden-Triangle priority** (Cost/Quality/Time) exists only as a **per-conversation composer dock** (`CoworkerPriorityDock`, #2337). A central default mechanism exists in `apps/web/lib/golden-triangle/persistence.ts` (`saveGoldenTrianglePlatformDefault` / `…OrgDefault` / `saveCoworkerGoldenTrianglePosture`, with an `agent → org → platform → balanced` resolver) **but it is not surfaced on the record and not wired into live dispatch** (Slice 3.5 incomplete; `AgentModelConfig.budgetClass` is still the operational field).

### 1.3 Too many surfaces; finding and managing one coworker is expensive

The HRIS spec deliberately kept ~9 surfaces "linked" to bound its blast radius. The result, measured for the canonical task *"find a coworker, then view/edit its prompt + skills + priority"*:

- **5–7 distinct surfaces**, **~15–20 clicks**: roster → record → (Capabilities tab, read-only) → `/platform/ai/assignments` to edit model/priority → `/platform/ai/prompts` to edit the prompt (must guess which global prompt applies) → `/platform/ai/skills` to inspect skills (no per-coworker grant UI).
- The same coworker summary is **re-rendered in 4+ places** (roster, record, `/platform/identity/agents`, operations-map), each slightly different.

---

## 2. Goal & non-goals

**Goal.** Make the coworker the *single managed record* — one canonical name, one place to see and edit identity + persona/prompt + skills/tools + priority + governance — and let the Cost/Quality/Time priority be **set once centrally** and overridden per coworker only when needed. Validate by **clicks and surfaces to reach/edit detail**.

**Non-goals (this pass).**
- Not rebuilding the HRIS roster/record — we **extend** what `EP-AI-WORKFORCE-001` shipped.
- Not changing the human-employee HRIS (`EmployeeProfile`, roster-import grid) — that is the parallel twin and stays untouched.
- Not redesigning Build Studio runtime visibility (`AgentActivityStrip`, ops-map) — orthogonal.
- Not inventing new agents or changing what any coworker *does* — this is naming, joining, and surfacing.

---

## 3. Research & Benchmarking (AGENTS.md §10)

The founder framed this as *"a parallel to how HR management solutions work… not just ours, but in general and in the market."* We benchmarked eight HRIS/HCM systems **at the data-model level** (not feature lists): **Workday, SAP SuccessFactors, Rippling** (enterprise); **BambooHR, Personio, HiBob** (mid-market); **OrangeHRM, Odoo HR** (open-source, readable schemas). The mapping that organizes the whole design:

> **coworker ≈ Worker · role/persona template ≈ Job Profile · deployed instance ≈ Position · tool grants ≈ provisioned accounts (SCIM Joiner-Mover-Leaver) · Cost/Quality/Time priority ≈ compensation band (central default + bounded per-person override).**

### Patterns adopted

1. **One canonical record, stable opaque ID ≠ mutable display name.** Every serious HRIS separates a surrogate key that survives renames (Workday `WID`, OrangeHRM `empNumber`, Odoo `hr.employee.id`) from a human-readable business number from a **computed, never-second-source display name** (BambooHR's `displayName` is read-only: preferred name if set, else legal). We adopt: keep `agentId` opaque/stable, add a required `displayName`, never let two stores disagree. Sources: [dbt — surrogate keys](https://www.getdbt.com/blog/guide-to-surrogate-key); [BambooHR Field Names](https://documentation.bamboohr.com/docs/list-of-field-names).
2. **Legal/canonical name vs preferred/display name as an explicit model.** SuccessFactors "General Display Name"; Workday `@Is_Legal`/`@Is_Preferred`. We map this to `name` (canonical/technical) vs `displayName` (shown everywhere).
3. **Role-template / seat / instance separation (job architecture).** Workday `Job Family → Job Profile → Position → Worker`; SuccessFactors `Job Classification → Position (MDF object)`; Odoo `hr.job` even tracks headcount (`no_of_employee`, `no_of_recruitment`). We already have the analogue (profession family → persona/role → `Agent` instance) but it is not named consistently. Adopt the **`family` + `kind` + role-template** separation so the *role* an agent fills is distinct from the *name* it carries. Sources: [Workday Position Management](https://www.suretysystems.com/insights/workday-position-management-101/); [Odoo hr_job.py](https://github.com/odoo/odoo/blob/17.0/addons/hr/models/hr_job.py).
4. **One normalized skills ontology bound to BOTH role (required) and person (held).** Workday Skills Cloud (~50k canonical skills, synonym-collapsed); SuccessFactors Talent Intelligence Hub; Odoo's copyable 4-table schema (`skill_type → skill → skill_level` + `employee_skill` join). DPF already has `SkillDefinition`/`SkillAssignment` + WSID profession corpus — we bind them onto the record so "which coworker for this task?" and "train vs. grant vs. spin up new?" become the same query. Sources: [Workday Skills Cloud](https://blog.workday.com/en-us/foundation-workday-skills-cloud.html); [Odoo hr_skills](https://github.com/odoo/odoo/blob/17.0/addons/hr_skills/models/hr_employee_skill.py).
5. **One profile, many facets + a universal "Related Actions" verb menu.** Every HRIS renders one person as tabbed sections (Workday Worker Profile: Summary/Job/Comp/Performance…), with per-section permissions and a context menu on every object that links to related objects — *the data-model edges are the navigation*. We extend the existing 6-tab record this way. Sources: [Workday Canvas — Related Actions](https://canvas.workday.com/content/ui-text/related-actions-menu).
6. **Central policy → rule cascade → bounded per-person override.** Workday comp grades attach to the Job Profile and *default* onto the worker via eligibility rules; base pay can deviate from band **as an explicit, flagged exception**. Rippling computes grants from attributes (Supergroups/RQL) and re-provisions on change. This is the **exact** model for a central Cost/Quality/Time default that cascades and is overridden per coworker with a reason. Sources: [Workday comp grids](https://workdaytrainings.com/workday-compensation-grids/); [Rippling Policies](https://www.rippling.com/platform/policies).
7. **Consistent naming + fast directory search.** Legal-vs-preferred name model + global search on name/ID + org chart as a projection of `reportsTo`. We adopt a single `displayName` shown identically everywhere, searchable alongside `slug`/`agentId`/aliases.
8. **Effective-dated config (append rows, don't overwrite)** and **SCIM Joiner-Mover-Leaver provisioning.** Noted as future-facing for agent audit/rollback and grant lifecycle; not in the first phases but recorded so the schema doesn't foreclose it. Sources: [SAP Effective Dating](https://help.sap.com/docs/successfactors-platform/sap-successfactors-api-reference-guide-odata-v2/effective-dating); [SCIM / Microsoft](https://www.microsoft.com/en-us/security/business/security-101/what-is-scim).

### Patterns rejected / bounded

- **Workday-style standalone `Position` object (vacant seats as first-class).** Rejected for now — DPF agents are spawned on demand, not seat-budgeted; Personio/HiBob prove you can ship a structured role/competency catalog **without** full position management. Revisit only if fleet capacity planning needs vacant-slot accounting.
- **Free-form competency text (OrangeHRM `yearsOfExp`, BambooHR review-only competencies).** Rejected — we keep the managed ontology (WSID + `SkillDefinition`), not free text.
- **Anti-pattern guarded against:** WSID's own warning that doctrine must not be "prompt-stuffed." The consolidation surfaces the *persona job description* on the record but keeps craft doctrine in the WSID corpus, not in giant role prompts.

---

## 4. Design

Five workstreams. WS1 is the foundation; WS2–WS5 each independently reduce surfaces/clicks and can be reviewed/scoped separately.

### WS1 — Canonical identity & a naming standard (the spine)

**Single source of truth.** `agent_registry.json` remains the **seed**; Prisma `Agent` is the **runtime** record everything reads. `ROUTE_AGENT_MAP`, prompt persona slugs, WSID `scope.roles`, and GAID all resolve **through** `Agent`, never alongside it.

**A three-layer identity per coworker** (HR pattern #1/#2), with one casing rule each, CI-enforced:

| Layer | Field | Rule | Example | Shown to user? |
| --- | --- | --- | --- | --- |
| Stable key | `agentId` | `AGT-<DOMAIN>-<ROLE>`, UPPER-KEBAB, **immutable** | `AGT-WS-BUILD` | No (behind a "details" disclosure) |
| Handle | `slug` (reconcile `slugId` + route key + persona slug to **one**) | lower-kebab, unique, URL-safe, **no `-agent` noise** | `build-lead` | In URLs / search only |
| **Display** | **`displayName`** (new required `Agent` column) | Title Case role-noun, **required for all**, the only label in UI | **"Build Lead"** | **Yes — everywhere** |

**Kill the suffix muddle with a `kind` facet.** The role-type comes out of the *name* and becomes a separate controlled-vocabulary chip:

`kind ∈ { Orchestrator, Specialist, Advisor, Engineer, Analyst, Coordinator }`

So the name says *who*, the `kind` chip says *what type*, and `family` (existing profession family) says *what domain*. Worked examples (for review — exact labels are a review decision):

| Today (`agent_name`) | `agentId` | Proposed `displayName` | `kind` | `family` |
| --- | --- | --- | --- | --- |
| `coo-orchestrator` | `AGT-ORCH-000` | **COO** | Orchestrator | General Management |
| `build-specialist` *(actually orchestrates)* | `AGT-WS-BUILD` | **Build Lead** | Orchestrator | Software Engineering |
| `finance-agent` | `AGT-900` | **Finance** | Specialist | Finance & Accounting |
| `marketing-specialist` | `AGT-WS-MARKETING` | **Marketing** | Specialist | Marketing |
| `architecture-agent` *(vague)* | `AGT-901` | **Solution Architect** | Specialist | Enterprise Architecture |
| `ea-architect` | `AGT-WS-EA` | **Enterprise Architect** | Specialist | Enterprise Architecture |
| `admin-assistant` *(vague)* | `AGT-WS-ADMIN` | **Platform Admin** | Coordinator | General Management |
| `soc-triage-analyst` *(hardcoded)* | `AGT-SOC-TRIAGE` | **SOC Triage Analyst** | Analyst | Security & Compliance |

**Cleanups folded in:** register or remove the undefined refs (`storefront-advisor`, `coworker`); bring `AGT-SOC-*` into the registry and delete the hardcoded array in `security-posture-extract.ts`; fix the duplicate/raw-cased sensitivity badge.

**Enforcement (promote, don't reinvent).** Extend the Persona-Audit invariants (PERSONA-001/002/004) from Draft into an enforced CI lint covering: every `Agent` has a non-empty `displayName` and a one-line role; `slug` unique and lower-kebab; `displayName` Title Case; **every `ROUTE_AGENT_MAP` key resolves to a registry agent** (closes the route-divergence gap the existing designs never touched); no registry-bypassing hardcoded agent lists. This is the "single source of truth" kernel principle made executable.

### WS2 — The unified coworker record (one record, many facets, now editable)

Extend the shipped 6-tab record at `/platform/ai/agent/[agentId]` so it is the **single place** to see and edit a coworker. Close the "writes are V2" gap for the three high-traffic facets:

- **Overview tab = the summary the founder asked for.** Identity header (`displayName` + `kind` chip + `family` + value stream; raw `agentId`/`slug`/GAID collapsed behind a "details" disclosure), the persona **job description** surfaced inline (the persona file's `# Role` / `# Accountable For` / `# Interfaces With` / `# Out Of Scope` sections), and an **at-a-glance chip row**: model tier · effective priority · # skills · # tools · autonomy (HITL) tier · health. One screen answers "who is this and what are they set to."
- **Capabilities tab → editable.** In-place **grant/revoke skills and tools** (writing `SkillAssignment` / `AgentToolGrant`) behind the least-privilege/entitlement-review framing the HRIS spec already established. The global `/platform/ai/skills` stays as the **catalog/observatory**; per-coworker granting happens here.
- **Persona/Prompt → on-record view + edit.** Show the coworker's *effective* prompt (route-persona + identity blocks composed) with inline edit that writes back to the scoped `PromptTemplate`, instead of sending the user to the global `/platform/ai/prompts` to guess which template applies.
- **Priority tab (new) →** the Golden-Triangle dial for this coworker, showing inheritance + override (WS4).

Adopt a Workday-style **Related Actions ("…") menu** on each coworker (in roster rows and the record header): pause, re-scope tools, adjust priority, open persona — the data-model edges become navigation.

### WS3 — Surface consolidation (fewer places)

Re-disposition the ~9 linked surfaces into **two primary surfaces + a few catalogs/admin views**, the HRIS shape (directory + profile + catalogs):

| Surface today | Disposition |
| --- | --- |
| `/platform/ai` (roster) | **PRIMARY — Directory.** Stays; becomes the one entry point (search + family/kind/priority/health filters). |
| `/platform/ai/agent/[agentId]` (record) | **PRIMARY — Record.** Stays; becomes view+edit for all facets (WS2). |
| `/platform/ai/prompts` | **Catalog.** Global prompt library only; per-coworker persona editing moves to the record. |
| `/platform/ai/skills` | **Catalog.** Global skills observatory; per-coworker grants move to the record. |
| `/platform/ai/assignments` | **Bulk editor.** Keep the cross-coworker grid (the HR "comp review" grid) for bulk priority/model edits; single-coworker editing moves to the record. |
| `/platform/identity/agents` | **Fold** principal-link status into the record's Governance tab; keep as admin health view or redirect. |
| `/platform/ai/operations-map` | **Keep** (runtime topology — different job). |
| `/platform/ai/capability-needs` | Already redirects to `/ops`; leave. |

Net: to *manage* one coworker you visit **one surface** (the record); the directory finds it; bulk changes have one grid; catalogs and ops-map remain for their distinct jobs.

### WS4 — Golden Triangle: central default + per-coworker override, surfaced and wired

This is the founder's "the setting would matter for centrally too, vs going to each surface." Implement the HR comp-band cascade (pattern #6):

```
Platform default (WWMD)         ← set ONCE, centrally
  └─ Org default (WWWD)         ← optional, per org
       └─ Coworker default      ← override on the record, with a reason (bounded exception)
            └─ Per-conversation ← existing CoworkerPriorityDock (#2337), last-mile only
```

- **One central control.** A single "Workforce Priority" setting (on the Directory or a workforce-settings panel) writes the platform/org default via the **existing** `saveGoldenTrianglePlatformDefault` / `…OrgDefault`. Set Cost/Quality/Time once → it cascades to every coworker.
- **Per-coworker override on the record** (Priority tab) writes `saveCoworkerGoldenTrianglePosture`, and **always shows the inheritance**: *"Inherited from Platform default · override for this coworker."* The composer dock stays as the per-conversation last mile, relabeled *"overrides Build Lead's default."*
- **Close the hot-path wiring (Slice 3.5).** Make `getEffectivePostureForAgent()` feed `inferContract()` / `prepareRoute()` so the central setting **actually governs dispatch**, and reconcile `AgentModelConfig.budgetClass` to be **derived from** the effective posture rather than a parallel operational field. Without this, "set it centrally" remains cosmetic.

### WS5 — The summary (at-a-glance, the founder's "see this detail summarized")

- **Directory table** (HR people-directory): `displayName` · `kind` · `family` · model tier · effective priority · # skills · autonomy tier · health — sortable, filterable, searchable.
- **Record summary header** (WS2 Overview chip row) — one coworker at a glance.
- **Workforce summary panel** (HR "people report"/headcount dashboard): counts by family/kind, profession-coverage %, priority distribution, naming-health (how many lack a clean `displayName`/role — drives WS1 to done), provider health. One screen for "how is my whole workforce configured."

---

## 5. Validation — clicks & surfaces (the founder's stated test)

Concrete, measurable acceptance targets. "Surface" = a distinct page; "click" = a user action.

| Task | Today | Target |
| --- | --- | --- |
| Find a specific coworker | roster → scroll/guess (no strong search) | **≤2 clicks** (search/filter + select), 1 entry point |
| See full detail (identity, prompt, skills, priority, governance) | 5–7 surfaces | **1 surface** (the record, tabbed), 0 hops |
| Edit a coworker's prompt | separate `/prompts`, guess template | **on-record, ≤2 clicks**, 0 hops |
| Edit a coworker's skills/tools | not possible on record | **on-record, ≤2 clicks** |
| Edit a coworker's priority | per-conversation only | **on-record, ≤2 clicks** |
| Set Cost/Quality/Time for the whole workforce | not possible centrally | **1 surface, set once**, cascades |
| Name shown for a coworker | varies by surface/casing | **1 `displayName`, identical everywhere**, 0 casing variants (CI-enforced) |
| Undefined / hardcoded / orphan agent references | ≥3 (`storefront-advisor`, `coworker`, `AGT-SOC-*`) | **0** (CI-enforced) |

A change is "done" only when its row hits target, evidenced by a live click-through on the canonical install (AGENTS.md §5 gate #3).

---

## 6. Data-model impact

Additive and low-risk; reuses the `EP-AI-WORKFORCE-001` substrate.

- **`Agent.displayName String`** (new, required; backfilled from registry/`name` Title-cased) — the one canonical label.
- **`Agent.kind String`** (new; controlled vocab) — replaces suffix-in-name. Add to the AGENTS.md §3 strongly-typed-enum table.
- **Reconcile `slugId` → `slug`** as the single handle; migrate `ROUTE_AGENT_MAP` keys + persona slugs to it (data + lint, no new table).
- **Registry `displayName`/`kind`/`slug`** populated for **all** agents; `AGT-SOC-*` added; `storefront-advisor`/`coworker` registered or removed.
- **Golden-Triangle:** no new tables — reuse `DecisionPerspectiveProfile.autonomyPolicy` persistence; wire `getEffectivePostureForAgent()` into the route path; derive `AgentModelConfig.budgetClass` from it.
- **No new tables for the record** — Capabilities/Persona edits write existing `SkillAssignment` / `AgentToolGrant` / `PromptTemplate`.

(Per AGENTS.md §11 Principal convergence, `Agent` is already a `PrincipalAlias`; identity changes here stay on that spine.)

---

## 7. UX-fit rationale (AGENTS.md §12)

Progressive disclosure is the through-line: the record's **default** view is the plain-language summary (name, kind, family, role line, a chip row); raw IDs, GAID, and advanced grants sit behind disclosures. Central priority means a non-technical founder sets Cost/Quality/Time **once** instead of per surface, and each coworker shows "inherited vs overridden" rather than a bare number. The Directory + Record collapse 5–7 surfaces to 1–2. We **derive** the display name and role from existing data rather than asking the user to type anything. A formal `principle_decide` UX-fit decision on `human_cognitive_load` will be recorded at implementation-PR time per the gate (noting the panel-header precedent that this dimension currently scores degenerate — the merits above carry the decision).

---

## 8. Phasing (for scoping at review)

Each phase is independently shippable and independently moves the §5 metrics.

- **Phase 1 — Identity & Naming Standard (foundation).** Add/backfill `Agent.displayName` + `kind`; reconcile `slug`; register SOC / undefined agents; promote Persona-Audit to an enforced CI lint covering `ROUTE_AGENT_MAP`. *Mostly data + lint; low blast radius; immediately fixes "names all over the place."*
- **Phase 2 — Editable record.** Fold per-coworker prompt + skills/tool editing into the record (close the V2-writes gap). Add the Related-Actions menu.
- **Phase 3 — Golden-Triangle cascade.** Central default control + per-coworker override on the record + inheritance UI + **hot-path wiring** (Slice 3.5) + `budgetClass` reconciliation.
- **Phase 4 — Surface consolidation + summary.** Re-disposition `/prompts`, `/skills`, `/assignments`, `/identity/agents`; ship the Directory search/filters, the bulk grid, and the Workforce Summary panel.

---

## 9. Relationship to existing work / overlap

- **Extends** `EP-AI-WORKFORCE-001` (HRIS roster/record) — this is its "finish the job" follow-on (closes its O-2 in-record-writes question).
- **Promotes** `2026-04-27-coworker-persona-audit-design.md` from Draft to enforced, and **widens** it to `ROUTE_AGENT_MAP` + GAID.
- **Consumes** WSID (`family`/profession corpus) as the `family` facet; does not change WSID.
- **Completes** the Golden-Triangle persistence (#2245/#2337) by surfacing + hot-wiring the central cascade.
- **Epic:** `EP-COWORKER-RT` (founder decision 2026-06-26 — extend the existing Coworker Runtime + Persona/Grant-audit epic rather than open a new one).

---

## 10. Review decisions (founder, 2026-06-26)

1. **Naming convention — DECIDED.** `displayName` (Title Case role-noun) + a separate role-`kind` chip + `family`; drop `-agent`/`-specialist` from the display name. `kind` becomes a filter facet, not part of the name. Initialisms like "COO" are kept as the display name. Exact per-agent labels (§4 worked examples) finalize during Phase 1 authoring.
2. **Surface consolidation — DECIDED (aggressive).** Move per-coworker prompt + skills/tool editing onto the record; demote `/platform/ai/prompts` and `/platform/ai/skills` to global catalogs (library / observatory).
3. **Golden-Triangle — DECIDED (full).** Surface the central default + per-coworker override **and** complete the hot-path wiring (Slice 3.5) so the central setting governs live dispatch; derive `AgentModelConfig.budgetClass` from the effective posture.
4. **Epic — DECIDED.** Extend `EP-COWORKER-RT` (no new epic).
5. **Effective-dated agent config (HR pattern #8) — still open.** A placeholder for audit/rollback of grant/model/priority changes. Recommendation: defer to a follow-up BI; do not foreclose it in the Phase-1 schema.

---

## 11. Sources

HR/HCM benchmarking (data-model level): Workday ([Skills Cloud](https://blog.workday.com/en-us/foundation-workday-skills-cloud.html), [Position Management](https://www.suretysystems.com/insights/workday-position-management-101/), [comp grids](https://workdaytrainings.com/workday-compensation-grids/), [Related Actions](https://canvas.workday.com/content/ui-text/related-actions-menu)); SAP SuccessFactors ([Person/Employment KBA 2493579](https://userapps.support.sap.com/sap/support/knowledge/en/2493579), [Position Management](https://help.sap.com/docs/successfactors-employee-central/implementing-position-management/what-is-position-management), [Effective Dating](https://help.sap.com/docs/successfactors-platform/sap-successfactors-api-reference-guide-odata-v2/effective-dating)); Rippling ([Policies](https://www.rippling.com/platform/policies), [IAM](https://www.rippling.com/products/it/identity-access-management)); BambooHR ([Field Names](https://documentation.bamboohr.com/docs/list-of-field-names)); Personio ([career frameworks](https://support.personio.de/hc/en-us/articles/30454790101789-Set-up-career-frameworks)); HiBob ([Job catalog API](https://apidocs.hibob.com/docs/explore-job-catalog-api)); Odoo ([hr_job.py](https://github.com/odoo/odoo/blob/17.0/addons/hr/models/hr_job.py), [hr_skills](https://github.com/odoo/odoo/blob/17.0/addons/hr_skills/models/hr_employee_skill.py)); OrangeHRM ([Employee.php](https://github.com/orangehrm/orangehrm/blob/develop/src/plugins/orangehrmPimPlugin/entity/Employee.php)); SCIM ([Microsoft](https://www.microsoft.com/en-us/security/business/security-101/what-is-scim)). Internal: the four predecessor specs listed at the top; code audit of `agent_registry.json`, `schema.prisma:1960`, `agent-routing.ts`, `golden-triangle/persistence.ts`, `coworker-record/*`.
