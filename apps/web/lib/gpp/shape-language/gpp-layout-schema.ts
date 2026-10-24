// apps/web/lib/gpp/shape-language/gpp-layout-schema.ts
//
// The GPP layout sidecar — presentation only, beside a shape document
// (docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §4.3; PR-3a-1, BI-6DA17863). The compiler never reads it, so a layout-only
// change has an empty compile diff. Node and edge keys are derived element ids
// (§9.1); a key that matches no element is the DRC's W-ORPHAN-LAYOUT warning,
// not a schema error.
//
// Types and validator only in Phase 3. No published layout schema is
// committed: the canvas that reads and writes it is Phase 4.
//
// Edge entries: §4.3 shows `edges: {}` and defines no entry shape. Phase 3
// admits only optional waypoints (`points`), closed like everything else, so
// the canvas phase widens it deliberately rather than inheriting an open map.

import { z } from "zod";

import { GPP_SHAPE_REF_PATTERN } from "./gpp-shape-schema";

export const GPP_LAYOUT_FORMAT = "gpp-layout/0.1";

const point = z.strictObject({ x: z.number(), y: z.number() });

const layoutNode = z.strictObject({
  x: z.number(),
  y: z.number(),
  w: z.number().positive().optional(),
  h: z.number().positive().optional(),
});

const layoutEdge = z.strictObject({ points: z.array(point).optional() });

export const gppLayoutSchema = z.strictObject({
  format: z.literal(GPP_LAYOUT_FORMAT),
  shape: z.string().regex(GPP_SHAPE_REF_PATTERN),
  nodes: z.record(z.string().min(1), layoutNode),
  edges: z.record(z.string().min(1), layoutEdge),
  viewport: z.strictObject({ x: z.number(), y: z.number(), zoom: z.number().positive() }),
});

export type GppLayoutSidecar = z.infer<typeof gppLayoutSchema>;
