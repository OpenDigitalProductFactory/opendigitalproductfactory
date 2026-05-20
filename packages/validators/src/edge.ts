// Edge Node telemetry schemas.
//
// Spec: docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md
//
// BigInt counter values (ifHCInOctets, ifHCOutOctets) are serialized as
// decimal strings over the wire so JSON.stringify / JSON.parse never
// encounter a native BigInt.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Capability literals
// ---------------------------------------------------------------------------

export const EDGE_TELEMETRY_CAPABILITY_TYPES = [
  "metrics.network",
  "discovery.lldp",
] as const;

// ---------------------------------------------------------------------------
// Network interface metrics (SNMP ifXTable / ifTable)
// ---------------------------------------------------------------------------

export const networkInterfaceMetricSchema = z.object({
  ifIndex: z.number().int().positive(),
  ifDescr: z.string(),
  ifAlias: z.string().optional(),
  /** ifHCInOctets serialized as a decimal string (avoids JSON BigInt). */
  ifHCInOctets: z.string().regex(/^\d+$/),
  /** ifHCOutOctets serialized as a decimal string. */
  ifHCOutOctets: z.string().regex(/^\d+$/),
  timestamp: z.string().datetime(),
});

export type NetworkInterfaceMetric = z.infer<typeof networkInterfaceMetricSchema>;

// ---------------------------------------------------------------------------
// BPS snapshot (computed delta, not a raw counter)
// ---------------------------------------------------------------------------

export const interfaceRateSchema = z.object({
  ifIndex: z.number().int().positive(),
  ifDescr: z.string(),
  ifAlias: z.string().optional(),
  inBps: z.number().nonnegative(),
  outBps: z.number().nonnegative(),
  timestamp: z.string().datetime(),
});

export type InterfaceRate = z.infer<typeof interfaceRateSchema>;

// ---------------------------------------------------------------------------
// LLDP peer discovery
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
// Edge metrics payload (POSTed to /api/v1/edge/metrics)
// ---------------------------------------------------------------------------

export const edgeMetricsPayloadSchema = z.object({
  nodeId: z.string().min(1).max(100),
  timestamp: z.string().datetime(),
  metrics: z
    .object({
      network: z.array(networkInterfaceMetricSchema).optional(),
    })
    .optional(),
  discovery: z
    .object({
      lldp: z.array(lldpPeerSchema).optional(),
    })
    .optional(),
});

export type EdgeMetricsPayload = z.infer<typeof edgeMetricsPayloadSchema>;

// ---------------------------------------------------------------------------
// Edge heartbeat with capabilities
// (extends the core heartbeat with telemetry-specific capability strings)
// ---------------------------------------------------------------------------

export const edgeHeartbeatSchema = z.object({
  nodeId: z.string().min(1).max(100),
  hostname: z.string().optional(),
  version: z.string().optional(),
  capabilities: z.array(z.string()),
  timestamp: z.string().datetime(),
});

export type EdgeHeartbeat = z.infer<typeof edgeHeartbeatSchema>;
