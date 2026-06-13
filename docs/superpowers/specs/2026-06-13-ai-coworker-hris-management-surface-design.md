# AI Coworker HRIS — Unified Workforce Management Surface

- **Date:** 2026-06-13
- **Status:** Draft for review
- **Epic:** EP-AI-WORKFORCE-001 (AI Workforce Consolidation) — this is the Phase 5+ "UI Enhancement"
  realization, extended to absorb the WSID profession corpus (EP-WSID) and the
  decision-perspective / voice / improvement-loop facets.
- **Backlog:** BI-TBD (HRIS management surface) — links EP-AI-WORKFORCE-001 + EP-WSID.
- **Family:** consolidation / IA refactor (no new substrate).
- **Related specs:**
  - `2026-04-02-ai-workforce-consolidation-design.md` — EP-AI-WORKFORCE-001 unified Agent model (the spine)
  - `2026-05-10-ai-coworker-visual-control-surface-design.md` — per-coworker detail tabs + Operations Map (the approved IA this realizes)
  - `2026-06-09-wsid-coworker-professional-corpus-design.md` — profession profiles + corpus (the content this manages)
  - `2026-06-13-wsid-location-competency-variants-design.md` — jurisdiction × competency coverage axes
  - `2026-05-17-wwmd-decision-perspective-kernel-design.md` — the decision gate / profiles
  - `2026-05-31-wwmd-explainability-layer-design.md` — Decision Canvas / review inbox / backlinks
  - `2026-05-19-persona-voice-layer-wwtd-design.md` — voice profiles
  - `2026-04-24-platform-ia-tools-ai-admin-refactor-design.md` — the `/platform/ai` IA precedent

---

## 1. Problem

DPF runs an AI workforce of ~63 coworkers (40+ `agent_registry.json` agents + ~24
`prompts/route-persona/*` personas, collapsed into **23 profession families** per
`docs/professions/registry.json`). The facets that *define* a single coworker are scattered
across surfaces that were each built for a subsystem, not for the coworker:

| Facet | Lives today |
|---|---|
| Identity / roster | `/platform/ai` (tier-grouped cards), `Agent` table, `agent_registry.json`, GAID (`PrincipalAlias`) |
| Profession / role doctrine (WSID) | `/wiki/perspectives` (no friendly profession label), `/wiki` corpus pages (`professions/*` slugs), `DecisionPerspectiveProfile kind="profession"`, `docs/professions/registry.json`, `resolve-profession-profile.ts` |
| Jurisdiction × competency coverage | seed-time log only (`tallyVariantCoverage`); not surfaced |
| Decision perspective profile | `/wiki/perspectives`, `DecisionPerspectiveProfile` + `PerspectiveMaterial` + versions + fallback chain |
| Capabilities / grants | `/platform/ai/agent/[id]` (Tool Grants section), `AgentToolGrant`, `agent-grants.ts` |
| Capability needs / improvement loop | `/platform/ai/capability-needs`, `CoworkerSelfAssessment`, `CoworkerCapabilityNeed` |
| Model routing | `/platform/ai/agent/[id]` (routing card), `/platform/ai/providers`, `AgentModelConfig` |
| Voice | `/wiki/perspectives/[profileId]/voice`, `VoiceProfile` |
| Prompts | `/platform/ai/prompts`, `PromptTemplate`, `AgentPromptContext` |
| Decisions / defer signals | `/platform/ai/decisions/[interactionId]` (Canvas), `/platform/ai/founder-review`, `DecisionInteraction` |

A reviewer who wants to answer *"is the finance coworker fit for duty — does it have the
right doctrine for our jurisdiction, the right grants, a healthy improvement loop, and is it
deferring too often?"* must visit six surfaces and mentally join them. The WSID corpus
build-out (21+ families, ~150 corpus pages) just multiplied the content with **no human-facing
home** — `/wiki/perspectives` lists profession profiles but with no friendly label and a
voice-config orientation, and the corpus pages are buried in generic wiki browse.

**This is a Non-Human Identity (NHI) management gap.** The coworker is an identity that is
owned, has a lifecycle, holds entitlements (grants), carries a professional competency, and
must eventually be decommissioned — exactly the questions an HRIS answers for a human
employee, and exactly the questions OWASP's NHI Top-10 says go unanswered when identity
config is fragmented.

## 2. Goals / Non-goals

**Goals**

1. **One cohesive "coworker record" per coworker** — an HRIS-style employee record that brings
   every facet above into a single, reviewable, tabbed surface, replacing the current flat
   scroll at `/platform/ai/agent/[agentId]`.
2. **A roster overview** at `/platform/ai` that filters by department/value-stream, profession
   family, competency level, jurisdiction, lifecycle status, and **coverage gaps** — and
   surfaces fitness-for-duty signals (missing profession profile, empty corpus, broken
   provider, open capability blockers, high defer rate).
3. **Surface the WSID corpus as managed content** — per coworker: bound profession profile
   (friendly label), corpus pages + materials, and the **jurisdiction × competency coverage
   matrix** the seed already computes — made legible to a human.
4. **Refactor, not N+1** — consolidate the fragmented surfaces by deciding, per surface,
   merge / become-a-tab / stay-linked (§5). No parallel page that re-implements what exists.
5. **Zero new substrate** — reuse the verified tables/types; the deliverable is a *view +
   aggregator + IA*, not a migration (§4).
6. **Standards-grounded** — model the record on the NHI-governance + HRIS-worker-record
   research (§3), so the surface answers ownership, lifecycle, entitlement, competency, and
   decommission questions explicitly.

**Non-goals (V1)**

- Wiring the decision gate to *filter* corpus retrieval by jurisdiction/competency — that
  rides the future gate↔material binding PR (WSID variants spec §6). V1 *displays* coverage;
  it does not change retrieval.
- In-surface *write* actions beyond what the existing cards already do (model routing card is
  already writable). New writes (edit grants, edit corpus) link out to the owning surface;
  in-record writes are a V2 concern (mirrors Visual Control Surface §Control Inspector Writes).
- A new Operations Map (already shipped at `/platform/ai/operations-map`); the record links to it.
- Human-employee HRIS at `/employee` is untouched — this is the *AI* workforce twin of it.
- Per-instance coworker learning / new performance substrate.

## 3. Research & Benchmarking

The user directive is explicit: research how these non-human identities should be *managed,
similar to how people are managed*. Two literatures converge.

### 3.1 Non-Human Identity (NHI) governance

NHIs (service accounts, agents, tokens) now outnumber humans ~100:1, and the **OWASP
Non-Human Identity Top 10 (2025)** frames the dominant failure mode as *fragmented or absent
lifecycle management*: no clear owner, improper offboarding (`NHI4`), overprivileged
identities (`NHI5`), and "human use of NHI" / unclear accountability (`NHI10`). The remedy the
field converges on (Saviynt, Delinea, GitGuardian, SGNL): **automated discovery, a single
owned record per identity, least-privilege entitlement review, and a governed
decommission path.**

| NHI governance question | Where the coworker record answers it |
|---|---|
| Who owns this identity? | Overview: `humanSupervisorId`, owning team, GAID/PrincipalAlias |
| What is it allowed to do? (least privilege) | Capabilities: skills + `AgentToolGrant` + grant implications, with open `CoworkerCapabilityNeed`s as the "requesting more access" signal |
| What lifecycle stage is it in? | Overview: `lifecycleStage` (plan→design→build→production→retirement) |
| Is it competent / fit for duty? | Profession (WSID) + Performance tabs |
| Is it over/under-deferring (accountability)? | Decisions tab: recommend/arbitrate/escalate/**defer** signal |
| How is it decommissioned? | Lifecycle stage = retirement + grant revocation, surfaced as a roster filter & record state |

**Adopt:** single owned record, explicit lifecycle, entitlement-review framing, coverage/gap
visibility. **Reject:** treating the coworker as opaque config — every entitlement and every
doctrine source must be inspectable and attributable (matches the platform's explainability
contract).

### 3.2 HRIS worker-record model

HRIS/people platforms (Workday, SuccessFactors; the **SCIM** core schema and **HR Open
Standards** worker model) converge on a worker record with: core identity (name, IDs,
status), position (title, department, manager, location), **competency/skills**, and lifecycle
events (hire → role change → offboard). The strong pattern is **one record, many tabs, a
roster/directory on top**, with role/department/manager/location/status as the universal
filter axes.

| HRIS concept | AI-coworker analogue (existing substrate) |
|---|---|
| Worker ID / status | `Agent.agentId` / `slugId` / GAID; `lifecycleStage` |
| Position: title, department | profession family (registry), `valueStream`, portfolio, tier |
| Manager / reporting line | `humanSupervisorId`, `escalatesTo`, `delegatesTo`, owning team |
| Location | **jurisdiction** (WSID `PROFESSION_JURISDICTIONS`) |
| Competency / proficiency | **competency level** (`PROFESSION_COMPETENCY_LEVELS`) + corpus coverage |
| Skills inventory | `AgentSkillAssignment` + corpus knowledge areas (coverage checklist) |
| Entitlements / access | `AgentToolGrant` + `AgentGovernanceProfile` |
| Performance review | `AgentPerformance` + `CoworkerSelfAssessment` (the improvement loop) |
| Job description / handbook | bound `DecisionPerspectiveProfile` + WSID corpus pages |

**Gap this fills:** no surveyed NHI tool renders the identity's *professional competency and
doctrine coverage* (jurisdiction × level) alongside its entitlements and lifecycle; no HRIS
renders a *governed decision/defer signal* as a fitness measure. DPF already has both
substrates (WSID corpus + DecisionInteraction ledger) — the contribution is unifying them
into the worker record. This is the same "project, don't republish" principle the Visual
Control Surface spec established.

Sources: OWASP Non-Human Identities Top 10 (2025); Saviynt / Delinea / GitGuardian NHI
guidance; SCIM core schema; HR Open Standards worker model; SFIA competency bands (already
the WSID competency frame).

## 4. Substrate verification — reuse, zero new tables

Verified against `packages/db/prisma/schema.prisma`, `apps/web/lib/*`, and the registries
(2026-06-13). **Every facet already has substrate; V1 adds no table, enum, or migration.**

| Facet | Existing substrate (reused) |
|---|---|
| Identity / roster | `Agent` (+ `slugId`, `valueStream`, `sensitivity`, `lifecycleStage`, `humanSupervisorId`, `escalatesTo`, `delegatesTo`), `getAgentGaidMap`, `agent_registry.json` (bootstrap) |
| Profession binding | `docs/professions/registry.json` (23 families), `resolve-profession-profile.ts`, `DecisionPerspectiveProfile kind="profession"` (`scope.professionKey`/`scope.roles`) |
| Corpus + coverage | `WikiPage` (slug `professions/*`), `WikiPageSource`/`RawSource`, `PerspectiveMaterial`, `PROFESSION_JURISDICTIONS` / `PROFESSION_COMPETENCY_LEVELS` + `WikiPageFrontmatter`, `tallyVariantCoverage` (seed) |
| Decision profile | `DecisionPerspectiveProfile` + `DecisionPerspectiveProfileVersion` + `PerspectiveMaterial` + `fallbackProfileId` |
| Grants / capabilities | `AgentToolGrant` + `agent-grants.ts` (implications), `AgentGovernanceProfile` + `AgentCapabilityClass` |
| Capability needs / improvement | `CoworkerSelfAssessment` + `CoworkerCapabilityNeed` (`get_my_coworker_profile`, `assess_my_capabilities`) |
| Model routing | `AgentModelConfig` + `AgentExecutionConfig` + `AgentModelRoutingCard` (already writable) |
| Voice | `VoiceProfile` + `VoiceConsentRecord` (admin at `/wiki/perspectives/[profileId]/voice`) |
| Prompts | `PromptTemplate` + `AgentPromptContext` |
| Decisions / defer | `DecisionInteraction` (Decision Canvas at `/platform/ai/decisions/[interactionId]`, review inbox at `/platform/ai/founder-review`) |
| Performance | `AgentPerformance` (`performanceProfiles`), `FeatureDegradationMapping` |

**The only new code is a read/aggregation layer + the IA**, organized as:

- `apps/web/lib/coworker-record/load-record.ts` — `loadCoworkerRecord(agentIdOrSlug)`:
  **composes the existing `loadCoworkerProfile` (`apps/web/lib/mcp-tools.ts`)** — which already
  joins Agent + skills + grants + latest `CoworkerSelfAssessment` — and *extends* it with
  `resolveProfessionProfile`, the profession-corpus coverage read, bound
  `DecisionPerspectiveProfile`/`VoiceProfile` joins, and recent `DecisionInteraction`
  aggregation (recommend/arbitrate/escalate/defer counts). It does **not** re-query the models
  `loadCoworkerProfile` already owns (`single-source-of-truth`); it is the single place that
  knows the *additional* heterogeneous source set (mirrors the projection-loader pattern).
- `apps/web/lib/coworker-record/coverage.ts` — `loadProfessionCoverage(professionKey)`:
  computes the jurisdiction × competency matrix at request time by querying `WikiPage.metadata`
  (Json) for pages with slug prefix `professions/<family>/`. **Substrate correction (O-1,
  resolved):** verified `seed-profession-corpus.ts` parses `professionJurisdiction` /
  `professionCompetencyLevel` but only tallies them in memory and **discards them** — they are
  not persisted to any column. Phase 0 therefore **extends the profession-corpus seed to write
  these two axes into the existing `WikiPage.metadata` Json column** (seed-only, *zero
  migration* — honors variants-spec §3 "no new column" and `fix-the-seed-not-the-runtime`), so
  the runtime helper reads `metadata`. This also makes coverage queryable for the future V2
  gate↔material binding, not just the UI. Reject the alternative of reading committed `docs/`
  corpus files at runtime: the production bundle may not ship `docs/`, and it would duplicate
  the seed's frontmatter parser.
- `apps/web/lib/coworker-record/roster.ts` — `loadRoster(filter)`: the directory query +
  profession-family/competency/jurisdiction/lifecycle/coverage-gap filters, built over the
  registry family map + the coverage helper.

## 5. IA decision — refactor map (merge / tab / link)

Per "refactor the fragmented surfaces rather than adding an N+1 page", each surface gets an
explicit disposition.

| Surface | Disposition | Detail |
|---|---|---|
| `/platform/ai` (roster) | **ENHANCE in place** | Becomes the AI-workforce **directory**: add filter rail (department/value-stream, profession family, competency, jurisdiction, lifecycle status, coverage-gap) and fitness badges. Keep tier grouping as one view mode. |
| `/platform/ai/agent/[agentId]` (flat detail) | **REFACTOR → tabbed coworker record** | The employee record. Tabs in §6. Absorbs WSID profession, voice status, improvement loop, decision/defer signals — currently absent. |
| `/wiki/perspectives` (profile + voice index) | **STAY linked; ENRICH** | Stays as the decision-profile/voice admin index, but gains a **friendly profession label** and a back-link to the owning coworker(s). The "no friendly label" gap closes here and in the record. Not deleted — it is the cross-profile admin index and voice entry point. |
| `/wiki/perspectives/[profileId]/voice` | **STAY linked** | Voice admin stays where it is (consent capture is a focused flow); the record's Capabilities/Voice section shows status + deep-links here. |
| `/wiki` + corpus `professions/*` pages | **STAY linked** | Corpus reading stays in wiki; the record's Profession tab shows coverage + materials and links into the pages. (A thin `professions` browse index is a small add if missing — corpus-read, not management.) |
| `/admin/wiki/lint` | **STAY linked** | Admin quality surface stays; the record's Profession tab shows a per-profession corpus-health badge linking to filtered lint findings. |
| `/platform/ai/decisions/[interactionId]` (Canvas) | **STAY linked** | Per-decision provenance stays; record's Decisions tab links per interaction. |
| `/platform/ai/founder-review` (review inbox) | **STAY linked; FILTER** | Gains a profession/coworker filter param; record's Decisions tab deep-links the inbox scoped to this coworker. |
| `/platform/ai/capability-needs` | **STAY linked; EMBED summary** | The record's Performance/Improvement tab shows this coworker's open needs; the queue page stays for cross-coworker triage. |
| `/platform/ai/prompts`, `/platform/ai/skills`, `/platform/ai/providers`, `/platform/ai/assignments` | **STAY linked** | Already the right homes (Admin>Prompts/skills already redirect here). Record tabs deep-link to the relevant filtered view. |
| `/platform/ai/operations-map` | **STAY linked** | Live ops view; record cross-links (coworker selected). |

Net: **two surfaces change** (roster + coworker record); everything else is enriched with
labels/filters/back-links and stays its own home. No new top-level page.

## 6. Coworker record — tab structure

Aligns to the Visual Control Surface spec's approved per-coworker tabs (Overview /
Capabilities / Governance / Runtime / Knowledge+Prompts / Activity), extended for WSID and the
HRIS/NHI framing. Implemented as a tabbed client shell over `loadCoworkerRecord`.

1. **Overview** — HRIS header + NHI identity. Name, agentId/slugId/GAID, tier, value stream,
   **profession family (friendly label)**, lifecycle stage, status, sensitivity, owner
   (`humanSupervisorId`/owning team), `escalatesTo`/`delegatesTo`, description. Fitness-at-a-glance
   chips (profile bound? corpus coverage %, open blockers, provider health, defer rate).
2. **Profession & Knowledge (WSID)** — NEW. Bound `DecisionPerspectiveProfile` (friendly
   profession label, version, fallback chain), the **jurisdiction × competency coverage matrix**,
   corpus pages + `PerspectiveMaterial` list (with evidence grade / freshness / source citation),
   coverage-checklist gaps from the registry, and a corpus-health badge → `/admin/wiki/lint`.
   Links into corpus pages and `/wiki/perspectives`.
3. **Capabilities** — skills (`AgentSkillAssignment`), tool grants (`AgentToolGrant` + implied),
   model routing (existing writable `AgentModelRoutingCard`), and **voice** status
   (`VoiceProfile`) → voice admin. The "least-privilege entitlement" view.
4. **Governance** — `AgentGovernanceProfile` (capability class, autonomy, HITL policy,
   delegation, max risk), feature degradation mappings. The "what it may do, under what gate".
5. **Performance & Improvement** — `AgentPerformance` profiles + the **improvement loop**:
   `CoworkerSelfAssessment` history (verdict/confidence trend) and open `CoworkerCapabilityNeed`s
   (the "requesting more capability" signal) → `/platform/ai/capability-needs`.
6. **Decisions & Activity** — recent `DecisionInteraction`s for this coworker with the
   recommend/arbitrate/escalate/**defer** breakdown (defer = corpus-gap demand signal), each
   linking to the Decision Canvas; deep-link to `founder-review` scoped to this coworker; link
   to ledger/operations-map. Prompt context (`AgentPromptContext`) + link to prompt editor.

## 7. Roster — directory + filters

`/platform/ai` gains a filter rail and a fitness-signal column, computed by `loadRoster`:

- **Filters:** department/value-stream, profession family (registry), competency level,
  jurisdiction, lifecycle stage/status, and **coverage-gap** (families whose corpus is missing
  jurisdictions/competencies their roles need, or roles with no bound profession profile — a
  registry-lint failure per WSID §4.11 rule 1).
- **Fitness signals** per row: profile-bound?, corpus coverage %, open capability blockers,
  provider health (existing broken-provider warning generalized), recent defer rate.
- **View modes:** tier grouping (current) and profession-family grouping (new), toggled.
- Coverage-gap and "unmapped role" are first-class roster states — the demand queue for which
  corpus to build next (WSID §4.11 rule 2 made visible).

## 8. Access & theming

- **Access:** reuse existing capabilities (`view_platform` baseline; `manage_platform` /
  `manage_agents` for the writable cards) exactly as the current detail page does
  (`can(..., "manage_platform")`). No new permission keys. Auditor-tier payload detail follows
  the existing decision/ledger surfaces. Single-org invariant; queries scope defensively.
- **Theming:** new code uses `--dpf-*` tokens only (AGENTS.md §12). The current detail page has
  pre-existing hardcoded hex; new tabs must not reintroduce it, and the refactor is an
  opportunity to migrate the header chips to tokens (`no-hex-colors` lint).

## 9. Acceptance (V1)

1. From `/platform/ai/agent/<finance-agent>` a reviewer sees, in one tabbed record: identity +
   owner + lifecycle; bound finance profession profile with US-GAAP/IFRS jurisdiction coverage
   and competency coverage; skills + grants + model routing + voice status; governance; perf +
   self-assessment + open needs; and recent decisions with the defer count — without leaving the page.
2. The roster filters to "finance family, us jurisdiction, coverage gaps" and shows which
   coworkers lack a bound profile or corpus coverage; an unmapped role surfaces as a flagged state.
3. Every facet renders from the verified substrate (§4) — no new table/enum/migration; a test
   asserts `loadCoworkerRecord` joins only existing models.
4. Coverage matrix matches the seed's `tallyVariantCoverage` output for a known family (parity test).
5. The two changed surfaces use `--dpf-*` tokens (no-hex-colors lint clean on new/changed files).
6. No dead links: every deep-link (corpus page, Canvas, founder-review, capability-needs, voice,
   lint) resolves on a seeded fixture (link-walk test).
7. Roles with no bound profession profile are reported (registry-lint parity), satisfying the
   WSID §4.11 "every active role resolves" contract as a *visible* roster state.

## 10. Phasing

See implementation plan `docs/superpowers/plans/2026-06-13-ai-coworker-hris-management-surface.md`:

- **Phase 0** — extend the profession-corpus seed to persist `professionJurisdiction` /
  `professionCompetencyLevel` into `WikiPage.metadata` (O-1 resolved; zero migration), build the
  registry family→role index, and the `loadProfessionCoverage` helper + parity test vs the
  seed's `tallyVariantCoverage`.
- **Phase 1** — `loadCoworkerRecord` aggregator + refactor `/platform/ai/agent/[agentId]` flat
  scroll into the tabbed record **including the new Profession & Knowledge (WSID) tab**. Highest value.
- **Phase 2** — roster directory: `loadRoster` + filter rail + fitness signals + family grouping.
- **Phase 3** — enrichment of linked surfaces: friendly profession labels + back-links on
  `/wiki/perspectives`; profession/coworker filter on `founder-review`; corpus-health badge → lint.
- **Phase 4** — decisions/defer aggregation in the record + roster defer-rate signal; coverage-gap
  demand queue view.

## 11. Open questions (tracked, non-blocking)

- **O-1 (RESOLVED):** The seed parses but discards the variant axes; they are not on any
  column. Phase 0 persists them into the existing `WikiPage.metadata` Json column (seed-only,
  zero migration). No new typed column in V1 (variants spec §3).
- **O-2:** Should the record expose in-place grant/lifecycle *writes* (decommission a coworker,
  revoke a grant) in V1, or link out? Default: link out (V2 for writes), matching Visual Control
  Surface §Control Inspector Writes.
- **O-3:** Does a thin `/wiki/professions` browse index need building, or is corpus reading via
  `/wiki/[...slug]` + the record's Profession tab sufficient? Default: sufficient for V1.
