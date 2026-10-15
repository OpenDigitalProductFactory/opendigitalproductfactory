// BI-64795FD0 — the weekly client-capability re-verification (design
// 2026-10-07-agent-toolchain-release-delivery §5.5).
//
// Inputs are declared, not discovered: each profile row's sources[] and the
// client CLI versions the updater reports. Output is a proposal, never an
// edit: at most one backlog item per client per run, deduplicated on
// `client-capability:<client>@<version>`. The run cannot write the profile,
// the policy or any client configuration; its only writes are backlog intake,
// an evidence row on that item, its own state and one platform notification.
//
// Failure is visible: a source that fails marks the client verificationStale
// with the reason, the open item (if any) records the failed run, and two
// failed runs in a row raise one PlatformNotification. The last verified value
// stays authoritative.

import {
  clientVersionUnverified,
  compareClientVersions,
  type ClientCapabilityProfile,
  type ClientCapabilityRow,
} from "@dpf/integration-shared/client-capability-profile";

import { err, type ActionResult } from "@/lib/shared/action-result";
import { isRecord } from "@/lib/shared/coerce";

import { cliVersionsFromDetail } from "./client-capability-drift";
import { extractPassages, fieldsMentioned, passageHash, type ProfileField } from "./client-capability-sources";

export const VERIFICATION_STATE_KEY = "clientCapability";
/** Mirrors CLIENT_CAPABILITY_REVERIFY_TASK_ID in packages/db (the seed and this app may not import each other). */
export const CLIENT_CAPABILITY_REVERIFY_TASK_ID = "client-capability-reverify-weekly";
const SNAPSHOT_LIMIT = 3_000;
const FINDINGS_PER_CLIENT = 10;

export type StaleMark = { reason: string; at: string };
export type ClientVerificationState = {
  verificationStale: StaleMark | null;
  /** Passage hashes per source URL, from the last successful read. */
  passages: Record<string, string[]>;
};
export type CapabilityVerificationState = {
  schemaVersion: 1;
  consecutiveFailedRuns: number;
  notified: boolean;
  clients: Record<string, ClientVerificationState>;
};

export function emptyVerificationState(): CapabilityVerificationState {
  return { schemaVersion: 1, consecutiveFailedRuns: 0, notified: false, clients: {} };
}

/** This task's state inside ScheduledAgentTask.taskConfig; empty when absent or malformed. */
export function readVerificationState(taskConfig: unknown): CapabilityVerificationState {
  const value = isRecord(taskConfig) ? taskConfig[VERIFICATION_STATE_KEY] : null;
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.clients)) return emptyVerificationState();
  const clients: Record<string, ClientVerificationState> = {};
  for (const [kind, raw] of Object.entries(value.clients)) {
    if (!isRecord(raw)) continue;
    const stale = isRecord(raw.verificationStale) && typeof raw.verificationStale.reason === "string" && typeof raw.verificationStale.at === "string"
      ? { reason: raw.verificationStale.reason, at: raw.verificationStale.at }
      : null;
    const passages: Record<string, string[]> = {};
    if (isRecord(raw.passages)) {
      for (const [url, hashes] of Object.entries(raw.passages)) {
        if (Array.isArray(hashes)) passages[url] = hashes.filter((hash): hash is string => typeof hash === "string");
      }
    }
    clients[kind] = { verificationStale: stale, passages };
  }
  return {
    schemaVersion: 1,
    consecutiveFailedRuns: typeof value.consecutiveFailedRuns === "number" ? value.consecutiveFailedRuns : 0,
    notified: value.notified === true,
    clients,
  };
}

/** What the fleet view shows for each client whose last re-verification failed. */
export function staleClientsFromTaskConfig(taskConfig: unknown): Array<{ clientKind: string; label: string; reason: string; at: string }> {
  return Object.entries(readVerificationState(taskConfig).clients)
    .filter(([, client]) => client.verificationStale)
    .map(([clientKind, client]) => ({ clientKind, label: "capabilities unverified", ...client.verificationStale! }));
}

/** A declared source read as text (`data`), or why it could not be read (`error`). */
export type SourceFetch = (url: string) => Promise<ActionResult<string>>;

export type CapabilityFinding = {
  field: ProfileField;
  source: string;
  passage: string;
  currentValue: string;
  proposedValue: string;
};

export type CapabilityProposal = {
  clientKind: string;
  clientVersion: string;
  verifiedVersion: string | null;
  intakeKey: string;
  findings: CapabilityFinding[];
  /** The newest CLI version the updater reported, when newer than verified. */
  reportedVersion: string | null;
};

export type ReverifyDeps = {
  profile: ClientCapabilityProfile;
  /** Newest `--version` per client kind from the latest updater reports. */
  reportedCliVersions: Record<string, string>;
  state: CapabilityVerificationState;
  now: Date;
  fetchSource: SourceFetch;
  fileItem: (proposal: CapabilityProposal) => Promise<{ itemId: string; created: boolean }>;
  /** Record a failed run on the client's open item, if any; returns its id. */
  recordOnOpenItem: (clientKind: string, payload: { runAt: string; failures: string[] }) => Promise<string | null>;
  notify: (message: string) => Promise<void>;
  resolveNotifications: () => Promise<void>;
};

export type ReverifyResult = {
  state: CapabilityVerificationState;
  proposals: CapabilityProposal[];
  filed: Array<{ clientKind: string; itemId: string; created: boolean }>;
  failures: string[];
  notified: boolean;
};

function describeValue(row: ClientCapabilityRow, field: ProfileField): string {
  const record = field === "hookPlane"
    ? { value: (["cli", "desktop", "ide"] as const).filter((host) => row.capabilities.hookPlane[host].status === "verified").join("+") || null, status: "per host" }
    : row.capabilities[field];
  const value = Array.isArray(record.value) ? record.value.join(", ") : String(record.value);
  return `${value} (${record.status})`;
}

function newestReported(row: ClientCapabilityRow, reported: string | undefined): string | null {
  if (!reported) return null;
  return clientVersionUnverified(row, reported) ? reported : null;
}

/** One run. Pure apart from the injected effects; the profile is only read. */
export async function runClientCapabilityReverification(deps: ReverifyDeps): Promise<ReverifyResult> {
  const at = deps.now.toISOString();
  const previous = deps.state;
  const state: CapabilityVerificationState = { ...previous, clients: { ...previous.clients } };
  const proposals: CapabilityProposal[] = [];
  const filed: ReverifyResult["filed"] = [];
  const failures: string[] = [];

  for (const [kind, row] of Object.entries(deps.profile.clients)) {
    const before = previous.clients[kind] ?? { verificationStale: null, passages: {} };
    const passages: Record<string, string[]> = {};
    const clientFailures: string[] = [];
    const findings: CapabilityFinding[] = [];

    for (const url of row.sources) {
      const fetched = await deps.fetchSource(url).catch((error: unknown) => err(error instanceof Error ? error.message : "fetch failed"));
      const read = fetched.ok ? extractPassages(fetched.data) : [];
      if (!fetched.ok || read.length === 0) {
        clientFailures.push(`${url}: ${fetched.ok ? "nothing parseable in the page" : fetched.error}`);
        if (before.passages[url]) passages[url] = before.passages[url]!;
        continue;
      }
      const known = before.passages[url] ? new Set(before.passages[url]) : null;
      passages[url] = [...new Set(read.map(passageHash))].slice(0, SNAPSHOT_LIMIT);
      if (!known) continue; // First read of this source: a baseline, not a change.
      for (const passage of read) {
        if (known.has(passageHash(passage))) continue;
        for (const field of fieldsMentioned(passage)) {
          findings.push({
            field,
            source: url,
            passage,
            currentValue: describeValue(row, field),
            proposedValue: `re-verify ${field} with a live probe; the source passage suggests it changed`,
          });
        }
      }
    }

    failures.push(...clientFailures);
    state.clients[kind] = {
      verificationStale: clientFailures.length ? { reason: clientFailures.join("; "), at } : null,
      passages,
    };
    if (clientFailures.length) await deps.recordOnOpenItem(kind, { runAt: at, failures: clientFailures });

    const reportedVersion = newestReported(row, deps.reportedCliVersions[kind]);
    if (findings.length === 0 && !reportedVersion) continue;
    const clientVersion = reportedVersion ?? deps.reportedCliVersions[kind] ?? row.verifiedVersion ?? "unversioned";
    const proposal: CapabilityProposal = {
      clientKind: kind,
      clientVersion,
      verifiedVersion: row.verifiedVersion,
      intakeKey: `client-capability:${kind}@${clientVersion}`,
      findings: findings.slice(0, FINDINGS_PER_CLIENT),
      reportedVersion,
    };
    proposals.push(proposal);
    const item = await deps.fileItem(proposal);
    filed.push({ clientKind: kind, ...item });
  }

  let notified = false;
  if (failures.length) {
    state.consecutiveFailedRuns = previous.consecutiveFailedRuns + 1;
    if (state.consecutiveFailedRuns >= 2 && !previous.notified) {
      await deps.notify(
        `Client capability re-verification failed ${state.consecutiveFailedRuns} runs in a row. `
        + `The profile keeps its last verified values. Failing sources: ${failures.slice(0, 5).join("; ")}`,
      );
      state.notified = true;
      notified = true;
    }
  } else {
    if (previous.consecutiveFailedRuns > 0 || previous.notified) await deps.resolveNotifications();
    state.consecutiveFailedRuns = 0;
    state.notified = false;
  }
  return { state, proposals, filed, failures, notified };
}

/** Newest version per client kind from updater reports (`detail.clientVersions` and `detail.cliVersion`). */
export function newestCliVersions(reports: Array<{ clientKind: string; detail: unknown }>): Record<string, string> {
  const newest: Record<string, string> = {};
  for (const report of reports) {
    for (const [kind, version] of Object.entries(cliVersionsFromDetail(report.clientKind, report.detail))) {
      const current = newest[kind];
      if (!current || (compareClientVersions(version, current) ?? 0) > 0) newest[kind] = version;
    }
  }
  return newest;
}
