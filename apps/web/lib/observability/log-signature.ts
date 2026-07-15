// EP-FULL-OBS Tier 2 (BI-5FE8656F) — pure log-line signature clustering.
//
// Turns raw container log lines into stable "signatures" by template
// extraction (strip timestamps, ids, paths, numbers) so that hundreds of
// near-identical error lines collapse to ONE actionable signature. Pure and
// dependency-free so it is exhaustively unit-testable without Loki, Prisma, or
// Inngest. The Inngest scanner (log-signature-scanner.ts) is the only caller.

import { createHash } from "node:crypto";

export interface RawLogLine {
  service: string;
  line: string;
  /** epoch milliseconds */
  tsMs: number;
}

export interface SignatureBucket {
  service: string;
  signatureId: string;
  template: string;
  count: number;
  sample: string;
  /** epoch milliseconds */
  firstTs: number;
  lastTs: number;
}

export type LogIssueSeverity = "critical" | "high" | "medium" | "low";

// Lines that are Alloy/Loki self-noise about their own backfill — never an
// application problem, must never become a signature.
const SELF_NOISE = /has timestamp too old|final error sending batch|loki\.write/i;
// Structured INFO/DEBUG logs: the "error" match is almost always a field name
// (e.g. grafana `ErrorCode:`), not an actual error. Caught live during the
// interim bring-up — filtering these is what keeps the detector trustworthy.
const INFO_DEBUG = /level=(info|debug)\b|"level":\s*"(info|debug)"/i;
// A whole-word error token, NOT a substring of ErrorCode / ErrorMessage.
const ERROR_TOKEN = /\b(error|fatal|panic|exception|traceback)\b/i;
// The responses-adapter logs its OWN outbound AI requests (and streamed SSE
// events) via console.log with no level= marker, so INFO_DEBUG can't catch
// them. Two of these are benign but trip ERROR_TOKEN:
//   1. `[responses-adapter] REQUEST to ...` outbound-request lines — never an
//      application error, they are the request being sent.
//   2. When the portal files a PlatformIssueReport THROUGH the AI, that outbound
//      request body echoes the prior report ("Error Report PIR-..."), so
//      ERROR_TOKEN matches "Error" and the scanner files a fresh PIR for its own
//      request — a self-referential loop that generated thousands of duplicate
//      signatures. `response.created` is the benign OpenAI Responses API SSE
//      start event, likewise not an error.
const OUTBOUND_REQUEST_NOISE = /\[responses-adapter\]\s+REQUEST|Error Report PIR-|\bresponse\.created\b/i;
// Postgres-side lifecycle FATALs emitted during a *controlled* restart (a
// self-upgrade recycle or deploy): the database announcing it is starting up /
// shutting down, terminating open connections on an operator SIGTERM, or the
// postgres-exporter sidecar briefly failing to scrape while the DB bounces.
// These are normal restart choreography, not application defects — and nothing
// actionable is hidden by filtering them, because a *genuine* DB outage ALSO
// surfaces app-side (Prisma DatabaseNotReachable / init errors), and those are
// NOT filtered here, so the real signal still clusters. Empirically this exact
// class minted ~6 duplicate BI-PIR-* during the 2026-07-15 self-upgrade window.
const DB_LIFECYCLE_NOISE =
  /database system is (starting up|shutting down)|terminating connection due to administrator command|error scraping (target|dsn)/i;

/** True when a line is a genuine error worth clustering (not info/debug/self-noise). */
export function isErrorLine(line: string): boolean {
  if (!line) return false;
  if (SELF_NOISE.test(line)) return false;
  if (INFO_DEBUG.test(line)) return false;
  if (OUTBOUND_REQUEST_NOISE.test(line)) return false;
  if (DB_LIFECYCLE_NOISE.test(line)) return false;
  return ERROR_TOKEN.test(line);
}

/** Collapse a log line to a stable template by masking variable tokens. */
export function toTemplate(line: string): string {
  return line
    .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, "<ts>") // ISO timestamps
    .replace(/\b[0-9a-fA-F]{8}-[0-9a-fA-F-]{20,}\b/g, "<uuid>") // uuids
    .replace(/\b0x[0-9a-fA-F]+\b/g, "<hex>") // hex addresses
    .replace(/\b[0-9a-fA-F]{12,}\b/g, "<hex>") // long hex ids / shas
    .replace(/([/\\])[^\s:]+(\.[a-zA-Z0-9]+)?(:\d+:\d+)?/g, "<path>") // paths / file:line:col
    .replace(/\b\d+(\.\d+)?(ms|s|MB|GB|KB|GiB|MiB)?\b/g, "<n>") // numbers / durations / sizes
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** Deterministic 10-char id for a (service, template) pair. */
export function signatureId(service: string, template: string): string {
  return createHash("sha1").update(`${service}|${template}`).digest("hex").slice(0, 10);
}

/** Stable dedupe key used as PlatformIssueReport.dedupeKey for idempotent filing. */
export function dedupeKeyFor(service: string, sigId: string): string {
  return `log-sig:${service}:${sigId}`;
}

/**
 * Fold rate-awareness into the single PIR path: a louder signature (more
 * occurrences in the window) files at a higher severity. This is why the scan
 * covers both the "loud" Mac-incident case and the "quiet" first-occurrence
 * case without a separate alert pipeline.
 */
export function severityForCount(count: number): LogIssueSeverity {
  if (count >= 300) return "critical";
  if (count >= 60) return "high";
  if (count >= 10) return "medium";
  return "low";
}

/** Cluster raw lines into signatures, sorted by descending occurrence count. */
export function clusterBySignature(lines: RawLogLine[]): SignatureBucket[] {
  const buckets = new Map<string, SignatureBucket>();
  for (const { service, line, tsMs } of lines) {
    if (!isErrorLine(line)) continue;
    const template = toTemplate(line);
    if (template.length < 12) continue; // too short to be a meaningful signature
    const sigId = signatureId(service, template);
    const key = `${service}|${sigId}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count++;
      existing.firstTs = Math.min(existing.firstTs, tsMs);
      existing.lastTs = Math.max(existing.lastTs, tsMs);
    } else {
      buckets.set(key, {
        service,
        signatureId: sigId,
        template,
        count: 1,
        sample: line.trim().slice(0, 300),
        firstTs: tsMs,
        lastTs: tsMs,
      });
    }
  }
  return [...buckets.values()].sort((a, b) => b.count - a.count);
}
