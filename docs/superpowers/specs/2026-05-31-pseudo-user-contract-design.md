# Spec: Pseudo-User Contract for AI Coworkers

**Date:** 2026-05-31
**Status:** Draft (founder review)
**Surface:** Platform-wide coworker substrate; Build Studio is the first-mile vertical
**Linked epic:** `EP-COWORKER-INTERACTIVITY` — *Pseudo-User Contract — coworker drives the screen with symmetric authority + audit* (filed 2026-05-31, priority 2)
**Linked backlog items:** 9 BIs filed 2026-05-31 (5 Phase 1 substrate + 4 Phase 2 Build Studio vertical) — see §16 Phased Rollout for the semantic→cuid mapping table.
**Kernel principles invoked:** `architecture-over-shortcuts`, `single-source-of-truth`, `governance-approves-evidence-not-provenance`, `state-results-directly`, `never-fabricate`, `principal-convergence`

> **2026-08-08 architecture note:** The delegation, dual-principal authority, governed-envelope, and audit decisions remain authoritative. The browser-shaped `ScreenManifest` is no longer the canonical interface: [`2026-08-08-authorized-surface-contract-design.md`](2026-08-08-authorized-surface-contract-design.md) makes it a compatibility projection of the render-independent Authorized Surface Contract.

---

## 1. Context

The user instructs an in-portal AI coworker ("Software Engineer", `AGT-BUILD-SE`) to advance a Build Studio build through its phase pipeline. The coworker has full conversational context, knows the build is selected on screen, knows the next correct phase action — and stalls. Three turns of dialog later it correctly self-reports: the build-action tools (`record_execution_evidence`, `update_backlog_item_status`, `save_build_notes`, `approve_decomposition`, `promote_to_build_studio`, `saveBuildEvidence`) are silently absent from its tool set, and it has no way to drive the screen selection back to a different build.

Root-cause audit (recorded 2026-05-31) identified **three concrete plumbing gaps**:

1. **Grant starvation.** `AGT-BUILD-SE` in [`packages/db/data/agent_registry.json:2361-2395`](packages/db/data/agent_registry.json) holds only `sandbox_execute`, `work_capsule_read`, `work_capsule_write`, `work_capsule_adopt`. Every build-phase mutation tool requires `backlog_write` or `build_promote`, both denied at the intersection in [`apps/web/lib/agent-grants.ts`](apps/web/lib/agent-grants.ts). Tool invocations fail silently to the user; the coworker sees the deny and reports it correctly, but the user reads it as "the AI is making excuses."
2. **No screen-action surface.** The reverse SSE channel from server → client at [`AgentCoworkerPanel.tsx:359-367`](apps/web/components/agent/AgentCoworkerPanel.tsx) relays a closed enum (`phase:change | evidence:update | sandbox:ready | orchestrator:* | done`). There is no `select_entity`, `navigate`, `focus_field`, `open_panel`, or `submit_form` verb anywhere in `PLATFORM_TOOLS`. The coworker cannot change what the user is looking at, even though the React state machine that would honour such commands ([`BuildStudio.tsx:199-212`](apps/web/components/build/BuildStudio.tsx)) already exists.
3. **No `reopen_feature_build` tool.** `FeatureBuild.abandonedAt` is set (e.g. from `emit-ring-2-3.ts:67`) but never cleared by any MCP tool. Once a build is abandoned, it is unrecoverable from either chat or UI without direct DB intervention.

Each gap is small. Together they make the coworker functionally useless against the screen it is embedded in. The user named the broader pattern: **"the AI coworker should be able to manipulate the screen we are on directly on behalf of the user when asked."** This spec formalizes that as a platform contract called the **Pseudo-User Contract**.

The contract is platform-wide. Build Studio is the first vertical because the user's goal — "go non-stop, using our own hardware and LLM, accelerate to a self-evolving process" — is gated on Build Studio's coworker fleet being able to drive itself through the build lifecycle with the same affordances a human operator has.

## 2. Problem statement

A DPF coworker is conceptually a *delegated principal*: it acts on behalf of the user, within the user's authorization scope, while preserving an independent audit identity (`Principal` + `PrincipalAlias` per AGENTS.md §11). The platform's current substrate honours the first half (independent identity, independent grants, independent audit) but breaks the second half:

- The coworker's **grant set is narrower than the user's** for no architecturally-defended reason — it's an artifact of when each role was scaffolded, not a deliberate boundary.
- The coworker's **action vocabulary is narrower than the user's** — domain tools exist but view commands don't.
- The coworker's **state visibility is partial** — `buildId` is plumbed, but the broader page state (selected panel, focused field, expanded rows, modal open) is not.
- When grants or vocabulary are missing, **failure mode is silent**: the coworker hits a deny or an absence, reports it correctly to the user, and the user reads it as evasion.

The contract closes these four with explicit invariants and the substrate to enforce them.

## 3. Goals

**G1 — Co-presence.** A coworker sees what the user sees: route, selected entity, focused field, open panels, current scroll target. This is read-only context, refreshed each turn.

**G2 — Co-equal verbs.** Any UI action the user can perform on the current screen, the coworker can perform — subject to the same authorization checks the user is subject to, no narrower. Grant intersection trims by *capability*, not by *kind* of action (domain vs view).

**G3 — Bidirectional channel.** The coworker can drive the screen — change selection, navigate, open panels, focus fields, pre-fill forms, propose submissions. The user sees every screen action as it lands and can interrupt.

**G4 — Loud failure.** When a coworker hits a grant deny, a missing tool, or an impossible state (e.g. abandoned build), the failure surfaces structurally to the user with the specific remediation, not as a chat sentence the user has to parse. Silent denies are an architecture defect.

**G5 — Audit symmetry.** Every coworker screen action writes to the same audit trail as user actions, plus the delegating user, the coworker principal, and the chat turn id. `/platform/ai/authority` is the single review surface.

**G6 — Extractable pattern.** The contract is implemented as a platform substrate, not in Build Studio. Storefront, Admin, Platform, and future verticals get the same affordances without re-implementation. The Build Studio first-mile is exemplar, not bespoke.

**G7 — Self-evolving discovery.** When a coworker hits a capability gap (missing tool, insufficient grant, missing screen action), it files a `submit_coworker_capability_need` automatically with the precise verb signature it expected. Capability gaps are first-class backlog input.

## 4. Non-goals

- **NG1.** Pixel-based computer-use control of the DPF web UI. We own the DOM and the action surface; a typed contract is strictly better than pixel-level automation for the surfaces we render. Computer-use remains the fallback for native applications outside the platform.
- **NG2.** Cross-tenant action. A coworker only ever acts within the user's tenant and current session scope.
- **NG3.** Background-only coworker drive. The contract applies when there is an active chat thread. Headless coworkers continue to act via MCP without the screen-action surface (they have no screen).
- **NG4.** Hot-patching old coworker definitions in production at deploy time. Migrations are explicit, capability-gap-driven.
- **NG5.** Replacing the existing MCP tool registry. View commands extend the registry; domain tools are unchanged.

## 5. Principles

**P1 — Coworker as delegated principal, never as impersonator.** Every action is recorded under the coworker's `Principal` with a `delegating_user_id` attribution. Audit shows both. Grant resolution checks the coworker's grants AND the delegating user's capabilities; the more restrictive wins, but neither set is bypassed.

**P2 — Domain actions and view commands are distinct tool classes with shared infrastructure.** Domain actions mutate persistent state (DB, work capsule, repo). View commands mutate ephemeral UI state (selection, focus, scroll). They share the tool registry, audit pipeline, and grant intersection — but the safety model differs (see P6).

**P3 — Declarative screen manifests.** Each screen registers a `ScreenManifest` enumerating what selections, navigations, actions, and forms it supports. The coworker discovers the manifest via `screen_describe()`, not by hallucinating. The manifest is the single source of truth for what the screen can do; if the manifest doesn't list it, the coworker doesn't try.

**P4 — Silent denies are bugs.** A tool that is gated by grant returns `insufficient_token_scope` with the missing grant name when called, not a tool-not-found. A tool that is missing from a manifest returns `screen_capability_missing` with the proposed verb signature. Both are visible to the user as structured notices, not buried as chat lines.

**P5 — Destructive actions require explicit envelope.** Domain writes, form submits, navigation that loses unsaved work, and any irreversible operation are wrapped in a confirmation envelope unless the user has elevated the coworker for the current turn. Elevation is per-turn, not per-session.

**P6 — User attention is the safety wire.** When the user is actively typing or focused on a field, the coworker may not steal focus. When the user navigates away, the coworker's in-flight screen actions are cancelled. The active human always wins.

**P7 — Single source of truth for screen state.** Selection, route, and focus live in one place per screen (URL + page-state-store), not duplicated across components. The manifest reads from this store; view commands write to it; the React tree subscribes. No second representation in chat-context that can drift.

**P8 — Live state, not seed state.** Coworker screen-context resolution queries live page-state every turn — never cached, never inferred from prior turn. Stale context is a silent corruption source.

## 6. Design — The Five Surfaces

### 6.1 Screen Manifest (declarative)

Every routable surface (page or substantive sub-view) exports a `ScreenManifest`:

```ts
// apps/web/lib/coworker/screen-manifest.ts
export interface ScreenManifest {
  surfaceId: string;                    // "build-studio", "storefront-products", etc.
  routePattern: string;                 // "/build", "/storefront/products/:id"
  selections: SelectionDescriptor[];    // what can be "selected" on this screen
  navigations: NavigationDescriptor[];  // where this screen can route to
  panels: PanelDescriptor[];            // collapsible/openable panels
  forms: FormDescriptor[];              // forms a coworker may pre-fill or submit
  domainActions: DomainActionRef[];     // references to MCP tools meaningful here
  destructiveActions: string[];         // subset of the above that require envelope
}

export interface SelectionDescriptor {
  selectionId: string;                  // "build", "panel-tab", "row"
  entityType: string;                   // "FeatureBuild", "BacklogItem"
  listSource: () => Promise<EntityRef[]>; // how the coworker enumerates options
  applySelection: (entityId: string) => void; // page-side handler
}

export interface FormDescriptor {
  formId: string;
  fields: FieldDescriptor[];
  submit: { tool: string; argMap: Record<string, string> };
  destructive: boolean;
}
```

Manifest registration is a single hook in the page component:

```tsx
// apps/web/app/(shell)/build/page.tsx
useScreenManifest(BUILD_STUDIO_MANIFEST);
```

The hook publishes the manifest to a process-local registry keyed by `routeContext` — the same string the chat send already carries (see prior audit). The chat handler at [`agent-coworker.ts`](apps/web/lib/actions/agent-coworker.ts) reads the manifest for the current `routeContext` and injects a compact descriptor into the prompt context envelope.

Manifests are **typed and lint-checkable**. CI enforcement runs two checks:

1. **Static manifest lint** (`pnpm --filter web exec tsx scripts/lint-screen-manifests.ts`, new). Imports every `*.manifest.ts` file, walks each manifest's `domainActions[].tool` and `forms[].submit.tool`, and fails if any referenced tool name is absent from the live `PLATFORM_TOOLS` registry. No DB access required — both the manifest and `PLATFORM_TOOLS` are TypeScript modules, so the lint round-trips entirely in the type system. (Resolves Suspicion C in the prior draft.)
2. **Vitest jsdom smoke-render**, **not Storybook**. The DPF monorepo does not have Storybook configured (verified 2026-05-31 — no `.storybook/` directory, no `@storybook/*` dependency in `apps/web/package.json`). The smoke check renders each page that calls `useScreenManifest` under jsdom and asserts that every `selections[].applySelection`, `panels[].open/close`, and `forms[].fields[].set` handler is a callable function on the resulting page tree. Vitest jsdom is already the test runtime per AGENTS.md §5 (`npx vitest run`), so no new test infrastructure is required.

### 6.2 View Command tool family (`screen_*`)

A new tool family extends `PLATFORM_TOOLS`.

**Naming.** The MCP spec ([SEP-986](https://modelcontextprotocol.io/seps/986-specify-format-for-tool-names)) defines the recommended tool-name charset as `[A-Za-z0-9_.\-\/]`, but several MCP clients (Cursor among them — see [forum thread](https://forum.cursor.com/t/cursor-incorrectly-filters-out-mcp-tool-names-containing-dots-and-hyphens-despite-being-valid-per-mcp-spec/157635), and the broader [SEP-986 issue](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/986)) strip or refuse names containing `.` even though it is technically valid. Every existing tool in `PLATFORM_TOOLS` uses `snake_case` (see `record_execution_evidence`, `update_backlog_item_status`, etc.). To preserve client portability and consistency, the view-command family uses underscore-prefixed naming (`screen_describe`, `screen_select_entity`, …) rather than `screen.describe`. The `screen_` prefix is the namespace.

**MCP tool annotations.** Each new tool also carries the four hint fields documented in the [MCP tool annotations blog post](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/): `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. These are **client hints only** — the spec explicitly notes annotations are not trustworthy from untrusted servers, so the server-side grant check and envelope decision remain authoritative. Existing tools in `PLATFORM_TOOLS` already declare `annotations.readOnlyHint`/`idempotentHint`/`destructiveHint` (search `mcp-tools.ts`), so this is conformance, not a new pattern.

| Tool | Args | Returns | `readOnly` | `destructive` | `idempotent` | `openWorld` | Required grant |
|---|---|---|---|---|---|---|---|
| `screen_describe` | `{}` | `ScreenManifest` (compact) | true | false | true | false | `coworker_screen_read` |
| `screen_get_state` | `{}` | `{ route, selectedEntities, focusedField, openPanels, scrollAnchor }` | true | false | true | false | `coworker_screen_read` |
| `screen_select_entity` | `{ selectionId, entityId }` | `{ ok }` | false | false | true | false | `coworker_screen_drive` |
| `screen_navigate` | `{ route, params? }` | `{ ok }` | false | conditional¹ | true | false | `coworker_screen_drive` |
| `screen_open_panel` | `{ panelId }` | `{ ok }` | false | false | true | false | `coworker_screen_drive` |
| `screen_close_panel` | `{ panelId }` | `{ ok }` | false | false | true | false | `coworker_screen_drive` |
| `screen_focus_field` | `{ fieldId }` | `{ ok }` | false | false | true | false | `coworker_screen_drive` |
| `screen_set_input` | `{ formId, fieldId, value }` | `{ ok }` | false | false² | true | false | `coworker_screen_fill` |
| `screen_scroll_to` | `{ anchor }` | `{ ok }` | true⁴ | false | true | false | `coworker_screen_read` |
| `screen_propose_action` | `{ manifestActionId, args, rationale }` | `{ envelopeId, status }` | false | true | false | false | `coworker_screen_drive` |
| `screen_dispatch_action` | `{ envelopeId }` | `{ ok, toolResult }` | false | yes³ | false | varies | resolved from manifest action |

¹ `screen_navigate` is destructive if the current page has unsaved form state. The runtime checks; envelope auto-injected when needed.
² Pre-filling a field is non-destructive *until submit*. Field changes are visible to the user immediately, who can edit before submit.
³ `screen_dispatch_action` resolves to a real MCP tool with its own grant + audit; the screen layer is the trigger, not the authority.
⁴ Scroll is reclassified as a read-class action: it cannot mutate state, only the user's viewport on already-rendered content. Re-using the `coworker_screen_read` grant (rather than `coworker_screen_drive`) collapses an unnecessary grant boundary — POLA (object-capability tradition; see [Capability-based security overview](https://en.wikipedia.org/wiki/Capability-based_security)) argues for fewer, sharper grants. If a future product surface treats scroll as a privacy/attention concern (e.g. agent scrolls to data the user has not yet seen), promote scroll to drive then.

Each view command:

- Executes server-side in the chat turn handler.
- Emits a typed SSE event on the existing `build-progress-update`-style channel — but **renamed to `coworker-screen-event`** for substrate generality.
- Returns success/failure structurally to the coworker so it can chain decisions.

The relay code at `AgentCoworkerPanel.tsx:359-367` becomes a switch over a closed event type, dispatched to the page's `ScreenManifest`-registered handlers.

### 6.3 Domain action tools (existing MCP, refactored grants)

Existing tools (`record_execution_evidence`, `update_backlog_item_status`, etc.) are unchanged at the call site. Their grants are restructured to support the contract:

**New grant tier (proposed):**

| Grant | Scope | Replaces / refines |
|---|---|---|
| `coworker_screen_read` | All `screen_describe`, `screen_get_state`, `screen_scroll_to` | new |
| `coworker_screen_drive` | All non-fill, non-dispatch view commands | new |
| `coworker_screen_fill` | `screen_set_input`, pre-fill flows | extends `elevatedFormFillEnabled` |
| `build_evidence` | `record_execution_evidence`, `saveBuildEvidence`, `save_build_notes` for FeatureBuild scope | finer than current `backlog_write` |
| `build_phase_advance` | `approve_decomposition`, advance-phase tools | finer than current `backlog_write` |
| `build_lifecycle` | `start_build`, `promote_to_build_studio`, `reopen_feature_build` (new), `cancel_thread` | broader than `build_promote` |
| `backlog_write` | unchanged — still required for non-build-scoped backlog mutation | unchanged |

`AGT-BUILD-SE` baseline becomes: `sandbox_execute, work_capsule_*, coworker_screen_read, coworker_screen_drive, build_evidence`. The `coworker_screen_fill` and `build_lifecycle` grants are opt-in per coworker config — surfaced in the runtime mode UI alongside `coworkerMode: act` (see `AgentCoworkerPanel`).

This is **finer-grained authorization, not broader**. The user still authorizes every act — but the grant taxonomy now matches the actions, so the coworker is not blocked from work it should obviously be able to do.

### 6.4 Confirmation envelope

Destructive actions (any action listed in `ScreenManifest.destructiveActions`, plus any `screen_navigate` that loses unsaved state, plus any `screen_dispatch_action` whose tool is marked destructive in `PLATFORM_TOOLS`) flow through a two-step envelope:

1. Coworker calls `screen_propose_action({ manifestActionId, args, rationale })`.
2. Server creates a `CoworkerActionEnvelope` row (see §8), emits `coworker-screen-event: action_proposed` to the client.
3. Client renders an inline "Coworker proposes: *<plain-English summary>*" card in the chat with **Approve / Modify / Deny** buttons.
4. On approve, the client posts back to `/api/agent/envelope/:id/approve`. Server executes the underlying MCP tool, records the envelope outcome, emits `coworker-screen-event: action_executed`.
5. On deny, envelope marked declined. Coworker is informed structurally so it can re-plan.

**Per-turn elevation.** If the user has explicitly said *"go"* or *"do it"* or has toggled the per-turn elevation switch in the chat UI (analogous to the existing `elevatedFormFillEnabled` for forms — verified at `app/api/agent/send/route.ts:65` and `AgentCoworkerPanel.tsx:527`), the envelope is auto-approved for up to **N=3** destructive actions in that turn. The cap is a hard floor; it is intentionally independent of the manifest's `destructiveActions.length` (which can be 20+ on a rich screen like Build Studio and would defeat the per-turn safety wire). On the 4th destructive in a single turn, the runtime returns `rate_limit_exceeded` and forces a fresh user approval. Elevation does not survive across turns. This composes with the §13 confirmation rate-limit — same N, single source of truth.

**Hard floors.** Three classes are never elevated, even with explicit user consent — they require an in-chat typed phrase (e.g. type "reopen FB-892ECD67"):
- Reopen of an abandoned build (`reopen_feature_build`).
- Any tool marked `irreversible: true` in `PLATFORM_TOOLS` (TBD field).
- Any action that modifies the coworker's own grant set.

### 6.5 Replay / audit

Every screen action and envelope outcome is recorded on the existing `ToolExecution` model with three new columns:

- `delegatingUserId` — the human user the coworker acted on behalf of
- `chatTurnId` — the conversational turn that initiated the action
- `envelopeId` — null for non-destructive view commands; populated for envelope-gated actions

`/platform/ai/authority` gains a **Screen Actions** tab that renders the per-turn timeline: chat turn → proposed actions → envelopes → executions. Replay is a read-only view; "undo" is **not** in scope for v1 (see §17 Open Questions).

## 7. Authorization model

Authorization is a **two-key system** — semantically a *delegated capability* in the object-capability tradition ([Wikipedia: Capability-based security](https://en.wikipedia.org/wiki/Capability-based_security); Mark Miller et al. on POLA, the Principle of Least Authority). The structural analogue in the web-services world is [RFC 8693 OAuth 2.0 Token Exchange](https://www.rfc-editor.org/rfc/rfc8693.html): the spec defines a `subject_token` (the user on whose behalf the call is made) and an `actor_token` (the service that is acting), and requires that the issued composite token "should not have broader privileges than the original" — the scope-intersection invariant we use below. RFC 8693's `act` claim is the audit-trail pattern we mirror (and §6.5 enriches).

Both keys must permit the action; the more restrictive wins (POLA / scope-intersection).

**Key 1: The coworker's principal grants** (object-capability "authority of the actor"). Resolved from `agent_registry.json` (or its DB-backed replacement) per the coworker's `agentId`. Returned by `getAvailableTools()` in [`apps/web/lib/tak/agent-grants.ts`](apps/web/lib/tak/agent-grants.ts) (note: `apps/web/lib/agent-grants.ts` is a re-export shim).

**Key 2: The delegating user's role capabilities** (object-capability "authority of the delegator"). Resolved from the user's `platformRole` via `PERMISSIONS` in [`apps/web/lib/govern/permissions.ts`](apps/web/lib/govern/permissions.ts).

Current intersection is per-tool. The contract refines it:

```ts
function canExecute(action: ToolOrViewCommand, coworker: Coworker, user: User) {
  const coworkerGrants = resolveCoworkerGrants(coworker);
  const userCaps       = resolveUserCapabilities(user);
  const required       = action.requiredGrant;     // single grant string
  const userRoleCap    = action.requiredUserRoleCap; // capability name on user side

  if (!coworkerGrants.includes(required))     return Deny('coworker_grant_missing', required);
  if (!userCaps.includes(userRoleCap))         return Deny('user_capability_missing', userRoleCap);
  if (action.requiresElevation && !envelope)   return Defer('envelope_required');
  return Allow;
}
```

**The `Deny` is structural.** It returns to the chat as a typed event the client renders as a notice ("Cannot execute — coworker missing grant `build_lifecycle`. [Request grant]"), not as a chat sentence the model produces. The "Request grant" link calls `submit_coworker_capability_need` and files a backlog item with the precise verb + grant gap.

**Cross-tenant guard.** All resolutions are constrained by the user's session tenant. Any reference to an entity outside the tenant is a hard reject regardless of grants.

## 8. Schema changes

Schema audit first (per AGENTS.md §11). Verified against live `packages/db/prisma/schema.prisma` 2026-05-31:

- `ToolExecution` (schema line 3825) already exists with `agentId`, `userId`, `threadId`, `routeContext`, `executionMode`, plus extension columns (`auditClass`, `capabilityId`, `apiTokenId`, `taskRunId`, `skillId`). Extend rather than parallel-table.
- `Principal` (line 221) / `PrincipalAlias` (line 250) — Principal convergence confirmed: coworkers ARE already aliased with `aliasType = "agent"` (verified in `apps/web/lib/identity/principal-linking.ts:275, 351` and `aidoc-resolver.ts:200, 279`; Suspicion A is **refuted** — convergence is live). The `Agent` model itself (line 1865) is a domain-attributes side table and does NOT carry `principalId`; identity is resolved through `PrincipalAlias(aliasType="agent", aliasValue=Agent.agentId)`. The schema for the new envelope therefore stores `coworker_principal_id` (canonical) and **`coworker_agent_id` for fast joins** rather than only the principal id.
- `ToolExecution.agentId` and `userId` are already the dual-principal columns. The new `delegatingUserId` column is **only** populated when the action originated through the pseudo-user channel (i.e. when `agentId` is set and the chat had a delegating user distinct from any system actor); for direct user actions it remains null. This avoids re-litigating who acted vs. on whose behalf for every existing row.
- No existing `CoworkerActionEnvelope` table. New.
- No existing `ScreenManifest` table. The manifest is process-local + page-source code; not in DB. Justification: manifests are code-resident and version with the page bundle; persisting them duplicates source of truth (`single-source-of-truth`).

New migration (one file, one concern). Schema is illustrative SQL — the actual landing format is a Prisma migration generated via `pnpm --filter @dpf/db exec prisma migrate dev --name pseudo_user_contract` per AGENTS.md §2:

```sql
-- CoworkerActionEnvelope: pending/approved/declined record of a destructive proposal
CREATE TABLE coworker_action_envelope (
  id              TEXT PRIMARY KEY,                                -- cuid, matches existing model id convention
  coworker_principal_id TEXT NOT NULL REFERENCES "Principal"(id),
  coworker_agent_id     TEXT NOT NULL REFERENCES "Agent"("agentId"), -- fast join; PrincipalAlias remains canonical
  delegating_user_id    TEXT NOT NULL REFERENCES "User"(id),
  thread_id       TEXT NOT NULL,
  chat_turn_id    TEXT NOT NULL,
  manifest_action_id TEXT NOT NULL,
  args_json       JSONB NOT NULL,
  rationale       TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('proposed','approved','declined','executed','failed','cancelled')),
  outcome_tool_execution_id TEXT REFERENCES "ToolExecution"(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);
CREATE INDEX idx_envelope_thread ON coworker_action_envelope(thread_id, created_at DESC);
CREATE INDEX idx_envelope_status_pending ON coworker_action_envelope(status) WHERE status = 'proposed';
CREATE INDEX idx_envelope_principal ON coworker_action_envelope(coworker_principal_id, created_at DESC);

-- ToolExecution column additions
ALTER TABLE "ToolExecution" ADD COLUMN "delegatingUserId" TEXT REFERENCES "User"(id);
ALTER TABLE "ToolExecution" ADD COLUMN "chatTurnId" TEXT;
ALTER TABLE "ToolExecution" ADD COLUMN "envelopeId" TEXT REFERENCES coworker_action_envelope(id);
CREATE INDEX "ToolExecution_envelopeId_idx" ON "ToolExecution"("envelopeId");
```

Note id column type: existing models use `String @id @default(cuid())` (text), not UUID. Aligned to keep one id convention across the schema (`single-source-of-truth`).

Backfill: not required — new columns are nullable, only populated for new executions.

Enum update: `BacklogItem.type` / `Epic.status` unaffected. No enum changes. The `status` enum on `coworker_action_envelope` is hyphen-free string-set today by tradition; spec keeps the existing convention to match `ToolExecutionReceipt.receiptStatus` ("valid"), `FeatureBuild.phase` (mixed), pending the broader status-enum hyphenation sweep in AGENTS.md §3.

## 9. Tool inventory

**New tools** (added to `PLATFORM_TOOLS` in [`apps/web/lib/mcp-tools.ts`](apps/web/lib/mcp-tools.ts)):

1. `screen_describe` — see §6.2
2. `screen_get_state`
3. `screen_select_entity`
4. `screen_navigate`
5. `screen_open_panel`
6. `screen_close_panel`
7. `screen_focus_field`
8. `screen_set_input`
9. `screen_scroll_to`
10. `screen_propose_action`
11. `screen_dispatch_action`
12. `reopen_feature_build` — clears `abandonedAt`, sets phase to last open phase, requires `build_lifecycle`, marked `irreversible: false` but `destructive: true`.

**Modified tools** (grant refactor only, no signature change):

- `record_execution_evidence` — required grant `build_evidence` (was `backlog_write` per existing mapping)
- `saveBuildEvidence` — required grant `build_evidence`
- `save_build_notes` — required grant `build_evidence`
- `approve_decomposition` — required grant `build_phase_advance`
- `update_backlog_item_status` — keeps `backlog_write` for non-build scopes; for build-scoped updates, also accepts `build_phase_advance`
- `promote_to_build_studio` — required grant `build_lifecycle` (was `build_promote`)

**Tool-side metadata** added to each PLATFORM_TOOLS entry: `destructive: boolean`, `irreversible: boolean`, `screenSurface?: string` (which manifest the tool is meaningful in). These power the manifest CI check (§6.1) and the envelope decision (§6.4).

## 10. Client wiring

### 10.1 Page-side manifest registration

Each page calls `useScreenManifest(MANIFEST)` once at mount. The hook:

- Publishes the manifest to a singleton `__dpf_screen_registry__` on `window` keyed by `routeContext`.
- Subscribes to `coworker-screen-event` (renamed from `build-progress-update`) on `window`.
- Dispatches each event to the manifest's matching handler.
- Emits `coworker-screen-state-changed` when the user changes selection/focus/navigation, so the chat panel can update its `activeBuildId`-style state without bespoke DOM events per page.

The existing `build-studio-active-build` event becomes a special case of `coworker-screen-state-changed` with payload `{ selectionId: "build", entityId }`. Backwards-compat shim kept until all consumers migrate.

**Old-event consumer inventory (verified 2026-05-31 via `grep -rn "build-progress-update\|build-studio-active-build"` over `apps/web/`):**

| Event | File | Role |
|---|---|---|
| `build-studio-active-build` | `components/agent/AgentCoworkerPanel.tsx:438-439` | listener — chat panel reads active build |
| `build-studio-active-build` | `components/agent/AgentCoworkerShell.tsx:194-195` | listener — shell reads active build |
| `build-studio-active-build` | `components/agent/AgentCoworkerShell.test.tsx:126` | test fixture |
| `build-studio-active-build` | `components/build/BuildStudio.tsx:294, 298` | emitter — Build Studio publishes selection |
| `build-progress-update` | `components/agent/AgentCoworkerPanel.tsx:361` | emitter — SSE relay |
| `build-progress-update` | `components/build/BuildStudio.tsx:310-311` | listener |
| `build-progress-update` | `components/build/BuildStudioWorkflowActionCard.tsx:188, 223` | emitter |
| `build-progress-update` | `components/build/ProcessGraph.tsx:115-117` | listener |
| `build-events.ts:28, 30` | `lib/build-events.ts` | constants — `ACTIVE_BUILD`, `PROGRESS_UPDATE` |

Shim plan: BI-PUC-004 (a) introduces `lib/build-events.ts → COWORKER_SCREEN_EVENT = "coworker-screen-event"` and `COWORKER_SCREEN_STATE_CHANGED = "coworker-screen-state-changed"`; (b) makes emitters fire both old and new events; (c) migrates each listener to the new event in a single follow-up commit per file (one concern per PR per AGENTS.md §4 — five PRs). Old events removed two releases after the last listener migrates. Add a runtime warning (one-shot per session) when an old event fires after the deprecation window opens.

### 10.2 Chat panel state hydration

`AgentCoworkerPanel` no longer needs the bespoke `useEffect` block for `activeBuildId`. It subscribes to `coworker-screen-state-changed` and forwards the full state object on each chat send:

```ts
fetch("/api/agent/send", {
  ...,
  body: JSON.stringify({
    threadId, content, routeContext, coworkerMode,
    screenState,            // full state object, not just buildId
    elevationToken,         // present if user clicked "go" this turn
    attachmentId, questionPacket,
  }),
});
```

### 10.3 Server-side context resolution

`resolvePortalContextEnvelope` in [`agent-coworker.ts`](apps/web/lib/actions/agent-coworker.ts) extends to read the full `screenState` payload (validated against the manifest) and inject:

- The compact manifest summary into the prompt.
- The current state (selections, focused field, open panels) into the prompt.
- Default argument bindings (e.g. `buildId` defaults to selected build entity) for any tool that opts in via `defaultArgsFromScreenState`.

### 10.4 SSE event vocabulary

`coworker-screen-event` payload schema:

```ts
type CoworkerScreenEvent =
  | { type: 'state_changed';     state: ScreenState }
  | { type: 'selection_changed'; selectionId: string; entityId: string }
  | { type: 'navigation_requested'; route: string; params?: object }
  | { type: 'panel_changed';     panelId: string; open: boolean }
  | { type: 'field_focused';     fieldId: string }
  | { type: 'field_set';         formId: string; fieldId: string; value: unknown }
  | { type: 'scrolled';          anchor: string }
  | { type: 'action_proposed';   envelopeId: string; summary: string; args: object; rationale: string }
  | { type: 'action_executed';   envelopeId: string; toolExecutionId: string; ok: boolean }
  | { type: 'denied';            reason: 'coworker_grant_missing' | 'user_capability_missing' | 'screen_capability_missing'; detail: object };
```

## 11. Coworker prompt changes

Each coworker's system prompt (today: prompts/, skills/, and inline strings in `agent-coworker.ts`) gets three additions:

1. **Screen contract preamble** — explains the manifest, the view command tools, the propose/dispatch envelope.
2. **Discovery directive** — on every chat turn, if `screen_describe` hasn't been called in the last K turns, call it first. The compact manifest is also auto-injected into the prompt envelope so this is fallback, not required path.
3. **Failure-mode directive** — if a view command or domain action returns a `denied` event, do not retry; instead, surface the gap to the user with `submit_coworker_capability_need` (verified at `apps/web/lib/mcp-tools.ts:3593` — accepts `{ verdict, confidence, needs: [{ kind, severity, need, blocks, evidenceJson, readinessJson }] }`; deny event payload maps directly to one `needs[]` entry with `kind: "tool-grant"|"missing-tool"|"missing-screen-capability"`). If the coworker also has a concrete fix to propose, call `propose_skill_improvement` (verified at `mcp-tools.ts:2788` — takes `{ skillId, title, description, proposedContent }`) to attach a draft.

Suspicion B from the prior draft is **partially refuted, partially clarified**: both tools exist and have signatures broadly compatible with §11 and §17, but `submit_coworker_capability_need` writes `CoworkerCapabilityNeed` rows (per the tool description), not direct `BacklogItem` rows; the BI is created downstream by the human reviewer in `/platform/ai/capability-needs`. §17 OQ8's claim that the fix is "automatically attached to the BI" should be reworded — the proposal attaches to the `CoworkerCapabilityNeed`, and the reviewer carries it through to a BI on triage. This is the correct shape; the spec needs the noun corrected.

These directives are added via a new shared skill `pseudo-user-contract` in `packages/dpf-skill-pack/skills/` per AGENTS.md §16 dual-surface contract, with `assignTo: ["*"]`.

## 12. Build Studio first-mile changes

Concrete unblock for the dialog that triggered this spec:

1. **`AGT-BUILD-SE` grants** in `agent_registry.json` extended to include `coworker_screen_read`, `coworker_screen_drive`, `coworker_screen_fill`, `build_evidence`, `build_phase_advance`. Not yet `build_lifecycle` — that requires the user to elevate explicitly per coworker config (see §6.4 hard floors).
2. **Build Studio manifest** registered at `apps/web/app/(shell)/build/page.tsx`:
   - `selections`: `build` (FeatureBuild list), `phase-tab` (per-build phase navigation)
   - `panels`: `design-doc`, `plan`, `evidence`, `verification`, `runtime`
   - `forms`: `design-doc-form`, `plan-task-add`
   - `domainActions`: `record_execution_evidence`, `save_build_notes`, `saveBuildEvidence`, `approve_decomposition`, `promote_to_build_studio`, `reopen_feature_build`, etc.
   - `destructiveActions`: `approve_decomposition`, `promote_to_build_studio`, `reopen_feature_build`, `start_build`
3. **`reopen_feature_build`** new tool — gated `build_lifecycle`, requires typed-phrase floor (§6.4).
4. **Backwards-compat shim** for `build-progress-update` → `coworker-screen-event`. Both fire for two releases, then `build-progress-update` is removed.

Once these land, the original dialog scenario resolves as: user types "go", coworker calls `screen_select_entity({ selectionId: "build", entityId: "FB-5E20E793" })`, screen switches, coworker calls `screen_dispatch_action` chain for design-review → plan → build phases, each envelope auto-approved by per-turn elevation, each landing as a typed audit row.

## 13. Safety & guardrails

- **Active-focus guard.** The client tracks two signals from the web platform's existing focus model — not a bespoke contract:
  1. The browser's [`UserActivation` interface](https://developer.mozilla.org/en-US/docs/Web/API/UserActivation) (`navigator.userActivation.isActive`) — true while the user has *transient activation* (recent interaction, default 5s window per the [User Activation v2 model](https://mustaqahmed.github.io/user-activation-v2/)). View commands that would re-target focus or change selection check this flag and defer when true.
  2. The client emits `lastUserInputTimestamp` from a delegated `input` / `keydown` listener on the chat panel root — independent of activation because activation expires after seconds, while we care about a tighter 1500 ms typing window for the active-typing case.
  When deferred, the coworker sees a `deferred_user_active` status and can wait or re-propose. Note explicit non-claim: this is not the [WICG Capability Delegation](https://wicg.github.io/capability-delegation/spec.html) mechanism — that spec governs cross-frame delegation of activation, not agent-vs-user focus arbitration. We borrow the activation signal only.
- **WAI-ARIA conformance for view commands that move focus.** `screen_focus_field` and `screen_open_panel` MUST follow the focus-management guidance from the [WAI-ARIA 1.2 spec](https://www.w3.org/TR/wai-aria-1.2/): when a panel is opened, focus moves into the panel; when closed, focus returns to the element that triggered the close. Status changes that don't move focus (e.g. envelope outcomes) MUST be announced through an `aria-live="polite"` region rendered by the chat panel.
- **Confirmation rate-limit.** Per turn, max 3 destructive proposals before the user must explicitly re-elevate. Prevents an in-prompt jailbreak from chaining unbounded destructive ops. (See §6.4 hard cap revision.)
- **Hostile screen state.** The manifest's `applySelection` and friends are pure UI dispatches; they never mutate domain state. A bad manifest cannot cause data loss — only a broken UI.
- **Replay safety.** Replay is read-only. No "rerun coworker turn" button in v1 — too easy to silently double-execute.
- **Sandbox isolation for cross-coworker chains.** When one coworker dispatches a domain action that triggers another coworker (e.g. a build phase advance kicks off `architect` review), the downstream coworker is a fresh principal; it does not inherit the upstream elevation token.
- **Hard floor: tenant.** All resolutions check tenant. Cross-tenant action is denied without manifest consultation.

## 14. Research & benchmarking

**OSS leaders.**

- **Open Interpreter** (Killian Lucas et al.). Whole-OS agent that can read clipboard, run shell, control the browser. Per-action consent UX with session-wide "trust" toggles. **Adopted:** per-turn elevation token. **Rejected:** session-wide trust — too easy to forget the agent has it; we keep elevation per-turn.
- **Continue.dev**. Slash-command registry (`/edit`, `/comment`, custom commands) where each command is a typed action manifest the IDE pre-registers. **Adopted:** manifest-driven discovery — coworker reads what the screen exposes, not what it imagines. **Rejected:** purely text-emitting commands; ours mutate UI state too.
- **Aider**. `/add`, `/commit`, `/undo` as explicit verbs; everything reversible at the git layer. **Adopted:** explicit verbs for every privileged action. **Rejected:** the "everything is undoable" assumption — DB writes in our domain are not always reversible, so we use envelope instead of undo.

**Commercial leaders.**

- **Cursor (Composer mode)**. Two-mode UX (chat suggests, composer acts), inline diff approval, multi-file edits behind a single approval gate. **Adopted:** the advise/act mode toggle (already present in DPF as `coworkerMode: "advise" | "act"` — verified at `app/api/agent/send/route.ts:63`) — extended to cover view commands. **Adopted:** batch envelope for multi-step destructive sequences.
- **Cognition Devin**. Long-running agent on its own VM; plan visible to user; checkpointing; "ask for help" when stuck. **Adopted:** structural failure reporting (the coworker says exactly what's missing). **Adopted:** plan visibility — we already have this in Build Studio. **Rejected:** the agent's own VM — we share the user's session.
- **Microsoft 365 Copilot — Declarative Agents.** Verified against the [official declarative-agent manifest schema 1.6](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-manifest-1.6) (current as of research). The declarative agent is packaged as an M365 app `.zip` containing `declarativeAgent.json` + icons + optional API plugin manifest; the manifest root carries `capabilities`, `conversation_starters`, and an `actions` JSON object that maps to plugin manifests for typed actions. Every action is audited under both the user identity and the agent identity (M365 Copilot audit log). **Adopted:** the manifest-defines-action-surface pattern; we generalize to "per-screen manifest" rather than per-agent. **Adopted:** dual-identity audit — concretely, `ToolExecution.userId` (delegating) + `ToolExecution.agentId` (acting) + new `delegatingUserId` + `chatTurnId` realize the M365-equivalent claim chain. **Rejected:** Graph API's centralized brokering — we keep tool resolution in-process. **Note:** unlike M365, our manifests live in source code (TypeScript modules), not in a packaged app artifact, because our agent and screen ship together; this lets the manifest CI lint round-trip entirely in the type system (no registry-server round-trip).

**Standards & specifications.** This spec is grounded in the following external standards (added 2026-05-31 architecture review per kernel principle `research-and-use-standards`):

- **[Model Context Protocol — tool annotations](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). **Adopted** for §6.2 view-command tool entries and §6.4 envelope decision (existing `PLATFORM_TOOLS` entries already use these fields — conformance, not a new pattern). **Critical caveat**: annotations are hints to *clients*, not enforcement — the spec explicitly warns "clients should never make tool use decisions based on ToolAnnotations received from untrusted servers." The DPF runtime grant check (`canExecute` in §7) remains the actual enforcement point; annotations only drive the client-side confirmation UX (envelope visibility, color-coding).
- **[MCP tool naming — SEP-986](https://modelcontextprotocol.io/seps/986-specify-format-for-tool-names)**. Dot-notation tool names are technically valid per the SEP but break in multiple clients (Cursor, etc.). Adopted underscore namespacing (`screen_describe`) for portability per §6.2.
- **[RFC 8693 — OAuth 2.0 Token Exchange](https://www.rfc-editor.org/rfc/rfc8693.html)**. The delegation model (subject_token + actor_token, `act` claim, scope-intersection invariant "issued token should not have broader privileges than the original") is the formal pattern this spec implements. **Adopted** in §7's two-key authorization. We don't actually issue OAuth tokens to coworkers — DPF coworkers are in-process principals — but the audit shape (`ToolExecution.userId` ≡ subject, `agentId` ≡ actor, `delegatingUserId` ≡ explicit `act` chain) is structurally the same. Cited so future federation work has a known mapping.
- **[Object-capability security / POLA](https://en.wikipedia.org/wiki/Capability-based_security)** (Mark Miller et al.). Coworker grants are unforgeable, downscoped delegations — closer to capability-based security than RBAC. The grant taxonomy in §6.3 follows POLA: many narrow grants, each authorizing one verb class, rather than a few broad role-based grants. The `screen_scroll_to` reclassification in §6.2 (read-class, not drive-class) is a POLA refinement.
- **[WAI-ARIA 1.2 — Accessible Rich Internet Applications](https://www.w3.org/TR/wai-aria-1.2/)**. View-command focus moves MUST follow ARIA focus-management conventions (focus into opened panels, return to trigger on close). Envelope status updates use `aria-live="polite"` regions. Cited in §13.
- **[UserActivation API](https://developer.mozilla.org/en-US/docs/Web/API/UserActivation) + [User Activation v2 model](https://mustaqahmed.github.io/user-activation-v2/)**. The active-focus guard's transient-activation check uses the platform primitive (`navigator.userActivation.isActive`) rather than inventing a custom contract. Cited in §13.
- **[WICG Capability Delegation](https://wicg.github.io/capability-delegation/spec.html)** — explicitly *not* used. The spec governs cross-frame delegation of activation between iframes, not agent-vs-user focus arbitration. Citing the boundary so the reader doesn't conflate the two.
- **[SLSA + in-toto attestation](https://slsa.dev/spec/v1.0/provenance)**. The dual-principal audit trail (`agentId` + `delegatingUserId` + `chatTurnId`) is conceptually a provenance attestation — "who built this artifact, on whose authority, in which invocation." For now this is *internal* attestation; surfacing the trail as a signed predicate (in-toto format) is a v2 enhancement. Cited so the audit layer can converge on the established schema when it ships externally.
- **[Anthropic computer use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)**. We treat pixel-based computer use as the **fallback** for surfaces we do not own, not the primary path. Anthropic's own approach is pixel-counting (verified in [Anthropic's developing-computer-use post](https://www.anthropic.com/research/developing-computer-use)) because they cannot rely on DOM authority across arbitrary apps. We *do* own the DOM for `/build`, `/storefront`, etc., so a typed manifest is strictly higher fidelity — fewer hidden controls leaked to the LLM, no DPI/scaling failures, no screenshot round-trip. This is the explicit justification for NG1.

**Anti-patterns identified.**

- **Pixel-control of owned surfaces.** ChatGPT Operator-style pixel automation is the wrong tier when we own the DOM. We use it only as fallback for native apps outside the platform.
- **Silent grant deny.** Every product that fails an action without explaining why erodes trust quickly. We make the deny structural and actionable.
- **Per-tool global confirmation toggles.** Open Interpreter and others allow "always allow shell" which gets toggled once and forgotten. We bind elevation to the turn.
- **Coworker that "tries to do it anyway."** Some agents probe alternate paths when blocked, which hides the real gap. Our directive in §11 forbids retry; instead, capability-need filing.

**Gaps this design fills that prior art doesn't.**

- Dual-principal audit (delegating user + coworker) with full chat-turn correlation. Microsoft Copilot does dual-identity but at the app-level, not at the chat-turn level.
- Manifest-CI: the typed schema is lint-checked against the actual tool registry, so a manifest can't reference a nonexistent action. None of the surveyed products do this; manifests are usually convention-only.
- Capability gap as first-class backlog input. Continue.dev and Open Interpreter log failures but don't route them into a product backlog with the precise verb signature.

## 15. Failure modes

| Failure | Detection | Recovery |
|---|---|---|
| Manifest references unknown tool | CI lint at build time | PR rejected |
| Coworker calls non-manifest verb | Runtime check in `screen_dispatch_action` | Structured `screen_capability_missing` event → capability-need filed |
| Manifest action's `applySelection` is undefined | Storybook smoke-render | PR rejected |
| User navigates while coworker mid-action | `coworker-screen-state-changed` on route change | All in-flight envelopes cancelled |
| User denies envelope | Envelope `status = declined` | Coworker informed structurally; replans |
| Concurrent coworkers on same screen | (out of scope v1) | Documented; tracked under §17 |
| Race: user clicks same selection as coworker proposes | Idempotency on selection events | Last-write-wins; coworker re-reads state |
| Tool times out | Envelope `status = failed` with error | Coworker sees and surfaces |
| Coworker chains > rate limit | `screen_propose_action` returns `rate_limit_exceeded` | User re-elevates explicitly |

## 16. Phased rollout

**Phase 0 — Spec acceptance.** This document. Founder review, kernel-principle check, schema audit confirmation.

**Phase 1 — Substrate (1 BI per file, ~5 BIs).**
| Semantic | Backlog id | Title | Size |
|---|---|---|---|
| `PUC-001` | `BI-D887CD3B` | Add `coworker_action_envelope` table + `ToolExecution` columns; migration | small |
| `PUC-002` | `BI-B2F7ABF5` | New grant taxonomy in `agent-grants.ts` + tool registry metadata (`destructive`, `irreversible`, `screenSurface`) | medium |
| `PUC-003` | `BI-D9487754` | `ScreenManifest` runtime registry + `useScreenManifest` hook + CI lint (Vitest jsdom, not Storybook) | large |
| `PUC-004` | `BI-DF6079E9` | `screen_*` tool family in `mcp-tools.ts` + relay channel migration (`build-progress-update` → `coworker-screen-event` with backwards-compat) | large |
| `PUC-005` | `BI-0F9C291C` | Envelope flow: propose → user UI card → approve/deny → dispatch → outcome (with N=3 per-turn destructive cap) | large |

**Phase 2 — Build Studio vertical (Build Studio first-mile §12, ~4 BIs).**
| Semantic | Backlog id | Title | Size |
|---|---|---|---|
| `PUC-010` | `BI-7C04E1E9` | `AGT-BUILD-SE` grant extension + dialog reproduction test | small |
| `PUC-011` | `BI-6C9CC0EC` | Build Studio `ScreenManifest` registration | medium |
| `PUC-012` | `BI-0B3B0232` | `reopen_feature_build` tool with typed-phrase hard floor | medium |
| `PUC-013` | `BI-743593F7` | Author `pseudo-user-contract` DPF platform skill (dual-surface) | medium |

**Phase 3 — Replicate to other verticals (one BI per vertical).**
- Storefront, Admin, Platform, Coworker management, Settings — each registers its manifest, gets the grants its coworkers need.

**Phase 4 — Observability + self-evolution.**
- `/platform/ai/authority` Screen Actions tab.
- Automated capability-gap → backlog item flow.
- Per-coworker dashboard: top 5 most-frequent denies = the next 5 grant or tool additions.

**Build gate.** Each phase ships behind a feature flag (`PSEUDO_USER_CONTRACT_ENABLED`) defaulted off in production, on in development, until Phase 2 verification completes against the failing-dialog scenario.

## 17. Open questions

**OQ1 — Undo.** Should the coworker's screen actions be undoable as a unit? View commands trivially yes; envelope-gated domain actions are tool-specific. Proposal: defer to v2; track which tools have explicit reverse operations and surface them, but no generic undo.

**OQ2 — Concurrent coworkers on one screen.** If two coworkers are active in the same chat thread (e.g. SE and EA), can they both drive the screen? Proposal: one coworker holds the screen lock at a time, swap via explicit handoff verb. v1 punts: only one coworker active per thread. **Future-work hook:** when this lands, the established pattern is Operational Transform with a central arbiter (Google Docs model) for shared text/form-fill, or CRDTs (Figma, Linear model) for shared non-textual state. See [Liveblocks — Understanding sync engines](https://liveblocks.io/blog/understanding-sync-engines-how-figma-linear-and-google-docs-work). Our central server is the chat-turn handler, so OT is the natural fit if v2 needs real concurrent drive; CRDT is preferred if v2 also supports offline/disconnected coworker action.

**OQ3 — Manifest evolution.** When a screen adds a new action mid-conversation, does the coworker need to re-call `screen_describe`? Proposal: the prompt envelope always carries the current manifest summary; the explicit `describe` tool exists as a fallback.

**OQ4 — Headless coworker variant.** Coworkers running outside a chat (background jobs, scheduled tasks) have no screen. Proposal: they don't get `coworker_screen_*` grants; their action surface is MCP-only. The contract degrades cleanly.

**OQ5 — Mobile / responsive screens.** Does a small viewport expose a different manifest? Proposal: same manifest, but `panels` and `forms` carry a `visibility: "responsive"` flag that the coworker reads before dispatching.

**OQ6 — Multi-tab.** User has two browser tabs open on different builds. Which one is "the screen"? Proposal: the screen the chat panel is rendered in. Cross-tab coordination is out of v1 scope.

**OQ7 — Build Studio non-stop loop.** The user named this explicitly: "go non-stop, accelerate to a self-evolving process." Does the contract gate auto-elevation differently for an explicit "loop" mode? Proposal: extend elevation tokens with a `loopUntil: {condition}` field — phase Build Studio Autonomy as a follow-on epic that *consumes* this contract, not part of v1.

**OQ9 — Typed-phrase floor UX.** §6.4 mandates typing `reopen FB-892ECD67` to clear an abandoned build. This is the right safety wire (forces the user to read the specific entity id before confirming) but is a UX paper-cut for power users. Alternatives surveyed:
- **Double-confirm with delay** (e.g. Stripe "type DELETE then wait 5s") — better friction profile but easier to muscle-memory-bypass than typing the entity id.
- **Cryptographic confirmation** (sign a challenge with the user's session key) — high friction, only justifiable for tenant-destructive ops which we don't have here.
- **Verbal entity-id readback** (the typed-phrase requires reading the id) — this is what §6.4 already proposes; cheap and forces evidence.
- **Slider-to-confirm gesture** (mobile pattern; iOS-style) — works on touch, awkward on desktop.
Proposal: keep the typed-phrase for v1 (irreversible class only), revisit in v1.1 once we have telemetry on user behavior. No action in this spec.

**OQ10 — Build Studio is down (audit context).** The user's standing memory notes Build Studio is non-functional as of 2026-05-29, which is why this spec is being authored externally via Claude rather than promoted through Build Studio. This is a context note, not a design open question — but it implies the Phase 2 verification path (BI-PUC-010 dialog reproduction test) cannot be exercised in the running Build Studio fleet until Build Studio's own intake/gate path is operating. Recommend Phase 1 substrate ships even with Build Studio down; Phase 2 vertical waits on Build Studio recovery.

**OQ8 — Self-evolution attestation.** When a coworker files a capability-need, can it propose the fix? Proposal: yes, via the existing `propose_skill_improvement` tool, with the proposal attached to the `CoworkerCapabilityNeed` record (not directly to a BI — the human reviewer on `/platform/ai/capability-needs` carries it through to a `BacklogItem` on triage, per the actual tool semantics verified in §11). Founder still reviews; not auto-approved.

## 18. Appendix: example interaction

**Setup.** User on `/build`, looking at abandoned `FB-892ECD67`. Phase 2 of rollout complete.

**Turn 1 — user.** "Drive `FB-5E20E793` to plan."

**Turn 1 — coworker.** Calls `screen_get_state` → sees current selection is `FB-892ECD67`. Calls `screen_describe` → confirms `selections.build` exists. Calls `screen_select_entity({ selectionId: "build", entityId: "FB-5E20E793" })` → screen switches. Calls `screen_get_state` → confirms phase is `ideate`. Calls `screen_propose_action({ manifestActionId: "save-design-doc", args: {...}, rationale: "save current design draft so it can be reviewed" })` → envelope created → chat card rendered: *"I'll save the design doc for FB-5E20E793 (GPU upgrade button). Approve?"*

**Turn 2 — user.** Clicks Approve, types "and keep going through plan."

**Turn 2 — coworker.** Envelope executes — design doc saved, returns success. Sees user said "keep going" → treats as per-turn elevation for the next destructive in the chain. Calls `screen_propose_action({ manifestActionId: "advance-to-plan" })` → envelope auto-executes under elevation → screen panel updates to Plan phase. Calls `screen_dispatch_action` (via envelope) to add the plan tasks. Reports: *"FB-5E20E793 design doc saved; advanced to Plan; 4 tasks drafted. Ready to start build — do you want me to kick off?"* Coworker stops at the `build_lifecycle` floor — `start_build` requires explicit consent.

**Turn 3 — user.** "yes start the build"

**Turn 3 — coworker.** Calls `screen_propose_action({ manifestActionId: "start-build" })` → envelope created → user approves inline → `start_build` MCP tool dispatches. Status emitted as `coworker-screen-event: action_executed`. Build Studio orchestrator picks up, fires its own `orchestrator:task_dispatched` events through the same SSE channel. Coworker waits at idle, watching events stream, surfacing failures structurally if any arrive.

**Audit trail (`/platform/ai/authority` Screen Actions tab):**

| Turn | Action | Outcome | Envelope |
|---|---|---|---|
| 1 | `screen_select_entity(build=FB-5E20E793)` | ok | — |
| 1 | `screen_propose_action(save-design-doc)` | proposed | env-1 |
| 2 | env-1 approved by user | executed → `record_execution_evidence` ok | env-1 |
| 2 | `screen_propose_action(advance-to-plan)` | auto-approved (elevation) | env-2 |
| 2 | env-2 executed → `approve_decomposition` | ok | env-2 |
| 2 | `screen_dispatch_action(add-plan-tasks)` × 4 | ok ok ok ok | (per-action envelopes, auto under elevation) |
| 3 | `screen_propose_action(start-build)` | proposed | env-3 |
| 3 | env-3 approved by user | executed → `start_build` ok | env-3 |

Every row carries `coworker_principal_id = AGT-BUILD-SE`, `delegating_user_id = <admin>`, `chat_turn_id`, and a back-pointer to the conversation.

---

## Architecture Review Findings (2026-05-31)

Run by the `dpf-architecture-review` skill as a Claude subagent, external to Build Studio (BS is currently down — see OQ10). Advisory only; no build gate. Surface alignment: **aligned with concerns** — the contract design is architecturally sound and substrate-grounded, but several factual claims and citations needed sharpening before implementation.

### Applied — MUST FIX (factual / kernel-principle compliance)

1. **Schema audit corrections** (§8). Verified `ToolExecution` (`schema.prisma:3825`) and `Principal`/`PrincipalAlias` (lines 221/250) live on `String @default(cuid())` ids, not UUID. Migration SQL re-typed to `TEXT`. Added `coworker_agent_id` FK to `Agent.agentId` for fast joins beside the canonical `coworker_principal_id`. Cited line numbers.
2. **Suspicion A — refuted.** Coworker `PrincipalAlias` convergence is live (`aliasType: "agent"` usage confirmed in `apps/web/lib/identity/principal-linking.ts:275, 351`, `aidoc-resolver.ts:200, 279`, plus three test fixtures). No precondition BI needed. Documented in §8.
3. **MCP tool naming conformance** (§6.2). Renamed `screen.*` → `screen_*`. Dot-namespacing is valid per [SEP-986](https://modelcontextprotocol.io/seps/986-specify-format-for-tool-names) but breaks in Cursor and other clients; all existing `PLATFORM_TOOLS` entries use snake_case (verified in `mcp-tools.ts`). Underscore preserves portability and consistency.
4. **MCP tool annotations** (§6.2). Added the four-column hint table (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) per the [MCP annotations blog post](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/). Explicitly noted annotations are *hints*, not enforcement — server-side grant check remains authoritative.
5. **Storybook does not exist in the repo.** Verified — no `.storybook/`, no `@storybook/*` dep in `apps/web/package.json`. §6.1 manifest CI claim rewritten to use Vitest jsdom (already the test runtime per AGENTS.md §5) plus a TypeScript-only manifest lint script.
6. **`agent-grants.ts` path correction** (§7). The file referenced is a shim re-export; the actual implementation lives at `apps/web/lib/tak/agent-grants.ts`. `PERMISSIONS` lives at `apps/web/lib/govern/permissions.ts`, not `agent-grants.ts`. Paths corrected.
7. **Suspicion B clarified** (§11). `submit_coworker_capability_need` and `propose_skill_improvement` both exist (`mcp-tools.ts:3593` and `:2788`) but the former writes `CoworkerCapabilityNeed` rows, not directly `BacklogItem` rows. §11 and §17 OQ8 updated to reflect the actual two-step path (need → reviewer → BI).
8. **Relay channel consumer inventory** (§10.1). Listed every consumer of `build-progress-update` and `build-studio-active-build` from `apps/web/` and articulated the per-PR migration plan (5 PRs, AGENTS.md §4 one-concern-per-PR compliance).
9. **§6.4 envelope auto-approval cap.** Original draft capped at `destructiveActions.length` — defeats per-turn safety for rich screens. Hard-floored at N=3 per turn. Composed with §13 confirmation rate-limit (same N, single source of truth — `single-source-of-truth`).

### Applied — SHOULD FIX (missing citations, weak justifications)

10. **§7 grounded in RFC 8693 + object-capability vocabulary.** The "two-key" pattern is structurally [OAuth 2.0 Token Exchange (RFC 8693)](https://www.rfc-editor.org/rfc/rfc8693.html) with subject/actor token claims. Authority taxonomy is closer to [object-capability security / POLA](https://en.wikipedia.org/wiki/Capability-based_security) than RBAC. Cited.
11. **§13 active-focus guard grounded in actual web primitives.** Now references the [UserActivation API](https://developer.mozilla.org/en-US/docs/Web/API/UserActivation) and explicitly distinguishes from [WICG Capability Delegation](https://wicg.github.io/capability-delegation/spec.html) (which governs cross-frame, not agent-vs-user).
12. **§13 WAI-ARIA conformance.** Focus-management view commands MUST follow [WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/) (focus into opened panel, return to trigger on close, `aria-live="polite"` for status updates).
13. **§14 Microsoft 365 Copilot grounded in actual manifest schema.** Cited [declarative-agent manifest schema 1.6](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-manifest-1.6); described the actual `actions` / `capabilities` / `conversation_starters` structure rather than a paraphrase. Articulated the deliberate divergence (source-resident manifest vs. packaged-app manifest).
14. **§14 Anthropic computer use rationale cited.** NG1 now references [Anthropic's developing-computer-use post](https://www.anthropic.com/research/developing-computer-use) — pixel-counting approach is *necessary* for non-DOM-owning agents, *not optimal* for DOM-owning ones.
15. **§14 new "Standards & specifications" subsection.** Inventoried with URLs: MCP annotations, SEP-986, RFC 8693, object-capability/POLA, WAI-ARIA 1.2, UserActivation API, WICG Capability Delegation (boundary), SLSA/in-toto (future-work hook), Anthropic computer use.
16. **§6.2 `screen_scroll_to` reclassified read-class.** Required-grant changed from `coworker_screen_drive` to `coworker_screen_read` — scroll cannot mutate state, only viewport. POLA-aligned grant collapse.

### Applied — CONSIDER (deferred to §17 with trade-off articulated)

17. **OQ9 — typed-phrase floor UX alternatives.** Surveyed double-confirm-with-delay, cryptographic confirmation, slider-to-confirm. Recommended keeping typed-phrase for v1 (forces entity-id readback) and revisiting in v1.1 with telemetry.
18. **OQ2 — concurrent coworkers future-work hook.** Cited [Liveblocks sync-engines post](https://liveblocks.io/blog/understanding-sync-engines-how-figma-linear-and-google-docs-work) — OT for central-server concurrent text, CRDT for offline/disconnected coworker action.
19. **OQ10 — Build Studio currently down.** Phase 2 vertical (`BI-7C04E1E9` dialog reproduction) cannot run in BS fleet until BS recovers. Phase 1 substrate can still ship.

### Not applied — deliberate non-changes (with reasoning)

- **Author's framing of §11 unchanged.** Spec-author had `propose_skill_improvement` and `submit_coworker_capability_need` listed correctly; only the downstream noun (CapabilityNeed → BI) needed correction. Did not restructure §11.
- **Spec-wide "v1 scope" boundaries unchanged.** Resisted scope creep: no expansion of envelope into an undo system, no expansion of view-commands into typed-state-machine commands, no replacement of MCP grants with raw object capabilities. Pattern-borrowing only.
- **`coworker_screen_fill` kept separate from `coworker_screen_drive`.** Considered collapsing per POLA but pre-fill is a privacy/attention concern (the agent puts text into a field the user did not type) — meaningful boundary preserved.
- **`reopen_feature_build` grant changed from `build_lifecycle` to `build_lifecycle` — unchanged.** Verified the grant taxonomy is internally consistent.

### Reference-doc feedback

- **AGENTS.md §11.** The Principal-convergence cutoff is dated 2026-05-09 and lists `Agent` as a convergent kind, but the §11 prose does not name the *fast-join pattern* for queries that need agent-domain attributes (e.g. capability domain, tier) without a Principal join. The spec's §8 schema introduces `coworker_agent_id` alongside `coworker_principal_id` for this reason; AGENTS.md §11 could acknowledge that domain-side tables MAY carry both fk columns for query ergonomics. Propose as a future doc edit, not part of this review.
- **`docs/superpowers/specs/2026-05-09-deployment-contracts.md`** — not directly affected by this spec (no host-coupled substrate). Confirmed.

### Escalated decisions

None. No 2-4-option trade-offs surfaced that needed kernel-scored deliberation; all open questions in §17 are either future-work hooks or have a clear preferred path.

### Recommended next step

Fold these edits (now applied in-place above) and proceed to BI filing for Phase 1 (`BI-D887CD3B`, `BI-B2F7ABF5`, `BI-D9487754`, `BI-DF6079E9`, `BI-0F9C291C`). Phase 2 vertical waits on Build Studio recovery (`BI-7C04E1E9`, `BI-6C9CC0EC`, `BI-0B3B0232`, `BI-743593F7`).

---

## 19. Captured extensions (parked 2026-05-31)

Two refinements surfaced in the founder conversation after the substrate was being built. Both depend on Phase 1 primitives landing first; captured here so they aren't lost when implementation work resumes.

### 19.1 Visual agency cue for `screen_set_input` + per-form confirmation envelope

**Backlog item:** [`BI-5696B4D7`](#) — *"PUC visual cue: highlight coworker-set fields + per-form confirmation envelope"*

The `screen_set_input` tool (§6.2) lets a coworker pre-fill form fields on the user's behalf. The spec as written defines the tool but not the UX contract for what the user sees while the fill is happening. The founder direction is:

- Every field set by the coworker carries a **transient highlight** (proposed: amber/yellow border or background) plus a tooltip showing which coworker set it. The highlight persists until the user modifies that field, confirms the batch, or cancels.
- When the coworker has set N fields in a form during a single turn, a **per-form confirmation card** appears at the form footer: *"<CoworkerName> proposes these N field changes — Approve and submit / Modify / Cancel."*
- **Per-turn elevation** (§6.4) is the consent floor. Once the user has elevated in this turn (e.g. typed "go"), subsequent fills in the same form go through without re-confirmation — but the visual cue stays so the user can still see what's changing in real time. This is the trust-but-visible pattern.
- **Cancel** reverts the fills (restores prior field values) and emits a structured `screen_set_input_reverted` event on the coworker-screen-event channel so the coworker can re-plan.

Why this matters: the spec already gates destructive actions behind the envelope. Form fills are below the destructive threshold (they're reversible until submit), but they're invisible without an affordance. The cue is the bridge that makes the AI's agency legible.

### 19.2 Cross-page coworker handoff via A2A protocol with HITL approval gate

**Backlog item:** [`BI-A32801C5`](#) — *"PUC cross-page coworker handoff via A2A protocol with HITL approval gate"*

The substrate as designed gives the coworker the ability to drive the screen the user is on. The natural follow-on: when the user (or the coworker via `screen_navigate`) leaves a page owned by Coworker A and lands on a page owned by Coworker B, the coworker context should follow them — not reset to a fresh chat.

A hard-coded variant of this **already exists in the onboarding flow**: the COO persona walks the user from `/storefront` through admin business-context setup pages, preserving conversational intent end-to-end. See `apps/web/lib/onboarding/` (merged in commit `deb7072f`). This BI generalises that pattern across the whole portal.

**Mechanism — composes three substrates:**

- **A2A protocol** (epic `EP-A2A` — agent-to-agent coworker team orchestration). The handoff IS an A2A message: a `CoworkerHandoffEnvelope` carrying inferred intent, recent conversational state, current screen-state snapshot, and any in-flight task references. The existing A2A routing layer just needs a navigation trigger.
- **Pseudo-User Contract** — `screen_navigate` (§6.2) is the navigation primitive; the envelope flow (§6.4) is the gate primitive. This BI composes them: navigation that crosses a coworker-ownership boundary fires the envelope.
- **HITL** — the gate IS the human's consent point: *"`A` is handing you to `B` for `<inferred-intent>`. Continue / Stay here / Cancel."* Same shape as the envelope card; just handoff-specific copy. Same-coworker navigations skip the gate.

**Why this matters and why it's parked:** without it, the screen-driving primitive works only within a single page; with it, coworkers become a continuous companion across the entire product. But it depends on three things that need to land first — `EP-A2A` spec maturity, `BI-DF6079E9` (screen_navigate fires the gate before completing), `BI-0F9C291C` (envelope UI is what the handoff card reuses). Founder direction is to capture the requirement and the onboarding precedent now, design and implement after Phase 1 substrate lands.

**Reference implementation:** `apps/web/lib/onboarding/` plus the COO persona scripting. Read this before designing the generalisation — there's a real working version with lessons embedded.

---

## Sign-off checklist

- [ ] Founder review (founder kernel commandment scan)
- [ ] Schema steward audit (AGENTS.md §11)
- [x] Architecture review (`dpf-architecture-review` skill) — completed 2026-05-31 (advisory). Outcome: aligned with concerns; 16 MUST/SHOULD edits applied in-place, 3 CONSIDER items added to §17 Open Questions. Cited 9 external standards. See "Architecture Review Findings (2026-05-31)" above.
- [ ] Build Studio team review (vertical owner)
- [ ] Coworker fleet owner review (cross-vertical pattern owner)
- [ ] Phase 1 BIs filed and linked
- [x] Epic created (`EP-COWORKER-INTERACTIVITY`, filed 2026-05-31, priority 2)
- [x] Phase 1 BIs filed: `BI-D887CD3B`, `BI-B2F7ABF5`, `BI-D9487754`, `BI-DF6079E9`, `BI-0F9C291C`
- [x] Phase 2 BIs filed: `BI-7C04E1E9`, `BI-6C9CC0EC`, `BI-0B3B0232`, `BI-743593F7`
