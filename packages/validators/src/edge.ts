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
  // FP7 (BI-4B381171): bound per-envelope interface count so an
  // unbounded array can't inflate payload size or downstream write
  // volume before the 64 KB body cap even engages. 2000 is far above
  // any real node's interface count (SNMP/UniFi/LLDP adapters see at
  // most a few hundred ports per poll cycle).
  interfaces: z.array(interfaceMetricSchema).max(2000),
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

// ---------------------------------------------------------------------------
// SecurityEvent — OCSF-normalized security telemetry on the edge envelope.
//
// EP-SOVEREIGN-SOC P0. Spec: docs/superpowers/specs/2026-06-24-sovereign-soc-
// siem-design.md §4.1 + §6.1. Rides the existing /api/v1/edge/events route and
// envelope via the eventType discriminator — the same pattern alert/change use.
// "security" carries an already-OCSF-normalized event; the portal dispatches it
// to the SecurityEvent table. A "security" record fails edgeEventSchema's
// eventType enum, so the envelope union routes it here unambiguously.
//
// Scope (customer/site) is NEVER taken from this wire body — the route derives
// it from the authenticated EdgeNode row. rawRef is a pointer/hash to edge-local
// raw evidence, never the raw payload (the sovereignty boundary).
// ---------------------------------------------------------------------------

export const SECURITY_EVENT_CONFIDENCE = [
  "source-reported",
  "low",
  "medium",
  "high",
  "confirmed",
] as const;
export type SecurityEventConfidence =
  (typeof SECURITY_EVENT_CONFIDENCE)[number];

export const securityEventWireSchema = z.object({
  /** Discriminator selecting the SecurityEvent persistence path. */
  eventType: z.literal("security"),
  /**
   * Globally-unique, producer-composed idempotency key. A replay with the same
   * eventKey collapses — append-only telemetry, re-submission is a no-op.
   */
  eventKey: z.string().min(1).max(255),
  /** OCSF schema version the producer normalized to (e.g. "1.8.0"). */
  ocsfVersion: z.string().min(1).max(20),
  /** OCSF class_uid — the event class (required). */
  ocsfClassUid: z.number().int(),
  /** OCSF category_uid (optional). */
  ocsfCategoryUid: z.number().int().optional(),
  /** OCSF activity_id (optional). */
  ocsfActivityId: z.number().int().optional(),
  /** OCSF severity_id, 0..6 (0 Unknown … 5 Critical … 6 Fatal). */
  severityId: z.number().int().min(0).max(6).optional(),
  /** RFC 3339 time the activity occurred (set by the detector). */
  time: z.string().datetime(),
  /** Source family — "windows.security", "syslog", "aws.cloudtrail", "dpf.internal". */
  sourceKind: z.string().min(1).max(100),
  /** Operator-readable source name — host, account, or service. */
  sourceName: z.string().min(1).max(200),
  /** Principal id when the actor is a known platform identity; else omitted. */
  actorPrincipalId: z.string().max(255).optional(),
  /** OCSF actor object (user / process). */
  actor: z.record(z.string(), z.unknown()).optional(),
  /** OCSF device / endpoint object. */
  device: z.record(z.string(), z.unknown()).optional(),
  /** OCSF src_endpoint. */
  srcEndpoint: z.record(z.string(), z.unknown()).optional(),
  /** OCSF dst_endpoint. */
  dstEndpoint: z.record(z.string(), z.unknown()).optional(),
  /** OCSF observables array. */
  observables: z.array(z.record(z.string(), z.unknown())).optional(),
  /** Full normalized OCSF body. */
  normalized: z.record(z.string(), z.unknown()).optional(),
  /** Pointer / hash to edge-local raw evidence — NOT the raw blob. */
  rawRef: z.record(z.string(), z.unknown()).optional(),
  confidence: z
    .enum(SECURITY_EVENT_CONFIDENCE)
    .optional()
    .default("source-reported"),
});

export type SecurityEventWire = z.infer<typeof securityEventWireSchema>;

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
  // alert/change share the PD-CEF edgeEventSchema; security carries the OCSF
  // securityEventWireSchema. The route discriminates on eventType: "security"
  // fails edgeEventSchema's eventType enum and so matches only the security
  // branch, while bare/alert/change records match only edgeEventSchema.
  events: z
    .array(z.union([edgeEventSchema, securityEventWireSchema]))
    .min(1)
    .max(500),
});

export type EdgeEventEnvelope = z.infer<typeof edgeEventEnvelopeSchema>;
export type EdgeEventEnvelopeEvent = EdgeEventEnvelope["events"][number];
