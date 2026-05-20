// Shared Zod schemas for the `/api/v1/edge/*` wire contract.
//
// Single source of truth that both the route handlers and the
// cross-runtime parity tests import. The Phase 0 spec calls this
// "the seam that makes Mode 1 (TypeScript container) and Mode 4
// (Go native binary) safe to interleave" — every shape on the wire
// is validated here, by both runtimes' fixtures, in the
// `wire-contract.test.ts` integration test.
//
// Drift in this file IS a wire-contract change. Coordinate with both
// `services/edge-node/` (TypeScript Mode 1) and
// `services/edge-node-go/` (Go Mode 4) when modifying.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
// ADR:  docs/superpowers/specs/2026-05-16-edge-node-runtime-decision.md
// Plan: docs/superpowers/plans/2026-05-14-edge-node-t3-windows-native.md (W1)

import { z } from "zod";

import {
  EDGE_NODE_CAPABILITY_STATUSES,
  EDGE_NODE_INSTALL_MODES,
  EDGE_NODE_PLATFORMS,
  RESERVED_CAPABILITIES,
} from "@dpf/db/edge-node-types";

/**
 * Body shape for POST /api/v1/edge/enroll.
 *
 * The bootstrap token is carried in the Authorization: Bearer header,
 * not in the body — keeps it out of route audit logs.
 */
export const EnrollBody = z.object({
  displayName: z.string().min(1).max(200),
  platform: z.enum(EDGE_NODE_PLATFORMS),
  installMode: z.enum(EDGE_NODE_INSTALL_MODES),
  version: z.string().min(1).max(40),
  advertisedCapabilities: z.array(z.string().min(1)).min(1),
  hostFingerprint: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type EnrollBodyT = z.infer<typeof EnrollBody>;

/**
 * Body shape for POST /api/v1/edge/heartbeat.
 *
 * Empty body `{}` is the steady-state shape; capabilityReports is the
 * extension point for per-capability health that lands with W4+.
 */
export const HeartbeatBody = z
  .object({
    capabilityReports: z
      .array(
        z.object({
          capability: z.enum(RESERVED_CAPABILITIES),
          status: z.enum(EDGE_NODE_CAPABILITY_STATUSES),
          evidence: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .optional(),
  })
  .default({});

export type HeartbeatBodyT = z.infer<typeof HeartbeatBody>;
