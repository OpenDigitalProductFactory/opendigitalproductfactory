// BET-5 (BI-A1E864A5): the `qdrant` module now delegates to the pgvector-backed store.
// Callers keep importing from "./qdrant" (or the @dpf/db barrel) unchanged; under the hood
// vectors live in Postgres/pgvector. Verified against live Qdrant at 1.000 top-5 ranking parity
// + identical filter results (benchmarks/bet5-datastore/ab_parity.py). The raw Qdrant REST
// client (./qdrant-legacy) and the migration backfill were removed once the fleet finished
// migrating (BI-2A3BE4D7); the platform is Postgres-only.
export * from "./pgvector-store";
