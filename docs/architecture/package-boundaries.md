# Package & Service Boundaries

Status: standard (BI-ARCH-PACKAGES, EP-PLATFORM-CONSOLIDATION)
Spec: [`docs/superpowers/specs/2026-06-25-platform-consolidation-spine-design.md`](../superpowers/specs/2026-06-25-platform-consolidation-spine-design.md)

DPF is a hybrid platform — business OS, AI coworker runtime, Build Studio, delivery
control plane, architecture graph, mobile companion, install/runtime substrate — in one
monorepo. The workspace (`pnpm-workspace.yaml`) holds `apps/*`, `packages/*`, and
`services/*`. Not every seam is real. This document is the durable rule for which package
boundaries DPF keeps and which it collapses.

## The rule

> **Collapse accidental seams; preserve runtime, deployment, distribution, and trust boundaries.**

A boundary is *real* when crossing it has a runtime, deployment, distribution, or trust
consequence (a server process, a shipped artifact, a security perimeter). A boundary is
*accidental* when it only exists because of how a type or file happened to be placed, and
removing it changes nothing a user or operator can observe.

Contract inversion comes before package deletion: it is safer to remove a server
dependency from a portable package than to merge the portable package into the server.

## Portable contract layer (enforced)

The contract/client layer is shared with the mobile app and external consumers, so it
**must not depend on server persistence**. These packages may not declare or import
`@dpf/db`, `@prisma/client`, or `.prisma/client`:

| Package | Role |
| --- | --- |
| `@dpf/types` (`packages/types`) | Portable DTOs and shared contract types. |
| `@dpf/validators` (`packages/validators`) | Pure Zod schemas (validation is part of the contract). |
| `@dpf/api-client` (`packages/api-client`) | Typed isomorphic API client for mobile / external consumers. |

Why this is the load-bearing seam: `@dpf/types` is consumed by `apps/mobile`. When it
re-exported `Prisma.*GetPayload` aliases it dragged the entire server persistence layer
into the shape of a mobile-facing contract, and any model-facing surface that grows with
each AI-first capability inherited that coupling.

Server-shaped helper types (`Prisma.*GetPayload`, payloads with relation includes used
only by route handlers) stay **server-only** under `@dpf/db` or `apps/web/lib/server-*` —
never in a portable package.

### How the contract stays honest

- **DTOs are hand-written, explicit, and stable** (`packages/types/src/entities.ts`). They
  are not generated from Prisma — a generated mirror would re-couple the contract to the
  schema shape, which is exactly what this boundary removes. `Decimal` columns are carried
  as `number` (validators use `z.number()`); `Json` columns as the contract `JsonValue`.
- **Schema drift is caught server-side** by
  [`apps/web/lib/contracts/entity-contract-drift.ts`](../../apps/web/lib/contracts/entity-contract-drift.ts):
  a type-level assertion that each Prisma payload (with `Decimal` mapped to its wire form)
  stays assignable to the matching DTO. A renamed, removed, or retyped column that the wire
  contract still promises fails `pnpm --filter web typecheck`.
- **The boundary itself is guarded** by
  [`scripts/check-package-boundaries.mjs`](../../scripts/check-package-boundaries.mjs),
  run both as a CI job (`Package Boundary Guard`) and as a web unit test
  ([`apps/web/lib/contracts/package-boundaries.test.ts`](../../apps/web/lib/contracts/package-boundaries.test.ts)).

## Keep / reshape / evaluate table

| Area | Direction | Rationale |
| --- | --- | --- |
| `@dpf/db` | Keep | Persistence and Prisma ownership are a real server boundary. |
| `@dpf/types` | Reshaped | Was leaking Prisma into portable consumers; now Prisma-free DTOs. |
| `@dpf/validators` | Keep | Pure validation is portable. Merge into a contracts package only if it simplifies ownership. |
| `@dpf/api-client` | Keep | Mobile and external consumers need a stable client boundary. |
| `@dpf/dpf-bootstrap` | Keep | Distribution / install tooling is not app runtime. |
| `@dpf/dpf-skill-pack` | Keep | Plugin / skill payload is a distribution artifact. |
| `storefront-templates`, `finance-templates` | Evaluate | Could become one template/archetype registry once contracts are clean. |
| `services/adp` | Keep | Runtime service boundary. |
| `services/edge-node` | Keep | Deployment / runtime boundary. |
| `services/integration-test-harness` | Keep | Verification harness boundary. |

## Adding a new package

Every new package must declare its boundary reason — the runtime, deployment,
distribution, or trust consequence that justifies the seam. If the only reason is "these
files are related," it is an accidental seam: put the code in an existing package behind a
module boundary instead. If a new package is portable (consumed by mobile / external
clients), add it to `PORTABLE_PACKAGES` in
[`scripts/check-package-boundaries.mjs`](../../scripts/check-package-boundaries.mjs) so the
Prisma-free invariant is enforced from day one.
