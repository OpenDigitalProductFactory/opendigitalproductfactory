# Complaints Persistence — Implementation Plan (BI-C10A4648)

> Ship Real Functionality audit follow-up. Epic: EP-SHIP-REAL-AUDIT.
> Status: IMPLEMENTED on branch `fix/complaints-persistence` (this plan documents the approach for review and for the BI record).

## Context

`/complaints` (built by Build Studio FB-BB6567DC) rendered a `DEMO_COMPLAINTS`
array held in React `useState`, with a "Submit Complaint" button whose handler
only mutated local state. It was a fictional surface: five fabricated named
customers (Sarah Chen, …) presented as the live complaint register, and filed
complaints vanished on refresh. There was no `Complaint` model.

**What already exists (reuse, do not rebuild):**
- `components/ui/report-kit` — `DataTable`, `FilterBar`, `StatusBadge` with
  `complaintSeverity` / `complaintStatus` domains already defined in
  `statusColors.ts`. The presentation is correct; only the data was fake.
- `lib/actions/*` server-action conventions (`"use server"`, `nanoid` refs,
  `revalidatePath`).
- Prisma migration convention: timestamped dir under
  `packages/db/prisma/migrations/` with a `migration.sql`.

## Concurrency note

The complaints UI was under concurrent work on `feat/report-kit-complaints`
(BI-6A842691, report-kit migration). This change is based on `origin/main`'s
current `ComplaintsClient.tsx`. If that branch is still open it must rebase onto
this; the collision surface is `ComplaintsClient.tsx` only.

## Approach

Backend-first, then a minimal client rewire that preserves the existing
report-kit presentation.

### Phase 1 — Data model
- Add `model Complaint` to `packages/db/prisma/schema.prisma`: `id` (cuid),
  `reference` (unique human ref `C-XXXXXXXX`), `customerName`, `description`,
  `severity` (default `medium`), `category` (default `Other`), `status`
  (default `open`), `createdAt`, `updatedAt`; indexes on `status`, `createdAt`.
- Migration `20260530160000_add_complaint_model/migration.sql` (CREATE TABLE +
  indexes), matching Prisma's deterministic output. No tenant FK — the surface
  is a single-install internal register, consistent with `OrgSettings`/finance.

### Phase 2 — Server actions (`lib/actions/complaints.ts`)
- `listComplaints(): ComplaintView[]` — `prisma.complaint.findMany` newest-first,
  mapped to the view shape (`reference` → `id`, `createdAt` → ISO).
- `createComplaint(input)` — trims + validates required fields, whitelists
  severity/category, inserts with a `nanoid` reference, `revalidatePath`,
  returns the stored row (`{ success, complaint } | { success: false, error }`).

### Phase 3 — Wire the surface
- `page.tsx` → async server component: `await listComplaints()` →
  `<ComplaintsClient initialComplaints={…} />`.
- `ComplaintsClient.tsx`: drop `DEMO_COMPLAINTS`; type alias to `ComplaintView`;
  `useState(initialComplaints)`; `handleSubmit` calls `createComplaint` inside
  `useTransition`, prepends the returned row, surfaces errors and a pending
  state on the submit button. Empty register shows the existing empty-state.

### Phase 4 — Tests / verification
- `ComplaintsClient.test.tsx`: pass `initialComplaints` fixtures (mock the
  `"use server"` module), assert rows render, StatusBadge intents, the filter
  facet, and the empty-state.
- `tsc --noEmit` clean (requires `prisma generate` after the schema change).

## Follow-ups (out of scope here)
- Status transitions (open → investigating → resolved → closed) from the table.
- Linking complaints to customer accounts / portal support intake.
- Tenant scoping if/when the install model becomes multi-org.
