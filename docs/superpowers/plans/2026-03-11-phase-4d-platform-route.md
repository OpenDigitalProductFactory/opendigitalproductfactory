# Phase 4D — Platform Route Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/platform` route showing all platform capabilities with their state.

**Architecture:** Two-file change: create `platform/layout.tsx` (auth gate using `view_platform`) and `platform/page.tsx` (server component querying `prisma.platformCapability.findMany`, rendering a 2-col card grid with state badge).

**Tech Stack:** Next.js 14 App Router server components, Prisma 5, Tailwind CSS, TypeScript strict mode (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `moduleResolution: "bundler"`).

---

## Codebase Context

Working directory: `d:/OpenDigitalProductFactory`

TypeScript rules:
- `moduleResolution: "bundler"` — NO `.js` extensions on local imports in `apps/web`
- `noUncheckedIndexedAccess: true` — `Record<string, V>` indexing returns `V | undefined`; always use `?? fallback`
- `exactOptionalPropertyTypes: true` — use `!= null` for optional DB fields typed as `string | null`

Test command: `pnpm test` (run from `d:/OpenDigitalProductFactory`)
Expected baseline: 53 tests passing (42 web + 11 db). No new unit tests in this phase.

TypeScript check: `cd d:/OpenDigitalProductFactory/apps/web && pnpm tsc --noEmit 2>&1 | head -20`

**Note on test exit code:** `pnpm test` may exit with code 1 due to Windows bash profile noise. Verify success by reading the `Tests N passed` line, not exit code.

**Note on TS check:** There may be one pre-existing error in `app/(shell)/layout.tsx` unrelated to this phase. Confirm no **new** errors appear.

---

## Reference

- Spec: `d:/OpenDigitalProductFactory/docs/superpowers/specs/2026-03-11-phase-4d-platform-route-design.md`
- Pattern: `d:/OpenDigitalProductFactory/apps/web/app/(shell)/employee/layout.tsx` — auth gate
- Pattern: `d:/OpenDigitalProductFactory/apps/web/app/(shell)/employee/page.tsx` — card grid with description

---

## Task 1: Create `platform/layout.tsx` — auth gate

**File to create:** `apps/web/app/(shell)/platform/layout.tsx`

### Exact file contents

```tsx
// apps/web/app/(shell)/platform/layout.tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "view_platform"
    )
  ) {
    notFound();
  }

  return <>{children}</>;
}
```

### Steps

- [ ] **Step 1.1: Create the file** with the exact contents above.
- [ ] **Step 1.2: TypeScript check**
  ```bash
  cd d:/OpenDigitalProductFactory/apps/web && pnpm tsc --noEmit 2>&1 | head -20
  ```
  Expected: no new errors.
- [ ] **Step 1.3: Run tests**
  ```bash
  cd d:/OpenDigitalProductFactory && pnpm test 2>&1 | grep -E "Tests|passed|failed"
  ```
  Expected: `Tests 53 passed`.
- [ ] **Step 1.4: Commit**
  ```bash
  cd d:/OpenDigitalProductFactory
  git add "apps/web/app/(shell)/platform/layout.tsx"
  git commit -m "feat(web): add /platform auth gate (view_platform)"
  ```

---

## Task 2: Create `platform/page.tsx` — capability registry

**File to create:** `apps/web/app/(shell)/platform/page.tsx`

### Exact file contents

```tsx
// apps/web/app/(shell)/platform/page.tsx
import { prisma } from "@dpf/db";

const STATE_COLOURS: Record<string, string> = {
  active: "#4ade80",
};

export default async function PlatformPage() {
  const capabilities = await prisma.platformCapability.findMany({
    orderBy: { capabilityId: "asc" },
    select: {
      id: true,
      capabilityId: true,
      name: true,
      description: true,
      state: true,
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Platform</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {capabilities.length} capabilit{capabilities.length !== 1 ? "ies" : "y"}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {capabilities.map((c) => {
          const stateColour = STATE_COLOURS[c.state] ?? "#555566";

          return (
            <div
              key={c.id}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
              style={{ borderLeftColor: "#fb923c" }}
            >
              <p className="text-[9px] font-mono text-[var(--dpf-muted)] mb-1">
                {c.capabilityId}
              </p>
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-sm font-semibold text-white leading-tight">
                  {c.name}
                </p>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: `${stateColour}20`, color: stateColour }}
                >
                  {c.state}
                </span>
              </div>
              {c.description != null && (
                <p className="text-[10px] text-[var(--dpf-muted)] line-clamp-2">
                  {c.description}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {capabilities.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No capabilities registered yet.</p>
      )}
    </div>
  );
}
```

### TypeScript notes

- `STATE_COLOURS[c.state]` — `Record<string, string>` returns `string | undefined` under `noUncheckedIndexedAccess`; `?? "#555566"` fallback required.
- `c.description != null` — correct guard for `String?` Prisma field typed as `string | null`.
- Pluralisation: `capabilit{capabilities.length !== 1 ? "ies" : "y"}` produces `"1 capability"` / `"N capabilities"` correctly. Note: the static text is `"capabilit"` (not `"capability"`) — appending `"y"` or `"ies"` gives the correct result.

### Steps

- [ ] **Step 2.1: Create the file** with the exact contents above.
- [ ] **Step 2.2: TypeScript check**
  ```bash
  cd d:/OpenDigitalProductFactory/apps/web && pnpm tsc --noEmit 2>&1 | head -20
  ```
  Expected: no new errors.
- [ ] **Step 2.3: Run tests**
  ```bash
  cd d:/OpenDigitalProductFactory && pnpm test 2>&1 | grep -E "Tests|passed|failed"
  ```
  Expected: `Tests 53 passed`.
- [ ] **Step 2.4: Commit**
  ```bash
  cd d:/OpenDigitalProductFactory
  git add "apps/web/app/(shell)/platform/page.tsx"
  git commit -m "feat(web): add /platform route (platform capability registry)"
  ```

---

## Architecture Notes

### No Header change needed

`/platform` is a workspace tile route, not a global nav item.

### No Prisma migration needed

`PlatformCapability` model is already in the schema. No migration required.

### Empty state

The `PlatformCapability` table is empty in the seeded database. The page gracefully handles this.
