# Business operations portable consumer

This is the BS-01 local working subset under BI-9A6163AD / WC-63F33236.
Producer source baseline: `4fa796b64425b6129f172a01b89d8c8887c065fc`.
The existing three-component checkpoint remains unchanged.

Adopt the narrow `@dpf/storefront-templates/operations` entry:

```ts
import {
  createVersionedOperationsSnapshot,
  projectCustomerOperations,
  summarizeCanonicalAnimalPopulation,
  selectOperationsScene,
} from "@dpf/storefront-templates/operations";
```

`closure.json` lists the eight authoritative source files. The runner copies
those bytes as regular files into an isolated temporary consumer, checks all
imports are relative `.js` paths, compiles strict ES2022/NodeNext with no ambient
host types, and executes the resulting ESM. It prints each copied SHA-256 digest,
the actual toolchain and scenario results. There are no runtime dependencies,
application aliases or producer dependency links. TypeScript is a separate build
tool, pinned to 6.0.3; the executable is required to be Node 24.16.0.

The synthetic scenarios cover owned customer service work, actual subscription
commitment dates, overdue/customer dependencies, contextual record references,
stable read revisions, changed facts, stale/degraded sources, unrelated account
exclusion, and canonical shelter population/holds with historical outcomes.
The shelter host fixture supplies its own authorized care/housing representation;
it is not a new live shelter loader or a qualification claim.

Real DPF callers migrate in the same slice: workspace, snapshot API and admin
preview consume the sole engine. The host customer loader uses existing current
permissions and canonical accounts/subscriptions/tickets. The rescue cockpit
and outcome loader share canonical animal/custody reads; public listing counts
are retired. Domain commands, stores and transactions remain their owners.

Optional account/service-work record-link ports belong to the consumer. DPF
supplies its existing routes through its host adapter; the synthetic host uses
its own routes. With no link port the core produces no action.

The snapshot is a read model. Its preserved FNV revision is not a permit,
cryptographic identity, domain mutation token or atomic multi-source guarantee.
Treat returned objects as immutable. The pure projection trusts its host to
authorize source facts and current record references. Missing current authority
at DPF's host adapter yields unavailable sources without reading them. The
customer host refuses an over-limit source instead of presenting partial totals.

Native gates and served nonproduction browser qualification are unrun. Static
renderer/semantic and existing axe unit checks do not establish real keyboard,
screen-reader, mobile, runtime performance or production qualification. Complete
shelter-day UI, all Hospitality/Resource migrations and new command adapters are
outside this working subset. No credentials, organization records, private
doctrine or production mutations are included.

Apache-2.0 provenance is retained in LICENSE and NOTICE. No third-party runtime
component is redistributed. Rollback reverts the portable entry and its migrated
callers/fact adapters together; no database migration is needed. The operator has
authorized source publication through the required checks and pull request.
