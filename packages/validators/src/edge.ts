// Edge Node telemetry schemas.
//
// Wire contract: MetricsEnvelope §6.1 of
// docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md
//
// Internal counter values (ifHCInOctets, ifHCOutOctets) are carried as
// decimal strings inside InterfaceSnapshot (used only within the edge-node
// process) to avoid JSON BigInt serialisation errors. These NEVER appear
// on the wire — only computed rxBps/txBps numbers are sent.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Capability literals
// ---------------------------------------------------------------------------

export const EDGE_TELEMETRY_CAPABILITY_TYPES = [
  "metrics.network",
  "discovery.lldp",
] as const;

// ---------------------------------------------------------------------------
// InterfaceMetric — per-interface record in the MetricsEnvelope (§6.1)
// ---------------------------------------------------------------------------

export const interfaceMetricSchema = z.object({
  /** Source device key — "snmp:<ip>", "unifi:<mac>", "kasa:<mac>", etc. */
  deviceKey: z.string().min(1),
  /** SNMP ifIndex, undefined for non-SNMP sources. */
  ifIndex: z.number().int().positive().optional(),
  /** Human-readable port / interface name (ifDescr or ifAlias). */
  ifName: z.string().min(1),
  /** Inbound bits per second (computed delta). */
  rxBps: z.number().nonnegative(),
  /** Outbound bits per second (computed delta). */
  txBps: z.number().nonnegative(),
  rxErrors: z.number().int().nonnegative().optional(),
  txErrors: z.number().int().nonnegative().optional(),
  operStatus: z.enum(["up", "down", "unknown"]),
  /** Nominal link speed in Mbit/s. */
  speedMbps: z.number().positive().optional(),
  /** Adapter-specific extras (poeWatts, latencyMs, …). */
  rawData: z.record(z.string(), z.unknown()).optional(),
});

export type InterfaceMetric = z.infer<typeof interfaceMetricSchema>;

// ---------------------------------------------------------------------------
// MetricsEnvelope — top-level POST body for /api/v1/edge/metrics (§6.1)
// ---------------------------------------------------------------------------

export const metricsEnvelopeSchema = z.object({
  /** UUID idempotency key — same pattern as discovery-runs runKey. */
  runKey: z.string().uuid(),
  /**
   * nodeId from the client.  The portal IGNORES this field and uses
   * the nodeId resolved from the bearer token instead.
   */
  nodeId: z.string().min(1).max(100).optional(),
  /** ISO 8601 timestamp when the metrics were captured. */
  observedAt: z.string().datetime(),
  metricsVersion: z.literal("1"),
  interfaces: z.array(interfaceMetricSchema),
});

export type MetricsEnvelope = z.infer<typeof metricsEnvelopeSchema>;

// ---------------------------------------------------------------------------
// LLDP peer discovery (used by the LLDP collector; submitted via
// discovery-runs, not via /api/v1/edge/metrics)
// ---------------------------------------------------------------------------

export const lldpPeerSchema = z.object({
  localPort: z.string(),
  chassisId: z.string(),
  portId: z.string(),
  systemName: z.string().optional(),
  systemDescription: z.string().optional(),
  portDescription: z.string().optional(),
  timestamp: z.string().datetime(),
});

export type LLDPPeer = z.infer<typeof lldpPeerSchema>;

// ---------------------------------------------------------------------------
// InterfaceSnapshot — internal counter snapshot (edge-node process only)
// Counter values are decimal strings to avoid JSON BigInt issues during
// interprocess logging/serialisation.  Never sent on the wire.
// ---------------------------------------------------------------------------

export const interfaceSnapshotSchema = z.object({
  ifIndex: z.number().int().positive(),
  ifDescr: z.string(),
  ifAlias: z.string().optional(),
  /** ifHCInOctets as a decimal string. */
  inOctets: z.string().regex(/^\d+$/),
  /** ifHCOutOctets as a decimal string. */
  outOctets: z.string().regex(/^\d+$/),
  timestamp: z.string().datetime(),
});

export type InterfaceSnapshot = z.infer<typeof interfaceSnapshotSchema>;

// ---------------------------------------------------------------------------
// Edge heartbeat with capabilities
// ---------------------------------------------------------------------------

export const edgeHeartbeatSchema = z.object({
  nodeId: z.string().min(1).max(100),
  hostname: z.string().optional(),
  version: z.string().optional(),
  capabilities: z.array(z.string()),
  timestamp: z.string().datetime(),
});

export type EdgeHeartbeat = z.infer<typeof edgeHeartbeatSchema>;
