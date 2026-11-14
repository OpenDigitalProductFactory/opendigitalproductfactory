---
status: active
---

# Wiki editor: link autocomplete, dangling-link warning and preview — implementation plan (BI-2F7BE778)

Design: §3.5 and §7 of the
[knowledge linking design](../specs/2026-10-14-knowledge-linking-design.md),
under the scope rules R1, R4, R5 (ranking) and R7 of §2. Scope manifest:
[knowledge-linking-editor](../specs/2026-10-14-knowledge-linking-editor-design.md).
It builds on BI-825D3487 (corpus read grants), whose branch this one sits on,
and reuses the backlinks reader rule (`canReadWikiPage`, BI-4EAFF7AC).
Each phase is test-first: the failing behaviour test lands before the code.

## Substrate check

- **Combobox.** `components/ui/ReferenceTypeahead.tsx` owns its own `<input>`,
  its own fetch and debounce, and floating-ui positioning.
  `components/ui/form/SearchableSelect.tsx` is a select-only combobox that
  filters a fixed option list. Neither can be driven by a textarea caret, and
  the quick switcher (BI-359C7C2F) needs an input-driven one. So, as §3.5 says,
  one new `components/shared/Combobox.tsx` serves both. It has no dependency.
- **Resolver.** `detectDanglingXrefs` holds the slug-set rule inline. It moves
  to a shared module, and the detector calls it. The rule stays the same.
- **Parser.** `extractWikilinks` (`packages/db/src/wiki-frontmatter.ts`) is the
  one link extractor (BI-23900D0A). The editor needs line numbers, so a sibling
  `extractWikilinkOccurrences` is added on the same code-stripping pass, and
  `extractWikilinks` is derived from it. No second regex is written.
- **Trigram index.** `pg_trgm` is installed (migration
  `20260704120000_add_mdm_normalized_columns_and_trgm`). No `WikiPage` column
  has a trigram index. §7 does not ask for one. The query reads `title` and
  `slug` from a table of a few hundred rows, after the organization filter, so
  a scan stays far under the target. BI-FC5E4832 owns the GIN index on `body`.
  This item adds no migration.

## Phase 1 — one parser and the shared resolver (AC-KLE-3)

- `extractWikilinkOccurrences(body)` in `packages/db/src/wiki-frontmatter.ts`
  returns `{ slug, line }` for every link outside code. `extractWikilinks`
  becomes its deduped slug list.
- New `apps/web/lib/wiki/link-resolution.ts`: `buildWikiSlugIndex(pages)`,
  `resolvableSlugs(index, organizationId)`, `danglingTargets(body, slugs)` and
  `danglingLinks(body, slugs)` (with line numbers).
- `detectDanglingXrefs` (`apps/web/lib/wiki/lint-detectors.ts`) calls the
  shared module and keeps no rule of its own.

Tests: `packages/db/src/wiki-frontmatter.test.ts` (occurrences and lines,
code skipped); `apps/web/lib/wiki/link-resolution.test.ts` (organization
falls back to kernel, kernel sees only kernel, another organization's slug is
dangling, line numbers); the existing `lint-detectors.test.ts` stays green.

## Phase 2 — scoped suggestions (AC-KLE-1, AC-KLE-2)

- New `apps/web/lib/wiki/link-suggest.ts`:
  - `linkSourceScope(page)` and `allowedTargetScopes(source)`: R4 direction.
    An organization page may link kernel, profession and organization pages.
    A profession page may link only profession and kernel pages. A kernel
    page is offered nothing (R7).
  - `queryLinkCandidates(db, input)`: one `$queryRaw` that pushes the
    organization and corpus filters into SQL and ranks by `pg_trgm`
    `similarity` and `word_similarity` on `title` and `slug`.
  - `selectLinkSuggestions(candidates, input)`: every row passes
    `canReadWikiPage` (R1) and the R4 filter. An overlay masks the kernel page
    it overrides. The page being edited is left out. Rows are ranked
    by the reader's family first (R5) and capped at 8.
- New `GET /api/wiki/link-suggest?q=&from=` (`apps/web/app/api/wiki/link-suggest/route.ts`):
  needs a session, uses the reader organization seam
  (`resolveReaderOrganizationId`) and `PERSON_CORPUS_SCOPE`. It returns no rows
  below two characters. A `Server-Timing` header lets the 200 ms p95 target be
  measured at the route.

Tests: `apps/web/lib/wiki/link-suggest.test.ts` (direction table; another
organization's page, a profession family outside the reader's set, and an
organization page for a profession source never appear; the cap; the
overlay masking its kernel page; the SQL scope parameters);
`apps/web/app/api/wiki/link-suggest/route.test.ts` (401 without a session,
short query, scope passed through, timing header).

## Phase 3 — the shared Combobox (AC-KLE-1, AC-KLE-4)

- New `apps/web/components/shared/Combobox.tsx`: `useCombobox` (state and
  keyboard for any controlling element), `ComboboxListbox` (the popup
  listbox), and `Combobox` (an input-driven combobox for the quick switcher).
  It follows the WAI-ARIA APG combobox pattern: `role="combobox"`,
  `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`,
  `aria-activedescendant`. Arrow keys wrap. Enter and, when enabled, Tab
  select. Escape and Alt+ArrowUp close. Alt+ArrowDown opens. Mouse selection
  keeps focus in the control. Theme tokens only.

Tests: `apps/web/components/shared/Combobox.test.tsx` (ARIA wiring, every
key, mouse selection, empty and loading states, no option when closed).

## Phase 4 — the editor (AC-KLE-1, AC-KLE-3, AC-KLE-4)

- New `apps/web/lib/wiki/link-autocomplete.ts`: `findOpenLinkQuery(text,
  caret)` and `insertWikiLink(text, query, page)`, which writes
  `[[slug|title]]`.
- New `apps/web/components/wiki/WikiBodyField.tsx`: the body textarea as the
  combobox control. `[[` plus two characters fetches suggestions, and the
  listbox opens at the caret.
- `apps/web/components/wiki/WikiPageEditor.tsx`: the dangling-link list
  (debounced 400 ms) with line numbers, the lint message on save, and a
  Write/Preview toggle on narrow screens with side-by-side panes on wide ones.
  The preview is `WikiBodyRenderer`. Copy moves to the `wiki` catalog, and
  controls use `ui/Button` and the form-kit control class.
- The edit route (`coworker-decisions/edit/[...slug]/page.tsx`) passes the
  resolvable slug set once, and provides the `wiki` namespace.

Tests: `apps/web/lib/wiki/link-autocomplete.test.ts`;
`apps/web/components/wiki/WikiPageEditor.test.tsx` (`[[` plus two characters
lists suggestions and Enter inserts `[[slug|title]]`; one character fetches
nothing; dangling links listed with line numbers; save shows the lint
message; preview HTML equals `WikiBodyRenderer`'s; the toggle is keyboard
reachable).

## Traceability

requirement: OBJ-KLE-1, OBJ-KLE-2.
contract: link-suggest route contract and shared dangling-link resolver.
flow: author types `[[` → link-suggest route → scoped suggestions → inserted link; body change → shared resolver → dangling list → preview.
verification: AC-KLE-1, AC-KLE-2, AC-KLE-3, AC-KLE-4.

| Requirement | Planned behavior | Acceptance verification |
| --- | --- | --- |
| OBJ-KLE-1 | Phases 2–4: scoped suggestion route, shared Combobox, caret autocomplete that inserts `[[slug\|title]]`. | AC-KLE-1 and AC-KLE-2. |
| OBJ-KLE-2 | Phases 1 and 4: shared resolver used by lint and the editor, dangling list, lint message on save, preview through `WikiBodyRenderer`. | AC-KLE-3 and AC-KLE-4. |

## Backlog coverage

Atomic. The four phases ship as one change. Autocomplete without the scoped
route has nothing to offer, and the route without the editor has no caller.
The resolver move changes lint only by sharing it with the editor. Every
deliverable maps to BI-2F7BE778. The GIN body index stays with BI-FC5E4832.
Entity completion (`BI-`, `EP-`, `DOC-`) waits for BI-A63A9476.

## Risk and rollback

- The latency target is measured at the route on the dev install, through
  the `Server-Timing` header. A unit test cannot prove it.
- People are not limited by profession family (R5 "People"), so the route
  uses `PERSON_CORPUS_SCOPE`. On an install with several organizations the
  reader seam answers null, and no organization pages are offered.
- One revert restores today's editor. There is no schema change or data
  migration.
