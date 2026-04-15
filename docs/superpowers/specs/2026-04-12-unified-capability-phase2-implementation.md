# Phase 2 Implementation Brief — Capability Inventory and Auth Formalization

**Design spec:** `docs/superpowers/specs/2026-04-12-unified-capability-and-integration-lifecycle-design.md` (Sections 5, 7.2, 11, 12 Phase 2)
**Date:** 2026-04-12
**Phase:** 2 of 4
**Depends on:** Workstream E only depends on Phase 1 Workstream C (Tools & Integrations nav). Workstreams A–D have no Phase 1 dependency and can run in parallel with all of Phase 1.
**Unblocks:** Phase 3 (audit class infrastructure builds on capabilityId from here)
**Parallelism:** Run Workstreams A–D in parallel with Phase 1. Hold Workstream E until Phase 1 Workstream C (IA/nav restructure) lands.

---

## What this phase delivers

1. **`sync-capabilities.ts`** — keeps `PlatformCapability` rows current with `PLATFORM_TOOLS` on every deploy
2. **`PlatformCapability.manifest` enrichment** — adds classification and drift-detection metadata
3. **`CapabilityInventoryView`** — unified query layer joining internal + external + provider capabilities
4. **DB migration** — `authMode` and `credentialOwnerMode` columns on `ModelProvider` and `McpServer`; `definitionHash` on `PlatformCapability`
5. **Skill→capability queryability** — resolve `SkillDefinition.allowedTools` to `capabilityId` values
6. **Capability Inventory admin page** — surface the inventory at `Tools & Integrations > Capability Inventory`

---

## Read before implementing

These files define the existing patterns you must follow:

- `packages/db/src/seed-skills.ts` — the exact pattern to follow for `sync-capabilities.ts` (idempotent upsert, fail-open on error, same lifecycle as portal-init)
- `packages/db/src/seed-prompt-templates.ts` — second example of the same pattern
- `apps/web/lib/mcp-tools.ts` — `PLATFORM_TOOLS` array (source of truth for internal tools), `getAvailableTools()` function
- `apps/web/lib/tak/mcp-server-tools.ts` — `getMcpServerTools()` and `discoverMcpServerTools()` (external MCP tool patterns)
- `apps/web/lib/actions/ai-providers.ts` — `syncProviderRegistry()` (provider sync pattern for Section 11.4.C)
- `packages/db/prisma/schema.prisma` — `PlatformCapability` (line ~927), `McpServer`, `McpServerTool`, `ModelProvider`, `SkillDefinition`, `SkillAssignment`
- `packages/db/src/seed.ts` — verify that `seedSkills` and `seedPromptTemplates` are called here; `syncCapabilities` must be added in the same place

---

## Workstream A: sync-capabilities.ts

### Purpose

The `PlatformCapability` table is currently empty. This sync script populates it from `PLATFORM_TOOLS` and keeps it current on every deploy. It follows the exact pattern of `seed-skills.ts`.

### New file: `packages/db/src/sync-capabilities.ts`

```typescript
// packages/db/src/sync-capabilities.ts
// Reads PLATFORM_TOOLS from mcp-tools.ts, upserts into PlatformCapability.
// Idempotent. Runs as part of portal-init on every deploy.
// Fails open — a sync error must not take the platform down.
```

Key implementation rules:

1. **Import `PLATFORM_TOOLS`** from `apps/web/lib/mcp-tools.ts`. You will need to either:
   - Import directly if the package dependency graph allows it, OR
   - Copy the tool list to a shared package (e.g., `packages/db/src/platform-tools-snapshot.ts`) that is updated by a build step
   - The simplest approach: export a `getPlatformToolsForSync()` helper from `mcp-tools.ts` and import it in the db package via the monorepo's workspace setup. Check if `@dpf/db` can import from `apps/web` — if not, the snapshot approach is needed.

2. **`capabilityId` format** — use `platform:${tool.name}` for all platform tools. No other format.

3. **`definitionHash`** — compute a stable hash of the tool's definition fields for drift detection:

   ```typescript
   import { createHash } from "crypto";
   function hashToolDefinition(tool: ToolDefinition): string {
     return createHash("sha256")
       .update(JSON.stringify({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }))
       .digest("hex")
       .slice(0, 16); // 16 hex chars is enough for drift detection
   }
   ```

4. **Manifest shape** — enrich the `manifest` JSON field with:

   ```typescript
   manifest: {
     sourceType: "internal",
     riskClass: tool.riskBand ?? "low",        // map from tool.riskBand if present
     auditClass: deriveAuditClass(tool),         // see note below
     adapterType: "platform_tool",
     requiresExternalAccess: tool.requiresExternalAccess ?? false,
     sideEffect: tool.sideEffect ?? false,
     buildPhases: tool.buildPhases ?? [],
     integrationDependencies: [],               // populated manually in Phase 2 for known deps
     definitionHash: hashToolDefinition(tool),
     schemaChangedAt: null,                     // set on first change after initial sync
   }
   ```

5. **`deriveAuditClass`** — derive from tool properties until explicit `auditClass` is added to `PLATFORM_TOOLS` definitions:
   - `sideEffect: true` → `"ledger"`
   - `!sideEffect && requiresExternalAccess` → `"journal"`
   - `!sideEffect && !requiresExternalAccess` → `"metrics_only"`
   This derivation is temporary. Phase 3 will add explicit `auditClass` to tool definitions.

6. **On tool removed** — set `state: "deprecated"` on the existing row. Do NOT delete. Print a warning.

7. **On tool schema changed** — detect via `definitionHash` diff. Update manifest and set `schemaChangedAt: new Date().toISOString()`.

8. **Fail-open** — wrap the entire sync in try/catch. Log errors to stdout with `[sync-capabilities]` prefix. Do not throw. Return without error.

9. **Add to seed.ts** — call `await syncCapabilities(prisma)` in the same location as `seedSkills` and `seedPromptTemplates`.

### Expected output

`PlatformCapability` table populated with ~55 rows (one per PLATFORM_TOOLS entry), each with `capabilityId: "platform:toolName"`, `state: "active"`, and enriched manifest.

---

## Workstream B: DB migration

Create migration `20260412210000_capability_inventory_phase2`:

### PlatformCapability additions

No new columns needed in Phase 1-2 — enrichment goes into the existing `manifest` JSON field. However, add a generated column or partial index for faster lookup if query patterns require it. Defer column promotion until Phase 3+ unless performance degrades.

### ModelProvider additions

```sql
ALTER TABLE "ModelProvider"
  ADD COLUMN IF NOT EXISTS "authMode" TEXT,
  ADD COLUMN IF NOT EXISTS "credentialOwnerMode" TEXT;
```

Valid `authMode` values: `none`, `api_key`, `oauth_client`, `oauth_user`, `service_account`
Valid `credentialOwnerMode` values: `platform_owned`, `admin_owned`, `user_owned`, `mixed`

These are nullable in Phase 2. Phase 3+ can add NOT NULL constraints with defaults after migration.

### McpServer additions

```sql
ALTER TABLE "McpServer"
  ADD COLUMN IF NOT EXISTS "authMode" TEXT,
  ADD COLUMN IF NOT EXISTS "credentialOwnerMode" TEXT;
```

Same valid values as above.

Update Prisma schema to match. Run `pnpm --filter @dpf/db exec prisma migrate dev --name capability_inventory_phase2`.

---

## Workstream C: CapabilityInventoryView query layer

### What this provides

A server-side query function that joins `PlatformCapability`, `McpServerTool`, and optionally `ModelProvider`/`ModelProfile` into a unified capability list. Used by the Capability Inventory admin page.

### New file: `apps/web/lib/actions/capability-inventory.ts`

```typescript
// apps/web/lib/actions/capability-inventory.ts
// Unified capability inventory query layer.
// Joins PlatformCapability (internal), McpServerTool (external MCP),
// and ModelProvider capabilities (provider-native).
// This is a read model — it does not replace the execution sources.
```

Projected shape per capability:

```typescript
type CapabilityInventoryRow = {
  capabilityId: string;         // "platform:toolName", "mcp:server__tool", "provider:id"
  sourceType: "internal" | "external_mcp" | "provider_native";
  integrationId: string | null; // McpServer.id for external_mcp; ModelProvider.id for provider_native
  displayName: string;
  description: string | null;
  enabled: boolean;
  availabilityStatus: string;   // "active" | "degraded" | "inactive" | "deprecated"
  riskClass: string | null;     // from manifest
  auditClass: string | null;    // from manifest
  sideEffect: boolean;
  requiresExternalAccess: boolean;
  buildPhases: string[];
  integrationDependencies: string[];
};
```

Implementation notes:

1. **Internal tools** — query `PlatformCapability` where `state != "deprecated"`. Parse manifest JSON for classification fields.

2. **External MCP tools** — query `McpServerTool` joined to `McpServer`. Include only tools from servers with `status: "active"`. `capabilityId` = `mcp:${server.serverId}__${tool.toolName}`. `availabilityStatus` derived from `McpServer.healthStatus`.

3. **Provider-native** — for Phase 2, include basic entries from `ModelProvider` where active. The shape is simpler (no toolName, just provider-level capability indicators). `capabilityId` = `provider:${provider.providerId}`. Detailed model-level capabilities from `ModelProfile.capabilities` JSON can be a Phase 3 expansion.

4. **Sort** — by sourceType (internal first), then alphabetically by displayName.

5. **Cache** — apply 60-second cache with `unstable_cache` or equivalent, same pattern as `PromptLoader`. The inventory is admin-facing and can tolerate slight staleness.

### Server action exports

```typescript
export async function getCapabilityInventory(filters?: {
  sourceType?: string;
  enabled?: boolean;
  searchQuery?: string;
}): Promise<CapabilityInventoryRow[]>

export async function getCapabilityById(capabilityId: string): Promise<CapabilityInventoryRow | null>

export async function getCapabilitiesForSkill(skillId: string): Promise<CapabilityInventoryRow[]>
```

---

## Workstream D: Skill→capability queryability

The `SkillDefinition.allowedTools` field is an array of tool names (e.g., `["create_backlog_item", "update_feature_brief"]`). Phase 2 must make this queryable as capability IDs.

### Resolution function

Add to `apps/web/lib/actions/capability-inventory.ts`:

```typescript
export async function getCapabilitiesForSkill(skillId: string): Promise<CapabilityInventoryRow[]> {
  const skill = await prisma.skillDefinition.findUnique({ where: { skillId } });
  if (!skill) return [];
  const allowedTools = skill.allowedTools as string[];
  // Map tool names to capabilityIds using the platform:toolName convention
  const capabilityIds = allowedTools.map(name => `platform:${name}`);
  // Also check for mcp: prefixed entries if the skill references external tools
  return getCapabilityInventory({ capabilityIds });
}
```

Update `getCapabilityInventory` to accept an optional `capabilityIds` filter array.

---

## Workstream E: Capability Inventory admin page

**New page:** `apps/web/app/(shell)/platform/tools/inventory/page.tsx`

This page is part of the Tools & Integrations section created in Phase 1.

Content:

- Page heading: "Capability Inventory"
- Filter bar: source type (All / Internal / External MCP / Provider), enabled toggle, search by name
- Table: one row per capability with columns: Name, Source, Integration, Status, Risk, Audit Class, Side Effects
- Status badge: active (green), degraded (yellow), inactive (gray), deprecated (strikethrough)
- Row click: expand inline or navigate to detail (Phase 2 can use inline expand)
- Empty state: "Sync capabilities first — run `portal-init` or trigger a redeploy"

Do not build a full detail page in Phase 2. An inline expand showing the manifest JSON is sufficient.

Add "Capability Inventory" to `ToolsTabNav.tsx` (created in Phase 1) pointing to `/platform/tools/inventory`.

---

## Acceptance criteria (from design spec Section 15)

- [ ] `PlatformCapability` table is populated on deploy — `sync-capabilities.ts` runs in `portal-init` and produces ~55 rows from PLATFORM_TOOLS with `capabilityId` in `platform:toolName` format.
- [ ] Removing a tool from `PLATFORM_TOOLS` sets `state: "deprecated"` on its row; it does not delete the row.
- [ ] Changing a tool's `description` or `inputSchema` updates `manifest.definitionHash` and sets `manifest.schemaChangedAt`.
- [ ] `getCapabilityInventory()` returns internal + external MCP + provider capabilities in one list.
- [ ] The Capability Inventory page at `/platform/tools/inventory` renders capabilities grouped by source type with status badges.
- [ ] `getCapabilitiesForSkill("some-skill-id")` returns the capability rows matching that skill's `allowedTools`.
- [ ] `ModelProvider` and `McpServer` have nullable `authMode` and `credentialOwnerMode` columns.
- [ ] TypeScript and lint pass with no new warnings.

---

## What NOT to do in Phase 2

- Do not implement trust policy enforcement (check 5 in Section 7.2). That is Phase 2+ work.
- Do not implement per-user credential state for `user_owned` integrations — that is Phase 2+ deferred per the spec.
- Do not implement composite capability authoring — `composite` sourceType is taxonomy-only through Phase 3.
- Do not add `auditClass` to `ToolExecution` — that is Phase 3.
- Do not remove `PLATFORM_TOOLS` or change it to read from `PlatformCapability` — `PlatformCapability` is the metadata overlay; `PLATFORM_TOOLS` remains the execution source of truth.
- Do not introduce scheduled health polling for integrations — that is a Phase 2+ decision point.
