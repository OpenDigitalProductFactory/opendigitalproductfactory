// apps/web/lib/ea/sysml-model-seed.ts
//
// The canonical SysML applier now lives in @dpf/db so that seed-time packages/db
// seeders and runtime apps/web extractors share ONE implementation. packages/db
// cannot import from apps/web (the workspace dependency only runs one way), so the
// shared seeder lives on the db side; this module re-exports it under the stable
// import path the EA extractors already use. Imported via the @dpf/db/sysml-model-seed
// SUBPATH (not the barrel) so it resolves under the apps/web vitest alias, where bare
// "@dpf/db" maps to client.ts rather than the full index barrel.
//
// Design: docs/superpowers/specs/2026-06-14-design-implementation-parity-engine-design.md
export {
  applySysmlModel,
  type SysmlDesiredElement,
  type SysmlDesiredRel,
  type SysmlDesiredConformanceIssue,
  type SysmlDesiredModel,
  type SysmlSeedResult,
} from "@dpf/db/sysml-model-seed";
