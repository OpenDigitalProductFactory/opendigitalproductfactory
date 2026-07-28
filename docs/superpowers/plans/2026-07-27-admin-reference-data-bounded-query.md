# Admin Reference Data Bounded Query Plan

**Backlog item:** BI-CC7CA516
**Work Capsule:** WC-59295C8B
**Branch:** `fix/admin-reference-data-pagination`
**Status:** Planned

## Outcome

Make `/admin/reference-data` fast and predictable without weakening its administrative capabilities or the route-budget guard. The page will query and render bounded, parent-scoped result pages instead of loading the complete geographic corpus into one response.

Success means:

- every country, region, city, and work-location row remains reachable;
- add, edit, activate/deactivate, merge, and address-link operations remain available;
- filtering and pagination are URL-addressable and survive refresh/back/forward navigation;
- merge targets use bounded typeahead search rather than a full-corpus `<select>`;
- the initial response and every result page have explicit row and choice bounds;
- deterministic route-sweep evidence shows a material reduction from the observed 82,544 words, 4,962 choices, and 697,502 ms.

## Evidence and reproduction

The same-SHA deterministic sweep for PR #3656 measured `/admin/reference-data` at 697,502 ms of a 706,819 ms run (about 99%). The rendered route contained 82,544 words and up to 4,962 choices. Code inspection confirms the page currently executes unbounded `findMany` calls for countries, regions, cities, and work locations, then passes every row to client panels for filtering and merge-target selection.

Expected: administration is complete but each request has a stable, inspectable bound.
Actual: a single request materializes and renders the entire geographic corpus.

## Existing design and substrate

No prior spec or plan directly covers this route. This plan extends rather than replaces:

- the existing `Country`, `Region`, `City`, and `WorkLocation` Prisma models;
- indexed parent relations (`Region.countryId`, `City.regionId`) and existing name indexes;
- the canonical `/admin/reference-data` route and `AdminTabNav`;
- existing mutation actions in `reference-data-admin.ts`;
- `ReferenceTypeahead` and the location search actions, which already provide a bounded accessible combobox contract;
- the platform usability standard that filters be server-readable and deep-linkable;
- report-kit URL-state conventions, while avoiding its client-only `DataTable` pagination because that still requires all rows in the browser.

No schema, enum, migration, new route, or parallel reference-data model is required.

## Decision ledger

DPF principle decision `DI-E53FF3A7B82E` compared:

1. URL-driven server pages and bounded parent-scoped Prisma queries;
2. panel-local client state backed by server actions;
3. DOM virtualization while retaining the full query and payload.

The kernel recommended option 1 with high confidence (8.504 composite, 2.554 margin, strong structured coverage, no commandment conflict). The strongest positive contributors were Research and Use Standards and Never Assume — Verify. DOM-only virtualization was rejected because it leaves the database, serialization, and network costs intact.

## UX fit review

**Primary persona and job:** a platform administrator or reference-data steward locating a geographic record and performing a precise maintenance action.

**Owning area and route:** Platform administration, on the existing `/admin/reference-data` route. No top-level or section navigation changes.

**Primary action:** find a record within its geographic parent, then edit, change status, merge, or link it.

**Hierarchy and disclosure:**

- keep the four existing panels and their familiar order;
- show bounded country and work-location pages immediately;
- require a country before listing regions and a region before listing cities;
- show stable result counts and page position;
- disclose add/edit/merge forms only when invoked;
- do not render pagination when a result set fits on one page.

**States:**

- no parent selected: explain the required country/region selection and show no child rows;
- no matches: say that the current filter has no results and preserve the filter;
- invalid/out-of-range page: clamp to a valid page deterministically;
- pending mutation: preserve existing disabled/loading feedback;
- merge search: accessible combobox loading, empty, and selection states;
- mutation failure: preserve existing action result behavior and do not substitute an empty list.

**Responsive/accessibility contract:** filters stack on narrow viewports; pagination uses semantic `<nav>` with a descriptive label, current-page state, and previous/next links; form controls retain visible labels; merge search follows the WAI-ARIA combobox pattern and keyboard contract already implemented by `ReferenceTypeahead`.

The new URL-backed search and parent-picker fields compose the shared
`FormField`/`SubmitButton` contract. `ReferenceTypeahead` accepts the field name
alongside its generated label-bound id, so these controls do not reintroduce
the unnamed, hand-wired form debt this refactor is meant to remove.

**Verification viewports:** desktop and narrow mobile viewport, including keyboard-only merge-target selection.

This is a local workflow correction, not a new product capability. It fits the existing route and removes cognitive and performance overload without adding navigation.

## Architecture review

The route will gain one bounded server read model that owns:

- parsing and validating namespaced URL parameters;
- a shared page-size constant and page clamping;
- parameterized Prisma `where`, `count`, `skip`, and `take` queries;
- compact parent option data;
- stable DTOs for the four panels.

The page remains the server composition root. Client panels retain mutation and disclosure state but no longer own corpus filtering. A shared pagination/link helper will preserve unrelated panel parameters while resetting the changed panel to page 1.

Merge survivors cannot be derived from the current result page. New bounded admin search actions will query active candidates inside the loser's parent scope and exclude the loser. They will feed the existing `ReferenceTypeahead`; preview and confirmation remain unchanged.

This design keeps one source of truth, follows existing model relationships, and caps database, serialization, DOM, and choice cardinality. It does not introduce cache invalidation or a second data representation.

## Standards

- [WAI-ARIA Authoring Practices: Combobox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) for merge-target search semantics and keyboard behavior.
- [U.S. Web Design System: Pagination](https://designsystem.digital.gov/components/pagination/) for semantic navigation, current-page state, and bounded controls.
- [GOV.UK Design System: Pagination](https://design-system.service.gov.uk/components/pagination/) for using pagination when a single page is too slow, applying filters to the whole set, resetting filters to page 1, and avoiding infinite scroll.
- `docs/platform-usability-standards.md` for server-readable URL filters and progressive disclosure.
- `apps/web/components/ui/report-kit/README.md` for DPF URL-state conventions and the documented limit of client-only table paging.

## Atomic delivery graph

1. **Bounded read model and URL contract** — defines the only result shape the refactored panels consume.
2. **Panel and pagination refactor** — consumes that new shape and removes full-corpus client filtering.
3. **Bounded merge-target typeahead** — preserves access to valid survivors after full lists are removed.
4. **Regression, UX, and route-budget evidence** — proves reachability, bounds, behavior, and performance.

These are internally sequenced but not independently shippable: a read-model-only change breaks the current panel contract; a panel-only change has no bounded data source; omitting bounded merge search removes valid survivor choices; and shipping without the invariant/evidence would leave the regression unguarded.

**Backlog coverage receipt:** `cms3gjd9p08mz01p5bufyeddd`
**Decision:** atomic; no separately mapped BI IDs. The dependency graph above is recorded against BI-CC7CA516.

## Implementation sequence

1. Add failing unit tests for URL parsing/clamping, query bounds/parent scoping, link preservation, and merge-candidate exclusion.
2. Implement the bounded read model and shared pagination primitives.
3. Refactor the page and panels to consume bounded results and namespaced URL state.
4. Add bounded region/city merge-target actions and wire them through `ReferenceTypeahead`.
5. Add route/component regression coverage for parent-required, empty, pagination, and action-preservation states.
6. Run formatting, targeted tests, typecheck, and the production build through the governed exact-SHA local-CI sandbox.
7. Verify desktop and narrow layouts, keyboard interaction, and an enforcing deterministic route sweep. Record before/after route metrics.

## Refactoring allocation

At least 20% of the implementation effort is reserved for extracting the shared page/query contract and removing duplicated client-side corpus filtering and full-list survivor selection. The refactor is limited to reusable reference-data paging/search boundaries; unrelated admin styling is out of scope.

## Documentation impact

This is an internal administrator performance and interaction correction on an existing documented route. No operator workflow, setup, public positioning, schema, or external-agent contract changes. This plan and the PR evidence are the appropriate durable documentation; no user-guide update is required unless verification discovers a visible workflow change beyond bounded navigation.

## Risks and rollback

- **Lost reachability:** test page traversal and merge search beyond the first page.
- **URL parameter collisions:** namespace all four panels and test preservation/reset behavior.
- **Stale page after mutation:** clamp pages after refresh and preserve active filters.
- **Choice explosion through parent controls:** pass compact/bounded parent choices and use typeahead where the candidate set is unbounded.
- **Query regression:** assert `take`, parent scope, and exclusion in unit tests and re-run the route sweep.

Rollback is a normal code revert; there is no migration or data transformation.
