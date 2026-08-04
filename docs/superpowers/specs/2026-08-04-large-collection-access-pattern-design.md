# Large-collection access pattern — purpose-first retrieval for surfaces that list many records

- **Status:** draft (substrate-verified; implementation phased) · **Date:** 2026-08-04
- **Backlog item:** BI-09C2F1DA · **Epic:** EP-UX-SYSTEM (systemic UX capability home)
- **Related:** BI-836923AD (list-completeness detector — the negative signal this pattern is the positive answer to) · BI-939E57D0 (page-purpose contract) · EP-UX-COGLOAD (per-page remediation, which keeps hitting this same wall) · EP-PEOPLE-HCM-CORE (the HR directory instance)
- **Grounded in:** [`2026-07-22-holistic-ux-system-and-agent-codification-design.md`](2026-07-22-holistic-ux-system-and-agent-codification-design.md) §L1/§L2 — this spec adds the missing *data-access* half of the shells-and-budgets contract

## 1. Problem

The founder's observation (2026-07-25):

> The HR directory likely will not work at scale (e.g. 3,000 employees). More generally: we need to better support access to large information sets in a smarter way given the purpose.

The instinct to generalise is right, and the generalisation is sharper than "add pagination". Across the estate, a surface that holds a large collection does one of two things, and **both are the same mistake wearing different clothes**:

- **dump-all** — fetch every row, render every row; or
- **silent cap** — fetch every row, render the first N, say nothing.

Both answer a question the reader did not ask ("here is the set") instead of the one they did ("where is the record I want / how is the set doing"). The cap is the more dangerous of the two, because a truncated list that does not admit it is *indistinguishable from a complete one* — the reader draws a conclusion from data that was never on screen.

## 2. Substrate verification (this section is evidence, not assumption)

BI-09C2F1DA explicitly says: *"Do NOT assert the HR directory is broken without verifying its current implementation first."* Verified on `origin/main` at `cf800be42de`, 2026-08-04.

**The HR directory does not paginate, at any layer.**
`apps/web/lib/workforce/workforce-data.ts:17` — `getEmployeeDirectoryRows()` is an unbounded `prisma.employeeProfile.findMany({ orderBy: { displayName: "asc" }, select: { …, department, position, manager, dottedLineManager, workLocation } })`: no `take`, no `skip`, no `where`, five relation joins, every row serialised into the client component. `apps/web/app/(shell)/employee/page.tsx:62` does the same for `prisma.user.findMany()`. At 3,000 employees this is one unbounded query with five joins per page view, and a multi-megabyte RSC payload. **The founder's concern is confirmed in code.**

**`report-kit`'s `DataTable` does not solve it, and says so.**
`apps/web/components/ui/report-kit/DataTable.tsx` sorts and paginates **client-side** — `paginateRows()` is `rows.slice(start, start + pageSize)` over an array the caller already fetched in full. Its own header comment: *"Data-source-agnostic: the caller fetches rows (often in a server component) and passes them in… Server-driven sort/paginate is a documented follow-up."* So `pageSize` improves the *rendering* cost and does nothing for the *transfer* or *query* cost. Adopting it for a 3,000-row directory would make the surface look fixed while the actual scaling defect is untouched — the most expensive possible outcome.

**The pattern is estate-wide, not an HR bug.** None of the routes named in the BI bound their query; one caps in the client with no total:

| Route | `take:` | client `slice(0,N)` | `pageSize` |
|---|---|---|---|
| `/platform/ai/skills` | 0 | 0 | 0 |
| `/platform/tools/discovery` | 0 | 0 | 0 |
| `/platform/identity/agents` | 0 | 0 | 0 |
| `/admin/twin-gallery` | 0 | 0 | 0 |
| `/platform/tools/integrations` | 0 | **1** | 0 |
| `/inventory` | 0 | 0 | 0 |

**What already exists and must be reused, not reinvented** (`apps/web/components/ui/report-kit/`): `FilterBar` (already has a **`url` mode** that is function-free and server-component-safe — the natural transport for server-side query state), `DataTable` (presentation + the `Column` contract), `CollapsibleList` (truncate one list), `ExpandableCard` (defer one record's detail), `SearchableSelect` (pick one of many — added 2026-08-04 under BI-D6135B88), `EmptyState`, `Skeleton`. The gap is **not** a table component. It is that **no surface can express a query it does not fully materialise**.

## 3. The reframe

> A large collection is not a thing to display. It is a thing to *ask questions of*.

The design error is treating collection size as a *rendering* problem (so the fix looks like pagination or virtualization) when it is a *retrieval* problem (so the fix looks like a query contract). Pagination applied to a dump-all query is a smaller window onto the same mistake.

The corollary that decides the default view: **the answer to "what should this page show first?" is a property of the surface's purpose, not of the collection's size.** A directory of 3,000 employees whose purpose is *find one person* should open on a search field and a headcount — not on page 1 of 60. That is the same claim BI-939E57D0 makes for pages generally, applied to collections.

## 4. The pattern

Five obligations. A surface listing a large collection satisfies all five or it is not migrated.

**P1 — Purpose-first default.** The landing state answers the surface's actual job: *find* (search-first), *scoped view* (my team, this department, open items), or *summarise* (headcount by department, coverage by status) with drill-down. Scrolling N rows is a fallback the reader chooses, never the default they are handed.

**P2 — The query is server-side and bounded.** Search, filter, sort and paginate resolve in the database. A route may never load a collection in full to render a page of it. Concretely: no unbounded `findMany` on a collection whose size is user-data-driven.

**P3 — The total is always stated.** "3,000 employees · showing 1–50." A count is one cheap `prisma.count()` and it is what converts a truncation from a lie into a fact. This is the positive form of BI-836923AD's detector.

**P4 — There is always a way to more.** Next page, broaden the filter, export. A reader who can see that rows exist beyond the window must be able to reach them.

**P5 — Virtualize only when the list is genuinely a list.** Virtualization is a rendering optimisation applied *after* P1–P4, not a substitute for them. Virtualizing a 3,000-row client array satisfies nothing above: the query is still unbounded and the payload is still multi-megabyte.

### Composition with the existing UX system

The budget axes in `apps/web/lib/ux-budget/` already reward this shape, which is a useful independent check that the pattern is right rather than merely tidy: P1 lowers `defaultVisibleWords`; P3's total is the count that `promoteClosedSummaries` deliberately keeps visible; and a search-first default measures as *fewer* words with *more* reachable data — the sweep rewards purpose-first retrieval without needing a new axis.

## 5. Proposed substrate

Two pieces, deliberately small, both extending what exists:

1. **A typed server-query contract** — `CollectionQuery` (`search`, `filters`, `sort`, `page`, `pageSize`) ⇄ `CollectionPage<T>` (`rows`, `total`, `page`, `pageSize`, plus the applied query echoed back). Serialisable both ways so it round-trips through `searchParams`, which is what makes it usable from a server component and shareable as a URL. `FilterBar`'s existing `url` mode is the front half of this and should be the transport rather than a second mechanism.
2. **A `CollectionView` shell** composing `FilterBar` (url mode) + `DataTable` (presentation only) + a count/paging footer, taking a `CollectionPage<T>` and a server action or route that resolves a `CollectionQuery`. `DataTable` keeps its client-side mode for the small-collection cases that are legitimately fine today; `CollectionView` is what large surfaces adopt.

**Enforcement** should follow the platform's existing grain — a guard that fails an unbounded `findMany` on a registered large-collection model, in the same family as the ux-budget ratchet, so the pattern does not decay back to dump-all one route at a time. This is a Phase-3 concern; the ordering below deliberately does not gate Phase 1 on it.

## 6. Phasing

- **Phase 1 — contract + shell.** Land `CollectionQuery`/`CollectionPage` and `CollectionView` in `report-kit`, with unit tests. No route changes.
- **Phase 2 — HR directory.** Migrate `getEmployeeDirectoryRows()` and `/employee`: search-first landing, `prisma.count()` total, server-side page/filter, department/status scopes. This is the founder-raised instance and the proof the contract survives a real surface.
- **Phase 3 — the rest, worst-first,** ordered by the route-budget league table, with the guard landing alongside so migrated routes cannot regress.

## 7. Recommendation on epic shape

The BI anticipates its own epic ("likely warrants its own epic if the scope confirms"). The scope **does** confirm — six-plus routes, a new shared contract, a data-access guard, and a schema-adjacent migration — but the work is a *data-access* capability, not a new UX programme, and its enforcement rides the machinery EP-UX-SYSTEM already owns. Recommendation: **keep it under EP-UX-SYSTEM** as a phased track rather than minting a parallel epic, and revisit only if Phase 3 grows a migration backlog large enough to need independent scheduling. Splitting a shared primitive away from the gate that enforces it is how the two drift.

## 8. Open questions for founder/architect review

1. **Where is the P2 line drawn?** Proposal: any collection whose size is user-data-driven and unbounded (employees, backlog items, tools, agents, inventory) — as opposed to platform-fixed sets (six platform roles), which may stay in-memory.
2. **Does `DataTable` keep its client mode?** Proposal: yes, for genuinely small sets, but `CollectionView` becomes the documented default for anything user-data-driven, so the easy path is the correct one.
3. **Does the guard block or report first?** Proposal: report-only until Phase 2 proves the contract, then block — the same two-clock rollout the route-budget sweep uses.
