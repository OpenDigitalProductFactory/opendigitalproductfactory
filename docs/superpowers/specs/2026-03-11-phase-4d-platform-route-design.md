# Phase 4D — Platform Route Design

**Date:** 2026-03-11
**Status:** Draft
**Scope:** Add a `/platform` route — a platform capability registry showing all `PlatformCapability` records with their state.

---

## Overview

The Platform route shows the platform's registered capabilities — the feature flags and capability manifest for the Digital Product Factory platform. Enterprise Architects use this to understand which platform capabilities are active or inactive.

This is a read-only view of the `PlatformCapability` table (seeded empty; capabilities are registered through the admin interface in future phases).

**Navigation:** The workspace tile already links to `/platform`. No header nav change.

---

## Route Structure

```
app/(shell)/
  platform/
    layout.tsx     — auth gate: view_platform (HR-000, HR-200, HR-300)
    page.tsx       — server component; lists all platform capabilities
```

Uses the existing `(shell)` layout. No sidebar.

---

## Data

One Prisma query:

```ts
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
```

`state` values: `"active"` | `"inactive"` (default `"inactive"`). `description` is nullable (`String?`).

---

## Page Layout

```
/platform

[heading] Platform
[subheading] N capabilities

[grid of capability cards — 1-col sm:2-col]
```

Capabilities ordered by `capabilityId` ascending.

### Capability card fields

| Field | Rendering |
|---|---|
| `capabilityId` | Top; monospace (`font-mono`), `text-[9px]`, muted |
| `name` | Bold (`font-semibold`), white, `text-sm` |
| `description` | If not null: `text-[10px]`, muted, clamped to 2 lines (`line-clamp-2`) |
| `state` | Status badge: `text-[9px] px-1.5 py-0.5 rounded-full`, colour-coded |

State colours:
```ts
const STATE_COLOURS: Record<string, string> = {
  active: "#4ade80",  // green-400
};
// fallback: "#555566"
```

Card left-border colour: fixed `"#fb923c"` (the `platform` workspace tile accent colour) for all capability cards.

Cards are not links — no capability detail page in Phase 4D.

---

## What Changes

### 1. `platform/layout.tsx` — auth gate

`apps/web/app/(shell)/platform/layout.tsx`

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

### 2. `platform/page.tsx` — new route

`apps/web/app/(shell)/platform/page.tsx`

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

---

## Auth

`platform/layout.tsx` uses `view_platform` which allows `HR-000` (CDIO), `HR-200` (Digital Product Manager), and `HR-300` (Enterprise Architect) plus superusers.

---

## Files to Create

| File | Action |
|---|---|
| `apps/web/app/(shell)/platform/layout.tsx` | Create auth gate |
| `apps/web/app/(shell)/platform/page.tsx` | Create new page |

No existing files need modification.

---

## Testing

No new unit tests. TypeScript check validates the Prisma query shape.

---

## What This Does Not Include

- Capability detail page with manifest JSON (future)
- McpServer or ModelProvider registries (separate future phases)
- Capability create/edit (out of scope for read-only views)
- Filtering by state (future)
