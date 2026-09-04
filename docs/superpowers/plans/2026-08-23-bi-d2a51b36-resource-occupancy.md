---
status: active
---

# BI-D2A51B36 — Complete the canonical animal housing workflow

| Field | Value |
| --- | --- |
| Backlog item | `BI-D2A51B36` |
| Epic | `EP-5102F494` |
| Workroom | `WC-19B43FAC` |
| Branch | `feat/bi-d2a51b36-resource-occupancy-delivery` |
| Design | `docs/superpowers/specs/2026-08-23-bi-d2a51b36-canonical-resource-occupancy-design.md` |

## Outcome

Complete the write reach behind the already-shipped Ward. A rescue can maintain
kennels and foster homes, place or move an animal, release a stay, and trust the
combined free-capacity number. The implementation reuses `Resource` and
`ResourceCapacityAllocation`; it adds no table or resource domain.

## Already delivered and retained

- PR #4494: subject-agnostic care and canonical Resource substrate.
- PR #5000: ward occupancy and capacity projection.
- PR #5022: Ward map/list and cockpit capacity surface.

These are dependencies and evidence, not work to duplicate.

## Atomic coverage

This plan maps to `BI-D2A51B36`. Resource maintenance, placement transaction,
foster support, and the operator controls are one usable workflow: shipping any
one without the others leaves the Ward read-only or its capacity incomplete.

| Deliverable | Acceptance | Primary verification |
| --- | --- | --- |
| Profile-governed kennel and foster kinds | `AC-HOUSING-001`, `006` | archetype and profile tests |
| Shared canonical Resource commands | `AC-HOUSING-001`, `004`, `008` | repository and hospitality compatibility tests |
| Atomic move/release command | `AC-HOUSING-002`–`005` | transaction service and route tests |
| Combined ward read model | `AC-HOUSING-003`, `006`, `008` | ward projection/store tests |
| Ward operator controls | `AC-HOUSING-007`, `008` | component, route, and governed-browser evidence |
| Release evidence | `AC-HOUSING-009` | semantic review, exact-tree CI, PR health, protected merge |

## Phase 1 — design and readiness

1. Reconcile the 2026-08-23 design with current `main` and the merged ward PRs.
2. Record research against the immutable design commit.
3. Obtain independent design/spec approval and objective baseline.
4. Record this atomic plan coverage and independent plan review.

No product edit begins before the implementation projection allows it.

## Phase 2 — Red: command contracts

Add failing tests for:

- configured `kennel` and `foster-home` kinds;
- Resource create/update lifecycle, version, capacity, organization, and kind
  validation;
- moving closes the previous stay and creates one new stay;
- release closes without deleting;
- blocked/full/retired/wrong-kind/cross-organization rejection;
- idempotent replay;
- transaction locking and bounded serialization retry;
- the Ward reading both kennel and foster resources.

Resolve related tests before Red and run the focused files to observe failure for
the intended missing behavior.

## Phase 3 — Green/refactor: shared Resource persistence

Create a small canonical repository under
`apps/web/lib/resource-scheduling/`. It owns validation and Resource
persistence; the housing adapter and hospitality canonical mirror consume it.
Keep hospitality response compatibility and legacy mirroring unchanged.

Add `foster-home` to the animal-welfare activation profile. No demo rows or
private address data are seeded.

## Phase 4 — Green: occupancy transaction and routes

Create a generic occupancy service over `ResourceCapacityAllocation` and expose
bounded admin routes:

- `GET/POST /api/storefront/admin/resources`;
- `PATCH /api/storefront/admin/resources/[id]`;
- `POST /api/storefront/admin/resource-occupancies`.

Route adapters derive the active storefront and organization from the session,
resolve the activation profile, and allow only the animal subject adapter for
this slice. They do not accept caller-supplied authority fields.

## Phase 5 — Green: Ward controls and read model

Extend the ward read model to include `kennel` and `foster-home`, capacity by
kind, available destinations, and bounded current-placement information.

Add one progressively disclosed housing form and one direct place/move/release
workflow to `/workspace/ward`. Preserve the map/list flip, honest no-data state,
focus, settled feedback, and narrow-width usability. Do not add navigation or a
second animal-management page.

## Phase 6 — verification and protected delivery

1. Run focused web and storefront-template tests plus typecheck.
2. Run prose/style guards and `pnpm run pregate:preflight`.
3. Regenerate route, audience, shell, purpose, doc-impact/index, business-type,
   and architecture artifacts required by the change-impact contract.
4. Use a governed nonproduction lease for authenticated desktop and 390px Ward
   verification with kennel, foster, blocked, full, unplaced, success, failure,
   and permission states.
5. Commit the UX-fit evidence and obtain fresh exact-tree semantic review.
6. Run governed exact-tree local CI.
7. Push normally, open one DCO-signed PR for `BI-D2A51B36`, enable squash
   auto-merge, read bot findings, run PR health, and verify protected merge.
8. Verify the live Ward after the normal deployment path, record acceptance and
   outcome reconciliation, close the BI/Workroom, and continue to
   `BI-7111AF0C`.

## Risk and rollback

| Risk | Control | Rollback |
| --- | --- | --- |
| Concurrent double placement | subject/resource transaction locks and serializable retry | disable route; preserve ledger |
| False free-capacity number | count active, unblocked resources and open allocations only | remove controls; retain prior read-only board |
| Foster privacy leak | operator-safe Resource label only; no address projection | remove unsafe attribute; preserve occupancy |
| Hospitality regression | adapter compatibility tests around shared helper | restore adapter call while keeping helper unused |
| Route or UI drift | generated route artifacts, UX-fit measurement, governed browser | remove new controls/routes without data loss |

## Documentation and seed disposition

- Design and plan above are the authority.
- User guide changes only describe behavior proven in the governed preview.
- Seed-fit is archetype-scoped: one `foster-home` resource kind, no demo records.
- Data impact is `not-applicable`: no schema, migration, or backfill.
- Refactoring budget is concentrated in shared Resource validation/persistence.
