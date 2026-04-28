# Eliminate the Seed as a Data-Load Step — Design Spec

| Field | Value |
|-------|-------|
| **Epic** | Platform Infrastructure / Routing Substrate (foundational layer beneath attempt #11) |
| **Status** | Draft |
| **Created** | 2026-04-28 |
| **Author** | Claude Opus 4.7 for Mark Bodman |
| **Scope** | `packages/db/src/seed.ts`, `packages/db/data/*.json`, `packages/db/prisma/schema.prisma`, `apps/web/lib/inference/bootstrap-first-run.ts`, `apps/web/lib/setup/*`, every `seed*.ts` module under `packages/db/src/`. New: `packages/db/src/catalog/*` (code-resident catalog modules), `packages/db/src/reconcile/*` (catalog reconciliation runtime). |
| **Aligns with** | [2026-04-27-routing-control-data-plane-design.md](./2026-04-27-routing-control-data-plane-design.md) (the spec this is the substrate for), [2026-04-27-routing-substrate-attempt-history.md](./2026-04-27-routing-substrate-attempt-history.md) (the constraint document) |
| **Companion audit** | [2026-04-27-routing-spec-boot-invariants.md](../audits/2026-04-27-routing-spec-boot-invariants.md) — 3 current invariant violations all rooted in seed/runtime drift |
| **Replaces, in part** | The `seed.ts` orchestrator and the 30+ `seed*` functions it composes — kept where they bootstrap one-off operator state, replaced where they shovel platform-shipped catalog into mutable DB rows |
| **Distinct from** | The routing control-plane / data-plane spec. That spec separates catalog from runtime state *inside* the routing subsystem. This spec asks the deeper question: why is the catalog written by a `seed.ts` step at all? |
| **Primary Goal** | Remove "seed-as-data-load" from the platform's bootstrap path. Replace it with five mechanisms — code-resident catalog modules, generated columns/views, immutable in-memory reference data, interactive bootstrap flows, and migrations-for-schema-only — and add a catalog reconciliation lifecycle so platform-shipped catalogs can update running installs without overwriting operator state. The structural prevention of all four recurring failure classes (vocabulary mismatch, three-place hand-aligned data, trusted-seed-vs-reality, unobserved silent failure) named in the constraint document. |

---

## 1. Problem Statement

The platform has a `seed.ts` step that runs at every install and re-runs on every redeploy. It is the entry point for ~35 named `seed*` functions composing a long script that writes thousands of rows across dozens of tables. Some of those writes seed *operator state* the platform legitimately needs at first boot (the bootstrap `Organization`, the default admin `User`). Most of those writes shovel *platform-shipped catalog* (provider definitions, agent definitions, tool grants, model profiles, MCP servers, taxonomy nodes, EA reference data, archetypes) into mutable DB columns where they immediately become a second source of truth alongside the file the seed read from.

The audit dated 2026-04-27 — [docs/superpowers/audits/2026-04-27-routing-spec-boot-invariants.md](../audits/2026-04-27-routing-spec-boot-invariants.md) — ran the routing spec's ten boot invariants against the live install and found three violations. Each violation maps directly to a class of seed-induced drift that no schema constraint, validation layer, or runtime check can prevent:

1. **INV-6 (`BI-A58F94A2`).** `ModelProfile.capabilityTier` carries the legacy LLM-grading vocabulary in 15 rows (`'deep-thinker'`, `'advanced'`, `'moderate'`). The routing code reads `qualityTier`, but `capabilityTier` is *also* still being written — by `seedCodexModels` (line 1523), `seedChatGPTModels` (line 1604), `seedLocalModels` (line 1387), and inferred by `seedMcpServers` (line 859). Two columns, two vocabularies, two writers; whichever writer ran most recently wins, neither is authoritative. **A code-resident catalog with one tier field would make the second column impossible to write.**
2. **INV-6b (`BI-6B87B3BF`).** Two routing source files (`apps/web/lib/routing/known-provider-models.ts`, `apps/web/lib/routing/recipe-types.ts`) still reference `capabilityTier`. Same root cause as INV-6: the column exists in the DB, so code that *could* read it does read it, even when its real intent is something else (admin-UI categorization). **A generated column or removed column would force both call sites to make their intent explicit.**
3. **INV-9 (`BI-54411FE8`).** The `anthropic-sub` provider is configured with `costModel='token'` and `inputPricePerMToken=0` / `outputPricePerMToken=0`. This isn't admin error — the seed wrote it that way, because `seedAnthropicSubScope` (line 1635) doesn't model subscription pricing and `seedProviderRegistry` (line 1224) reads from a JSON file with no concept of `subscriptionWindowKind`. The runtime cost ledger now happily attributes $0 to every Anthropic call. **A code-resident `ProviderDefinition` type with a discriminated `pricingModel` field — `'token' | 'subscription' | 'compute' | 'free'` — would make the malformed combination unrepresentable.**

These three findings are not separate bugs. They are three symptoms of a single architectural fault: **the seed writes catalog data into mutable DB columns, then the runtime trusts those columns even though they may have been written by a stale or malformed seed pass**. The constraint document ([2026-04-27-routing-substrate-attempt-history.md](./2026-04-27-routing-substrate-attempt-history.md), §"The Recurring Failure Class — Named Explicitly") names the four classes:

- **Class A: Vocabulary mismatch between layers.** The seed writes `capabilityTier` in the LLM-grading vocabulary; the router reads `qualityTier` in its own. Both columns are populated by seed code; nobody owns either.
- **Class B: Three-place hand-aligned data.** `PLATFORM_TOOLS` (declared in code) + `TOOL_TO_GRANTS` (mapped in code) + `agent_registry.json:tool_grants` + DB rows written by `seedCoworkerAgents` (`HARDCODED_COWORKER_GRANTS` at line 933, *separate from the JSON*). Four places, two writers, no single source.
- **Class C: Trusted seed values vs reality.** `ModelProvider.status='active'` written by `seedMcpServers` whether or not the provider is actually reachable. `costModel='token'` and `price=0` written by the seed for every subscription provider whether or not they are token-priced.
- **Class D: Unobserved silent failure.** `seedLocalModels` returns silently if Docker Model Runner is unreachable (line 1346, `console.log(...) return`). `seedModelProfiles` skips a profile if `prisma.modelProfile.create` throws (line 1690, bare `catch { skipped++; }`). `seedDpfSelfRegistration` throws on missing taxonomy but `seedEaReferenceModels` is wrapped in `.catch()` so its failure prints a warning and proceeds (line 1994).

Every silent failure is a divergence between what the operator's UI says and what's in the DB. The constraint document's prior-attempts ledger shows ten previous fixes for this pattern, each addressing a specific instance and shipping a specific mitigation (boot-time reconcile scripts, invariant assertions, regression tests). None of them removed the *seed-as-data-load step itself*. Until the step is removed, the next install introduces the next instance.

The reframe Mark articulated on 2026-04-27 — "seeds shouldn't be data loads, [or] they create these invariant conditions" — is the architectural insight: the *step* is the bug, not any specific row the step writes. And the second half — "since these seeds may be updated periodically, reference data, new providers etc, they need to be re-load safe and not just load in an entire database schema" — adds the lifecycle requirement: removing the seed-as-data-load is necessary but insufficient, because catalogs evolve. The platform must support incremental catalog updates to running installs without re-introducing the same failure surface.

This spec defines five mechanisms to replace the seed-as-data-load step, plus a catalog reconciliation protocol to handle catalog evolution. It is a deep architectural layer beneath the routing-control-plane spec ([2026-04-27-routing-control-data-plane-design.md](./2026-04-27-routing-control-data-plane-design.md)), which assumes a clean catalog-vs-runtime separation that does not exist today and cannot exist while the seed continues to write across that boundary.

## 2. Non-Goals

- **Replacing the routing spec.** The control-plane / data-plane separation in [2026-04-27-routing-control-data-plane-design.md](./2026-04-27-routing-control-data-plane-design.md) stands. This spec is the substrate it depends on. The routing spec's RIB/FIB compilation and state-machine semantics are preserved verbatim; only the *source* of catalog data feeding the RIB changes.
- **Replacing the artifact-provenance spec.** Tool-call receipts, `verificationOut` integrity, and `saveBuildEvidence` guards are a separate concern. Out of scope here, deferred per the routing spec's §9.1.
- **Replacing migrations entirely.** Schema migrations remain, and they remain the only mechanism for changing schema. What changes is that they stop being a backdoor for data writes — see §4.5.
- **Replacing the operator's ability to override platform decisions.** Operator-mutable fields (provider credentials, admin pins, agent budget overrides, subscription caps when discovered empirically) remain mutable. The reconciliation protocol's whole job is to update platform-owned fields *without* touching operator-owned fields. See §7.3.
- **Eliminating every seed-shaped write.** Postgres needs at least one `User` row before login works. The interactive-bootstrap pattern (§4.4) handles this honestly; pretending no seed-shaped writes are needed at all would be wrong, and §10.6 names the cases where a one-time write at first boot remains necessary.
- **Solving capability-derived grants, MDM for agent identifiers, the build-phase state machine.** Each is a deferred concern from the routing spec's §9 and remains out of scope here.
- **Shipping in one PR.** This is a multi-month migration. §9 estimates 14-22 weeks across nine phases.

## 3. The Five Replacement Mechanisms

The seed today does six categorically distinct things, conflated into one script. Each kind of work has a fit-for-purpose replacement; the replacements are the architectural primitives.

| # | Mechanism | What it replaces | Why this shape |
|---|-----------|------------------|----------------|
| 1 | Code-resident catalog module | "Categories the software ships with" — providers, tools, agents, MCP servers, archetypes, EA notations, business models, role registry, portfolios, taxonomy, deliberation patterns, prompt templates, skills | The TypeScript type system is the strongest invariant enforcer the codebase already has. A `ProviderDefinition` whose `pricingModel: 'token'` arm requires `inputPricePerMToken: number` makes INV-9 unrepresentable. The DB cannot enforce a discriminated union; TypeScript can. |
| 2 | Generated columns and views | Derived state — `qualityTier`, `costAccrued`, `status`-like fields that compose other columns, `routingTier` aliases | A generated column cannot drift from its inputs because Postgres recomputes it. Dropping `capabilityTier` and replacing it with a generated `qualityTier GENERATED ALWAYS AS (assign_tier_from_model_id(model_id)) STORED` would have prevented INV-6 by construction. |
| 3 | Immutable in-memory reference data | Slowly-evolving reference data with no per-install variance — countries, currencies, regions, tax jurisdictions, IT4IT viewpoint definitions, ArchiMate notation, BPMN notation, taxonomy v3 nodes | These are platform constants. They have no business in mutable rows. Loading them at portal startup as TypeScript constants and joining against them in-memory removes their drift surface entirely. (Joining against in-memory data has cost — addressed in §10.) |
| 4 | Interactive bootstrap flow | One-time human decisions — first organization, default admin user, contribution-mode opt-in, provider OAuth, hive-contribution token, sandbox pool sizing | These are *operator* decisions, not platform shipped catalog. The seed today bakes in defaults (`admin@dpf.local` / `changeme123`, `ORG-PLATFORM`/`Open Digital Product Factory`), then leaks them into the audit trail. A first-run wizard captures the operator's actual choices, with a real audit trail. |
| 5 | Schema migrations for schema only | Migrations today sometimes carry data writes (backfills, default-row inserts). This is the path through which "data corruption survives a DB wipe-and-restore" enters the system | Migrations describe schema. Data writes happen through the validated runtime path with audit trails. The routine `prisma migrate dev` produces a migration; if a deployment needs a row, it goes through a named bootstrap or reconcile step, not embedded SQL inside the migration. |

A sixth category — "this is genuinely necessary one-time data write" — survives scrutiny for exactly two cases (see §10.6). Both are bootstrap concerns and handled by mechanism 4.

### 3.1 Mechanism 1: Code-resident catalog modules

A code-resident catalog is a TypeScript module that exports an array of fully-typed values. The runtime imports the module directly. The DB holds at most a *reference key* (a foreign key to a stable `catalogId` string), never a copy of catalog data.

Concrete shape, taking the provider catalog as the worked example:

```typescript
// packages/db/src/catalog/providers.ts
//
// THIS IS THE SOURCE OF TRUTH FOR PROVIDERS.
// The DB stores ModelProvider rows that REFERENCE entries here by providerId.
// Adding a new provider: add an entry to PROVIDERS, increment CATALOG_VERSION.
// Removing a provider: mark it deprecated; never delete (preserves audit trail).

export const CATALOG_VERSION = "2026-04-28.1";

export type AuthMethod = "none" | "api_key" | "oauth_pkce" | "oauth_device";

export type PricingModel =
  | { kind: "token"; inputPerMToken: number; outputPerMToken: number }
  | { kind: "subscription"; windowKind: "weekly" | "monthly"; estimatedCapTokens: number | null }
  | { kind: "compute"; computeWatts: number; electricityRateKwh: number }
  | { kind: "free" };

export interface ProviderDefinition {
  readonly providerId: string;                 // stable key — DB references this
  readonly catalogVersion: string;             // bumped when this entry changes
  readonly name: string;
  readonly category: "direct" | "subscription" | "local" | "mcp-bundled" | "service";
  readonly families: readonly string[];
  readonly endpointType: "chat" | "responses" | "service";
  readonly auth: { method: AuthMethod; supportedMethods: readonly AuthMethod[]; oauth?: OAuthConfig };
  readonly pricing: PricingModel;
  readonly capabilities: { toolUse: boolean; streaming: boolean; structuredOutput: boolean };
  readonly sensitivityClearance: readonly SensitivityLevel[];
  readonly docsUrl?: string;
  readonly consoleUrl?: string;
  readonly status: "shipped" | "preview" | "deprecated";
  readonly deprecatedAt?: string;              // ISO date; reconciliation surface
  readonly replacedBy?: string;                // providerId of replacement
}

export const PROVIDERS: readonly ProviderDefinition[] = [
  {
    providerId: "anthropic-sub",
    catalogVersion: "2026-04-28.1",
    name: "Anthropic Claude (Subscription)",
    category: "subscription",
    families: ["claude-opus-4", "claude-sonnet-4", "claude-haiku-4"],
    endpointType: "chat",
    auth: { method: "oauth_pkce", supportedMethods: ["oauth_pkce"], oauth: { /* ... */ } },
    pricing: { kind: "subscription", windowKind: "weekly", estimatedCapTokens: null },
    capabilities: { toolUse: false, streaming: true, structuredOutput: true },
    sensitivityClearance: ["public", "internal", "confidential"],
    status: "shipped",
  },
  // ... rest of catalog
] as const;
```

Three invariants this shape enforces by construction:

1. **No malformed pricing.** TypeScript's discriminated union means `pricing: { kind: "token" }` without `inputPerMToken` is a compile error. INV-9 cannot recur.
2. **No vocabulary drift.** `category`, `auth.method`, `pricing.kind`, `status` are all string literal unions. Any code writing `category: "direct-api"` instead of `"direct"` fails to compile.
3. **No silent extension.** `as const` and `readonly` prevent runtime mutation. The runtime cannot drift the catalog after import; the only way to change it is a code change that goes through PR review.

The DB schema for `ModelProvider` collapses to: `providerId` (FK to catalog), `status` (runtime: `unconfigured | configured | active | degraded | rate_limited | recovering | retired`), `credentials` (operator data), `discoveredCapabilities` (runtime — what probes actually returned), and a small set of operator-set policy fields. Catalog-derived fields (`name`, `category`, `families`, `pricing`, `endpointType`, `auth.supportedMethods`) are *removed from the DB* and joined in-memory at routing-decision time, satisfying the routing spec's RIB §3.2 compose-from-multiple-sources contract.

The catalog modules to be created (one per current `seed*` family):

| Catalog module | Replaces | Current seed source |
|----------------|----------|--------------------|
| `catalog/providers.ts` | `seedProviderRegistry` | `data/providers-registry.json` |
| `catalog/agents.ts` | `seedAgents`, `seedCoworkerAgents` | `data/agent_registry.json` + `HARDCODED_COWORKER_GRANTS` constant |
| `catalog/tools.ts` | (no seed today; lives in `apps/web/lib/tak/agent-grants.ts`) | `PLATFORM_TOOLS`, `TOOL_TO_GRANTS` collapsed into one typed source |
| `catalog/mcp-servers.ts` | `seedMcpServers` | inline constant `defaultServers` |
| `catalog/agent-skills.ts` | `seedCoworkerSkills`, `seedAgentPromptContexts` | inline `agentSkills`, `contexts` constants |
| `catalog/agent-model-defaults.ts` | `seedAgentModelDefaults` | inline `defaults` constant |
| `catalog/codex-models.ts` | `seedCodexModels`, `seedChatGPTModels` | inline `codeModels`, `models` constants |
| `catalog/model-pricing.ts` | `seedModelPricing` | inline `priceBrackets` constant |
| `catalog/feature-degradation.ts` | `seedFeatureDegradationMappings` | inline `mappings` constant |
| `catalog/business-models.ts` | `seedBusinessModels` | `data/business_model_registry.json` |
| `catalog/portfolios.ts` | `seedPortfolios` | `data/portfolio_registry.json` |
| `catalog/roles.ts` | `seedRoles` | `data/role_registry.json` |
| `catalog/digital-products.ts` | `seedDigitalProducts`, `seedDpfSelfRegistration` | `data/digital_product_registry.json` + inline self-registration |
| `catalog/storefront-archetypes.ts` | `seedStorefrontArchetypes` | inline in `seed-storefront-archetypes.ts` |
| `catalog/work-queues.ts` | `seedWorkQueues` | inline constants |
| `catalog/platform-config.ts` | `seedPlatformConfig` | inline `USE_UNIFIED_COWORKER` flag |

(EA-related catalogs — ArchiMate notation, BPMN notation, structure rules, viewpoints — are reference data per mechanism 3, not catalog per mechanism 1; see §3.3.)

The discriminator between mechanisms 1 and 3 is whether the data is *referenced by foreign key from per-install rows*. Providers are catalog (FK from `ModelProfile`, `CredentialEntry`). Country codes are reference data (used as string fields, never FK targets).

### 3.2 Mechanism 2: Generated columns and views

Today's seed sometimes writes a value that is *deterministically derived from another column*. `qualityTier` is the canonical example: `assignTierFromModelId(modelId)` is a pure function in `apps/web/lib/routing/quality-tiers.ts`, and the seed runs it inside a TypeScript loop, then writes the result into a DB column (`seedCodexModels` line 1523-1604 etc.). Because the seed writes the value, the column can drift from `assignTierFromModelId(modelId)` whenever (a) the function is updated and the seed isn't re-run, (b) the row is touched by a non-seed code path that bypasses the function, (c) a DB-level data import creates a row without going through the seed.

A Postgres `GENERATED ALWAYS AS ... STORED` column eliminates the drift surface:

```sql
ALTER TABLE "ModelProfile"
  ADD COLUMN "qualityTier" TEXT
    GENERATED ALWAYS AS (assign_tier_from_model_id("modelId")) STORED;
```

The function `assign_tier_from_model_id` is a Postgres `IMMUTABLE` function whose body is the SQL translation of the TypeScript `assignTierFromModelId`. Both must agree; a CI check (Phase D) runs both implementations against a fixture set and fails if they diverge.

Generated columns to introduce, replacing today's hand-written seed values:

| Table.column | Source | Drops |
|--------------|--------|-------|
| `ModelProfile.qualityTier` | `assign_tier_from_model_id(modelId)` | `seedCodexModels`, `seedChatGPTModels`, `seedLocalModels` writing `capabilityTier` and the inferred `qualityTier` |
| `ModelProfile.tierDimensionsBaseline` (view, not column) | `tier_dimension_baselines(qualityTier)` | `ensureBuildStudioModelConfig`'s "if scores at default 50, set to 95" patch logic |
| `Agent.canonicalIdentifier` (view) | resolves `agentId` ↔ `slugId` ↔ DB `id` to one canonical key | The Class A "three identifiers" problem named in the constraint document |
| `ModelProvider.activeRoutingState` (view) | composes `status`, last probe outcome, credential presence | The "is this provider really usable?" question scattered across 6 different code sites |

Views serve cases where the derivation is non-trivial enough to compose multiple columns or join other tables, but still deterministic. They cost an in-memory compute per query; for the routing path, the FIB compile (per the routing spec §4) reads the view once per recompile, not per request.

Generated columns are the structural replacement for boot-time reconcile scripts. The reconcile script runs once at seed time; the generated column runs *on every row write*. Drift is eliminated, not merely caught.

### 3.3 Mechanism 3: Immutable in-memory reference data

Reference data is platform-shipped, slowly-evolving, and identical across every install. Examples currently in the DB:

- All 195 ISO countries (`seedGeographicData` from `data/countries.json`).
- All US states + Canadian provinces + 3000+ cities (`seedGeographicData`).
- All 1200+ tax jurisdictions (`seedTaxJurisdictions`).
- ArchiMate 4 notation (~80 element types, ~25 relationship types) (`seedEaArchimate4`).
- BPMN 2.0 notation (~30 elements, ~10 relationships) (`seedEaBpmn20`).
- ArchiMate viewpoint definitions (`seedEaViewpoints`).
- Cross-notation rules (`seedEaCrossNotation`).
- EA structure rules (`seedEaStructureRules`).
- Taxonomy v3 nodes (`seedTaxonomyNodes` from `data/taxonomy_v3.json`, ~hundreds of nodes).
- Governance reference data (`seedGovernanceReferenceData`).
- Workforce reference data (`seedWorkforceReferenceData`).
- Deliberation patterns (`seedDeliberationPatterns`).
- IT4IT viewpoint definitions (in `seedEaViewpoints`).

These are loaded today via `prisma.upsert` in a loop. Every install ends up with identical row content. The DB has no use for them as mutable rows: nothing creates a per-install country, nothing edits a US state's population, nothing renames an ArchiMate element type.

The replacement is to load them once at portal process startup from typed TypeScript modules, hold them as immutable in-memory constants, and expose them through accessor functions:

```typescript
// apps/web/lib/reference/countries.ts
import COUNTRIES_DATA from "./data/countries.json";

export interface Country {
  readonly iso2: string;
  readonly iso3: string;
  readonly name: string;
  readonly numeric: string;
  readonly callingCode: string;
}

const COUNTRIES: readonly Country[] = Object.freeze(
  (COUNTRIES_DATA as Country[]).map(Object.freeze)
);

const BY_ISO2 = new Map(COUNTRIES.map((c) => [c.iso2, c]));

export function getAllCountries(): readonly Country[] { return COUNTRIES; }
export function getCountryByIso2(iso2: string): Country | undefined { return BY_ISO2.get(iso2); }
```

The DB drops the `Country`, `Region`, `City` tables (~3500 rows of identical-across-installs data per install). Foreign keys that point to these tables are converted to plain string columns holding the ISO code, validated at the application layer against the in-memory map.

The same pattern for EA notation: `EaNotation`, `EaElementType`, `EaRelationshipType`, `ViewpointDefinition` are deleted; the runtime imports them from `apps/web/lib/reference/ea-notation.ts`. `EaView` (which references notation by FK) becomes a per-install table whose `notationSlug` and `viewpointSlug` columns are validated against the in-memory catalog at write time.

Reference data is allowed to grow at deploy: a new ArchiMate version ships with new element types; a new tax jurisdiction is added. These changes ride the application bundle; there is no DB migration, no reconcile pass, no risk of drift between catalog and DB because *the DB has nothing to drift from*.

The cost trade-off: reference data must be loaded into memory at startup. The current dataset (~3500 countries/cities + ~120 EA elements/relationships + ~hundreds of taxonomy nodes + several thousand tax jurisdictions) is on the order of single-digit MB serialized. Acceptable for a long-running process. Not acceptable would be loading datasets in the GB range; if a future reference dataset crosses that threshold, it gets a fit-for-purpose backing store (search index, embedded SQLite, etc.) — not a Postgres table.

### 3.4 Mechanism 4: Interactive bootstrap flow

Some rows the platform genuinely needs at first boot are not catalog and not reference data — they are *operator decisions*. Today's seed bakes in defaults for these decisions and writes them silently:

| What today's seed writes | What it actually is | What it should be |
|--------------------------|---------------------|-------------------|
| `Organization { orgId: "ORG-PLATFORM", name: "Open Digital Product Factory" }` | Operator's company identity | Setup wizard captures real company name; the seed-shaped row is renamed in place by `setup-entities.ts` |
| `User { email: "admin@dpf.local", password: "changeme123" }` | Default admin credentials in the audit trail | First-run wizard prompts for admin email + password before the portal is reachable |
| `PlatformDevConfig { clientId, gitAgentEmail }` | Pseudonymous identity for hive contributions | Generated at first run if absent (this one is correct today, kept) |
| `CredentialEntry { providerId: "hive-contribution", status: "unconfigured" }` | Placeholder so the UI knows to prompt | First-run wizard's "join the hive?" page captures the operator's choice and either records the token or records the explicit opt-out |
| `WorkQueue { queueId: "triage-default" }` | Default work-queue configuration | Could be reference data (mechanism 3) since it has no per-install variance, OR operator-confirmed during setup |

The replacement pattern is a **first-run wizard** at `/setup` that detects an empty install (no `User` rows) and refuses to serve any other route until the wizard is completed. The wizard:

1. Captures operator identity (admin email, password) → writes one `User` row through the same validated path the admin UI uses, with a `BootstrapEvent` audit row recording "first admin created at first-run wizard at $TIMESTAMP from $IP".
2. Captures organization identity (name, slug) → writes one `Organization` row through the same path.
3. Captures contribution-mode preference (opt in / opt out / decide later) → writes a `BootstrapEvent` row recording the choice; if opted in, captures the hive token.
4. Captures provider OAuth choices (one or more of: Anthropic Claude Max, ChatGPT, OpenAI Codex, Gemini, local-only) → triggers the existing OAuth flow per provider; writes `CredentialEntry` rows on completion.

Crucially, **the wizard writes rows through the same code paths the admin UI does**, with the same validation, the same audit trail, the same authorization checks. It is not a side door. If the wizard wrote rows directly to the DB without going through the validated path, the wizard would itself be a seed-as-data-load step in disguise.

Reversibility: the wizard is single-use. After completion, `/setup` redirects to `/admin`. A separate "reset to first-run" admin operation (intended for E2E testing only) drops the relevant rows and re-enables the wizard.

### 3.5 Mechanism 5: Schema migrations for schema only

Schema migrations exist today as `packages/db/prisma/migrations/` and run via `prisma migrate deploy` on container start (`docker-entrypoint.sh`). The pattern is correct; the discipline gap is that some migrations have historically embedded data writes (backfill scripts inserted as raw SQL into the migration body, default-row inserts at the bottom of a `CREATE TABLE`).

The discipline this spec asks for:

- A migration's body contains only `CREATE`, `ALTER`, `DROP`, `RENAME`, `CREATE INDEX`, `CREATE FUNCTION` statements.
- A migration *never* contains an `INSERT`, `UPDATE`, or `DELETE` against application tables. (Internal Prisma metadata tables are exempt.)
- A CI check (Phase B) parses every migration file and fails the build if a forbidden statement is present.
- Backfills that today live in migrations move to a one-shot `bootstrap-fix-NNNN.ts` script invoked by name during deployment, with explicit before/after row-count logging and a dry-run mode.

The reason: a migration that writes data is invisible to the audit trail, runs as a privileged DB user, can corrupt operator-mutable fields, and survives a `prisma migrate reset` in a different shape than it survives `prisma db push`. By forbidding data writes inside migrations, the platform can guarantee that *every row in the DB was written by either the runtime (with audit trail) or a named bootstrap script (also with audit trail)*. There is no third path.

## 4. Inventory: Every Current Seed Function, Classified

This is the audit the constraint document requires. Each `seed*` function in `packages/db/src/seed.ts` and the modules it composes is classified into one of the five mechanisms (or sixth: genuinely necessary one-time write).

| Seed function | Lines | Today does | Replacement mechanism | Notes |
|---------------|-------|-----------|----------------------|-------|
| `ensureBootstrapOrganization` | 263-280 | Writes a placeholder `Organization` row with hard-coded name "Open Digital Product Factory" | **4 (bootstrap flow)** + **6 (necessary one-time)** | Empty `Organization` table breaks downstream FKs. First-run wizard captures real values; if the wizard hasn't completed, a bootstrap row exists with `name: 'unconfigured'` and the portal redirects to `/setup`. |
| `seedGeographicData` | (separate file) | 195 countries, US states, ~3000 cities | **3 (reference data)** | Drop tables; load from typed module. |
| `seedTaxJurisdictions` | (separate file) | ~1200 tax jurisdiction rows | **3 (reference data)** | Drop table; load from typed module. |
| `seedRoles` | 31-66 | ~10 platform roles from `role_registry.json` | **1 (catalog)** | Move to `catalog/roles.ts`. DB stores reference by `roleId`. |
| `seedGovernanceReferenceData` | (separate file) | Governance reference rows | **3 (reference data)** | Audit content; likely all reference. |
| `seedWorkforceReferenceData` | (separate file) | Workforce reference rows | **3 (reference data)** | Audit content; likely all reference. |
| `seedPortfolios` | 282-304 | 4 portfolios from `portfolio_registry.json` + hardcoded `PORTFOLIO_BUDGETS` | **1 (catalog)** | Budgets are catalog defaults; operator overrides go to a separate `PortfolioBudgetOverride` table. |
| `seedBusinessModels` | 201-253 | Business models + roles from `business_model_registry.json` | **1 (catalog)** | Move to `catalog/business-models.ts`. |
| `seedAgents` | 104-192 | Agents from `agent_registry.json`, including `AgentExecutionConfig` and `AgentToolGrant` rows | **1 (catalog)** | Move to `catalog/agents.ts`. Tool grants become a derived join from `Agent.role` × `Role.requiredCapabilities` — this is the "capability-derived grants" deferred concern from the routing spec §9.2; until that lands, grants stay as a per-install row but are *reconciled* from the catalog (§7) rather than seeded. |
| `seedCoworkerAgents` | 907-1011 | 16 hardcoded coworkers + `HARDCODED_COWORKER_GRANTS` + `ONBOARDING_AGENT_GRANTS` | **1 (catalog)** | These are the canonical example of Class B (three-place data: registry JSON + hardcoded constant + DB grants). Collapse all three into `catalog/agents.ts` with one entry per agent. |
| `seedCoworkerSkills` | 1014-1057 | 4 agents' skills as inline constant | **1 (catalog)** | Move to `catalog/agent-skills.ts`. |
| `seedAgentPromptContexts` | 1060-1101 | 4 agents' prompt contexts as inline constant | **1 (catalog)** | Move to `catalog/agent-skills.ts` (same file, related concern). |
| `seedFeatureDegradationMappings` | 1104-1126 | 5 mappings as inline constant | **1 (catalog)** | Move to `catalog/feature-degradation.ts`. |
| `seedTaxonomyNodes` | 306-415 | Hundreds of taxonomy nodes from `taxonomy_v3.json` | **3 (reference data)** | Taxonomy is platform-shipped, identical across installs. Drop table; load from typed module. Per-install taxonomy *extensions* (admin adds a custom node) get a separate `TaxonomyExtension` table that joins against the reference data. |
| `seedEaReferenceModels` | (separate file) | EA reference models | **3 (reference data)** | Same as taxonomy. |
| `seedDigitalProducts` | 417-468 | DPF-self-registration product entries from `digital_product_registry.json` | **1 (catalog)** for platform-shipped products + **6 (necessary one-time)** for `dpf-portal` self-registration | Per-install custom products remain in `DigitalProduct`; platform-shipped catalog of products (DPF Portal, etc.) move to catalog. |
| `seedEaArchimate4` | (separate file) | ArchiMate 4 elements + relationships | **3 (reference data)** | Drop table; load from typed module. |
| `seedEaBpmn20` | (separate file) | BPMN 2.0 elements + relationships | **3 (reference data)** | Same. |
| `seedEaCrossNotation` | (separate file) | Cross-notation rules | **3 (reference data)** | Same. |
| `seedEaStructureRules` | (separate file) | Structure rules | **3 (reference data)** | Same. |
| `seedEaViewpoints` | 540-661 | ArchiMate + BPMN viewpoint definitions | **3 (reference data)** | Same. |
| `seedEaViews` | 663-712 | Two default `EaView` rows | **1 (catalog)** | Default views are platform-shipped; per-install custom views remain in `EaView`. |
| `seedDpfSelfRegistration` | 470-513 | One `DigitalProduct` for the DPF Portal itself | **6 (necessary one-time)** | Self-registration is a one-time write at first boot; the `dpf-portal` row is the platform's representation of itself in its own catalog. Reconciled (§7) on every boot to update its name/description if catalog changes. |
| `seedDefaultAdminUser` | 516-538 | `User` with `admin@dpf.local` / `changeme123` | **4 (bootstrap flow)** | First-run wizard. The current default password leaks into every audit log on every install; replacing this is a security improvement on top of the architectural one. |
| `ensureDiscoveryTriageScheduledTask` | (separate file) | Scheduled task row | **1 (catalog)** | Scheduled tasks are platform-shipped configuration; move to `catalog/scheduled-tasks.ts`. |
| `seedMcpServers` | 714-871 | 5 default MCP servers + mirror rows in `ModelProvider` | **1 (catalog)** | Move to `catalog/mcp-servers.ts`. The mirror-into-`ModelProvider` step disappears once `ModelProvider` rows are derived from the catalog at read time (the "N new MCP services detected" banner becomes a catalog-vs-DB diff per §7). |
| `seedSandboxPool` | 873-905 | Sandbox slot rows sized by `DPF_SANDBOX_POOL_SIZE` env var | **4 (bootstrap flow)** + **2 (generated view)** | Pool size is operator-configurable; the wizard (or admin UI) captures the size and creates rows. Pool *occupancy* state is runtime, owned by the sandbox dispatcher. |
| `seedAnthropicSubScope` | 1635-1661 | `CredentialEntry` placeholder + `supportsToolUse: false` writeover | **4 (bootstrap flow)** + **1 (catalog)** | The `supportsToolUse: false` fact is catalog (it's a property of the anthropic-sub provider's CLI adapter, not per-install). The `CredentialEntry` placeholder is bootstrap. |
| `seedProviderRegistry` | 1224-1327 | 200 lines of upserting from `providers-registry.json` with selective field updates and complicated authMethod-preserving logic | **1 (catalog)** + **7 (reconciliation)** | The whole function is a hand-rolled, error-prone version of the reconciliation protocol §7. The replacement is the protocol itself. |
| `seedLocalModels` | 1334-1405 | Probes Docker Model Runner; writes discovered models | **2 (generated)** + runtime | Discovery is runtime, not seed. Move to a startup hook that writes `DiscoveredModel` rows; `ModelProfile` derivation from those rows is the routing spec's RIB compile step. |
| `seedCodexModels` | 1411-1558 | 3 codex models with hardcoded scores, capability flags | **1 (catalog)** + **2 (generated)** | Catalog the model definitions; derive `qualityTier` and dimension scores via generated columns from `tier_dimension_baselines(qualityTier)`. The "fix scores at default 50 → 95" patch logic disappears because the column is generated. |
| `seedChatGPTModels` | 1565-1633 | 1 ChatGPT model | **1 (catalog)** | Same. |
| `seedModelProfiles` | 1670-1693 | Imports `model-profiles.json` for known-good profiles | **1 (catalog)** | The JSON file becomes the catalog source. |
| `ensureBuildStudioModelConfig` | 1786-1856 | Patches Anthropic model `modelStatus`, scores, retired flags | **1 (catalog)** + **2 (generated)** | Every "if scores at default 50, set to 95" arm is the symptom of seed/runtime drift the catalog eliminates. The whole function deletes. |
| `seedModelPricing` | 1723-1784 | Pattern-matches `(provider, model)` to set pricing | **1 (catalog)** | Pricing belongs on the `ProviderDefinition`/`ModelDefinition` directly. The pattern-match logic moves to a pure derivation function in catalog code. |
| `seedAgentModelDefaults` | 1867-1947 | 17 agents' model defaults as inline constant | **1 (catalog)** | Move to `catalog/agent-model-defaults.ts`. |
| `seedPlatformConfig` | 1128-1135 | One feature flag `USE_UNIFIED_COWORKER` | **1 (catalog)** | Feature flags are catalog (platform-shipped defaults); per-install overrides go to a separate `PlatformConfigOverride` table. |
| `seedClientIdentity` | 1152-1183 | One pseudonymous identity, generated only if absent | **6 (necessary one-time)** | Correct as-is. Generated at first run; never rewritten. The pattern this function uses (read-then-conditionally-write, never overwrite) is the model for all bootstrap-class writes. |
| `seedHiveContributionCredential` | 1193-1211 | `CredentialEntry` placeholder | **4 (bootstrap flow)** | Wizard captures choice; if no choice yet, no row is created. |
| `seedStorefrontArchetypes` | (separate file) | Storefront archetypes | **1 (catalog)** | Move to `catalog/storefront-archetypes.ts`. |
| `seedWorkQueues` | 1949-1975 | 2 default queues | **1 (catalog)** | Move to catalog. |
| `seedPromptTemplates` | (separate file) | Prompt templates from `.prompt.md` files | **1 (catalog)** | The `.prompt.md` files are already the source of truth (per `CLAUDE.md`); the seed function reads them and writes to DB. The catalog mechanism reads them at runtime through the `PromptLoader`'s existing fallback path; the DB cache becomes optional, not required. |
| `seedSkills` | (separate file) | Skill definitions from `.skill.md` files | **1 (catalog)** | Same pattern as prompts. |
| `seedDeliberationPatterns` | (separate file) | Deliberation patterns | **1 (catalog)** | Move to catalog. |
| `syncCapabilities` | (separate file) | Reconciles capabilities | **7 (reconciliation)** | This is already reconciliation-shaped; absorb into the unified protocol. |
| `assertActiveProvidersHaveClearance` | 2038-2053 | Boot invariant: active providers have sensitivityClearance | **(invariant, kept)** | Invariants are explicitly kept and strengthened, see §8. |
| `assertCoworkerAgentsHaveGrants` | 2062-2081 | Boot invariant: coworker agents have grants | **(invariant, kept)** | Same. |

**Summary by mechanism:**

- Mechanism 1 (catalog modules): 24 functions
- Mechanism 2 (generated columns): augments 4 catalog moves
- Mechanism 3 (reference data): 11 functions
- Mechanism 4 (bootstrap flow): 5 functions (some shared with mechanism 1)
- Mechanism 5 (migrations for schema only): not a per-function replacement; a discipline applied to all migrations
- Mechanism 6 (necessary one-time write): 3 functions (`ensureBootstrapOrganization`, `seedDpfSelfRegistration`, `seedClientIdentity`)
- Mechanism 7 (reconciliation): 2 functions (`seedProviderRegistry`, `syncCapabilities`) — the seed today already attempts this shape, and these become the model for the unified protocol

The honest answer to "are any seed-shaped writes genuinely necessary": **3**. Bootstrap organization, DPF self-registration, client identity. All three are first-boot-only writes that read state and write only if absent. None of them update existing rows. They are mechanism 6, the legitimate residue.

## 5. Schema Implications

This section enumerates the schema changes required by the migration. It is concrete enough to inform a Prisma schema diff, but stops short of a full migration script (that's Phase B implementation).

### 5.1 Tables to delete

Per-install rows for these tables are 100% derivable from code-resident catalog or reference data; deleting the tables removes the drift surface entirely.

- `Country`, `Region`, `City` — replaced by `apps/web/lib/reference/geography.ts`. FK columns elsewhere become validated string columns.
- `TaxJurisdiction` — replaced by `apps/web/lib/reference/tax-jurisdictions.ts`.
- `EaNotation`, `EaElementType`, `EaRelationshipType`, `ViewpointDefinition` — replaced by `apps/web/lib/reference/ea-notation.ts`.
- `TaxonomyNode` (read-only portion) — replaced by `apps/web/lib/reference/taxonomy.ts`. Per-install custom nodes move to a new `TaxonomyExtension` table that holds only the operator's additions.

### 5.2 Tables that become catalog-referenced

These tables stay (they hold per-install state) but their catalog-derived columns are removed. Each row references a catalog entry by stable string key.

- `ModelProvider` — removes `name`, `families`, `category`, `baseUrl`, `endpointType`, `supportsToolUse`, `supportsStreaming`, `supportsStructuredOutput`, `costModel`, `inputPricePerMToken`, `outputPricePerMToken`, `computeWatts`, `electricityRateKwh`, `docsUrl`, `consoleUrl`, `billingLabel`, `costPerformanceNotes`, `catalogVisibility`, `serviceKind`, `authorizeUrl`, `tokenUrl`, `oauthClientId`, `oauthRedirectUri`, `authMethod`, `supportedAuthMethods`, `authHeader`, `sensitivityClearance`, `capabilityTier`, `costBand`, `taskTags`. Keeps `providerId` (FK to catalog), `status`, `enabledFamilies` (operator selection), `lastProbedAt`, `lastProbeOutcome`, runtime observation fields. Operator-mutable fields (`status`, `enabledFamilies`) carry an `operatorMutated` boolean that the reconciliation protocol respects.
- `ModelProfile` — removes `friendlyName`, `summary`, `bestFor`, `avoidFor`, `modelClass`, `inputModalities`, `outputModalities`, `maxContextTokens`, `maxOutputTokens`, all dimension scores (becomes generated from `qualityTier`), `pricing`, `inputPricePerMToken`, `outputPricePerMToken`. Keeps `providerId`, `modelId` (composite FK to catalog `ModelDefinition`), `modelStatus`, `lastSeenAt`, `profileSource`, eval-derived overrides.
- `Agent` — removes catalog-derived fields. Keeps per-install state (created backlog items, recent activity, etc.).
- `MlcServer` (the `McpServer` table) — removes catalog-derived config; keeps operator-set credentials.
- `Portfolio` — removes `name`, `description`. Keeps per-install budget overrides.
- `BusinessModel`, `BusinessModelRole` — remove catalog-derived fields.
- `PlatformRole` — same.
- `WorkQueue` — same.
- `StorefrontArchetype` — same.

### 5.3 New columns

- `qualityTier` on `ModelProfile`: `GENERATED ALWAYS AS (assign_tier_from_model_id(modelId)) STORED`.
- `tierDimensionsBaseline` on `ModelProfile`: a view, not a column — joins against the in-memory tier-baselines table.
- `operatorMutated` on every catalog-referenced table: boolean flag flipped to `true` whenever an operator changes a field through the admin UI. The reconciliation protocol (§7) skips reconciling fields where `operatorMutated = true` for any operator-owned field on the row.
- `catalogVersion` on every catalog-referenced row: the `catalogVersion` of the catalog entry the row was last reconciled against. Used by the reconciliation diff to decide what changed.
- `bootstrapEvent` table (new): one row per bootstrap-time write, capturing what was written, by whom (or "first-run wizard"), at what timestamp, with what config-profile inputs.

### 5.4 New tables

- `CatalogReconciliationLog`: one row per reconciliation pass with summary counts, per-entry decisions, operator review state. See §7.4.
- `CatalogEntryReview`: one row per catalog entry awaiting operator acknowledgment (e.g., field changes the operator-owned policy says require review). See §7.3.
- `TaxonomyExtension`, `PortfolioBudgetOverride`, `PlatformConfigOverride`, `ProviderModelOverride`: per-install operator additions to platform-shipped catalogs. The reconciliation protocol leaves these untouched.

### 5.5 Migration sketch

A representative migration for the `ModelProfile.qualityTier` change:

```sql
-- 20260601_modelprofile_quality_tier_generated.sql

CREATE OR REPLACE FUNCTION assign_tier_from_model_id(model_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  m TEXT := lower(model_id);
BEGIN
  IF m LIKE 'claude-opus-4%' OR m LIKE 'claude-sonnet-4%' OR m LIKE 'gpt-5%'
     OR m LIKE 'o1%' OR m LIKE 'o3%' OR m LIKE 'o4%' THEN
    RETURN 'frontier';
  ELSIF m LIKE 'claude-haiku-4%' OR m LIKE 'gpt-4o' OR m LIKE 'gemini-2.5-pro%' THEN
    RETURN 'strong';
  ELSIF m LIKE 'claude-3-haiku%' OR m LIKE 'gpt-4o-mini%' OR m LIKE 'gemini-2.5-flash%'
     OR m LIKE 'gemini-2.0-flash%' OR m LIKE 'gemma4%' OR m LIKE 'command-r%' THEN
    RETURN 'adequate';
  ELSE
    RETURN 'basic';
  END IF;
END;
$$;

ALTER TABLE "ModelProfile" DROP COLUMN IF EXISTS "qualityTier";
ALTER TABLE "ModelProfile"
  ADD COLUMN "qualityTier" TEXT
    GENERATED ALWAYS AS (assign_tier_from_model_id("modelId")) STORED;

-- The following are dropped in a separate, reversible migration after Phase D:
-- ALTER TABLE "ModelProfile" DROP COLUMN "capabilityTier";
-- ALTER TABLE "ModelProfile" DROP COLUMN "reasoning", DROP COLUMN "codegen", ...;
```

The CI check in Phase D verifies that `assignTierFromModelId(modelId)` (TS) and `assign_tier_from_model_id(model_id)` (SQL) agree on a fixture set of ~50 model IDs. Failing the check blocks the migration from landing.

## 6. Code-Resident Catalog Pattern

The TypeScript shape for catalog modules. Worked example for `ProviderDefinition`; the same pattern applies to all catalogs.

### 6.1 Type discipline

```typescript
// apps/web/lib/types/catalog-base.ts
export interface CatalogEntry {
  readonly catalogId: string;          // stable, never reused
  readonly catalogVersion: string;     // ISO date with revision: "2026-04-28.1"
  readonly status: "shipped" | "preview" | "deprecated";
  readonly deprecatedAt?: string;
  readonly replacedBy?: string;        // catalogId of replacement
  readonly addedIn: string;            // ISO date the entry first shipped
  readonly modifiedIn: string;         // ISO date of last modification
}
```

Every catalog entry extends `CatalogEntry`. The `catalogVersion` field changes whenever any field of the entry changes; this is what the reconciliation protocol (§7) uses to detect updates.

### 6.2 The agent_registry.json conversion

Today's `agent_registry.json` (2388 lines, 47 agents) becomes:

```typescript
// packages/db/src/catalog/agents.ts

import type { AgentDefinition } from "../../apps/web/lib/types/catalog-agent.js";

export const CATALOG_VERSION = "2026-04-28.1";

export const AGENTS: readonly AgentDefinition[] = [
  {
    catalogId: "AGT-ORCH-000",
    catalogVersion: "2026-04-28.1",
    status: "shipped",
    addedIn: "2026-02-28",
    modifiedIn: "2026-04-28",
    name: "coo-orchestrator",
    tier: "orchestrator",
    valueStream: "cross-cutting",
    capabilityDomain: "Strategic alignment, budget authority delegation, ...",
    humanSupervisorId: "HR-000",
    hitlTierDefault: 0,
    delegatesTo: ["AGT-100", "AGT-101", "AGT-102"],
    escalatesTo: "HR-000",
    it4itSections: ["6.1.1 Policy FC", "6.1.2 Strategy FC", "6.2.1 Portfolio Backlog FC"],
    config: {
      modelBinding: { temperature: 0.3, maxTokens: 8192 },     // no model_id pin — feedback_no_provider_pinning
      executionRuntime: { type: "in_process", timeoutSeconds: 300 },
      tokenBudget: { dailyLimit: 500000, perTaskLimit: 50000 },
      memory: { type: "persistent", backend: null },
      concurrencyLimit: 2,
    },
    toolGrants: [
      "registry_read", "backlog_read", "backlog_write", "backlog_triage",
      "build_promote", "decision_record_create", "agent_control_read",
      "role_registry_read", "policy_read", "strategy_read", "budget_read",
      "spec_plan_read",
    ],
  },
  // ... 46 more agents
] as const;

const BY_ID = new Map(AGENTS.map((a) => [a.catalogId, a]));

export function getAgent(catalogId: string): AgentDefinition | undefined {
  return BY_ID.get(catalogId);
}

export function getAllAgents(): readonly AgentDefinition[] {
  return AGENTS;
}
```

The TypeScript type for `AgentDefinition` includes:

```typescript
export type AgentTier = "orchestrator" | "service" | "specialist" | "coworker" | "onboarding";
export type ValueStream = "evaluate" | "explore" | "integrate" | "consume" | "operate" | "cross-cutting";

export interface AgentDefinition extends CatalogEntry {
  readonly name: string;
  readonly tier: AgentTier;
  readonly valueStream: ValueStream;
  readonly capabilityDomain: string;
  readonly humanSupervisorId: string;            // FK to PlatformRole catalog
  readonly hitlTierDefault: 0 | 1 | 2 | 3;
  readonly delegatesTo: readonly string[];       // FKs to other catalog entries
  readonly escalatesTo: string;
  readonly it4itSections: readonly string[];
  readonly config: AgentConfigProfile;
  readonly toolGrants: readonly ToolGrantKey[];  // ToolGrantKey is a union of literals from catalog/tools.ts
}
```

The `ToolGrantKey` type is a union of literal strings exported from `catalog/tools.ts`. Adding a new tool grant requires editing the catalog; using an unrecognized grant key in any catalog entry is a compile error. **This is the structural elimination of Class B drift.**

### 6.3 Runtime access pattern

The runtime imports catalog modules directly. No DB roundtrip.

```typescript
// apps/web/lib/agents/get-agent-definition.ts
import { getAgent } from "@dpf/db/catalog/agents";

export async function loadAgent(catalogId: string): Promise<RuntimeAgent | null> {
  const definition = getAgent(catalogId);                            // synchronous, in-memory
  if (!definition) return null;

  const runtimeRow = await prisma.agent.findUnique({
    where: { catalogId },
    select: { lastActiveAt: true, archivedAt: true, /* per-install state only */ },
  });

  return composeRuntimeAgent(definition, runtimeRow);                // join in code
}
```

The DB query returns only per-install state. The catalog data is in-memory. The compose step is pure TypeScript. No drift surface exists between catalog and per-install fields because they are never both writers to the same column.

## 7. Catalog Reconciliation Protocol

Catalogs evolve. New providers ship, model pricing updates, deprecated agents get marked, new tool grants are added. The platform must apply these updates to running installs without overwriting operator-customized state.

The current seed's `upsert` pattern is structurally wrong: either the `update: {}` arm no-ops on existing rows (silently missing real updates) or the `update: { ...catalogFields }` arm overwrites them (clobbering operator changes). The reconciliation protocol does neither.

### 7.1 Catalog versioning

Every catalog source file declares a `CATALOG_VERSION` at the module level (per §6.1 example). Every catalog entry carries a `catalogVersion` that bumps when the entry changes. The DB's per-install rows carry a `catalogVersion` recording the version of the catalog entry the row was last reconciled against.

The version string format is `YYYY-MM-DD.N` — date plus revision count for that day. This makes lexicographic ordering match temporal ordering and gives multiple reconciliation passes per day a clean discriminator.

### 7.2 Reconciliation outcomes

For each entry in the in-memory catalog at reconciliation time, the protocol computes one of four states relative to the DB:

| State | Detection | Action |
|-------|-----------|--------|
| **New** | catalog has entry, no DB row with matching `catalogId` | Create the per-install row with platform-owned fields populated from catalog; operator-owned fields default to "unconfigured" state. Emit `BootstrapEvent` recording the addition. |
| **Unchanged** | DB row exists, `row.catalogVersion == catalog.catalogVersion` | No-op. Skip the row entirely; do not even read its operator-owned fields. |
| **Modified** | DB row exists, `row.catalogVersion < catalog.catalogVersion` | Compare each platform-owned field; apply changes per the field-governance rules (§7.3). Bump `row.catalogVersion`. |
| **Removed** | DB row exists, no catalog entry with that `catalogId` | If the catalog had the entry as `deprecated` in any prior version, mark the row's `lifecycleState = 'deprecated'` and surface to the admin via `CatalogEntryReview`. If the entry never existed (genuinely orphaned), emit a critical `CatalogReconciliationAnomaly`. |

A separate state — **Replaced** — is computed when an entry is marked `deprecated` with `replacedBy: '<newCatalogId>'`. The protocol creates the new entry's row, marks the old row deprecated, and emits a `CatalogEntryReview` row asking the operator whether to migrate operator-owned state from old to new.

### 7.3 Field-level governance

Every field on a catalog-referenced table is classified as **platform-owned** or **operator-owned**. The classification is part of the schema, encoded by a TypeScript decorator or a column comment that the reconciliation engine reads.

| Field on `ModelProvider` | Owner | Reconciliation behavior |
|--------------------------|-------|------------------------|
| `providerId` (FK to catalog) | platform | Never changes (immutable key). |
| `lifecycleState` (`shipped`/`deprecated`/`retired`) | platform | Updated on reconciliation when catalog status changes. |
| `status` (runtime: active/degraded/etc.) | runtime | Reconciliation never touches; owned by the routing state machine. |
| `enabledFamilies` | operator | Reconciliation never touches. |
| `credentials` | operator | Reconciliation never touches. |
| Catalog-derived fields (name, families, pricing, etc.) | platform-mirrored | Reconciliation overwrites unless `operatorMutated` flag is set on the same row, in which case it surfaces a `CatalogEntryReview` instead. |

The `operatorMutated` flag flips to `true` whenever an admin UI write touches an operator-overridable field. Operator overrides are intentional; the reconciliation protocol respects them but surfaces the divergence so the operator knows the platform's recommendation has shifted.

For a field to be operator-overridable, the schema must declare it so. The default is platform-owned. This means new catalog fields default to "reconciliation overwrites freely" — safe — and graduating a field to operator-overridable is an explicit decision.

### 7.4 Reconciliation pass

A reconciliation pass runs at portal startup and on demand from the admin UI. The algorithm:

```text
function reconcile(catalogModule):
  pass = create CatalogReconciliationLog row { startedAt, catalogVersion, source }
  inTransaction:
    catalogEntries = catalogModule.getAllEntries()
    dbRows = SELECT * FROM <table> WHERE catalogReferenced = true
    catalogIds = set(e.catalogId for e in catalogEntries)
    dbCatalogIds = set(r.catalogId for r in dbRows)

    for entry in catalogEntries:
      dbRow = dbRows.findByCatalogId(entry.catalogId)
      if dbRow == null:
        outcome = createNew(entry)
      elif dbRow.catalogVersion == entry.catalogVersion:
        outcome = unchanged
      else:
        outcome = applyModification(dbRow, entry)
      pass.recordEntryOutcome(entry.catalogId, outcome)

    for dbRow in dbRows where dbRow.catalogId not in catalogIds:
      outcome = handleRemoval(dbRow)
      pass.recordEntryOutcome(dbRow.catalogId, outcome)

    pass.completedAt = now
    pass.summary = { newCount, unchangedCount, modifiedCount, removedCount, reviewCount }
  emit reconciliation_completed event
```

Each pass writes a `CatalogReconciliationLog` row with full per-entry outcomes. The admin UI surfaces unresolved `CatalogEntryReview` rows with accept/reject buttons; until the admin acts on a review, the affected row's operator-owned field is preserved unchanged.

### 7.5 Idempotency and safety

- Re-running reconciliation on an unchanged catalog is a no-op: every entry is `unchanged`, no DB writes occur, no `CatalogEntryReview` rows are created.
- The pass runs in a transaction. A partial failure (DB connection drop mid-pass) rolls back; the install never observes a half-applied reconciliation.
- An exception thrown by the reconciliation engine writes a `CatalogReconciliationAnomaly` row at severity `critical` and surfaces to the operator alarm channel (per the routing spec's §10.5).
- A reconciliation pass is bounded in row count (default: refuse to run if it would create or modify more than 25% of the table's rows in one pass). Catalogs that ship a sweeping change must do it in multiple intermediate releases or override the bound with operator confirmation.
- The reconciliation engine never reads a row to "verify" a stable catalog field. If `row.catalogVersion == catalog.catalogVersion`, the row is correct by construction (the reconciliation engine wrote it that way last time). This rules out a class of bugs where reconciliation "corrects" a row that was changed by some other code path; if such a code path exists, it is itself the bug, and the boot invariant in §8 catches it.

### 7.6 Distinction from runtime state

Reconciliation only touches platform-mirrored fields on catalog-referenced rows. It does not touch:

- `ModelProvider.status` — owned by the routing spec's state machine (§3.3 of the routing spec).
- `ModelProvider.lastProbeOutcome` — owned by the probe daemon.
- `ModelProfile.evalDerivedScores` (when present) — owned by the eval pipeline.
- `Agent.lastActiveAt` — runtime observation.
- Any `CredentialEntry` field — owner-set, never reconciled.

The reconciliation engine has a hard list of tables and columns it is permitted to write. Anything outside the list is structurally inaccessible.

### 7.7 Admin-facing reconciliation surface

A new admin page at `/admin/catalog/reconciliation` shows:

- Last reconciliation pass: timestamp, source (boot / manual / scheduled), summary counts.
- Open `CatalogEntryReview` rows with side-by-side "platform recommends" vs "operator current" diff and accept/reject controls.
- `CatalogReconciliationAnomaly` rows for resolution.
- Per-catalog version history (when did the platform last update this catalog?).
- A "Reconcile now" button that re-runs the pass on demand.

The page is server-rendered. Reuse the routing spec's `RoutingAnomaly` notification channel (§10.5 of the routing spec) for `CatalogReconciliationAnomaly`.

## 8. Boot Invariants

The current seed has two assertions (`assertActiveProvidersHaveClearance`, `assertCoworkerAgentsHaveGrants`). Both stay; the catalog/reconciliation model adds many more, all derived from the type system rather than runtime checks where possible.

Compile-time invariants (TypeScript / CI):

- Every catalog entry is fully-typed; missing required fields fail compilation.
- Every `ToolGrantKey` referenced in `catalog/agents.ts` exists in `catalog/tools.ts`.
- Every `replacedBy` in a deprecated catalog entry points to a real catalog entry.
- Every `humanSupervisorId` on an agent points to a real `PlatformRole.roleId`.
- Every `delegatesTo` / `escalatesTo` on an agent points to a real agent or role.
- The TypeScript `assignTierFromModelId` and the SQL `assign_tier_from_model_id` agree on a fixture set of 50+ model IDs.
- No migration file contains `INSERT`, `UPDATE`, or `DELETE` against application tables (parser-based check).
- No source file outside `packages/db/src/catalog/` and `apps/web/lib/reference/` directly writes to a table column classified as `platform-owned`.

Boot-time invariants (run at portal startup):

- For every catalog table: every per-install row's `catalogId` references a real catalog entry, OR the row is marked `lifecycleState = 'deprecated'` AND a `CatalogEntryReview` exists for it.
- For every catalog table: `row.catalogVersion <= catalog.catalogVersion` (rows can lag, never lead).
- The reference-data tables are gone (drop check — fail loud if a migration accidentally re-introduces them).
- The bootstrap `User` row exists OR the install is in first-run state (the wizard is the only route served).
- The `BootstrapEvent` table contains a `first-admin-created` row OR the install is in first-run state.

Boot fails loud with a clear error message and links to the specific catalog entry, DB row, or reference data file that violated the invariant. This is the structural prevention of the four drift classes named in the constraint document.

## 9. Migration Phases

This is a multi-month migration. Each phase is independently shippable, reversible per phase, and delivers value standalone.

The migration starts with the smallest safest move (introduce the catalog mechanism alongside the seed) and ends with the seed itself deleted. At every phase boundary, the install is in a consistent state and could remain there indefinitely without harm — that is the per-phase reversibility constraint.

### Phase A — Establish the catalog primitives (Weeks 1-2)

- Create `packages/db/src/catalog/` directory with one trivially-small worked example (`catalog/work-queues.ts` is the smallest current seed and a good prototype).
- Define the `CatalogEntry` base interface, the `CATALOG_VERSION` convention.
- Add the reconciliation engine skeleton in `packages/db/src/reconcile/`.
- Add the `CatalogReconciliationLog` and `CatalogEntryReview` tables.
- Add the `operatorMutated` and `catalogVersion` columns to the first catalog-referenced table (also `WorkQueue`).
- Run the reconciliation engine alongside `seedWorkQueues`; verify they produce identical DB state.
- **Phase exit:** the reconciliation engine round-trips one catalog without behavior change. The seed still runs. Reversing the phase is a Prisma migration revert plus a code revert.

### Phase B — Migration discipline tooling (Weeks 2-3)

- Add the migration-content linter (rejects `INSERT`/`UPDATE`/`DELETE` on application tables in migration files).
- Add the "no direct platform-owned column writes outside catalog/" linter.
- Audit existing migrations; quarantine offenders to a `legacy/` subdirectory and document which need backfill scripts. (No deletion yet — just visibility.)
- Add the `BootstrapEvent` table.
- **Phase exit:** every new migration is statically prevented from writing data. The legacy backlog is enumerated. Reversal: revert the linter; legacy migrations untouched.

### Phase C — Move pure catalogs to mechanism 1 (Weeks 3-6)

The "pure catalog" set: catalogs with no operator overrides today, no complicated reconciliation needs, no schema dependencies on other catalogs.

Order (each ships as its own PR):

1. `catalog/feature-degradation.ts` (5 entries, smallest meaningful catalog)
2. `catalog/agent-model-defaults.ts` (17 entries)
3. `catalog/agent-skills.ts` (4 agents × ~4 skills)
4. `catalog/scheduled-tasks.ts` (1 entry, validates the pattern for cron-like data)
5. `catalog/storefront-archetypes.ts`
6. `catalog/business-models.ts`
7. `catalog/portfolios.ts` (introduces the `PortfolioBudgetOverride` operator-extension pattern)
8. `catalog/roles.ts`

Each PR: introduces the catalog module, adds reconciliation for that table, deletes the corresponding `seed*` function. The seed orchestrator's `main()` shrinks by one line per PR.

**Phase exit:** the seed orchestrator is half its current size. Reversal: each PR is independently revertible because each catalog migration includes a re-population path that recreates rows from the catalog module's `getAllEntries()` even after the schema strips fields. (The catalog data exists in code; the DB can always be rebuilt.)

### Phase D — Generated columns and tier consolidation (Weeks 6-8)

- Introduce `assign_tier_from_model_id` as a Postgres function.
- Add the TS-vs-SQL parity test.
- Add `qualityTier` as a generated column on `ModelProfile`.
- Drop the legacy `capabilityTier` column (per the routing spec's §8.1, this is the structural fix for the parallel-vocabulary drift).
- Audit and fix the 2 remaining `capabilityTier` references in routing source per audit finding INV-6b.
- Closes audit findings INV-6 and INV-6b.

**Phase exit:** model tier is unrepresentable in two vocabularies. Reversal: the migration is reversible (re-add `capabilityTier`, recompute from current `qualityTier` mapping) but lossy of the few weeks of intermediate writes; document this.

### Phase E — Migrate the provider catalog (Weeks 8-11)

The big one. `catalog/providers.ts` replaces `seedProviderRegistry` (200 lines) and `data/providers-registry.json`. Discriminated `PricingModel` union eliminates audit finding INV-9 (the `costModel='token'` + `inputPricePerMToken=0` for `anthropic-sub` becomes a compile error).

Sub-phases:

- E.1: Define the `ProviderDefinition` type and populate the catalog from current state.
- E.2: Add reconciliation; verify DB state matches today's seed output.
- E.3: Strip catalog-derived columns from `ModelProvider`; switch all readers to compose from catalog + per-install row in code.
- E.4: Delete `seedProviderRegistry` and `data/providers-registry.json`.
- E.5: Reuse the same pattern for `seedCodexModels`, `seedChatGPTModels`, `seedLocalModels` (which fold into the provider catalog as `ModelDefinition` entries on each provider).

Per-phase reversibility: each sub-phase is its own PR. The schema strip in E.3 is the only irreversible step in this phase (other steps revert cleanly); E.3 is gated on a 2-week soak of E.2.

### Phase F — Migrate the agent catalog (Weeks 11-14)

`catalog/agents.ts` replaces `seedAgents`, `seedCoworkerAgents`, `agent_registry.json`, `HARDCODED_COWORKER_GRANTS`, `ONBOARDING_AGENT_GRANTS`. This is the structural elimination of the four-place data problem named in the constraint document's Class B.

Sub-phases:

- F.1: Define `AgentDefinition` type; populate from `agent_registry.json`.
- F.2: Move `HARDCODED_COWORKER_GRANTS` into the catalog as `toolGrants` on each entry.
- F.3: Move `ONBOARDING_AGENT_GRANTS` into the catalog.
- F.4: Add reconciliation; verify identical DB output.
- F.5: Strip catalog-derived columns; readers compose in code.
- F.6: Delete `seedAgents`, `seedCoworkerAgents`, `agent_registry.json`.

The `assertCoworkerAgentsHaveGrants` invariant becomes a TypeScript compile-time check (every `AgentDefinition` requires a non-empty `toolGrants` array) — runtime assertion stays as defense-in-depth.

### Phase G — Reference data extraction (Weeks 14-17)

Move geography, EA notation, taxonomy, governance/workforce/tax reference data to `apps/web/lib/reference/` per mechanism 3. Drop the corresponding tables. Convert FK columns to validated string columns.

Largest content move; lowest risk per row (these tables are read-only in practice today). Each reference dataset is its own PR.

### Phase H — Interactive bootstrap (Weeks 17-19)

- Build `/setup` first-run wizard.
- Detect empty install (no `User` rows); refuse all other routes until wizard completes.
- Captures admin identity, organization, contribution-mode, provider OAuth.
- Writes via existing validated runtime paths with `BootstrapEvent` audit.
- `seedDefaultAdminUser` deleted; `seedAnthropicSubScope` placeholder write becomes a wizard step.
- Documented "reset to first-run" admin operation for E2E testing.

### Phase I — Delete the seed orchestrator (Weeks 19-22)

- Whatever remains in `seed.ts` after phases C-H is one of: the three legitimate one-time writes (mechanism 6), a reconciliation invocation, or a boot invariant assertion.
- Reorganize the entry point: `packages/db/src/bootstrap.ts` runs the necessary one-time writes; `packages/db/src/reconcile-all.ts` runs the reconciliation passes; `packages/db/src/invariants.ts` runs the assertions. The portal startup composes these explicitly.
- `seed.ts` is deleted. `pnpm --filter @dpf/db exec ts-node src/seed.ts` is replaced by `pnpm --filter @dpf/db exec ts-node src/bootstrap.ts`.
- Document the new model in CLAUDE.md.

**Phase exit:** the platform has no seed-as-data-load step. Catalog updates ship via reconciliation. Operator state ships via the validated runtime path. Reference data ships in the application bundle. The four drift classes from the constraint document have no remaining structural surface to recur on.

### 9.1 Phase sequencing

```text
A → B → C ──┐
    ↓       ↓
    D → E → F → G → H → I
```

A and B are sequential prerequisites; C, D, E, F, G, H can overlap once A and B are done; I closes everything out.

Estimated cadence: 14-22 weeks of focused work. Honest range: 18-26 weeks with normal interruptions. The constraint document's Class A pattern ("ship a partial fix, regression in 1-3 weeks") is what makes this estimate harder to compress — every phase is reversible per phase precisely because the prior pattern was to ship halfway and leak the rest. This migration plan refuses that shape.

### 9.2 Migration of existing seed-corrupted installs

An install today has DB rows containing whatever the most recent seed pass wrote. Some of those values are stale (Phase D's `capabilityTier` rows), some are wrong-shape (Phase E's `costModel='token' price=0` for subscriptions), some are duplicate-of-truth (Phase F's three-place agent grants).

Each phase's migration includes a one-shot conversion script that:

1. Reads the seed-corrupted state.
2. Computes what the catalog says it should be.
3. For each row: if `operatorMutated == false` (or the field has never been touched outside the seed), apply the catalog value silently; if `operatorMutated == true`, create a `CatalogEntryReview` for operator decision.
4. Logs every row touched to `BootstrapEvent` with `source: 'phase-N-migration'`.

The script is idempotent: re-running it on a converted install is a no-op. It also runs in dry-run mode by default; the operator must explicitly confirm to apply.

For installs that are unwilling to migrate, each phase ships behind a feature flag (`SEED_LEGACY_MODE=true`) that keeps the old seed function active and skips the catalog reconciliation for that table. This lets installs stage their conversion across releases. The flag is removed in Phase I; by then, every install is expected to have completed the per-phase migration.

## 10. Failure Modes

The honest list of what's worse with this approach.

### 10.1 Cache regeneration cost on boot

The reference-data and catalog modules (mechanism 3 and the in-memory side of mechanism 1) load at portal startup. Current rough sizing: ~5 MB serialized JSON across countries, EA notations, taxonomy, tax jurisdictions; another ~1 MB across catalog modules. Parsing and freezing this at startup adds a one-time ~100ms (estimate; benchmark in Phase A).

For long-running portal containers this is irrelevant. For dev workflows that restart the portal frequently, it's a tax. Mitigation: the typed modules import as `JSON modules` so the bundler can tree-shake and pre-parse. Reference data is loaded lazily on first access for datasets that aren't routinely needed (e.g., `getCityByName('Tulsa')` doesn't load the EA notation).

If the in-memory dataset later grows past hundreds of MB, the answer is fit-for-purpose stores (search index, embedded SQLite) — not "put it back in Postgres." Postgres for reference data is what got the platform here.

### 10.2 Joining against in-memory data costs more code

A query today: `prisma.modelProfile.findMany({ include: { provider: true } })`. After Phase E: `prisma.modelProfile.findMany()` then `compose(profiles, getAllProviders())` in TypeScript. The compose step is ~5 lines per query path; the codebase has ~50 such paths.

This is real code-volume cost. The win is that the compose step is testable in pure TypeScript without a DB, and the result is type-safe in a way Prisma's `include` arms (which sometimes return `null` for outer-join misses) are not. Net: more code, more type safety, faster tests.

### 10.3 The genuine bootstrap problem

Postgres needs a first `User` row before the admin UI can be logged into. The `User`-write happens before the admin can authorize it. Three honest options:

1. **The wizard route is unauthenticated** when no `User` row exists (the install is by definition not yet secured). The wizard captures admin email + password, writes the `User` row, then the wizard route immediately disables itself. This is the proposed approach.
2. **A bootstrap token** generated at deploy time and written to a file readable only by the operator (analogous to the Jellyfin / various-self-hosted-app pattern). Operator pastes the token into the wizard's first screen.
3. **A bootstrap CLI command** that creates the first user and prints a one-time login URL.

Option 1 is simplest and matches the platform's existing posture (the install is the operator's; the operator is on the network with it). Option 2 is more secure for installs exposed to the internet at first boot. The wizard supports both via configuration.

### 10.4 Backup / restore implications

Today's `pg_dump` captures everything including catalog mirrors. After this migration, `pg_dump` captures only per-install state. A backup restored on a different platform version will reconcile against that version's catalog at boot — meaning the operator's data lands in a coherent state with whatever catalog version it's restored on.

This is *better* than today's situation, where a backup contains stale catalog snapshots that may diverge from the running platform's catalog. But it's a behavior change operators must understand: catalog state is not in the backup; it's in the running platform's bundle.

### 10.5 Reconciliation conflicts when multiple catalog versions ship in quick succession

If catalog versions `2026-04-28.1` and `2026-04-28.2` ship within hours and an install upgrades through both, the reconciliation engine sees `row.catalogVersion < entry.catalogVersion` and applies the latest. No problem.

But: if a catalog entry's *meaning* changes between versions (e.g., a tier name is reused for a different concept), the reconciliation engine cannot know. This is why §6.1 mandates immutable `catalogId` strings — never reuse a key for a different concept. A renamed concept gets a new `catalogId` and the old one is marked deprecated. The CI check enforces "no `catalogId` is ever removed without being marked deprecated first."

### 10.6 The cases where seed-shaped writes survive

Three writes survive scrutiny:

- **`ensureBootstrapOrganization`**: a placeholder `Organization` row exists in `unconfigured` state so downstream FKs can link. Renamed in place by the wizard. The bootstrap-state row is itself a permanent feature, just with the right name eventually.
- **`seedDpfSelfRegistration`**: the platform's representation of itself as a digital product. Unique per install (orgId varies); the catalog says the platform should self-register but the row carries the per-install orgId.
- **`seedClientIdentity`**: the pseudonymous identity for hive contributions, generated per install. Already correct shape today.

All three are first-boot-only writes that read state and write only if absent. None of them update existing rows. They are mechanism 6, the legitimate residue. The CI invariant "no platform-owned column writes outside catalog/" carves out these three named bootstrap functions explicitly.

### 10.7 What if reconciliation itself has a bug?

The reconciliation engine is the new most-important piece of code, replacing the seed's accumulated 30+ functions with one engine. Mitigations:

- Property-test the engine across the four outcome states with synthetic catalogs and DB states.
- Dry-run mode is the default; production deployments confirm with an explicit flag.
- The 25%-of-table cap (§7.5) prevents catastrophic reconciliation passes.
- Every reconciliation pass writes a full audit trail; reversing a bad pass is a matter of reading the audit trail and applying the inverse.
- The boot invariant (§8) catches the case where reconciliation produces an inconsistent state.

### 10.8 What if the catalog ships a malformed entry?

A catalog entry that fails type-checking can't ship — TypeScript blocks it at compile. A catalog entry that type-checks but is semantically wrong (a deprecated entry pointing to a `replacedBy` that doesn't exist) is caught by the boot invariants (§8). A catalog entry that type-checks, satisfies invariants, and is semantically wrong in ways the platform can't detect (a wrong pricing value) ships and gets noticed when the cost ledger surfaces the discrepancy — same as today, except the fix is a one-line catalog change shipped through PR review instead of a manual SQL update on every install.

## 11. What This Spec Is NOT

- **Not a replacement for the routing-control-plane spec.** The routing spec ([2026-04-27-routing-control-data-plane-design.md](./2026-04-27-routing-control-data-plane-design.md)) defines how runtime routing decisions are made. This spec defines how the catalog feeding those decisions is shaped. They compose; neither replaces the other.
- **Not a replacement for the artifact-provenance spec.** That concern (tool-call receipts, fakery prevention) lives at a different layer and is deferred per the routing spec's §9.1.
- **Not a replacement for capability-derived grants.** That concern (replacing static role-pinned grants with dynamic capability-matching) is deferred per the routing spec's §9.2. This spec's catalog mechanism makes capability-derived grants *easier* to implement later (the catalog defines required capabilities; the derivation produces the grants) but does not implement them.
- **Not a refactor.** No code changes ship in the same PR as this spec. The PR is the spec only. Phase A-I implementations ship as separate PRs over the multi-month migration.
- **Not opinionated about which UI framework the wizard uses.** The wizard is a Next.js route in the existing `apps/web/`; the framework choice is the platform's existing one.
- **Not an attempt to make catalog updates instantaneous across installs.** Installs reconcile at their own boot cadence and on operator demand. The platform team ships catalogs with the application bundle; installs adopt the catalog when they upgrade. No central "push catalog to all installs" mechanism is proposed.
- **Not a repudiation of Prisma.** Prisma remains the ORM. Catalog data living in TypeScript modules joined against Prisma queries in code is fully compatible with Prisma; many production systems use Prisma exactly this way.

## 12. Cross-references

This spec sits beneath the routing control-plane spec and references the constraint document for its motivation. The companion documents must be updated to acknowledge this layer:

- **[2026-04-27-routing-control-data-plane-design.md](./2026-04-27-routing-control-data-plane-design.md)** — §3.1 "Catalog: read-mostly, hand-maintained provider declarations from the seed" should be updated after this spec lands to read "Catalog: read-mostly, code-resident provider declarations per the eliminate-seed-as-data-load substrate spec." The §8.1 boot invariants become a subset of §8 here.
- **[2026-04-27-routing-substrate-attempt-history.md](./2026-04-27-routing-substrate-attempt-history.md)** — the constraint document. Add an entry for "Attempt #11.5 (substrate): eliminate the seed as a data-load step" with the architectural argument that this substrate is a structural prevention of all four failure classes, not just the routing instances. The four failure classes' "Past fixes" rows should reference this spec as the structural fix.
- **[2026-04-27-routing-spec-boot-invariants.md](../audits/2026-04-27-routing-spec-boot-invariants.md)** — the audit. Findings INV-6, INV-6b, INV-9 are addressed by Phases D and E of this spec; cross-link.
- **CLAUDE.md** — the seed/runtime drift entries in the project memory link to this spec as the architectural answer.

The cross-reference updates ride the same PR that lands this spec, OR they ride a follow-up PR within the same week. The update is small (one paragraph per document).

---

**Disposition:** This spec sits for review. No implementation begins until the spec has been read by Mark and any other stakeholders, the gap analysis against the constraint document's eight constraints has been verified by an independent pass (a separate session reading both documents end-to-end), and the migration plan's phase boundaries have been independently sanity-checked. The constraint document explicitly names "session shows up energized, ships symptomatic patch, frames as architectural" as the failure mode of attempts 1-10; the antidote is to slow down before phase A starts, not after.
