# Platform IA: Tools, AI, Admin, and Native Integrations Refactor Design

| Field | Value |
| --- | --- |
| **Date** | 2026-04-24 |
| **Status** | Draft |
| **Author** | Codex |
| **Scope** | `apps/web/app/(shell)/platform/**`, `apps/web/app/(shell)/admin/**`, related platform/admin nav components, and the IA around AI operations, tools/services, native integrations, prompts, skills, and built-in tools |
| **Primary Goal** | Make Platform Hub legible and scalable by separating AI workforce/runtime management from connection management, runtime inventory, audit, and core admin configuration |
| **Constraints** | Stay grounded in the current DPF route model and data model; prefer canonical-home clarification and redirects over gratuitous route churn |

---

## 1. Inputs and Evidence

This design is grounded in:

- Current platform route and nav code:
  - `apps/web/components/platform/platform-nav.ts`
  - `apps/web/app/(shell)/platform/page.tsx`
  - `apps/web/app/(shell)/platform/ai/**`
  - `apps/web/app/(shell)/platform/tools/**`
  - `apps/web/app/(shell)/platform/audit/**`
  - `apps/web/app/(shell)/admin/**`
- Current data model and live runtime tables:
  - `ModelProvider`
  - `McpIntegration`
  - `McpServer`
  - `McpServerTool`
  - `IntegrationCredential`
  - `PlatformCapability`
  - `PromptTemplate`
  - `SkillDefinition`
- Existing related specs:
  - `docs/superpowers/specs/2026-03-21-platform-services-ux-design.md`
  - `docs/superpowers/specs/2026-04-02-product-centric-navigation-refactoring.md`
  - `docs/superpowers/specs/2026-04-02-ai-workforce-consolidation-design.md`
  - `docs/superpowers/specs/2026-04-12-unified-capability-and-integration-lifecycle-design.md`
  - `docs/superpowers/specs/2026-04-17-portal-navigation-consolidation-design.md`
  - `docs/superpowers/specs/2026-04-20-routing-architecture-current.md`

### 1.1 Live backlog check

The live backlog was queried from the running Docker Postgres container on **2026-04-24** using `docker exec dpf-postgres-1 psql ...`.

Relevant live epic and backlog signal (IDs copied verbatim from the DB):

- Epic `ep_int_harness_benchmarking_20260423` — `Integration Harness: Benchmarking and Private Deployment Foundation` is `open`
- Backlog item `bi-int-b4d291` — `Refine the Tools and Connections IA for catalog research, active connections, enterprise anchors, and built-in tools` is `in-progress`, `type=product`

This design therefore belongs with an existing live epic rather than requiring a brand-new epic.

> Enum compliance: only `Epic.status` ∈ {`open`, `in-progress`, `done`} and `BacklogItem.status` ∈ {`open`, `in-progress`, `done`, `deferred`} are valid per `apps/web/lib/backlog.ts`. New backlog rows added under this design must use those literals.

### 1.2 Live platform snapshot

Live counts from the same database snapshot:

| Metric | Live value |
| --- | --- |
| `McpIntegration` active rows | `0` |
| `McpServer` active rows | `1` |
| `McpServer` unconfigured rows | `4` |
| Enabled `McpServerTool` rows | `0` |
| `PlatformCapability` rows | `121` |
| `PromptTemplate` rows | `40` |
| `SkillDefinition` rows | `53` |

Additional live shape:

- Service-type `ModelProvider` rows currently include both true MCP service providers and non-MCP direct services such as address validation.
- No `IntegrationCredential` rows currently exist in the live DB for `adp` or `quickbooks`, which means the native integration surfaces exist structurally even though no native connections are configured in this install.

---

## 2. Problem Statement

DPF already has the right major platform domains, but the current IA still reflects transitional implementation history more than a durable operator mental model.

Today the platform mixes together:

- AI workforce management
- provider routing and calibration
- MCP catalog browsing
- active MCP service operations
- native third-party integrations
- built-in tools such as Brave Search
- runtime capability inventory
- audit surfaces
- admin configuration

The result is not that the platform lacks pages. The result is that the same concept appears in the wrong lifecycle stage or wrong home:

- research/evaluate
- connect/configure
- operate/monitor
- audit/govern

This makes the platform look incomplete or misleading even where the underlying feature work is already present.

---

## 3. Research and Benchmarking

This section uses primary-source references to avoid inventing IA rules from scratch.

### 3.1 Open source and open-platform references

#### Plane App Rail

Plane describes its App Rail as a navigation foundation that shows only real apps and avoids “dashboards pretending to be features.” That is directly relevant to DPF’s current tendency to let launch surfaces and mixed-purpose pages stand in for durable homes.

What DPF should adopt:

- durable app-level homes should represent real domains
- section chrome should not pretend to be a second app map
- navigation should scale by adding stable homes, not by piling more mixed-purpose tabs into one area

Source:

- [Plane: Introducing App Rail](https://plane.so/blog/introducing-apprail-plane-new-navigation)

#### n8n credentials and external secrets

n8n treats credentials and secret storage as first-class operational concepts rather than burying them inside general settings pages. It also distinguishes credential configuration from workflow logic and allows scoped secret access.

What DPF should adopt:

- connection credentials should have an operational home
- credential custody should be explicit
- built-in tool credentials should not be hidden inside unrelated admin forms

Sources:

- [n8n Credentials](https://docs.n8n.io/integrations/builtin/credentials/)
- [n8n External Secrets](https://docs.n8n.io/external-secrets/)

### 3.2 Commercial references

#### Atlassian unified navigation

Atlassian’s current navigation work emphasizes one cross-product navigation model, consistent component patterns, and a separation between universal actions and product/domain navigation. It also explicitly warns against fragmented navigation that makes users relearn structure across product areas.

What DPF should adopt:

- keep top-level platform families stable
- keep repeated navigation patterns consistent across families
- do not let each domain invent its own partial platform map

Source:

- [Atlassian: Designing Atlassian’s new navigation](https://www.atlassian.com/blog/design/designing-atlassians-new-navigation)

#### Microsoft Copilot Studio connections model

Copilot Studio separates the agent from the connections it uses, and exposes connection name, tools/knowledge sources using that connection, and connection status on a dedicated settings surface.

What DPF should adopt:

- separate “AI workforce definition” from “external connections”
- surface connection status and consumers explicitly
- let operators answer: what is connected, what uses it, and what state is it in?

Source:

- [Microsoft Copilot Studio: Create and manage connections](https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-connections)

### 3.3 Anti-patterns identified

- One page trying to be catalog, active-connections view, runtime inventory, and audit console at the same time
- Calling different things “services” without clarifying whether they are inference providers, MCP services, built-in tools, or native integrations
- Hiding built-in operational tools under Admin > Settings as if they were generic organization configuration
- Keeping audit-only routes visible inside an operational family after the canonical home already moved to Audit
- Using “discovery” for both estate discovery and connection/catalog discovery

---

## 4. Current-State Inventory

### 4.1 Platform family structure

Current platform families from `platform-nav.ts`:

- `Overview`
- `Identity & Access`
- `AI Operations`
- `Tools & Services`
- `Governance & Audit`
- `Core Admin`

This top-level shape is directionally correct. The main problems are within family boundaries and section naming.

### 4.2 Surface inventory by concept

| Concept | Current data source | Current surface | Current problem |
| --- | --- | --- | --- |
| Native integrations | `IntegrationCredential` | `/platform/tools/integrations`, `/platform/tools/integrations/adp`, `/platform/tools/integrations/quickbooks` | Correct family, but absent from the catalog story and visually isolated from other connection lifecycle surfaces |
| MCP catalog | `McpIntegration` | `/platform/tools/catalog` | The route label implies a universal catalog, but the page is MCP-only |
| Activated MCP services | `McpServer`, `McpServerTool` | `/platform/tools/services` and also a panel on `/platform/ai/providers` | Duplicated between Tools and AI; not clearly separated from provider routing |
| AI providers and routing | `ModelProvider`, `ModelProfile`, `AgentModelConfig` | `/platform/ai/providers` with label `Routing & Calibration` | Page mixes provider registry, MCP services, tool inventory, token spend, and scheduled jobs |
| Prompt templates | `PromptTemplate`, `PromptRevision` | `/admin/prompts` | AI behavior is stored under Admin even though it belongs with AI workforce/runtime management |
| Skills catalog | `SkillDefinition` | `/admin/skills` | Same problem; user-facing/coworker-facing skills are under Admin instead of AI |
| Skills observability | route-context + executions | `/platform/ai/skills` | AI already has a skills surface, but it is observability-only and not the canonical home for skill catalog management |
| Built-in tools like Brave Search | `PlatformCapability` + `PlatformConfig` | Brave Search key under `/admin/settings`; runtime tool capability in `PlatformCapability`; web search logic in `mcp-tools.ts` | The tool exists as platform capability but its configuration is hidden in generic admin settings |
| Capability inventory | `PlatformCapability`, `McpServerTool`, `ModelProvider` | `/platform/tools/inventory` | Useful expert surface, but currently too easy to confuse with catalog or connection management |
| Discovery operations | inventory/discovery tables | `/platform/tools/discovery` | “Discovery” here means estate discovery, not connection discovery; the label collides with catalog/discovery language |
| AI authority / operations / routing logs | audit tables | `/platform/ai/authority`, `/platform/ai/operations`, `/platform/ai/routing` | These are already redirects to `/platform/audit/*`, but the AI family still conceptually carries their old names |

### 4.3 Concrete route findings

Canonical and redirect evidence in code:

- `/platform/integrations` permanently redirects to `/platform/tools/catalog`
- `/platform/services` permanently redirects to `/platform/tools/services`
- `/platform/ai/routing` permanently redirects to `/platform/audit/routes`
- `/platform/ai/operations` permanently redirects to `/platform/audit/operations`
- `/platform/ai/authority` permanently redirects to `/platform/audit/authority`

This is good progress, but it also proves the current family labels and subitems still carry historical baggage.

### 4.4 Live examples of the current mismatch

Examples from the live source and DB on 2026-04-24:

- `Platform Hub > Tools & Services` says “Catalog,” “Services,” “Enterprise Integrations,” and “Capability Inventory,” but only the MCP catalog is catalogued.
- `/platform/ai/providers` still renders “Activated MCP Services” even though a TODO in the page says those cards should move to `/platform/tools`.
- `Admin > Settings` includes `Brave Search API Key` next to generic platform/upload settings even though Brave Search is an operator-facing built-in tool.
- `Admin > Prompts` and `Admin > Skills` are both AI-runtime concerns, while `/platform/ai/skills` already exists as a separate AI-specific surface.

---

## 5. User Mental-Model Problems

### 5.1 “Catalog” means the wrong thing

Users reasonably expect a catalog to answer “what can this platform connect to?” The current catalog answers only “what MCP integrations are in the synced MCP registry?”

That makes the experience misleading for:

- native integrations
- built-in tools
- direct service endpoints

### 5.2 “Services” is overloaded

In the current source, “service” can mean:

- a model provider endpoint
- an MCP server
- a native integration runtime
- a built-in tool endpoint

The UI needs stable nouns that match the lifecycle being managed.

### 5.3 AI configuration is split by implementation history

The operator mental model for AI is:

- who the coworkers are
- what skills and prompts shape them
- what providers and routing rules power them
- what runtime Build Studio uses

Today those concerns are split between `/platform/ai/*` and `/admin/*`.

### 5.4 Runtime inventory is being mistaken for setup inventory

`Capability Inventory` is a downstream runtime view of everything agents can use. It is not the right primary place to discover, connect, or configure new capabilities.

### 5.5 Audit and operations have already moved, but the family story has not caught up

The AI family still conceptually carries items that now canonically live under Audit. This makes the IA feel less trustworthy because the labels and routes do not tell the same story.

### 5.6 “Discovery” means two different things

`/platform/tools/discovery` is about estate and infrastructure discovery, while catalog/discovery language in integrations means “finding connectable capabilities.” Those must not share the same label without a qualifier.

---

## 6. IA Options Considered

### Option A: Minimal relabeling only

Keep all current route families and most current pages. Rename a few labels and move only Brave Search.

Pros:

- Lowest implementation cost
- Minimal redirects

Cons:

- Does not fix the Admin vs AI split
- Does not clarify catalog vs native integrations vs built-ins
- Leaves `/platform/ai/providers` overloaded

### Option B: Sharpen existing family boundaries without replacing the shell

Keep the current major Platform families, but make each family own one lifecycle concern:

- AI Operations owns coworkers and AI runtime behavior
- Tools & Services owns external/non-human capabilities and connection lifecycle
- Governance & Audit owns logs, authority, route evidence, and long-running runtime evidence
- Core Admin owns global organization and reference configuration

Pros:

- Fits the current route model
- Removes the biggest mental-model breaks
- Adds clarity without large route churn

Cons:

- Requires a few new canonical routes and redirects
- Needs a phased catalog story because the current data model is still source-specific

### Option C: Capability-first mega-hub

Collapse providers, services, integrations, built-ins, and capability inventory into one universal “Capabilities” family.

Pros:

- Very theoretically clean

Cons:

- Too abstract for current DPF operator workflows
- Would flatten away meaningful lifecycle differences
- Higher churn than warranted

### Recommendation

Choose **Option B**.

It keeps the current shell structure that already exists in the repo, but removes the misleading overlaps that make the current platform feel less coherent than it actually is.

---

## 7. Recommended Target IA

### 7.1 Top-level platform families

Keep these Platform families:

- `Overview`
- `Identity & Access`
- `AI Operations`
- `Tools & Services`
- `Governance & Audit`
- `Core Admin`

Do **not** create a brand-new top-level family just to fix the current overlaps.

### 7.2 Family responsibilities

### AI Operations

AI Operations should answer:

- Who are the coworkers?
- How are they assigned and governed?
- What prompts and skills shape their behavior?
- Which inference providers and routing policies power them?
- Which runtime does Build Studio use?

Canonical subsections (every Platform family keeps an `Overview` entry as its first nav item to mirror the current `Tools & Services > Hub` and `Governance & Audit > Hub` pattern in `platform-nav.ts`):

- `Overview`
- `Workforce`
- `Assignments`
- `Prompts`
- `Skills`
- `Providers & Routing`
- `Build Runtime`

`Workforce` is the canonical home for coworker definitions and grants (currently rendered on `/platform/ai`); `Overview` becomes a small landing summary that links into the rest. Implementations may keep `Workforce` colocated on `/platform/ai` and treat the family root as the overview without splitting the route — the nav still shows both labels.

AI Operations should **not** own:

- route audit logs
- long-running operations log
- authority audit
- activated MCP service lifecycle

### Tools & Services

Tools & Services should answer:

- What external or first-party capabilities can DPF connect to?
- Which ones are currently active?
- Which connection model does each capability use?
- What runtime capabilities are actually available to agents?

Canonical subsections:

- `Hub`
- `Connection Catalog`
- `MCP Services`
- `Native Integrations`
- `Built-in Tools`
- `Estate Discovery`
- `Capability Inventory`

### Governance & Audit

Governance & Audit should answer:

- What happened?
- Who could do what?
- What route decisions were made?
- What long-running runtime operations ran?

Canonical subsections (already implemented in `platform-nav.ts`; this design keeps them as-is):

- `Hub`
- `Ledger`
- `Journal`
- `Routes`
- `Operations`
- `Authority`
- `Metrics`

### Core Admin

Core Admin should answer:

- Who has access?
- What is the organization identity and branding?
- What reference data and business defaults shape the install?
- What install-wide configuration belongs to the organization/platform rather than the AI runtime or connection lifecycle?

Canonical subsections:

- `Access`
- `Organization`
- `Configuration`
- `Advanced`

Today, `Core Admin` in `platform-nav.ts` only exposes a single `Admin Home` subitem. Expanding to the four subsections above is part of this design's nav cleanup, but introduces no new top-level routes — they are tabs/sections under `/admin`.

### 7.3 Connection-type model

DPF should explicitly distinguish four connection/capability source types in the IA:

### A. AI providers

What they are:

- inference endpoints used by routing and model execution
- per `CLAUDE.md`, all inference calls go through the OpenAI-compatible `/v1/chat/completions` shape (see `apps/web/lib/ai-inference.ts`); native vendor APIs (e.g. Anthropic Messages API) are accessed through that adapter, not directly

Examples:

- Anthropic (via OpenAI-compatible shim)
- OpenAI-compatible providers (OpenRouter, Together, etc.)
- Local inference via Docker Model Runner

Canonical home:

- `AI Operations > Providers & Routing`

Data-model note: today `ModelProvider` rows of type `service` mix true MCP service providers and non-MCP direct services (e.g. address validation). This design treats those as **Built-in Tools** and requires a one-time backfill (see § 9 Phase 4) to either retag those rows or move them out of `ModelProvider` entirely. Without that backfill the new IA labels will misrepresent the data.

### B. MCP services

What they are:

- external MCP servers activated for tool use

Examples from live state:

- `mcp-github`
- `mcp-filesystem`
- `mcp-postgres`
- `mcp-browser-use`

Canonical home:

- `Tools & Services > MCP Services`

### C. Native integrations

What they are:

- first-class DPF-owned integration experiences with custom runtime, domain workflow, and credential custody

Examples:

- ADP Workforce Now
- QuickBooks Online

Canonical home:

- `Tools & Services > Native Integrations`

### D. Built-in tools

What they are:

- first-party capabilities that ship with DPF and may require external credentials or external-access policy, but are not MCP services and not native business-system integrations
- this bucket also covers platform-owned service-backed utilities where DPF presents the capability as part of its own product surface rather than as a customer-managed business-system connector

Examples:

- Brave Search
- public web fetch
- branding analyzer
- address-validation utilities surfaced as platform capabilities rather than enterprise anchors

Canonical home:

- `Tools & Services > Built-in Tools`

### 7.4 Lifecycle model

The same capability should not appear with the same weight in every lifecycle stage. The IA should differentiate:

### Catalog

Purpose:

- evaluate what could be connected or enabled

Contents:

- source badge
- description
- connection model
- docs
- status summary

### Active connections/services

Purpose:

- operate configured external assets

Contents:

- health
- credential state
- enabled tools
- last check
- who/what depends on the connection

### Runtime capability inventory

Purpose:

- show what agents can actually use at runtime

Contents:

- platform capabilities
- MCP tools
- provider-native capabilities
- risk/audit class
- enablement state

### Estate discovery

Purpose:

- discover infrastructure and product-estate evidence

This is **not** the same thing as catalog discovery and should be labeled accordingly.

---

## 8. Route and Navigation Implications

### 8.1 Recommended canonical homes

| Current route | Recommended role | Action |
| --- | --- | --- |
| `/platform/ai` | AI workforce home within AI Operations | Stay |
| `/platform/ai/assignments` | assignment policy | Stay |
| `/platform/ai/providers` | provider registry, routing, calibration | Stay, relabel to `Providers & Routing`, remove MCP service and generic tool-inventory sections |
| `/platform/ai/build-studio` | build runtime config | Stay |
| `/platform/ai/skills` | canonical AI skills home | Stay, expand to include catalog management as well as observability |
| `/admin/prompts` | prompt template management | Move to `/platform/ai/prompts`; keep redirect |
| `/admin/skills` | skill catalog management | Fold into `/platform/ai/skills` or `/platform/ai/skills/catalog`; keep redirect |
| `/platform/tools/catalog` | connection catalog | Short term: relabel truthfully; medium term: evolve into cross-source `Connection Catalog` |
| `/platform/tools/services` | MCP service operations | Stay, relabel to `MCP Services` |
| `/platform/tools/integrations` | native integrations | Stay, relabel to `Native Integrations` |
| `/platform/tools/discovery` | estate/inventory discovery | Stay, relabel to `Estate Discovery` |
| `/platform/tools/inventory` | runtime capability inventory | Stay, relabel help text to `Runtime Capability Inventory` or `Agent Capability Inventory` |
| `/admin/settings` | org/install config | Stay, but remove Brave Search from this page |
| `/platform/ai/routing` | route audit | Keep redirect to `/platform/audit/routes` |
| `/platform/ai/operations` | long-running runtime evidence | Keep redirect to `/platform/audit/operations` |
| `/platform/ai/authority` | authority audit | Keep redirect to `/platform/audit/authority` |

### 8.2 Recommended nav copy changes

### AI Operations family

Recommended subitems (in order):

- `Overview` (`/platform/ai`)
- `Workforce` (`/platform/ai` — same route, scoped section, OR a `/platform/ai/workforce` alias if useful)
- `Assignments` (`/platform/ai/assignments`)
- `Prompts` (`/platform/ai/prompts`, NEW — see § 8.3)
- `Skills` (`/platform/ai/skills`, expanded scope)
- `Providers & Routing` (`/platform/ai/providers`, relabeled from `Routing & Calibration`)
- `Build Runtime` (`/platform/ai/build-studio`)

Remove from AI family subitems (these still exist as redirects to Audit, but should not appear in the AI nav):

- `Operations`
- `Authority`

Those are already audit concerns.

### Tools & Services family

Recommended subitems (in order):

- `Hub` (`/platform/tools`)
- `Connection Catalog` or `MCP Catalog` (`/platform/tools/catalog` — see truth-in-labeling rule below)
- `MCP Services` (`/platform/tools/services`, relabeled from `Services`)
- `Native Integrations` (`/platform/tools/integrations`, relabeled from `Enterprise Integrations`)
- `Built-in Tools` (`/platform/tools/built-ins`, NEW — see § 8.3)
- `Estate Discovery` (`/platform/tools/discovery`, relabeled from `Discovery Operations`)
- `Capability Inventory` (`/platform/tools/inventory`)

Concrete bug to fix as part of this nav cleanup: today `Enterprise Integrations` in `platform-nav.ts` points to `/platform/tools/integrations/adp` — the detail page for one specific integration — instead of the `/platform/tools/integrations` index. The relabeled `Native Integrations` item must point to the index.

Short-term truth-in-labeling if the catalog is not yet cross-source:

- use `MCP Catalog` instead of `Connection Catalog`

Do not call the page `Catalog` if it still only shows `McpIntegration` rows.

### Core Admin family

Keep as:

- `Access`
- `Organization`
- `Configuration`
- `Advanced`

But reduce AI-specific content inside it.

### 8.3 Page-level content changes

### `/platform/ai/providers`

Keep:

- provider registry
- model discovery and calibration
- token spend
- scheduled jobs that are provider/routing-specific

Move out:

- activated MCP services list
- generic tool inventory

These belong in Tools & Services.

### `/platform/ai/skills`

Unify:

- current observatory content
- current admin skill catalog management

Recommended internal sections or tabs:

- `Catalog`
- `Route Skills`
- `Observability`

### `/platform/ai/prompts`

New canonical page for prompt templates, revisions, and reset-to-default actions.

### `/platform/tools/catalog`

Target state:

- cross-source catalog with type badges:
  - `MCP`
  - `Native`
  - `Built-in`

Short term:

- make current MCP-only scope explicit
- add prominent links/cards to `Native Integrations` and `Built-in Tools`

### `/platform/tools/built-ins`

New home for built-in capabilities that need runtime/operator configuration.

Initial contents:

- Brave Search
- public web fetch
- branding analyzer

### `/admin/settings`

Keep:

- social auth
- organization-level or install-level configuration that is not itself a platform capability
- upload storage path

Move out:

- Brave Search credential/config

---

## 9. Migration and Redirect Plan

### 9.0 Redirect map

All redirects use Next.js `permanentRedirect` (HTTP 308) to match existing precedent in the codebase (`/platform/integrations`, `/platform/services`, `/platform/ai/operations`, `/platform/ai/authority`, `/platform/ai/routing`). Choose 308 only after the new canonical home has at least one stable release; otherwise use `redirect` (307) until the new path is locked in to avoid permanent caching of an experimental path.

| From (legacy) | To (canonical) | Status | Phase |
| --- | --- | --- | --- |
| `/platform/integrations` | `/platform/tools/catalog` | 308 (already shipped) | n/a |
| `/platform/services` | `/platform/tools/services` | 308 (already shipped) | n/a |
| `/platform/ai/routing` | `/platform/audit/routes` | 308 (already shipped) | n/a |
| `/platform/ai/operations` | `/platform/audit/operations` | 308 (already shipped) | n/a |
| `/platform/ai/authority` | `/platform/audit/authority` | 308 (already shipped) | n/a |
| `/admin/prompts` | `/platform/ai/prompts` | 308 | Phase 2 |
| `/admin/skills` | `/platform/ai/skills` | 308 | Phase 2 |
| `/platform/tools/integrations/adp` | `/platform/tools/integrations` (index, with `?focus=adp` deep-link, optional) | n/a — fix nav target | Phase 1 |

Tests must assert the redirect target (Vitest + Next.js handler tests, or Playwright nav-click tests) before flipping any redirect to 308.

### Phase 1: Truth in labeling and duplicate removal

- Change nav labels without large route churn:
  - `Routing & Calibration` → `Providers & Routing`
  - `Services` → `MCP Services`
  - `Enterprise Integrations` → `Native Integrations`
  - `Discovery Operations` → `Estate Discovery`
- Remove AI-family subitems that only redirect to Audit
- Remove MCP service and generic tool inventory sections from `/platform/ai/providers`
- Add explicit descriptive copy on `Capability Inventory` that it is a runtime inventory, not a setup catalog

### Phase 2: Move AI-runtime configuration out of Admin

- Create `/platform/ai/prompts`
- Redirect `/admin/prompts` to `/platform/ai/prompts`
- Merge `/admin/skills` into `/platform/ai/skills`
- Redirect `/admin/skills` to the new canonical AI skills surface

### Phase 3: Give built-in tools a real home

- Create `/platform/tools/built-ins`
- Move Brave Search config off `/admin/settings`
- Add built-in tool cards and detail pages
- Keep permissions the same; only change the canonical home

### Phase 4: Make the catalog honest, then unified

Short-term:

- If the catalog remains MCP-only, rename the surface to `MCP Catalog`

Medium-term:

- Build a cross-source `Connection Catalog` UI that aggregates:
  - `McpIntegration`
  - native integration descriptors
  - built-in tool descriptors

This should be a UI aggregation layer first, not a forced immediate schema merger. Concretely: add a server-side `getConnectionCatalog()` query in `apps/web/lib/tools/connection-catalog.ts` that unions the three sources and returns a typed `ConnectionCatalogEntry` discriminated union (`{ kind: "mcp" | "native" | "built-in", ... }`) — do not migrate the underlying tables.

Backfill required for `ModelProvider`:

- Inspect `ModelProvider` rows where `type='service'` and identify any non-MCP entries (e.g. address-validation utilities). For each, either:
  - retag with a new `kind` field/column scoped to `built-in`, OR
  - move to a dedicated built-in-tools registry table seeded from `prompts/`-style descriptors.
- This must land in the same PR as the Built-in Tools UI, with a Prisma migration + `packages/db/src/seed-*.ts` update per the strongly-typed-enum and DB-migration rules in `CLAUDE.md`.

### Phase 5: Inventory and dependency polish

- Add “used by” and “depends on” relationships where possible:
  - which agents depend on which providers
  - which capabilities depend on which services
  - which built-in tools require external access

This brings DPF closer to the connection-status model seen in Copilot Studio while staying compatible with current tables.

---

## 10. Risks and Anti-patterns

### 10.1 Do not flatten unlike things into one table before the UI model is stable

Native integrations, MCP services, built-in tools, and AI providers have different operational lifecycles. The UI should unify discovery and navigation before the storage model is aggressively unified.

### 10.2 Do not keep using “service” as the universal noun

Operators need to know whether something is:

- a provider
- an MCP service
- a native integration
- a built-in tool

### 10.3 Do not let Admin remain the junk drawer

If a page exists because it is an AI runtime concern or connection lifecycle concern, it should not live under Admin merely because it needed a home early.

### 10.4 Do not make Capability Inventory the first stop for setup

It is an expert/runtime surface. It should remain available, but it should not be used to paper over a missing catalog or missing connection homes.

### 10.5 Do not keep “discovery” unqualified

Use `Estate Discovery` for infrastructure/product-estate discovery. Reserve catalog/discovery language for researching connectable capabilities.

---

## 11. Suggested Rollout Phases

### Phase A: IA hygiene

- label fixes
- nav cleanup
- remove duplicate audit entries from AI

### Phase B: Canonical-home fixes

- prompts to AI
- skills to AI
- Brave Search to Built-in Tools

### Phase C: Catalog and connections refinement

- honest `MCP Catalog` or aggregated `Connection Catalog`
- explicit native integrations lane
- explicit built-in tools lane

### Phase D: Runtime relationship visibility

- dependency mapping
- consumers-of-connection views
- stronger capability inventory annotations

### 11.1 Documentation impacts

This refactor must ship with documentation updates, not only route and nav changes.

At minimum, the implementation PR sequence should update or supersede the currently referenced docs that still encode the old IA:

- `docs/superpowers/specs/2026-04-11-business-setup-unification-design.md`
  - stop treating `/admin/prompts` and `/admin/skills` as canonical homes
- `docs/superpowers/specs/2026-04-12-unified-capability-and-integration-lifecycle-design.md`
  - replace stale labels such as `Routing & Calibration`
  - align service/catalog language with `Providers & Routing`, `MCP Services`, `Native Integrations`, and `Built-in Tools`
- `docs/superpowers/specs/2026-04-18-purpose-first-product-estate-design.md`
  - rename `Discovery Operations` to `Estate Discovery` while preserving the route context
- `tests/e2e/platform-qa-plan.md`
  - treat `/platform/ai/prompts`, `/platform/ai/skills`, and `/platform/tools/built-ins` as canonical test destinations
  - treat `/admin/prompts` and `/admin/skills` as redirect/back-compat checks

Where an older spec remains historically useful but is no longer canonical, prefer a short supersession note pointing back to this design rather than a large retroactive rewrite.

---

## 12. Epic Recommendation

This work should be tracked under the existing live epic (IDs verified against the running `dpf-postgres-1` DB on 2026-04-24):

- `ep_int_harness_benchmarking_20260423` — `Integration Harness: Benchmarking and Private Deployment Foundation` (`status=open`)

Why:

- It already contains the live in-progress backlog item `bi-int-b4d291` (`type=product`, `status=in-progress`) specifically about refining Tools and Connections IA.
- The most urgent scope in this design is connection lifecycle clarity:
  - MCP catalog
  - MCP services
  - native integrations
  - built-in tools
- The AI/Admin cleanup here is adjacent and should be added as follow-on backlog items under the same epic unless a separate AI-workforce-focused epic is already being actively worked in parallel.

Recommended backlog follow-ons under the same epic:

- `Move prompt management from Admin to AI Operations`
- `Unify skill catalog and observability under AI Operations`
- `Create Built-in Tools home and move Brave Search configuration out of Admin`
- `Rename discovery/services/catalog surfaces to match actual lifecycle stage`

---

## 13. Summary Decision

DPF does **not** need a brand-new top-level platform IA.

It needs the current Platform Hub families to become trustworthy:

- `AI Operations` should own coworkers and AI runtime behavior
- `Tools & Services` should own connection lifecycle and runtime capability surfaces
- `Governance & Audit` should own logs, authority, and route evidence
- `Core Admin` should stop carrying AI-runtime and built-in-tool configuration by accident

That is the smallest change set that fixes the current confusion while still scaling cleanly as DPF adds more native integrations, MCP services, and built-in tools.

---

## 14. Acceptance Criteria

The refactor is complete when each of the following holds, evidenced by a passing test or a verified screenshot in the relevant PR:

1. `platform-nav.ts` matches the subitem lists in §§ 7.2 / 8.2 exactly — no leftover `Routing & Calibration`, `Discovery Operations`, `Enterprise Integrations`, or AI-family `Operations`/`Authority` entries.
2. `Native Integrations` nav item targets `/platform/tools/integrations` (the index), not `/platform/tools/integrations/adp`.
3. `/admin/prompts` and `/admin/skills` return a 308 redirect to their `/platform/ai/*` canonical homes; the new pages render the same data sets without regression.
4. `/platform/ai/providers` no longer renders an `Activated MCP Services` section or a generic `Tool Inventory` section. The `// TODO Phase 2` comment at line 100 is removed.
5. `/admin/settings` no longer surfaces `brave_search_api_key`. Brave Search configuration is read/written exclusively from `/platform/tools/built-ins`, with the same `PlatformConfig` row backing it (no key rename, no data migration).
6. Every `ModelProvider` row of `type='service'` is either an MCP service provider OR has been retagged/moved to the new built-in-tool surface — verified by a SQL check shipped as a seed-time invariant guard (per the "Fix the seed, not the runtime path" feedback memory).
7. `Capability Inventory` page copy explicitly says it is a runtime view, not a setup catalog.
8. New backlog items added under `ep_int_harness_benchmarking_20260423` use only the canonical enum values from `apps/web/lib/backlog.ts`.

---

## 15. Test Plan

| Layer | Test | Tool |
| --- | --- | --- |
| Unit | `platform-nav.ts` exports the subitem lists from §§ 7.2 / 8.2 (snapshot or `toEqual`) | Vitest |
| Unit | Each redirect page returns the expected canonical path | Vitest + `next/navigation` mock |
| Integration | `getConnectionCatalog()` unions MCP + native + built-in descriptors and tags each entry with `kind` | Vitest against test DB |
| Integration | `PlatformConfig.brave_search_api_key` is readable from `/platform/tools/built-ins` server action and writable round-trip | Vitest |
| Integration | Seed invariant: no `ModelProvider` of `type='service'` has a `kind` outside the allowed set | Seed test in `packages/db/src/seed-*.test.ts` |
| E2E | Click through every Platform nav family; assert no item resolves to a 404 or a redirect chain longer than one hop | Playwright (existing Build Studio harness) |
| E2E | `/admin/prompts` and `/admin/skills` deep-links from existing bookmarks land on the new canonical pages with the same content | Playwright |

Tests must run under the existing CI gates from `CLAUDE.md`: `Typecheck`, `Production Build`, `DCO`. Unit tests are currently informational per project policy but should still be green.

---

## 16. Delivery Plan (Branches, PRs, DCO)

Per `CLAUDE.md` git workflow: every change lands via short-lived topic branches against `main`, one concern per PR, DCO sign-off on every commit (`git commit -s`), squash-merge after CI green.

| Phase | Branch prefix | Suggested PR title |
| --- | --- | --- |
| 1 | `feat/platform-ia-relabel` | `feat(platform): relabel Tools/AI nav and remove duplicate audit entries` |
| 2a | `feat/ai-prompts-canonical-home` | `feat(ai): move prompt management from /admin to /platform/ai/prompts` |
| 2b | `feat/ai-skills-unify` | `feat(ai): unify skill catalog and observability under /platform/ai/skills` |
| 3 | `feat/built-in-tools-home` | `feat(tools): add Built-in Tools home and migrate Brave Search config` |
| 4 | `feat/connection-catalog-aggregation` | `feat(tools): aggregate MCP + native + built-in into Connection Catalog` |
| 5 | `feat/capability-dependency-graph` | `feat(tools): show consumers and dependencies for connections` |

Phase 3 and Phase 4 each include a Prisma migration; per `CLAUDE.md`, use `pnpm --filter @dpf/db exec prisma migrate dev --name <name>` with a unique timestamp and update the corresponding seed in the same commit.

Out of scope for this design: any change to `Build Studio` PR-opening behavior (governed by the "Build Studio owns feature PRs; Claude opens maintenance PRs" feedback memory). These IA changes are maintenance-class and ship via Claude-authored PRs.
