// BI-64795FD0 — notice a client release the capability profile has not
// verified (design 2026-10-07-agent-toolchain-release-delivery §5.5).
//
// P3 records each connection's clientInfo.version. When that version is newer
// than the profile's verifiedVersion for the client, the fleet view marks the
// client "capabilities unverified for <version>", and one backlog item is
// filed to re-verify the profile. The item is deduplicated by the shared
// intake front door on its origin marker, so the intake key
// `client-capability:<client>@<version>` is the marker
// `[origin:client-capability:<client>@<version>]`.

import { checkClientVersion, extractClientVersion } from "@dpf/integration-shared/client-capability-profile";

import { isRecord } from "@/lib/shared/coerce";
import type { BacklogIngestInput, BacklogIngestResult } from "@/lib/operate/backlog-ingest";

export const CLIENT_CAPABILITY_INTAKE_KIND = "client-capability";

/** The dedupe key for one client and version. */
export function clientCapabilityIntakeKey(clientKind: string, clientVersion: string): string {
  return `${CLIENT_CAPABILITY_INTAKE_KIND}:${clientKind}@${clientVersion}`;
}

export type CapabilityDrift = {
  clientKind: string;
  clientVersion: string;
  verifiedVersion: string | null;
  /** What the fleet view shows for the client. */
  label: string;
  intakeKey: string;
};

/** Pure: each client and version that observations report newer than the profile verified, once. */
export function capabilityDriftFromObservations(
  rows: Array<{ clientKind: string; clientInfoVersion: string | null }>,
): CapabilityDrift[] {
  const seen = new Map<string, CapabilityDrift>();
  for (const row of rows) {
    if (!row.clientInfoVersion) continue;
    const check = checkClientVersion(row.clientKind, row.clientInfoVersion);
    if (!check.unverified) continue;
    const intakeKey = clientCapabilityIntakeKey(check.clientKind, check.clientVersion);
    if (seen.has(intakeKey)) continue;
    seen.set(intakeKey, {
      clientKind: check.clientKind,
      clientVersion: check.clientVersion,
      verifiedVersion: check.verifiedVersion,
      label: `capabilities unverified for ${check.clientVersion}`,
      intakeKey,
    });
  }
  return [...seen.values()];
}

/**
 * The CLI versions one readiness report carries in `detail`: the updater's
 * per-client `clientVersions` map plus the surface's own `cliVersion`. Values are
 * the raw `--version` lines; the version inside each is extracted here.
 */
export function cliVersionsFromDetail(clientKind: string, detail: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(detail)) return out;
  if (isRecord(detail.clientVersions)) {
    for (const [kind, raw] of Object.entries(detail.clientVersions)) {
      const version = extractClientVersion(raw);
      if (version) out[kind] = version;
    }
  }
  const own = extractClientVersion(detail.cliVersion);
  if (own) out[clientKind] = own;
  return out;
}

/** Pure: drift from the CLI versions the updater reported, before a client even connects. */
export function capabilityDriftFromReports(rows: Array<{ clientKind: string; detail?: unknown }>): CapabilityDrift[] {
  return capabilityDriftFromObservations(
    rows.flatMap((row) =>
      Object.entries(cliVersionsFromDetail(row.clientKind, row.detail)).map(([clientKind, clientInfoVersion]) => ({ clientKind, clientInfoVersion })),
    ),
  );
}

type Ingest = (input: BacklogIngestInput) => Promise<BacklogIngestResult>;

async function defaultIngest(input: BacklogIngestInput): Promise<BacklogIngestResult> {
  const { ingestBacklogItem } = await import("@/lib/operate/backlog-ingest");
  return ingestBacklogItem(input);
}

/** File, or count again, the one re-verification item for this client and version. */
export async function fileCapabilityReverification(
  drift: { clientKind: string; clientVersion: string; verifiedVersion: string | null },
  deps: { ingest?: Ingest } = {},
): Promise<BacklogIngestResult> {
  const ingest = deps.ingest ?? defaultIngest;
  const verified = drift.verifiedVersion ? `version ${drift.verifiedVersion}` : "no version";
  return ingest({
    title: `Re-verify ${drift.clientKind} capabilities for ${drift.clientVersion}`,
    body: [
      `A ${drift.clientKind} connection reported version ${drift.clientVersion}. The client capability profile was verified on ${verified}.`,
      "",
      "Re-verify each field of this client's row in packages/dpf-skill-pack/client-capabilities.json against the row's sources[] and a live probe on the dev install. That includes the hook plane per host: the events that fire, the deny envelope honoured, and the permission modes probed.",
      "Change a value only by a PR that cites the source passage and the probe. Until then every rule keeps the last verified value.",
      "",
      "Design: docs/superpowers/specs/2026-10-07-agent-toolchain-release-delivery-design.md §5.5 (BI-64795FD0).",
    ].join("\n"),
    workType: "chore",
    source: "automated-detection",
    origin: { kind: CLIENT_CAPABILITY_INTAKE_KIND, id: `${drift.clientKind}@${drift.clientVersion}` },
  });
}

const MEMO_LIMIT = 500;
const filed = new Set<string>();

/**
 * Called when a connection declares its client and reports clientInfo.version.
 * Files at most once per process for each unverified client and version; the
 * intake dedupe makes every later process a recurrence count, not a new item.
 * Never throws: a filing must not fail a connection.
 */
export async function noteObservedClientVersion(
  clientKind: string,
  clientVersion: string,
  deps: { ingest?: Ingest } = {},
): Promise<BacklogIngestResult | null> {
  const check = checkClientVersion(clientKind, clientVersion);
  if (!check.unverified) return null;
  const key = clientCapabilityIntakeKey(clientKind, clientVersion);
  if (filed.has(key)) return null;
  if (filed.size >= MEMO_LIMIT) filed.clear();
  filed.add(key);
  try {
    return await fileCapabilityReverification(check, deps);
  } catch (error) {
    filed.delete(key);
    console.warn("[agent-toolchain] capability re-verification not filed:", error);
    return null;
  }
}

/** Test seam. */
export function _resetCapabilityDriftMemo(): void {
  filed.clear();
}
