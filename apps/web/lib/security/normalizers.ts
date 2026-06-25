// EP-SOVEREIGN-SOC P0 — reference source normalizers (raw → OCSF core).
//
// Spec: docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md §4.2, §7.1.
//
// Each normalizer is a PURE mapper from a source-native record to a scope-free
// `NormalizedSecurityCore`. Edge collectors wrap the core as a wire event
// (`toSecurityEventWire`) and POST it; the internal projector attaches
// org-internal scope and persists it. Scope is NEVER set by a normalizer — it
// is a trust-boundary concern owned by the route / projector.
//
// Three reference sources are implemented here (Windows Security Event Log, AWS
// CloudTrail, ArcSight CEF over syslog). They demonstrate the mapping contract;
// broader collector coverage is an EP-EDGE-TOPOLOGY track this epic consumes.

import type { SecurityEventWire } from "@dpf/validators";

import {
  OCSF_ACTIVITY,
  OCSF_CATEGORY,
  OCSF_CLASS,
  OCSF_SEVERITY,
  OCSF_VERSION,
  cefSeverityToOcsf,
} from "./ocsf";

/**
 * Scope-free OCSF-normalized core. Identical to the wire shape minus the
 * `eventType` discriminator, with `confidence` optional (the wrapper/persist
 * step fills the default).
 */
export type NormalizedSecurityCore = Omit<
  SecurityEventWire,
  "eventType" | "confidence"
> &
  Partial<Pick<SecurityEventWire, "confidence">>;

/** Wrap a normalized core as a wire event ready to POST to /api/v1/edge/events. */
export function toSecurityEventWire(
  core: NormalizedSecurityCore,
): SecurityEventWire {
  return {
    ...core,
    eventType: "security",
    confidence: core.confidence ?? "source-reported",
  };
}

type Observable = { name: string; type: string; value: string };

/** Build the OCSF observables array, dropping null entries; undefined if empty. */
function observables(
  entries: Array<Observable | null | undefined>,
): Record<string, unknown>[] | undefined {
  const kept = entries.filter((e): e is Observable => Boolean(e));
  return kept.length ? kept : undefined;
}

/** Deterministic FNV-1a (32-bit) hex — a stable tiebreaker inside an eventKey. */
function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ── Windows Security Event Log ──────────────────────────────────────────────

export interface WindowsSecurityEventRaw {
  /** Windows Event ID (4624 logon, 4625 failed logon, 4688 process creation). */
  eventId: number;
  computer: string;
  /** ISO 8601 TimeCreated. */
  timeCreated: string;
  /** EventRecordID — stable per record on a host. */
  eventRecordId: number | string;
  channel?: string;
  /** Flattened EventData key/values (TargetUserName, NewProcessName, …). */
  eventData?: Record<string, string | undefined>;
}

/**
 * Windows Security channel → OCSF. Logon events (4624/4625) map to
 * Authentication (3002); process creation (4688) maps to Process Activity
 * (1007). A failed logon is the one notable severity bump (Medium).
 */
export function normalizeWindowsSecurityEvent(
  raw: WindowsSecurityEventRaw,
): NormalizedSecurityCore {
  const ed = raw.eventData ?? {};
  const isProcess = raw.eventId === 4688;
  const isFailedLogon = raw.eventId === 4625;
  const userName = ed.TargetUserName ?? ed.SubjectUserName;
  const processName = ed.NewProcessName;

  return {
    eventKey: `windows.security:${raw.computer}:${raw.eventRecordId}`,
    ocsfVersion: OCSF_VERSION,
    ocsfClassUid: isProcess
      ? OCSF_CLASS.PROCESS_ACTIVITY
      : OCSF_CLASS.AUTHENTICATION,
    ocsfCategoryUid: isProcess
      ? OCSF_CATEGORY.SYSTEM_ACTIVITY
      : OCSF_CATEGORY.IAM,
    ocsfActivityId: isProcess
      ? OCSF_ACTIVITY.PROCESS_LAUNCH
      : OCSF_ACTIVITY.LOGON,
    severityId: isFailedLogon
      ? OCSF_SEVERITY.MEDIUM
      : OCSF_SEVERITY.INFORMATIONAL,
    time: raw.timeCreated,
    sourceKind: "windows.security",
    sourceName: raw.computer,
    actor: userName ? { user: { name: userName } } : undefined,
    device: { hostname: raw.computer },
    observables: observables([
      userName ? { name: "user.name", type: "User", value: userName } : null,
      isProcess && processName
        ? { name: "process.name", type: "Process", value: processName }
        : null,
    ]),
    normalized: {
      windowsEventId: raw.eventId,
      channel: raw.channel ?? "Security",
      eventData: ed,
    },
    rawRef: {
      sourceKind: "windows.security",
      eventRecordId: String(raw.eventRecordId),
    },
  };
}

// ── AWS CloudTrail ──────────────────────────────────────────────────────────

export interface CloudTrailEventRaw {
  eventID: string;
  eventName: string;
  /** ISO 8601 eventTime. */
  eventTime: string;
  eventSource: string;
  awsRegion?: string;
  sourceIPAddress?: string;
  readOnly?: boolean;
  errorCode?: string;
  userIdentity?: { arn?: string; type?: string; accountId?: string };
}

function cloudTrailActivity(eventName: string, readOnly?: boolean): number {
  if (readOnly) return OCSF_ACTIVITY.API_READ;
  if (/^(Create|Run|Put|Add|Allocate)/.test(eventName)) return OCSF_ACTIVITY.API_CREATE;
  if (/^(Delete|Remove|Terminate|Revoke)/.test(eventName)) return OCSF_ACTIVITY.API_DELETE;
  if (/^(Update|Modify|Set|Attach|Detach|Associate)/.test(eventName)) return OCSF_ACTIVITY.API_UPDATE;
  if (/^(Get|List|Describe|Lookup|Head)/.test(eventName)) return OCSF_ACTIVITY.API_READ;
  return OCSF_ACTIVITY.UNKNOWN;
}

/** AWS CloudTrail → OCSF API Activity (6003). A non-empty errorCode is a low
 *  severity signal (denied / failed call); successful calls are informational. */
export function normalizeCloudTrailEvent(
  raw: CloudTrailEventRaw,
): NormalizedSecurityCore {
  const arn = raw.userIdentity?.arn;
  return {
    eventKey: `aws.cloudtrail:${raw.eventID}`,
    ocsfVersion: OCSF_VERSION,
    ocsfClassUid: OCSF_CLASS.API_ACTIVITY,
    ocsfCategoryUid: OCSF_CATEGORY.APPLICATION_ACTIVITY,
    ocsfActivityId: cloudTrailActivity(raw.eventName, raw.readOnly),
    severityId: raw.errorCode ? OCSF_SEVERITY.LOW : OCSF_SEVERITY.INFORMATIONAL,
    time: raw.eventTime,
    sourceKind: "aws.cloudtrail",
    sourceName: raw.eventSource,
    actor: arn ? { user: { uid: arn, type: raw.userIdentity?.type } } : undefined,
    srcEndpoint: raw.sourceIPAddress ? { ip: raw.sourceIPAddress } : undefined,
    observables: observables([
      arn ? { name: "user.uid", type: "User", value: arn } : null,
      raw.sourceIPAddress
        ? { name: "src_endpoint.ip", type: "IP Address", value: raw.sourceIPAddress }
        : null,
    ]),
    normalized: {
      api: { operation: raw.eventName, service: { name: raw.eventSource } },
      region: raw.awsRegion ?? null,
      errorCode: raw.errorCode ?? null,
    },
    rawRef: { sourceKind: "aws.cloudtrail", eventID: raw.eventID },
  };
}

// ── ArcSight CEF (over syslog) ──────────────────────────────────────────────

export interface CefMessageRaw {
  deviceVendor: string;
  deviceProduct: string;
  deviceVersion?: string;
  signatureId: string;
  name: string;
  /** CEF severity 0..10. */
  severity: number;
  /** CEF extension key/values (src, dst, suser, …). */
  extensions?: Record<string, string>;
  /** Syslog header timestamp (ISO 8601) — required so the mapper stays pure. */
  timestamp: string;
  host?: string;
}

/** ArcSight CEF → OCSF Security Finding (2001). */
export function normalizeCefMessage(raw: CefMessageRaw): NormalizedSecurityCore {
  const ext = raw.extensions ?? {};
  const src = ext.src;
  const dst = ext.dst;
  const suser = ext.suser;
  const tiebreak = stableHash(
    `${raw.timestamp}|${raw.name}|${src ?? ""}|${dst ?? ""}|${suser ?? ""}`,
  );
  return {
    eventKey: `cef:${raw.deviceVendor}:${raw.deviceProduct}:${raw.signatureId}:${tiebreak}`,
    ocsfVersion: OCSF_VERSION,
    ocsfClassUid: OCSF_CLASS.SECURITY_FINDING,
    ocsfCategoryUid: OCSF_CATEGORY.FINDINGS,
    ocsfActivityId: OCSF_ACTIVITY.UNKNOWN,
    severityId: cefSeverityToOcsf(raw.severity),
    time: raw.timestamp,
    sourceKind: "cef",
    sourceName: `${raw.deviceVendor} ${raw.deviceProduct}`,
    actor: suser ? { user: { name: suser } } : undefined,
    srcEndpoint: src ? { ip: src } : undefined,
    dstEndpoint: dst ? { ip: dst } : undefined,
    observables: observables([
      suser ? { name: "user.name", type: "User", value: suser } : null,
      src ? { name: "src_endpoint.ip", type: "IP Address", value: src } : null,
      dst ? { name: "dst_endpoint.ip", type: "IP Address", value: dst } : null,
    ]),
    normalized: {
      finding: { title: raw.name, uid: raw.signatureId },
      device: { vendor: raw.deviceVendor, product: raw.deviceProduct, version: raw.deviceVersion },
      cefSeverity: raw.severity,
      extensions: ext,
    },
    rawRef: { sourceKind: "cef", signatureId: raw.signatureId, host: raw.host },
  };
}
