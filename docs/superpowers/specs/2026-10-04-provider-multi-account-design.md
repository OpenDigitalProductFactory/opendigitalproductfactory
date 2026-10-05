# Multiple provider accounts and compact provider management

Status: operator-approved direction; independent source review pending. Backlog: BI-71ABBD95. Epic: EP-D38F463C.

## Objectives

**OBJ-ACCOUNTS:** Use multiple independently authenticated accounts of one provider concurrently for coding and non-coding work.

**OBJ-ROUTING:** Choose an eligible account and model together without compromising data suitability or duplicating capacity.

**OBJ-UX:** Show pertinent facts densely and preserve every existing function through progressive disclosure.

**OBJ-CONVERGENCE:** Migrate existing installs safely while reducing singleton assumptions and duplicated read models.

## Design grounding

Extend existing AiProviderConnection, not a parallel account registry. Its credentialEntryId, financeProfileId, supplierContractId, capacityStatusId and trustEvidence already establish the ownership boundaries. ModelProvider remains catalog metadata. CredentialEntry.providerId, ProviderCapacityStatus.providerId and CliPoolStatus.adapterType currently impose singleton constraints that prevent account isolation. Existing default connections use provider-default-<providerId>.

Reviewed substrate: packages/db/prisma/schema/ai-providers.prisma; packages/db/prisma/schema/integrations.prisma; apps/web/lib/inference/ai-provider-data.ts and ai-provider-internals.ts; apps/web/lib/routing/provider-suitability/compile.ts; provider-routing-eligibility.ts; provider-capacity/store.ts; cli-pool-status.ts; weekly-quota.ts; provider and provider-detail routes under apps/web/app/(shell)/platform/ai/providers; report-kit; portal-navigation-model.ts.

This extends the existing [suitability design](2026-07-19-ai-provider-suitability-routing-design.md), [capacity recovery](2026-06-29-provider-capacity-recovery-design.md), [finance bridge](2026-04-23-ai-provider-finance-bridge-design.md) and [CLI adapter design](2026-04-29-cli-execution-adapter-routing-design.md). Runtime Health and Readiness retain their cross-system purposes and reuse the shared account projection. No additional gateway service or dependency.

## Research & Benchmarking

Research completed during the approved proposal; recheck API details during implementation.

| Comparator | Data/contract pattern | Adopt | Reject |
| --- | --- | --- | --- |
| [CLIProxyAPI auth types](https://github.com/router-for-me/CLIProxyAPI/blob/main/sdk/cliproxy/auth/types.go) | Auth ID, provider, label, disabled/unavailable and per-auth quota/model state | Distinct connection identity and independent lifecycle/capacity facts | Importing its gateway or assuming subscription access supports every execution channel |
| [LiteLLM router types](https://raw.githubusercontent.com/BerriAI/litellm/main/litellm/types/router.py) and [routing](https://docs.litellm.ai/docs/routing) | Deployment identity plus model information, cooldown and affinity | Account/model candidate, scoped cooldown and soft continuity | Independent load-balancer policy that bypasses DPF suitability |
| [Portkey load balancing](https://portkey.ai/docs/product/ai-gateway/load-balancing) | Weighted target configurations | Explicit target ownership and explainable selection | Static weights as the sole account decision |
| [OpenRouter provider selection](https://openrouter.ai/docs/guides/routing/provider-selection) | Provider filtering and routing constraints | Filter before ranking | Treating aggregator choice as proof of underlying supplier/region compliance |

Follow the existing DPF data-classification vocabulary and credential encryption boundary. Authentication isolation follows OAuth client/account scoping; authorization identity remains existing Principal/Organization. An account connection is resource access, not a new person/principal registry.

## Account and execution contract

Every executable candidate carries connectionId, providerId, modelId and executionChannel. Credential resolution, OAuth state/callback, refresh cache, discovery, reconnect/disable and diagnostics accept explicit connection identity. Provider-only callers resolve the legacy default connection during migration; ambiguous multi-account lookup must not silently choose the first credential. Inventory every provider-keyed reader/writer and migrate or document its compatibility boundary.

Keep catalog pricing/profiles provider/model scoped; purchased entitlement, account evidence, actual usage attribution and connection overrides belong to the connection. Finance facts keep their supplier/contract provenance; shared billing agreements may be referenced by multiple connections without duplicating commitments.

Account capacity and upstream shared capacity are distinct. Reuse/refactor the capacity substrate to represent the actual upstream quota owner explicitly. Keys or OAuth grants for one upstream account share one quota pool; two genuinely independent accounts may have separate pools. Unknown pool identity is conservative and visibly uncertain. Do not display invented quota percentages: distinguish reported, estimated and unavailable with observed/reset timestamps. Provider-wide outages remain provider scoped.

CLI accounts require isolated supported authentication homes/profile selection in the execution adapter. Never swap global CLI credentials during active work. A channel without verified account isolation advertises that limitation and cannot pretend the second account is executable. Test simultaneous jobs under distinct identities and redacted telemetry. API success does not prove CLI isolation.

## Selection and continuity

Evaluate data sensitivity, workload scope, commercial/contract evidence, region/residency, model access, context/output limits, tools and required capabilities before ranking available capacity and budget. Reuse provider-suitability compilation with account facts. Declarations are not reviewed evidence. Data clearance is a dedicated prominent summary, independent of connection state and quota.

Balance independent work across eligible accounts. Current task affinity is a preference only while the candidate remains eligible. Recheck on retries and handoff; preserve task state and already-completed external actions. Do not retry ambiguous side effects or resume a CLI task under a different identity without a safe adapter checkpoint. No hard provider/model pins.

Persist selected connection and quota-pool attribution with existing attempt/usage evidence. Logs expose masked identity and reasons, never secrets. Governing surface actions re-enter existing governedExecuteTool contracts; browser and coworker projections share the same account read model and authority checks.

## Compact overview and setup

Use data-dpf-density="compact" and shared report-kit primitives. Essential columns: provider/account, connection state, Data clearance + workload scope, accessible models/capabilities, capacity/reset, actions. Warnings needing action remain visible when details are collapsed. Explicit labels distinguish used from remaining quota; never infer semantics from a progress bar alone.

Default overview contains Local and configured connections, including disabled, disconnected, exhausted and waiting ones. Unconfigured catalog appears through visible Add provider, searchable by name/channel/capability. Initial install shows all choices in the setup surface. Complete with Local only persists setup completion separately from remote-account count; deleting the last remote account does not reopen onboarding. Reuse the existing install/setup persistence owner, not ad hoc localStorage.

Add account preselects its provider. Provider detail supports account selection without losing existing deep links: legacy links open default account. Native disclosure groups expose connection/access, models/execution, usage/billing and diagnostics/history. Focus restoration, keyboard expansion, descriptive counts and narrow layouts are required. Prefer in-row expansion for quick review; full account detail remains available for substantial edits.

## Information and functionality preservation map

| Existing surface/function | Default destination | Disclosure destination / required behavior |
| --- | --- | --- |
| Suitability headline, recommendation, blocked reason, next action | Overview summary and visible account warning | Full ProviderSuitabilityGuide: why, mayLeave/staysControlled/blocked, workload classes, useNow/useAfterReview/notForWork, evidence expiration/drift and specialist confirmation |
| Provider identity, auth status and OAuth failures | Account row with reconnect action | Connection & access: ProviderDetailForm, OAuthConnectionStatus, OAuthPortMismatchBanner, auth method/config, docs/console links |
| AccountClass, no-training, regions and aggregator restrictions | Data clearance/workload summary, restrictions visible | ProviderAccountPostureForm, ProviderTrustEvidencePanel, ProviderClearanceOverridePanel; preserve zero retention, regional processing and approved underlying providers |
| Model access and capability summary | Models count and salient required capabilities | Models & execution: all ModelCard dimensions, tool/thinking/vision/structured output/code execution, context/output limits, provenance, score freshness/confidence, discovery/profiling and restrictions |
| Local hardware, model install/manage and health | Local row and actionable health | OllamaManagement and local hardware details, endpoint configuration and model controls |
| Quota windows, weekly usage, cooldown, reset and exhaustion | Capacity cell and action warning | CliPoolStatusPanel/account equivalent, weekly-quota observations, refresh/reprobe with truthful timestamps and source |
| Price/cost and commercial posture | Concise cost/billing summary where relevant | Usage & billing: ProviderCostSourcePanel's five distinct sources/provenance, AiProviderFinancePanel supplier/contract/cadence/payment/commitment/currency/coverage/bills/snapshots/open work, TokenSpendPanel and account attribution |
| Endpoint performance and routing explanation | Actionable failures visible | Diagnostics & history: EndpointPerformancePanel, RouteDecisionLog, recent decisions and account selection reason |
| Recipes and cost/performance notes | Relevant summary/link | Models & execution retains RecipePanel and notes |
| Agent budgets/rejections and local-only policy | Global constraint summary, blocked reason | Advanced routing operations retains AgentBudgetEventsPanel and LocalOnlyInferenceToggle |
| Scheduled maintenance/discovery/reconciliation | Actionable job failures visible | ScheduledJobsTable and maintenance controls |
| Detected services, catalog source/time and coworker help | DetectedServicesBanner when actionable; help entry | ProviderCatalogStatus and AskCoworker remain reachable; Tools & Services is a concise link, not a permanent large migration notice |
| Phase/model-selection resolver guidance | Visible when launched for a blocked phase | Preserve candidate badges and return to the originating phase |
| Readiness, Runtime Health and MCP services | Existing navigation with account-aware facts | Keep service-specific forms/actions; account pooling must not accidentally convert MCP services into LLM accounts |

Before removing any component, enumerate its fields, actions, warnings and permissions into a source-backed preservation test matrix. A disclosure with only a label is not preservation. Record old route to new destination and test deep links, read-only principals and action rights. Completion is blocked by any unmapped item.

## Acceptance

| ID | Objective | Statement |
| --- | --- | --- |
| AC-IDENTITY | OBJ-ACCOUNTS | Two accounts for one provider maintain independent credentials, refresh, discovery, enable/reconnect lifecycle and execution identity under concurrent work. |
| AC-QUOTA | OBJ-ROUTING | Shared upstream accounts share one capacity budget; rate limits/auth failures affect only their actual scope. Unknown quota is shown as unknown. |
| AC-SUITABILITY | OBJ-ROUTING | Sensitivity/workload/model capability/region/evidence gates precede quota/cost selection, and the explanation names the selected account and rejected constraints. |
| AC-CONTINUITY | OBJ-ROUTING | Soft affinity, checkpointed handoff and attempt history preserve completed actions without duplicating external side effects. |
| AC-DISCLOSURE | OBJ-UX | Compact configured-only overview, visible Add provider/Add account and initial setup/local-only completion work with keyboard and narrow/light/dark layouts. |
| AC-PRESERVATION | OBJ-UX | Every field/action/warning in the preservation inventory remains reachable with correct permission and deep-link behavior; critical warnings and Data clearance remain prominent. |
| AC-MIGRATION | OBJ-CONVERGENCE | Existing credentials/default connections and finance/evidence links survive idempotent expand/backfill migration; no secret is returned to clients or logs. |
| AC-REFACTOR | OBJ-CONVERGENCE | Provider/account singleton assumptions are replaced by one account selection/read-model contract shared across browser, routing and coworker surfaces. |

## Delivery boundaries and verification

1. Account identity/authentication foundation: expand/backfill schema, default compatibility, connection credential/OAuth/discovery actions, account-aware finance/usage ownership. Independently testable before enabling pooled dispatch.
2. Account capacity and execution routing: pool identity, API/CLI isolation, suitability candidate compilation, affinity and durable attempt attribution; depends on foundation.
3. Compact account UX and progressive disclosure: shared account projection, catalog/setup flow, component consolidation and exhaustive preservation matrix; depends on foundation and routing for complete live facts.

Each has a live child BI before implementation, its own source branch/PR and affected unit/typecheck gates. Use governed shared local-CI for migrations, simultaneous execution and served UX. Migration fixtures include partial/default/orphaned existing rows and retries. Negative tests include cross-account OAuth callback/refresh mixups, shared-key quota duplication, expired evidence and insufficient capability. Validate keyboard/light/dark/narrow views and measured UX-fit evidence. Do not claim prototype checks as served production verification.

## Risks, deployment and rollback

Largest risk: a provider-keyed compatibility caller silently selects another account or globally disables healthy ones. Inventory callers and reject ambiguity. CLI isolation is channel-specific and must be proven. Contract/evidence must never leak from one connection to another.

Use additive expand/backfill first; no destructive credential migration. Retain default identity and old reads until all callers migrate. Roll back code to default-account selection while preserving new rows; disabling extra accounts is reversible. A release unable to read added accounts must not overwrite them. Schema contraction only after fleet compatibility is proven.

Review [deployment contracts](2026-05-09-deployment-contracts.md) for public MCP/authorized surface response compatibility, secret resolution and configuration convergence. Live advances use the existing self-upgrade path. Source worktrees are not runtimes. Existing Organization/Principal, typed enums, data classification/retention and data-impact manifests apply; schema steward reviews pool/usage relationships before migration. No new host-coupled runtime or service.
