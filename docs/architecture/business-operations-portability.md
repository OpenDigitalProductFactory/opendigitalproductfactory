# Portable business operations read models

The `@dpf/storefront-templates/operations` entry owns the current `operations.v1`
snapshot, bounded slice selectors and render-neutral twin contracts. It also
owns the existing semantic intent, source-observation and template vocabularies.
It imports neither the application nor Prisma, React, transport or identity
services. Profile/value-stream derivation stays in the same package's existing
entry; domain stores and atomic command handlers stay in their existing owners.

The existing API, workspace and admin preview use the versioned loader and sole
portable engine. The old `loadLivingBusinessSnapshot` function is retired.
Application `kit-types`, `twin-snapshot` and source-health files are type-only
re-export bridges for incumbent component/host callers; @markdbodman owns their
final-import removal under BI-9A6163AD. They contain no alternate projection.

TENANTS uses canonical `CustomerAccount` status and `Subscription` renewal
commitments plus actual `ServiceTicket` responsibility/SLA facts. The host
requires current `view_customer`; ticket reads also require `manage_platform`.
Queries exclude canonical tombstones/merged rows, select only bounded operating
fields, and restrict dependent records to the authorized account set. A source
over 64 records becomes unavailable rather than claiming a complete count from a
truncated page. The renderer shows up to 12 units/items per lane. No second
account-health algorithm, financial rollup or write path is introduced.

Rescue population/legal-hold reads share one organization-scoped adapter with
the existing rescue cockpit. The twin boundary requires current
`view_animal_welfare` before these reads. Custody identities without public
listings remain visible; listings without custody cannot become population.
Adoption outcomes count completed historical custody episodes, preserving a
returned animal's prior adoption. Legal holds and readiness are independent
counts and are not summed or labeled available for adoption. Missing canonical
sources remain unknown; verified empty sources remain zero. Housing still uses
the existing Resource/ward owner. Donations keep their storefront scope and
currency separation. No business records change during this extraction.

The existing display revision algorithm is preserved for compatibility. It is
not cryptographic, authorization, a domain mutation version or an atomic
multi-source transaction certificate. Observation timestamps indicate when a
read was attempted, not the age of all business events. Input/slice objects are
ordinary read-model values; a host must treat a returned snapshot as immutable.
Optional consumer-owned account/service-work link ports supply record references;
an absent port produces no action. DPF's host adapter supplies its existing
routes; the portable core has no DPF route defaults. These references become
native links on existing resource, work and
queue labels, with specific accessible names and visible focus. They navigate to
existing permission-checked record surfaces and do not execute commands or grant
admission. Existing TwinView layout and metadata row are reused. The host
projection includes recorded priority and the responsible principal reference
in that row when it cannot supply an actor display name; it does not invent a
human/AI identity. Renewal attention includes
overdue, upcoming within 90 days and unknown-date commitments, with unknown dates
identified explicitly.

The isolated [consumer](../../examples/business-operations/README.md) compiles
eight exact source files with Node 24.16.0 and TypeScript 6.0.3, strict NodeNext,
ES2022 and no ambient host types or runtime dependency links. It exercises
software/customer projection and a synthetic shelter host through the same
snapshot engine, including current/stale/degraded reads, ownership, commitments,
constraints, unrelated-account exclusion, and zero/unknown custody facts.

This proves a source-local working subset. It does not establish a live software
or shelter operating day, served keyboard/screen-reader/mobile behavior,
production performance, generalized custody/command authority, full
Hospitality-to-Resource migration or an atomic read across canonical stores.
The working restaurant and shelter transaction/lifecycle owners are unchanged.
Native plan/review gates and served nonproduction qualification remain unrun
under the operator's explicit local-only exception. Roll back the entry, host
callers and fact adapters as one change; no schema/data migration is involved.
