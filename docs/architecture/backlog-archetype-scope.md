# Backlog Archetype Scope

**Status:** Implemented substrate - 2026-07-24
**Owner surface:** Operations backlog, epics, workbook grids, MCP backlog tools, REST backlog API
**Primary consumer:** Roadmapping, portfolio budgeting, archetype gap closure, Build Studio planning

DPF tracks platform work, common company capabilities, and archetype-specific functionality in the same backlog. That is correct for execution, but it makes investment planning blurry unless every epic and backlog item can say what kind of scope it serves.

Backlog archetype scope is the planning facet that separates:

| Scope kind | Meaning | Typical examples |
|---|---|---|
| `platform` | DPF operating substrate or internal development capability | Build Studio, self-upgrade, worktree hygiene, platform data governance |
| `common` | Business capability reused across most archetypes | Finance, accounting, payroll, workforce, IAM |
| `archetype-category` | Work specific to a storefront archetype category | Fabric care, healthcare, retail, public sector |
| `archetype-leaf` | Work specific to one leaf archetype | `dry-cleaning-plant-network`, `dental-practice` |
| `multi-archetype` | Work that spans a named set of categories/leaves | Field dispatch across trades, home health, mobile pet grooming |
| `unknown` | Scope needs triage before planning or budget allocation | Imported or ambiguous backlog items |

## Stored Fields

`Epic` and `BacklogItem` carry the same fields:

| Field | Purpose |
|---|---|
| `scopeKind` | The planning bucket above. |
| `archetypeCategories` | Category slugs served by the work, such as `fabric-care-services`. |
| `archetypeIds` | Leaf archetype slugs served by the work, such as `dry-cleaning-plant-network`. |
| `scopeRationale` | Short human explanation for the classification. |
| `lifecycleTags` | Product/service lifecycle tags used for roadmaps and budget cuts, such as `claim-ticket`, `ready-promise`, `booking`, `invoice`, or `field-dispatch`. |

The fields are deliberately duplicated on epics and items. Epics give portfolio leaders a coarse planning view; items can override or narrow the classification when one epic contains mixed work.

## Backfill Rule

The migration only classifies rows with durable signals:

- Fabric-care work under `EP-FABRIC-CARE-OPS` is tagged to `fabric-care-services` and the `dry-cleaning-plant-network` leaf.
- Existing "Industry Vertical Readiness - ..." epics are mapped to their category or leaf slugs and child items inherit that scope.
- Finance, payroll, workforce, and identity epics are tagged `common`.
- DPF lifecycle, UX system, upgrade, Build Studio, tracking, and data-governance epics are tagged `platform`.
- Ambiguous rows remain unclassified so roadmap review can decide instead of guessing.

## Tooling Contract

The governed MCP backlog tools expose the scope fields on create, update, list, query, and get paths. REST backlog routes accept the same write fields and support filters for `scopeKind`, `archetypeCategory`, `archetypeId`, and `lifecycleTag`.

Workbook backlog grids expose editable columns for scope review. This is the intended high-throughput operator path for tagging or correcting many backlog items after an archetype audit.

## Design Grounding

- Existing specs/plans reviewed:
  - `AGENTS.md` Adding a business archetype doctrine.
  - `docs/superpowers/specs/2026-07-21-archetype-provisioning-playbook-design.md`.
  - `docs/superpowers/specs/2026-06-07-business-operating-model-portfolio-wiring-design.md`.
  - `docs/superpowers/specs/2026-06-21-portfolio-coverage-multisource-projection-design.md`.
  - `docs/superpowers/plans/2026-07-24-backlog-archetype-scope-metadata.md`.
- Current code substrate reviewed:
  - `rg -n "archetype|StorefrontConfig|BacklogItem|Epic|Portfolio" apps/web packages docs`.
  - `packages/db/prisma/schema.prisma`.
  - `apps/web/lib/mcp/packs/backlog-pack.ts`.
  - `apps/web/lib/explore/backlog.ts`.
  - `apps/web/lib/workbooks/backlog-adapter-mapping.ts`.
  - `apps/web/app/api/v1/ops/backlog/route.ts`.
  - `apps/web/app/api/v1/ops/epics/route.ts`.
- Source of truth:
  - `Epic` and `BacklogItem` own planning scope metadata. `StorefrontConfig.archetypeId` remains the portal industry source of truth; backlog scope references archetype slugs for planning and gap tracking only.
- Decision:
  - Add an explicit planning facet instead of overloading portfolio alignment or product/service catalogs. Portfolio alignment remains the investment/container lens; `scopeKind`, `archetypeCategories`, `archetypeIds`, and `lifecycleTags` identify whether the work is platform, common, category-specific, leaf-specific, or still unknown.

## Planning Use

Portfolio and roadmap reviews should use `scopeKind` first:

- `platform` work funds DPF itself.
- `common` work funds cross-archetype business substrate.
- `archetype-category` and `archetype-leaf` work funds market-specific coverage gaps.
- `multi-archetype` work should name all affected archetypes and carry lifecycle tags that identify the reusable capability pattern.
- `unknown` is planning debt and should be reduced before budgeting.

Lifecycle tags provide the second cut. For example, the fabric-care backlog can separate claim-ticket custody work from ready-promise notification work without creating separate one-off portfolios for each operating step.
