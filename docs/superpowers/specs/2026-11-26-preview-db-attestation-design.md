# Attest the database of a leased Contributor preview

BI-5C193A3F. First in the S5 preview dependency stack. This change supplies read-only proof, not enrollment, draft provisioning or activation.

**OBJ-1:** The lease owner can attest the exact dedicated database used by the current Contributor preview, and the consumer can match it on the transaction that would write.

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | A current lease owner records the database identity from the dedicated preview, bound to the exact lease, runtime and source revision. |
| AC-2 | OBJ-1 | The transaction rejects a different cluster with an identically named database, a different database on the same cluster, unreadable proof, or missing, expired, revoked or replaced owner provenance. |
| AC-3 | OBJ-1 | Production and unattested installations cannot use the proof as authorization. No production database, credentials or new privileged database role is involved. |

## Design

Reuse the owner and TaskRun binding in `environment-lease-provenance.ts`. The owner reads identity from the inspected dedicated preview target established by `scripts/lib/dev-preview-runtime.mjs`. After probing, revalidate the exact active lease and runtime binding under the owner environment lock before publishing evidence. Do not change cleanup ownership or hold the owner lock during the probe. A preview may read evidence through the authenticated owner path. The expected identity must not come from the connection being checked or from a row in a clone.

Follow the sanitized-clone connection-readback pattern, but replace its name and network endpoint identifiers with PostgreSQL control-file system identifier and current database catalog OID and name. Qualify catalog references and encode numeric identifiers as decimal strings to avoid precision loss. Use the same transaction client for the live comparison and any downstream write. The owner must establish independently initialized preview storage. Physical copies or replicas can preserve PostgreSQL identifiers, so the tuple does not replace verification of the dedicated runtime and storage. If the existing preview role cannot read the control-file identity, hold. Do not widen a production grant or introduce a new privileged role.

The helper in `preview-db-attestation.ts` will return a hold on any missing or mismatched identity and will not itself write. No caller-supplied hostname, environment variable, database URL or cached lease is positive evidence. Later consumers require BI-8EA98961's verified non-production leaf and BI-60FC9291's reservation before any write. This item must not independently register a setup surface.

## File boundaries and sequence

This layer touches `apps/web/lib/nonprod/environment-lease-provenance.ts`, the preview database proof helper and focused tests, and the existing preview startup adapter `scripts/lib/dev-preview-runtime.mjs`. The shared stack boundary is `environment-lease-provenance.ts`, `preview-runtime-fence.ts` and `environment-lease.ts`. The latter two remain unchanged in this layer unless the governed scope is amended. Stack BI-8EA98961 after this layer for the installation join, then BI-60FC9291 for reservation and release ordering.

## Research

The pin sources and downstream sequencing are in the [S5 provisioner design](2026-11-25-s5-rehearsal-draft-provisioner-design.md). The existing sanitized-clone probe reads network endpoint and database name, which cannot distinguish two clusters behind the same endpoint at different times. PostgreSQL documents the stronger available fields in [control file functions](https://www.postgresql.org/docs/18/functions-info.html) and [the shared database catalog](https://www.postgresql.org/docs/18/catalog-pg-database.html). Qualification of the deployed preview database role remains a synthetic fixture check.
