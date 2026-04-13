# Phase 1 Implementation Brief — IA Terminology, Score Fix, Audit Enum

**Design spec:** `docs/superpowers/specs/2026-04-12-unified-capability-and-integration-lifecycle-design.md` (Sections 6.3, 8.2, 9, 12 Phase 1, 13, 15)
**Date:** 2026-04-12
**Phase:** 1 of 4
**Depends on:** Nothing — Phase 1 has no dependencies.
**Unblocks:** Phase 2-E (Capability Inventory page needs the Tools & Integrations nav structure from Workstream C here), Phase 3 (audit class enum defined in Workstream B here)
**Parallelism:** Phase 1 Workstreams A and B are fully independent of all Phase 2 work and can run concurrently. Phase 1 Workstream C (IA/nav restructure) must complete before Phase 2 Workstream E (Capability Inventory page).

---

## What this phase delivers

1. **Route log score normalization** — data integrity bug fix (do not defer)
2. **Audit class enum** — constant definitions needed by Phase 3
3. **IA and terminology pass** — rename confusing actions, restructure navigation into three sections, add URL redirects

These three workstreams are independent and can be implemented in any order or in parallel.

---

## Workstream A: Route log score normalization

### Why this is urgent

`RouteDecisionLog.fitnessScore` is stored at the wrong scale and the two UI components that display it disagree on what scale to expect. Live data already contains `NaN` values.

### Files to read first (in order)

1. `apps/web/lib/routing/task-router.ts` — read `getDimensionScore()` (line 42) and the score computation block (lines 185–210). Determine what scale `getDimensionScore` returns. The endpoint manifest fields (`reasoning`, `codegen`, `toolFidelity`, etc.) are profiling scores — verify their range before writing the fix.
2. `apps/web/components/platform/RouteDecisionLog.tsx` — read `fitnessColor()` (line 46). It uses 0..1 thresholds (0.8, 0.5) and renders `(score * 100).toFixed(0)%`. This component expects 0..1 input.
3. `apps/web/components/platform/RouteDecisionLogClient.tsx` — read `fitnessColor()` (line 32). It uses 0..100 thresholds (70, 40) and renders the raw value. This is the conflicting component.
4. `packages/db/prisma/schema.prisma` — `RouteDecisionLog.fitnessScore` at line 3817. Currently `Float` (non-nullable).

### Fix target

Canonical stored `fitnessScore` must be `0..1`. All paths that write it must normalize before persisting. Both UI components must agree on 0..1 input.

### Writer fix (task-router.ts)

The bug is at line 204:
```typescript
finalFitness = 0.6 * finalFitness + 0.4 * costFactor * 100;
```

`costFactor` is in 0..1 range. `* 100` inflates it to match the 0..100 qualityFitness scale. Fix by keeping everything in 0..1: change `costFactor * 100` to `costFactor`. Then divide the final result to normalize to 0..1 at assignment (line 207). The correct normalization depends on the confirmed scale of getDimensionScore — if it returns 0..100, divide by 100 at assignment; if it already returns 0..1, the costFactor * 100 was the only bug.

Search for any other paths that write `fitnessScore` to `RouteDecisionLog` (grep for `fitnessScore` and `RouteDecisionLog` across `apps/web/lib/`) and apply the same normalization.

### UI fix (RouteDecisionLogClient.tsx)

Change `fitnessColor()` thresholds from 70/40 to 0.7/0.4. Change the render output to use `(score * 100).toFixed(0)%` to match `RouteDecisionLog.tsx`.

Both components must handle `null` or `undefined` fitnessScore gracefully — render `—` or `unscored`, not `0%` or `NaN%`.

### Migration

Create migration `20260412200000_normalize_fitness_score`:

1. Make `fitnessScore` nullable: `ALTER TABLE "RouteDecisionLog" ALTER COLUMN "fitnessScore" DROP NOT NULL;`
2. Update the Prisma schema: `fitnessScore Float?`
3. Backfill existing rows using these rules in order (do not skip any):
   - `NaN` → `NULL`: `UPDATE "RouteDecisionLog" SET "fitnessScore" = NULL WHERE "fitnessScore" != "fitnessScore";` (Postgres NaN check)
   - `value > 1.0` → `value / 100`: `UPDATE "RouteDecisionLog" SET "fitnessScore" = "fitnessScore" / 100.0 WHERE "fitnessScore" > 1.0;`
   - `value >= 0.0 AND value <= 1.0` → no change (already normalized)
   - `value < 0.0` → `NULL`: `UPDATE "RouteDecisionLog" SET "fitnessScore" = NULL WHERE "fitnessScore" < 0;`
4. Run `pnpm --filter @dpf/db exec prisma migrate dev --name normalize_fitness_score` to generate the migration.

Do not remove the `fitnessScore` column — it remains the stored field. Do not add any new columns.

---

## Workstream B: Audit class enum

This is a small code change. The enum must exist before Phase 3 audit work references it.

### Create a shared constants file

**New file:** `apps/web/lib/audit-classes.ts`

```typescript
// apps/web/lib/audit-classes.ts
// Canonical audit class values for ToolExecution and future AuditEvent model.
// These are enforced string values — do not add synonyms.
// Phase 3 will add these as a DB column. Phase 1 just defines the constants.

export const AUDIT_CLASSES = ["ledger", "journal", "metrics_only"] as const;
export type AuditClass = (typeof AUDIT_CLASSES)[number];

/**
 * ledger      — Always retained in full. Side-effecting writes, destructive actions,
 *               approvals, credential changes, cross-boundary writes.
 * journal     — Retained for 30 days rolling. External reads, reasoning checkpoints,
 *               behavior tests.
 * metrics_only — No payload retained. Read chatter, probes, health pings, list/search.
 */
```

No other files need to change in Phase 1. Phase 3 will import this constant when adding the `auditClass` column.

---

## Workstream C: IA and navigation restructure

### Scope

The current flat `AiTabNav` (9 tabs, all under `/platform/ai`) must be replaced with three nav sections. Pages must move to their new URL homes. HTTP 301 redirects are required from all old URLs.

### Read these files first

- `apps/web/components/platform/AiTabNav.tsx` — current nav (9 tabs)
- `apps/web/app/(shell)/platform/ai/page.tsx` — current AI landing, imports AiTabNav
- `apps/web/app/(shell)/platform/page.tsx` — platform root links, needs label updates
- All page files under `apps/web/app/(shell)/platform/ai/` and `apps/web/app/(shell)/platform/services/` and `apps/web/app/(shell)/platform/integrations/` — understand what each page does before moving it

### Target URL structure

**AI Workforce** (`/platform/ai`)
| Current page | Current URL | New URL | New label |
| --- | --- | --- | --- |
| Workforce landing | `/platform/ai` | `/platform/ai` | Overview |
| Model Assignment | `/platform/ai/model-assignment` | `/platform/ai/assignments` | Assignments |
| External Services (providers only) | `/platform/ai/providers` | `/platform/ai/routing` or keep at `/platform/ai/providers` | Routing & Calibration |
| Build Studio | `/platform/ai/build-studio` | `/platform/ai/build-studio` | Build Studio CLI |
| Skills | `/platform/ai/skills` | `/platform/ai/skills` | Skills |

**Tools & Integrations** (new section, `/platform/tools`)
| Current page | Current URL | New URL |
| --- | --- | --- |
| MCP Integrations Catalog | `/platform/integrations` | `/platform/tools/catalog` |
| MCP Services | `/platform/services` | `/platform/tools/services` |
| MCP Service detail | `/platform/services/[serverId]` | `/platform/tools/services/[serverId]` |
| MCP Activate | `/platform/services/activate` | `/platform/tools/services/activate` |

**Audit & Operations** (new section, `/platform/audit`)
| Current page | Current URL | New URL |
| --- | --- | --- |
| Action History | `/platform/ai/history` | `/platform/audit/ledger` |
| Route Log | `/platform/ai/routing` | `/platform/audit/routes` |
| Operations | `/platform/ai/operations` | `/platform/audit/operations` |
| Authority | `/platform/ai/authority` | `/platform/audit/authority` |

> **Note:** The providers page currently mixes LLM provider cards and MCP server cards. Read the page source carefully (`apps/web/app/(shell)/platform/ai/providers/page.tsx`). The LLM provider section stays under AI Workforce > Routing & Calibration. If the MCP server cards can be cleanly separated into a different component, move them to Tools & Integrations. If they can't be cleanly separated in Phase 1, leave the full page under AI Workforce with a note that the MCP card section moves in Phase 2 when the Services page is the canonical home.

### Implementation approach

1. **Create nav components for each new section.** The `AiTabNav` pattern is a good model — one component per section with its tabs. Create:
   - `WorkforceTabNav.tsx` (tabs for AI Workforce section)
   - `ToolsTabNav.tsx` (tabs for Tools & Integrations section)
   - `AuditTabNav.tsx` (tabs for Audit & Operations section)

2. **Create section layouts.** Each new section should have a layout that renders its nav. Create:
   - `apps/web/app/(shell)/platform/ai/layout.tsx` (AI Workforce nav)
   - `apps/web/app/(shell)/platform/tools/layout.tsx` (Tools & Integrations nav)
   - `apps/web/app/(shell)/platform/audit/layout.tsx` (Audit & Operations nav)

3. **Move pages.** Move or copy page files to new URLs. Do not delete old files — add redirect files at old paths.

4. **Add HTTP 301 redirects.** For every old URL, create a redirect file. In Next.js App Router, use `redirect()` from `next/navigation` in a minimal page component, or add permanent redirect config in `next.config.js`. Example:
   ```typescript
   // apps/web/app/(shell)/platform/ai/history/page.tsx (after move)
   import { redirect } from "next/navigation";
   export default function HistoryRedirect() { redirect("/platform/audit/ledger"); }
   ```
   Mark as permanent (HTTP 301) where Next.js App Router allows it.

5. **Update `platform/page.tsx`.** The Platform root page links to `/platform/ai`, `/platform/integrations`, and `/platform/services`. Update labels and hrefs to match new section homes.

6. **Rename label strings** in nav components and page headings per the new terminology (Section 6.3 of the design spec):
   - "External Services" → "Routing & Calibration" (for the providers/model routing page)
   - "Build Studio" → "Build Studio CLI" (label change only, not URL)
   - "Action History" → "Action Ledger"
   - "Operations" → "Long-running Operations"

7. **Do not rename** these provider page action labels as part of the nav restructure — those are Workstream D (separate):
   - "Test Connection", "Sync Models & Profiles", "Run Eval", "Run Probes"

### Provider page action renames (Workstream D — can be separate PR)

These are label-only changes on the LLM provider detail page and any management UI buttons:

| Current label | New label |
| --- | --- |
| Test connection | Verify Connection + Refresh Catalog (split) or "Connect & Prepare" (combined) |
| Sync Models & Profiles | Refresh Model Catalog |
| Run Eval | Update Routing Scores |
| Run Probes / Run Full Tests | Health Probes / Behavior Tests |

Read `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx` and `apps/web/app/(shell)/platform/ai/providers/page.tsx` to find all button labels before changing them. If the test-connection button triggers a multi-step flow (auth + discovery + profiling), add a subtitle or tooltip that says "Verifies connection, refreshes catalog, and syncs routing scores." Do not change the underlying server action behavior — Phase 1 is labels only.

---

## Acceptance criteria (from design spec Section 15)

- [ ] `RouteDecisionLog.fitnessScore` is stored in 0..1 range. New writes from task-router are normalized before persistence.
- [ ] Both `RouteDecisionLog.tsx` and `RouteDecisionLogClient.tsx` use the same 0..1 thresholds and render the same format. NULL fitnessScore renders as "—".
- [ ] `AUDIT_CLASSES` constant exists in `apps/web/lib/audit-classes.ts` and is exported.
- [ ] Navigation is organized into three sections: AI Workforce, Tools & Integrations, Audit & Operations.
- [ ] Every old URL that moved has an HTTP 301 redirect to the new canonical URL.
- [ ] "Build Studio" section is labeled "Build Studio CLI" in nav and page heading.
- [ ] "Action History" page is labeled "Action Ledger" at its new URL.
- [ ] No 404s on previously-bookmarkable admin pages.
- [ ] TypeScript and lint pass with no new warnings.

---

## What NOT to do in Phase 1

- Do not change any server action logic (test-connection flow, sync models flow). Phase 1 is labels only for those.
- Do not add new DB columns. The only schema change is making `fitnessScore` nullable.
- Do not implement Capability Inventory, CapabilityInventoryView, or sync-capabilities.ts — that is Phase 2.
- Do not implement audit log split (Action Ledger vs Capability Journal UI) — that is Phase 3.
- Do not implement the Tools & Integrations "Capability Inventory" subsection — that page does not exist yet. Create the section with catalog and services only.
- Do not change MCP server health check behavior or integration lifecycle logic — that is Phase 2.
