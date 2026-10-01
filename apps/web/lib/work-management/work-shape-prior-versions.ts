// Superseded work-shape versions that live rooms may still pin (BI-CB5C0DCE).
//
// A room pins its activity shape as `key@version`. Bumping a shape used to stop
// every room on the old version, because the registry held one version per key.
// GPP §2.1.1 says a widening takes a new version and a fresh gate decision, so
// a pinned room must keep running on its version until its owner rebinds it.
//
// A bump therefore moves the old definition here, frozen, in the same change.
// It stays while any non-terminal room pins it. Rooms resolve against it; new
// rooms and claim adoption never may (normalizePersistedScope requires the
// current version). Spec: docs/superpowers/specs/2026-10-01-workroom-shape-rebind-design.md

import type { WorkShapeDefinition } from "./work-shapes";

export const WORK_SHAPE_PRIOR_VERSIONS: readonly WorkShapeDefinition[] = [];
