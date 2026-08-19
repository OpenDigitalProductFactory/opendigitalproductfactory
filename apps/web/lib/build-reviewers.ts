// Shim — moved to lib/build/build-reviewers.ts (Phase 10 refactoring)
export * from "./build/build-reviewers";
// The architecture-advisory pipeline (advisory shaping, reference-doc
// promotion, WSID ledger write) lives in its own module so build-reviewers.ts
// stays under the module-size ceiling and the two fail postures are not read as
// one. Re-exported here so existing "@/lib/build-reviewers" callers are unmoved.
export * from "./build/architecture-advisory-ledger";
