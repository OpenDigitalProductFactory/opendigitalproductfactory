# Headless Employee — External Agents Operate the Platform as a Role-Scoped Employee, WWWD/WWMD-Aware

- **Epic:** EP-HEADLESS-EMPLOYEE
- **Status:** design (spec)
- **Date:** 2026-08-05
- **Source:** founder request (Mark Bodman)
- **Related epics:** EP-WWMD-MCP, EP-53A259C6 (WWWD onboarding), EP-AGENT-AUTH-VAULT, EP-COMPANY-AUTHZ-FGA, EP-COWORKER-INTERACTIVITY, EP-AGENT-INSTRUCTION-PLANE, EP-ORG-LOCALE-CURRENCY, EP-DECISION-TIER-REBALANCE, EP-EMPLOYEE-OCCUPATION, EP-A2A, EP-MCP
- **Related specs:** `2026-03-13-unified-identity-access-agent-governance-design.md`, `2026-03-16-unified-mcp-coworker-design.md`, `2026-05-31-pseudo-user-contract-design.md`, `2026-03-16-external-services-mcp-surface-design.md`

## 1. Problem

Some AI interactions with the platform from **outside** (Claude Code, Codex, Grok, or an organization's own agent) lack the organization's context: they do not take into account the **archetype**, **where the business operates** (locale / currency / jurisdiction), the org **mission**, or its **WWWD stance** when acting on the platform. Two consumer classes matter:

1. **Org-only operators** — organizations that interact with the platform *purely through their agent* and do no development at all.
2. **External developers** — contributors who develop against the platform and must interact **as if they were using the exposed surfaces logged in as a human**, only in chat mode.

The requirement is **not** to hand-author a new MCP tool for every surface and every interaction. It is to **derive** a per-human MCP surface dynamically, scoped by the person's login so the agent can do **only what their role permits** — a governed *headless interaction for employees* that survives the platform's evolving archetypes, roles, and surfaces.

OAuth would be the ideal auth substrate, but the MCP endpoint deliberately chose a PAT pattern (§4.1). **Decision (founder, 2026-08-05): employee-scoped PAT for v1**; token-exchange and full OAuth are deferred to the roadmap tail (§4.1, §8).

## 2. Key finding — this is ~80% wiring existing substrate

A five-thread substrate survey (2026-08-05) established that each of the four hard parts already has a real foundation. The work is connecting them and closing two seams, not greenfield.

| Requirement | Existing foundation | State |
|---|---|---|
| Agent acts "as if logged in as a human" | MCP PAT (`dpfmcp_`) binds `userId` (human) + `agentId` (acting agent); dual-principal audit contract ratified by the Pseudo-User Contract (RFC 8693 shape) | Ready |
| "Only what their role permits" | `getAvailableTools()` = `(userId→role capabilities) ∩ (agentId→grants) ∩ (token scope)`; 12-gate `evaluateCoworkerAuthority` adds delegation/row/clearance/HITL | Ready, with holes (§6) |
| Derive the interface, not a tool per surface | Pseudo-User Contract / **ScreenManifest** + 11 generic `screen_*` verbs (describe/navigate/select/fill/propose→dispatch) | Skeleton built, **empty** (`ALL_MANIFESTS = []`) |
| WWWD corpus for business decisions | Per-org overlay wiki pages (mission, who-we-serve, how-we-decide, 5 stance vectors) + `DecisionPerspectiveProfile` chain + `evaluate_org_business_decision` gate | Exists, but **push-only inside the platform + mis-routed for external agents** (§3) |

Load-bearing principle already in code: this is **delegation, not impersonation** — the Pseudo-User Contract commits to "coworker as delegated principal, never impersonator," recording every action under both the acting agent and the delegating human. The headless-employee model is that contract pointed at an org's own agent.

## 3. The two seams that block the goal

### Seam 1 — External agents are routed to the wrong corpus (correctness defect)
`apps/web/lib/decision/caller-context.ts` maps `callingPopulation` → governing profile. Today `external_coding_agent` (and `human`) route to the **WWMD platform** kernel, while only `in_platform_coworker` routes to the **org WWWD** profile. So an external agent reaching for `principle_decide` on a *business* question is scored against founder doctrine, not the org's WWWD. Only `evaluate_org_business_decision` reaches WWWD, and it hard-resolves `organization.findFirst()` (single-install). **This is the direct cause of the "AI lacks archetype / where-it-operates context" symptom** and the highest-payoff, smallest-surface fix. Routing must key on the **decision domain** (business → WWWD; platform/coding → WWMD), not solely the calling population.

### Seam 2 — No ambient context for external callers
Inside the platform, `apps/web/lib/tak/prompt-assembler.ts` *pushes* context every coworker turn: Block 0 = company mission, Block 5 = `recallWikiContext()` biased to stance/heuristic/principle, plus the decision-routing block. An external agent over `apps/web/app/api/mcp/v1/route.ts` gets **only a tool list** — no mission, no archetype doctrine, no locale/currency. The corpus is reachable by *pull* (`wiki_query`), but the agent must know to ask, so context is inconsistent. Additionally the WWWD pages are generic-English archetype starters; `OrgSettings.countryCode/locale/baseCurrency` and profession jurisdiction never fold into the stance/mission text — "where it operates" must be composed in explicitly.

## 4. Target architecture — a "Headless Employee Session"

Five layers, each extending something that exists.

### 4.1 Identity & Auth
- **Foundation:** MCP PAT (`dpfmcp_`, `apps/web/lib/auth/mcp-api-token.ts`) bound to the employee's `User` (`EmployeeProfile.userId @unique`) + the org's `agentId`. The token authenticates **as the human employee** (accountable identity + authorization scope) while `agentId` records **which agent is acting** — the dual-principal shape the Pseudo-User Contract already ratifies.
- **Do NOT** build on the coworker-summon path (`summonCoworker` spins up an independent *agent* principal and is committed to role-only, anti-impersonation identity). Do NOT overload A2A/federation (those are cross-*install* / cross-*org-agent* task exchange).
- **v1 decision — employee-scoped PAT.** Net-new work is a **governed issuance flow** that binds a token to a specific `EmployeeProfile`'s `User` with employee-scoped authorization, guaranteeing `User` backing (today `EmployeeProfile.userId` is optional and issuance mints for an admin user only — `apps/web/scripts/issue-mcp-token.ts`).
- **Deferred (roadmap tail):** RFC 8693 **token exchange** for short-lived delegated sessions and per-request human identity on a shared org agent token (the Pseudo-User Contract §7 already references the two-key subject+actor model); full OAuth 2.1 resource-server discovery only if orgs bring external IdPs (EP-ENTERPRISE-SSO-DIRECTORY). The MCP endpoint deliberately avoided OAuth 2.1 (`route.ts` header comment) — v1 does not disturb that.

### 4.2 Authorization — close the holes
Substrate is strong: `(userId→role caps) ∩ (agentId→grants) ∩ (token scope)` + `evaluateCoworkerAuthority`. Holes to close:
- `tools/list` (`handleToolsList`) is **not** clearance-filtered, and the coworker-authority gate is **skipped entirely** for non-agent-bound tokens → headless-employee tokens must be **always** agent-bound, and `tools/list` must clearance-filter.
- **List/call skew:** `handleToolsList` filters by token scopes only; `tools/call` additionally enforces agent grants → the list can advertise tools the call layer rejects. Unify.
- `loadUserContext` reads only `groups[0]` (`take: 1`) → a multi-group human's role is under-determined. Fix.
- **List/search tools are not row-scoped:** `query_employees` etc. return all rows regardless of manager scope, because `deriveCoworkerAuthoritySubject` only scopes id-addressed calls. Add query-time manager/department scoping so the agent sees exactly what the human would.
- **Granularity:** permissions derive from 7 `HR-xxx` roles; `Position.occupationKey` carries none and is non-widening. Role-coarse is acceptable for v1; true per-position/occupation scoping is a separable layer (EP-EMPLOYEE-OCCUPATION).

### 4.3 Context injection — the actual "expose WWWD" work
A new **org-identity bundle composer** that mirrors `prompt-assembler` Block 0/5 for external callers, delivered as (a) the MCP `initialize` `instructions` field + an MCP **resource**, and (b) a `get_org_context` tool the agent is told to call first. It composes: mission (`org-mission` overlay page), archetype + its business doctrine (`apps/web/lib/onboarding/archetype-business-context.ts`), **locale/currency/country** (`OrgSettings`), profession jurisdiction, and the live stance vectors. Paired with the **Seam 1 routing fix** so business decisions resolve against WWWD and platform/coding decisions against WWMD.

### 4.4 Derived surface — no per-surface tools
Two layers, both avoiding hand-authored tools:
1. `PLATFORM_TOOLS` filtered through `getAvailableTools()` **is already** the per-human derived surface — tools carry `screenSurface`, so they self-map to routes; enrich with `route-context-map` for presentation.
2. Progressively **populate ScreenManifests** (`apps/web/lib/coworker/manifests/index.ts`, currently `ALL_MANIFESTS = []`) for high-value routes so the generic `screen_*` verbs drive the long tail "as if logged in"; un-stub `screen_describe`/`screen_get_state`; **generate** manifests from page-purpose contracts + `route-context-map` rather than hand-writing per page.

### 4.5 Tenancy glue
Add `organizationId` to `McpApiToken` (and downstream `WorkCapsule`, `ExternalEvidenceRecord`) for the multi-tenant "org interacts purely through its agent" case. Single-install works implicitly today; this is prerequisite for org-only operators at scale (composes with EP-MSP-FEDERATION, EP-PARTNER-CHANNEL, BI-CTRL-A7D185).

## 5. Cross-cutting reconciliation — who owns what

This capability is a **through-line**, not a silo. EP-HEADLESS-EMPLOYEE is a **thin coordinating epic** owning only the net-new assembly BIs (§7). Ingredient work stays with its home epic:

| Layer | Home epic | Existing relevant items |
|---|---|---|
| MCP auth boundary, OAuth consent, token vault, delegated tokens | EP-AGENT-AUTH-VAULT | BI-6A01F90E, BI-717FD971, BI-F52C13C2, BI-77F62CF2 (open) |
| WWWD corpus onboarding & governance | EP-53A259C6 | BI-AF405E72, BI-E43D4732, BI-8EBD852B (open) |
| WWMD/decision MCP-exposure pattern to mirror | EP-WWMD-MCP | BI-CC64ECE4, BI-230C9EF7 (done); BI-0F0BE69A routing-guard (done) |
| Org-scoped RBAC, manager scope, coworker authority | EP-COMPANY-AUTHZ-FGA | — |
| PUC/ScreenManifest drive layer, grant taxonomy, envelope | EP-COWORKER-INTERACTIVITY | BI-F75E897A, BI-B2F7ABF5, BI-0F9C291C (done); BI-A32801C5, BI-5696B4D7 (open) |
| Ambient instruction/context plane | EP-AGENT-INSTRUCTION-PLANE | — |
| Locale / currency spine | EP-ORG-LOCALE-CURRENCY | — |
| Decision routing / tier scoping | EP-DECISION-TIER-REBALANCE | — |
| Per-occupation privilege granularity | EP-EMPLOYEE-OCCUPATION | — |

Every BI below cites its sibling epic and any existing BI it extends, so nothing is duplicated.

## 6. Phased backlog (reliability → observability → enforcement)

Ordering follows the process-spine rule: fix correctness and measurement before adding capability, add capability before enforcing new controls.

1. **BI — Seam 1: route external business decisions to the org WWWD profile, not the WWMD platform kernel.** Key routing on decision domain in `caller-context.ts`; give `external_coding_agent` the org WWWD profile for business-class decisions while keeping platform/coding decisions on WWMD. Extends BI-0F0BE69A; relates EP-DECISION-TIER-REBALANCE, EP-WWMD-MCP. *Highest payoff, smallest surface.* Size: medium. **DELIVERED (BI-HDLEMP-01, merged):** the `decisionDomain` axis (`org-business` → WWWD, `platform-development` → WWMD) on `resolveDecisionCallerContext`, backward-compatible when unset. The `principle_decide` consumer wiring was deferred (that pack is at the module-size ceiling); the consumer arrives as the `initialize` directive in item 2.
2. **BI — Org-identity context bundle for external MCP callers.** Compose mission + archetype doctrine + locale/currency/jurisdiction + stance into an ambient block at MCP `initialize` (instructions + resource + `get_org_context` tool), mirroring `prompt-assembler`. Relates EP-AGENT-INSTRUCTION-PLANE, EP-ORG-LOCALE-CURRENCY. Size: large. **PARTIALLY DELIVERED (BI-HDLEMP-02):** `apps/web/lib/mcp/org-context-bundle.ts` composes the bundle (mission from `BusinessContext`, archetype doctrine from `archetype-business-context`, locale/currency from `OrgSettings` via `org-locale`, the 5 stance vectors) and renders it into the MCP `initialize` `instructions` — including the `decisionDomain="org-business"` directive that activates item 1's engine (fail-open to the base note). **Deferred:** the pull-path `get_org_context` MCP tool and the MCP resource (new-tool gate surface), and folding profession jurisdiction into the block. *The `initialize` change carries context, not authority: it does not alter MCP tool authorization or the AI-agent meta-model — those remain as documented in `docs/architecture/mcp-tool-authorization-runbook.md` and `docs/architecture/ai-agent-meta-model.md`.*
3. **BI — Employee-scoped MCP credential issuance + on-behalf-of subject binding (headless-employee session).** Governed issuance binding a PAT to a specific `EmployeeProfile`'s `User` + org `agentId`; guarantee `User` backing; reconcile with the anti-impersonation Pseudo-User Contract (delegation + dual-principal audit). Extends EP-AGENT-AUTH-VAULT BI-6A01F90E / BI-717FD971 / BI-F52C13C2 (does not restate them). Size: large.
4. **BI — Close the external-surface authz holes.** Clearance-filter `tools/list`; require headless-employee tokens to be agent-bound; unify list/call authority so the list never advertises un-callable tools; fix `loadUserContext` multi-group role resolution. Relates EP-COMPANY-AUTHZ-FGA. Size: medium.
5. **BI — Query-time row-scoping on list/search MCP tools.** Bound `query_employees` and peer list tools to the acting human's manager/department visibility so the agent sees exactly what the person would. Relates EP-COMPANY-AUTHZ-FGA, `manager-scope.ts`. Size: medium.
6. **BI — Populate ScreenManifests for high-value routes (external headless drive).** Fill `ALL_MANIFESTS`, un-stub `screen_describe`/`screen_get_state`, generate manifests from page-purpose + `route-context-map`, so `screen_*` verbs drive the surfaces "as if logged in." Relates EP-COWORKER-INTERACTIVITY, first-consumer BI-6C9CC0EC. Size: large.

Tenancy (`organizationId` on `McpApiToken`) is captured as a prerequisite note under BI-3 for org-only operators; it is deferred until multi-tenant is a live requirement (composes with EP-MSP-FEDERATION).

## 7. Risks & non-goals

- **Non-goal:** a new per-surface MCP tool taxonomy. The derived surface reuses `PLATFORM_TOOLS` + ScreenManifests.
- **Non-goal (v1):** OAuth 2.1 / SSO federation; multi-tenant org isolation.
- **Risk — impersonation semantics.** "Headless employee acting AS a human" partially inverts the Pseudo-User Contract's anti-impersonation stance; BI-3 must land the *delegation* framing (actor = org agent, subject = employee, both audited) from `2026-03-13-unified-identity-access-agent-governance-design.md`, not the coworker-persona path.
- **Risk — clearance vs role conflation.** Clearance lives on `Principal.sensitivityClearance`; role on `User.groups → PlatformRole`. The two axes must stay distinct in BI-4.
- **Verify-at-implementation.** File:line anchors are from the 2026-08-05 substrate survey; confirm against `main` at build time.

## 8. Decisions — kernel-ratified (WWMD, 2026-08-05)

Consulted via `principle_decide` (callingPopulation `external_coding_agent` → `mark-dpf-platform` profile). Both high-confidence, no commandment conflict, strong structured coverage.

- **Coordinating-epic shape → `thin-coordinating`** (composite 6.09, margin 2.31, high). Ledger `DI-75E1B342F1FD`. Top contributors: Research and Use Standards, Never Assume—Verify, Architecture Over Shortcuts, Single Source of Truth. `fat-standalone` scored ~0 (penalized as un-grounded duplicate structure). **Ratified — this spec's structure stands.**
- **External-agent decision routing → `route-on-domain`** (composite 8.82, margin 3.98, high). Ledger `DI-58E1256CD8B4`. Top contributors: Never Assume—Verify, Architecture Over Shortcuts, Optimize for the Whole, and the *Organization as Canonical Platform Identity* core principle. `hybrid-default-override` lost — a caller-set override flag reads as avoidable failure surface. **Ratified — BI-HDLEMP-01 routes on decision domain, not caller population.**
- **Near-term org-only-operator tenancy → operator call (not kernel).** Product-scope decision; the kernel should not decide it. Recommendation: **defer `organizationId` on `McpApiToken` until multi-tenant is a live requirement** (single-install works implicitly; composes with EP-MSP-FEDERATION). Captured as a prerequisite note under BI-HDLEMP-03.
