// Estate patch management — lightweight, prisma-free barrel (EP-PATCH-MANAGEMENT).
// Exposed as the "@dpf/db/patch" subpath so apps/web can consume the pure classifier,
// advisory extractors, and assessment projector without pulling the heavy package index
// (which instantiates Prisma/neo4j/qdrant clients).
export * from "./patch-intel";
export * from "./osv-adapter";
export * from "./patch-projector";
