# EP-CODEX-001: Codex Provider + MCP Server Integration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI Codex as a distinct AI provider with MCP server integration and human-readable billing labels across all providers.

**Architecture:** New `codex` provider entry in the registry with `category: "agent"`. Two new `ModelProvider` columns (`billingLabel`, `costPerformanceNotes`) drive billing clarity UX. Codex MCP server seeded as an `McpServer` record. Provider grid gains a third "Agent Providers" section.

**Tech Stack:** Prisma 5 (migration + seed), Next.js 14 App Router (server components), Vitest (pure function tests)

**Spec:** `docs/superpowers/specs/2026-03-15-codex-provider-integration-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/db/prisma/schema.prisma` | Modify | Add `billingLabel String?` and `costPerformanceNotes String?` to `ModelProvider` |
| `packages/db/data/providers-registry.json` | Modify | Add `codex` entry; add `billingLabel`/`costPerformanceNotes` fields to all existing entries |
| `packages/db/src/seed.ts` | Modify | Add `seedMcpServers()` function, call after `seedScheduledJobs()` |
| `apps/web/lib/ai-provider-types.ts` | Modify | Widen `category` union; add fields to `RegistryProviderEntry` + `ProviderRow`; add `getBillingLabel()` |
| `apps/web/lib/ai-providers.test.ts` | Modify | Add `getBillingLabel()` tests |
| `apps/web/lib/ai-provider-data.ts` | Modify | Add `billingLabel`/`costPerformanceNotes` to ProviderRow mapping in `getProviders()` and `getProviderById()` |
| `apps/web/lib/actions/ai-providers.ts` | Modify | Update `syncProviderRegistry()` to persist new fields |
| `apps/web/app/(shell)/platform/ai/page.tsx` | Modify | Add "Agent Providers" section; add billing labels to all cards |
| `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx` | Modify | Add cost-performance notes info box |

---

## Chunk 1: Schema Migration + Registry Data

### Task 1: Prisma Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma:264-285` (ModelProvider model)

- [ ] **Step 1: Add new fields to ModelProvider**

In `packages/db/prisma/schema.prisma`, add two fields to the `ModelProvider` model after `consoleUrl`:

```prisma
  billingLabel         String?
  costPerformanceNotes String?
```

- [ ] **Step 2: Generate the migration**

Run:
```bash
cd packages/db && npx prisma migrate dev --name add_billing_label_to_provider
```

Expected: Migration created successfully, no errors.

- [ ] **Step 3: Verify the migration SQL**

Read the generated migration file in `packages/db/prisma/migrations/*/migration.sql` to confirm it adds two nullable `TEXT` columns to `ModelProvider`. No data loss.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add billingLabel and costPerformanceNotes to ModelProvider"
```

---

### Task 2: Registry JSON — Add Codex + Billing Labels

**Files:**
- Modify: `packages/db/data/providers-registry.json`

- [ ] **Step 1: Add `codex` entry to the registry**

Append to the array in `providers-registry.json`, after the last `category: "direct"` entry (before routers):

```json
{
  "providerId": "codex",
  "name": "OpenAI Codex",
  "category": "agent",
  "baseUrl": null,
  "authMethod": "api_key",
  "supportedAuthMethods": ["api_key"],
  "authHeader": "Authorization",
  "costModel": "token",
  "families": ["codex-mini"],
  "inputPricePerMToken": 1.50,
  "outputPricePerMToken": 6.00,
  "billingLabel": "Pay-per-use (API key) or Subscription (ChatGPT plan)",
  "costPerformanceNotes": "Agentic coding specialist. ~3x cheaper than GPT-4o for code tasks. Runs in sandboxed environment with tool use and persistent threads.",
  "docsUrl": "https://developers.openai.com/codex/",
  "consoleUrl": "https://platform.openai.com/settings/organization/billing"
}
```

- [ ] **Step 2: Add `billingLabel` and `costPerformanceNotes` to existing entries**

Add these two fields to every existing entry. Use `null` for `costPerformanceNotes` on entries where no meaningful cost/performance context exists. Use explicit `billingLabel` only for entries where the auto-generated label from pricing would be insufficient or misleading. For most direct providers with pricing, omit `billingLabel` (the `getBillingLabel()` function will auto-generate from pricing data). Entries that need explicit labels:

- `ollama`: `"billingLabel": "Local compute · electricity cost only"`
- Routers (`openrouter`, `litellm`, `portkey`, `martian`): `"billingLabel": "Pay-per-use · rates vary by model"`

All other entries: `"billingLabel": null` (auto-generated from pricing).

All entries get `"costPerformanceNotes": null` (can be populated by admins later).

- [ ] **Step 3: Verify JSON is valid**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('packages/db/data/providers-registry.json', 'utf-8')); console.log('Valid JSON')"
```

Expected: `Valid JSON`

- [ ] **Step 4: Commit**

```bash
git add packages/db/data/providers-registry.json
git commit -m "feat(db): add codex provider and billing labels to registry"
```

---

## Chunk 2: Type System + Pure Functions + Tests

### Task 3: Widen Types and Add `getBillingLabel()`

**Files:**
- Modify: `apps/web/lib/ai-provider-types.ts:134-151` (RegistryProviderEntry) and `:44-64` (ProviderRow)
- Test: `apps/web/lib/ai-providers.test.ts`

- [ ] **Step 1: Write failing tests for `getBillingLabel()`**

Add `getBillingLabel` to the existing import block at the top of `apps/web/lib/ai-providers.test.ts`:

```typescript
import { getBillingLabel } from "./ai-provider-types";
```

Then append the following `describe` block to the bottom of the file:

```typescript
describe("getBillingLabel", () => {
  it("returns explicit billingLabel when set", () => {
    expect(getBillingLabel({
      costModel: "token",
      billingLabel: "Custom label",
      inputPricePerMToken: 3.0,
      outputPricePerMToken: 15.0,
    })).toBe("Custom label");
  });

  it("auto-generates label for token provider with prices", () => {
    expect(getBillingLabel({
      costModel: "token",
      billingLabel: null,
      inputPricePerMToken: 3.0,
      outputPricePerMToken: 15.0,
    })).toBe("Pay-per-use · $3.00/$15.00 per M tokens");
  });

  it("auto-generates label for token provider without prices", () => {
    expect(getBillingLabel({
      costModel: "token",
      billingLabel: null,
      inputPricePerMToken: null,
      outputPricePerMToken: null,
    })).toBe("Pay-per-use · rates vary by model");
  });

  it("auto-generates label for compute provider", () => {
    expect(getBillingLabel({
      costModel: "compute",
      billingLabel: null,
      inputPricePerMToken: null,
      outputPricePerMToken: null,
    })).toBe("Local compute · electricity cost only");
  });

  it("returns null for unknown costModel without explicit label", () => {
    expect(getBillingLabel({
      costModel: "subscription",
      billingLabel: null,
      inputPricePerMToken: null,
      outputPricePerMToken: null,
    })).toBeNull();
  });

  it("formats prices with two decimal places", () => {
    expect(getBillingLabel({
      costModel: "token",
      billingLabel: null,
      inputPricePerMToken: 1.5,
      outputPricePerMToken: 6.0,
    })).toBe("Pay-per-use · $1.50/$6.00 per M tokens");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd apps/web && npx vitest run lib/ai-providers.test.ts
```

Expected: FAIL — `getBillingLabel` is not a function or not exported

- [ ] **Step 3: Widen `RegistryProviderEntry.category` union**

In `apps/web/lib/ai-provider-types.ts`, change the `category` field in `RegistryProviderEntry`:

```typescript
  category: "direct" | "router" | "agent";
```

- [ ] **Step 4: Add new fields to `RegistryProviderEntry`**

Add after `consoleUrl`:

```typescript
  billingLabel?: string | null;
  costPerformanceNotes?: string | null;
```

- [ ] **Step 5: Add new fields to `ProviderRow`**

Add after `consoleUrl: string | null;`:

```typescript
  billingLabel: string | null;
  costPerformanceNotes: string | null;
```

- [ ] **Step 6: Implement `getBillingLabel()`**

Add at the bottom of `apps/web/lib/ai-provider-types.ts`, before the URL helpers section:

```typescript
// ─── Billing label ───────────────────────────────────────────────────────────

type BillingLabelInput = {
  costModel: string;
  billingLabel: string | null;
  inputPricePerMToken: number | null;
  outputPricePerMToken: number | null;
};

/** Human-readable billing label. Returns explicit label if set, auto-generates from pricing otherwise. */
export function getBillingLabel(provider: BillingLabelInput): string | null {
  if (provider.billingLabel) return provider.billingLabel;

  if (provider.costModel === "token") {
    if (provider.inputPricePerMToken != null && provider.outputPricePerMToken != null) {
      return `Pay-per-use · $${provider.inputPricePerMToken.toFixed(2)}/$${provider.outputPricePerMToken.toFixed(2)} per M tokens`;
    }
    return "Pay-per-use · rates vary by model";
  }

  if (provider.costModel === "compute") {
    return "Local compute · electricity cost only";
  }

  return null;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run:
```bash
cd apps/web && npx vitest run lib/ai-providers.test.ts
```

Expected: All tests PASS (existing 11 + 6 new = 17 total)

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/ai-provider-types.ts apps/web/lib/ai-providers.test.ts
git commit -m "feat: add getBillingLabel() and widen category union for agent providers"
```

---

### Task 4: Update ProviderRow Mapping in `ai-provider-data.ts`

**Files:**
- Modify: `apps/web/lib/ai-provider-data.ts:46-64` (getProviders function) and `:66-79` (getProviderById function)

- [ ] **Step 1: Add new fields to the ProviderRow spread**

In `getProviders()`, the `provider` object is built with explicit spreads for JSON fields. The `satisfies ProviderRow` assertion requires all fields in `ProviderRow` to be present. After Task 3 widened `ProviderRow`, the new `billingLabel` and `costPerformanceNotes` fields must be explicitly mapped.

Update the provider mapping in `getProviders()` to include (after the `supportedAuthMethods` line):

```typescript
        billingLabel:         p.billingLabel ?? null,
        costPerformanceNotes: p.costPerformanceNotes ?? null,
```

Do the same in `getProviderById()`.

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd apps/web && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/ai-provider-data.ts
git commit -m "feat: include billingLabel and costPerformanceNotes in ProviderRow mapping"
```

---

## Chunk 3: Sync Logic + Seed

### Task 5: Update `syncProviderRegistry()` to Persist New Fields

**Files:**
- Modify: `apps/web/lib/actions/ai-providers.ts:47-131` (syncProviderRegistry function)

- [ ] **Step 1: Update the create branch**

In `syncProviderRegistry()`, in the `create` data object (the `else` branch), add after `consoleUrl`:

```typescript
          billingLabel:         entry.billingLabel ?? null,
          costPerformanceNotes: entry.costPerformanceNotes ?? null,
```

- [ ] **Step 2: Update the update branch**

In the `update` data object (the `if (existing)` branch), add after `consoleUrl`:

```typescript
          billingLabel:         entry.billingLabel ?? null,
          costPerformanceNotes: entry.costPerformanceNotes ?? null,
```

Note: Unlike `status`/`enabledFamilies`/`endpoint`, we DO overwrite `billingLabel` and `costPerformanceNotes` on sync — these are registry-managed values, not admin-configured.

- [ ] **Step 3: Verify TypeScript compiles**

Run:
```bash
cd apps/web && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/ai-providers.ts
git commit -m "feat: sync billingLabel and costPerformanceNotes in provider registry"
```

---

### Task 6: Seed MCP Server

**Files:**
- Modify: `packages/db/src/seed.ts` (add `seedMcpServers()` after `seedScheduledJobs()`)

- [ ] **Step 1: Add `seedMcpServers()` function**

Add before the `main()` function in `seed.ts`:

```typescript
async function seedMcpServers(): Promise<void> {
  const existing = await prisma.mcpServer.findUnique({
    where: { serverId: "codex-agent" },
  });

  if (!existing) {
    await prisma.mcpServer.create({
      data: {
        serverId: "codex-agent",
        name: "OpenAI Codex Agent",
        config: {
          command: "npx",
          args: ["-y", "codex", "mcp-server"],
          transport: "stdio",
          tools: ["codex", "codex-reply"],
          linkedProviderId: "codex",
          defaults: {
            "approval-policy": "on-request",
            sandbox: "workspace-write",
          },
        },
        status: "unconfigured",
      },
    });
    console.log("Seeded MCP server: codex-agent");
  } else {
    console.log("MCP server codex-agent already exists — skipping (preserving admin config)");
  }
}
```

- [ ] **Step 2: Call `seedMcpServers()` in `main()`**

Add after `await seedScheduledJobs();`:

```typescript
  await seedMcpServers();
```

- [ ] **Step 3: Run the seed to verify**

Run:
```bash
cd packages/db && npx prisma db seed
```

Expected: `Seeded MCP server: codex-agent` in output. No errors.

- [ ] **Step 4: Run the seed again to verify idempotency**

Run:
```bash
cd packages/db && npx prisma db seed
```

Expected: `MCP server codex-agent already exists — skipping (preserving admin config)` in output. No errors, no duplicate.

- [ ] **Step 5: Verify TypeScript compiles**

Run:
```bash
cd packages/db && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/seed.ts
git commit -m "feat(db): seed Codex MCP server record (create-only, no overwrite)"
```

---

## Chunk 4: UI Changes

### Task 7: Provider Grid — Agent Providers Section + Billing Labels

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/page.tsx`

- [ ] **Step 1: Add agent provider filter**

After the existing `directProviders` and `routerProviders` filters (around line 54-55), add:

```typescript
  const agentProviders = providers.filter((pw) => pw.provider.category === "agent");
```

- [ ] **Step 2: Update the subtitle count**

Update the subtitle text (around line 64) to include agent count:

```typescript
          {providers.length} provider{providers.length !== 1 ? "s" : ""} registered ({directProviders.length} direct, {agentProviders.length} agent, {routerProviders.length} routers)
```

- [ ] **Step 3: Add billing label to direct provider cards**

In the direct provider card JSX, after the families `<div>` (around line 96) and before the links `<div>`, add:

```tsx
                    {(() => {
                      const label = getBillingLabel(provider);
                      return label ? (
                        <div style={{ color: "#8888a0", fontSize: 10, marginBottom: 6 }}>{label}</div>
                      ) : null;
                    })()}
```

Add the import at the top of the file:

```typescript
import { getBillingLabel } from "@/lib/ai-provider-types";
```

- [ ] **Step 4: Add the Agent Providers section**

After the Direct Providers section and before the Routers & Gateways section, add:

```tsx
        {/* Agent Providers */}
        {agentProviders.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: "#7c8cf8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Agent Providers
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
              {agentProviders.map(({ provider }) => {
                const colour = STATUS_COLOURS[provider.status] ?? "#8888a0";
                const label = getBillingLabel(provider);
                return (
                  <div
                    key={provider.providerId}
                    style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderLeft: `3px solid ${colour}`, borderRadius: 6, padding: 10 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                      <span style={{ color: "#e0e0ff", fontWeight: 600, fontSize: 12 }}>{provider.name}</span>
                      <ProviderStatusToggle providerId={provider.providerId} initialStatus={provider.status} />
                    </div>
                    <div style={{ color: "#8888a0", fontSize: 10, marginBottom: 6 }}>
                      {provider.families.slice(0, 3).join(" · ")}
                      {provider.families.length > 3 ? " +more" : ""}
                    </div>
                    {label && (
                      <div style={{ color: "#8888a0", fontSize: 10, marginBottom: 6 }}>{label}</div>
                    )}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <Link
                        href={`/platform/ai/providers/${provider.providerId}`}
                        style={{ color: "#7c8cf8", fontSize: 10 }}
                      >
                        Configure →
                      </Link>
                      {provider.docsUrl && (
                        <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#8888a0", fontSize: 10 }}>
                          Docs
                        </a>
                      )}
                      {provider.consoleUrl && (
                        <a href={provider.consoleUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#8888a0", fontSize: 10 }}>
                          Console
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
```

- [ ] **Step 5: Add billing label to router cards too**

Same pattern as step 3 — add the billing label `<div>` to the router provider cards, after the families line and before the links.

- [ ] **Step 6: Verify the page renders**

Run the dev server and navigate to `/platform/ai`. Verify:
- Codex appears under "Agent Providers" section
- All cards show billing labels
- Section order: Direct → Agent → Routers

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/(shell)/platform/ai/page.tsx
git commit -m "feat: add Agent Providers section and billing labels to AI Providers grid"
```

---

### Task 8: Provider Detail Page — Cost-Performance Notes

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx`

- [ ] **Step 1: Add cost-performance notes info box**

After the `hardwareInfo` conditional block (around line 69) and before the `<div style={{ background: "#1a1a2e" ...` form wrapper, add:

```tsx
      {pw.provider.costPerformanceNotes && (
        <div style={{
          background: "#161625",
          borderLeft: "3px solid #7c8cf8",
          borderRadius: 6,
          padding: "12px 16px",
          marginBottom: 16,
          fontSize: 12,
          color: "#b0b0c8",
          lineHeight: 1.5,
        }}>
          {pw.provider.costPerformanceNotes}
        </div>
      )}
```

- [ ] **Step 2: Verify the page renders for Codex**

Navigate to `/platform/ai/providers/codex`. Verify the info box appears with the cost-performance notes text. Verify it does NOT appear on providers without notes (e.g. `/platform/ai/providers/openai`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx
git commit -m "feat: show cost-performance notes on provider detail page"
```

---

## Chunk 5: Final Verification

### Task 9: Full Test Suite + Type Check

- [ ] **Step 1: Run full test suite**

Run:
```bash
pnpm test
```

Expected: All tests pass, including the 6 new `getBillingLabel` tests.

- [ ] **Step 2: Run TypeScript check**

Run:
```bash
cd apps/web && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Run seed to verify full pipeline**

Run:
```bash
cd packages/db && npx prisma db seed
```

Expected: Seed completes. Codex provider appears after registry sync. MCP server seeded.

- [ ] **Step 4: Visual verification**

Start the dev server and verify:
1. `/platform/ai` — Codex appears under "Agent Providers" with billing label
2. `/platform/ai/providers/codex` — cost-performance notes info box visible
3. All existing provider cards show billing labels
4. Section order: Direct Providers → Agent Providers → Routers & Gateways

- [ ] **Step 5: Final commit (if any fixups needed)**

```bash
git add -A && git commit -m "fix: address any remaining issues from EP-CODEX-001"
```
