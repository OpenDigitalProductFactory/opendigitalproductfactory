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

// ---------------------------------------------------------------------------
// EdgeEvent — canonical PD-CEF-style envelope for POST /api/v1/edge/events
//
// Slice 0 of the edge-node detection engine (BI-9FE9D48D).
// Spec: docs/superpowers/specs/2026-05-21-edge-event-envelope-design.md
//
// The wire shape mirrors PagerDuty's PD-CEF (source / component / group /
// class / severity / custom_details) with an explicit dedupKey + action so
// the portal can collapse replays and run a triggered → acknowledged →
// resolved lifecycle without inventing a new contract per detector.
// ---------------------------------------------------------------------------

export const EDGE_EVENT_SEVERITIES = [
  "info",
  "warn",
  "error",
  "critical",
] as const;
export type EdgeEventSeverity = (typeof EDGE_EVENT_SEVERITIES)[number];

export const EDGE_EVENT_ACTIONS = [
  "trigger",
  "acknowledge",
  "resolve",
] as const;
export type EdgeEventAction = (typeof EDGE_EVENT_ACTIONS)[number];

// Slice 1 (BI-8405FDA5): discriminator separating fire-and-collapse alert
// events from point-in-time change events (deploys, config pushes, feature
// flips). Defaulted to "alert" so every Slice 0 producer remains untouched
// on the wire. The portal route discriminates: "alert" upserts EdgeEvent
// (full lifecycle, replay-collapsed); "change" upserts ChangeEvent (no
// lifecycle, kept as point-in-time facts the correlation engine joins to
// alerts within an N-minute window).
//
// For eventType="change", `action` should be "trigger" (lifecycle doesn't
// apply to changes; the route accepts but ignores other values). `dedupKey`
// is reused as the change's stable identifier — a git SHA, deploy ID, etc.
// — so re-submissions update rather than duplicate.
export const EDGE_EVENT_TYPES = ["alert", "change"] as const;
export type EdgeEventType = (typeof EDGE_EVENT_TYPES)[number];

export const edgeEventSchema = z.object({
  /**
   * Discriminator: "alert" (default) follows the Slice 0 lifecycle and
   * collapses on (edgeNodeId, dedupKey); "change" is a point-in-time fact
   * persisted to ChangeEvent for downstream correlation to alerts. Optional
   * with default "alert" so Slice 0 producers don't need to change.
   */
  eventType: z.enum(EDGE_EVENT_TYPES).optional().default("alert"),
  /**
   * Dedup anchor — for alerts, detectors compose from source + component +
   * class (+ instance) so the same condition collapses on replay; for
   * changes, this is the change's stable identifier (git SHA, deploy ID).
   * Scoped per edge node by the @@unique on each table.
   */
  dedupKey: z.string().min(1).max(255),
  /** Producing detector — "snmp.trap", "syslog", "ping", "unifi.events". */
  source: z.string().min(1).max(100),
  /** Operator-readable sub-source — hostname, IP, MAC, port. */
  component: z.string().max(200).optional(),
  /** PD-CEF group — logical bucket ("network", "host", "ups", "deploy"). */
  eventGroup: z.string().max(100).optional(),
  /** PD-CEF class — specific condition ("interface_down", "deploy", "rollback"). */
  eventClass: z.string().max(100).optional(),
  severity: z.enum(EDGE_EVENT_SEVERITIES),
  /**
   * For alerts: trigger raises or re-raises; acknowledge marks
   * under-investigation; resolve closes it. For changes: should be
   * "trigger" — lifecycle does not apply and the route ignores the value.
   */
  action: z.enum(EDGE_EVENT_ACTIONS),
  /** Short human-readable line for incident lists. */
  summary: z.string().min(1).max(500),
  /** RFC 3339 timestamp the edge detector observed the condition. */
  occurredAt: z.string().datetime(),
  /** Free-form detector payload — varbinds, deltas, parsed syslog, deploy metadata. */
  customDetails: z.record(z.string(), z.unknown()).optional(),
});

export type EdgeEvent = z.infer<typeof edgeEventSchema>;

export const edgeEventEnvelopeSchema = z.object({
  /** UUID idempotency key — same pattern as discovery-runs + metrics. */
  runKey: z.string().uuid(),
  /**
   * nodeId from the client. The portal IGNORES this field and uses the
   * nodeId resolved from the bearer token instead (mirrors metrics).
   */
  nodeId: z.string().min(1).max(100).optional(),
  /** ISO 8601 timestamp when the batch left the edge node. */
  observedAt: z.string().datetime(),
  eventsVersion: z.literal("1"),
  events: z.array(edgeEventSchema).min(1).max(500),
});

export type EdgeEventEnvelope = z.infer<typeof edgeEventEnvelopeSchema>;
