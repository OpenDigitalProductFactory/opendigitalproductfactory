// AI-capacity watch (BI-24092DC9).
//
// WHY THIS EXISTS: on 2026-10-21..28 the platform ran with almost no working AI.
// The Claude subscription sign-in lapsed, Codex hit its usage limit, the fallback
// API key was spend-limited and xAI had no credentials, while the one local
// engine saturated. Each fault was detected somewhere (a provider page, a capacity
// row, five auto-filed backlog items), but nothing measured usable capacity as a
// whole and nothing told the operator. Hourly served share sat at 2-15% for a day.
//
// What it does, every alert-delivery-bridge cycle (5 minutes):
//   1. Reads AdapterRunTelemetry for the last 30 minutes and computes the served
//      share per provider and in total. Served = success or refusal (the model
//      answered); failed = error or timeout; cancelled / policy-block are not
//      capacity outcomes and are not counted.
//   2. A provider with >= 5 counted calls and none served is a total failure. It
//      gets ONE monitor row naming the provider, the plain-language cause and its
//      provider page.
//   3. >= 10 counted calls in total with a served share below 50% is a platform
//      collapse. It gets ONE platform row listing what is failing.
//   4. Rows clear themselves: a later window that serves calls resolves them. A
//      row whose provider got no calls this window is HELD, not resolved, because
//      routing may simply have stopped sending to a dead provider.
//
// Thresholds and window: WWMD DI-E5208C7D1666 (window/threshold) and
// DI-BA01CDC705DB (host and surface). The rows are `ai_capacity_loss`
// PortfolioQualityIssue rows written through the shared monitor-issue-writer, so
// they reach Needs-you through the platform-health attention source and close
// with the monitor that raised them. This is deliberately NOT a backlog row.

import type { MonitorIssueDb } from "@/lib/observability/monitor-issue-writer";
import { openMonitorIssue, resolveMonitorIssuesExcept } from "@/lib/observability/monitor-issue-writer";
import { AI_PROVIDER_CONNECTIONS_ROUTE } from "@/lib/ai-provider-routes";
import { providerDetailHref } from "./provider-health";

export const AI_CAPACITY_ISSUE_TYPE = "ai_capacity_loss" as const;
export const AI_CAPACITY_WINDOW_MS = 30 * 60_000;
export const PROVIDER_MIN_ATTEMPTS = 5;
export const PLATFORM_MIN_ATTEMPTS = 10;
export const PLATFORM_MIN_SERVED_SHARE = 0.5;
export const AI_CAPACITY_PLATFORM_KEY = "ai-capacity:platform";
const TELEMETRY_READ_CAP = 5000;

export function aiCapacityProviderKey(providerId: string): string {
  return `ai-capacity:provider:${providerId}`;
}

export type CapacityTelemetryRow = {
  providerId: string;
  status: string;
  errorClass: string | null;
  httpStatus: number | null;
  refusalReason: string | null;
  startedAt: Date;
};

export type CapacityProvider = {
  providerId: string;
  name: string;
  /** ModelProvider.status — an operator-inactive provider is never held open. */
  status: string;
  capacity?: { state: string; retryAt: Date | null } | null;
};

export type CapacityCause =
  | "sign-in"
  | "usage-limit"
  | "spend-limit"
  | "no-credentials"
  | "local-saturated"
  | "calls-failing";

export type CapacityShare = { attempts: number; served: number; share: number | null };
export type ProviderCapacityShare = CapacityShare & { providerId: string };

type FindingCopy = { title: string; explanation: string; actionLabel: string; href: string };

export type ProviderCapacityFinding = FindingCopy & {
  kind: "provider";
  issueKey: string;
  providerId: string;
  name: string;
  cause: CapacityCause;
  attempts: number;
  retryAtIso: string | null;
};

export type PlatformCapacityFinding = FindingCopy & {
  kind: "platform";
  issueKey: string;
  attempts: number;
  served: number;
  share: number;
  failing: Array<{ providerId: string; name: string; cause: CapacityCause }>;
};

export type CapacityFinding = ProviderCapacityFinding | PlatformCapacityFinding;

const SERVED = new Set(["success", "refusal"]);
const FAILED = new Set(["error", "timeout"]);
const QUOTA_STATES = new Set(["quota_resets_at", "rate_limited", "cooling_down"]);
const BILLING_STATES = new Set(["billing_action_required", "unsupported_plan"]);

/** Plain cause of ONE failed call, from what the adapter recorded. */
export function classifyFailureCause(row: Pick<CapacityTelemetryRow, "errorClass" | "httpStatus" | "refusalReason">): CapacityCause {
  const text = `${row.refusalReason ?? ""} ${row.errorClass ?? ""}`.toLowerCase();
  if (/no[- ]credentials/.test(text)) return "no-credentials";
  if (/admission timeout on local engine|local provider dispatch deferred/.test(text)) return "local-saturated";
  if (/specified api usage limits|credit balance|insufficient_quota|billing|payment required/.test(text) || row.httpStatus === 402) {
    return "spend-limit";
  }
  if (/usage[_ ]limit|rate[_ ]limit/.test(text) || row.httpStatus === 429) return "usage-limit";
  if (row.errorClass === "auth" || row.httpStatus === 401 || row.httpStatus === 403 || /invalid_grant|token refresh|oauth/.test(text)) {
    return "sign-in";
  }
  return "calls-failing";
}

function causeFromCapacity(state: string | undefined): CapacityCause | null {
  if (!state) return null;
  if (QUOTA_STATES.has(state)) return "usage-limit";
  if (BILLING_STATES.has(state)) return "spend-limit";
  if (state === "reauth_required") return "sign-in";
  return null;
}

function dominantCause(failed: CapacityTelemetryRow[]): CapacityCause {
  const counts = new Map<CapacityCause, number>();
  for (const row of failed) {
    const cause = classifyFailureCause(row);
    counts.set(cause, (counts.get(cause) ?? 0) + 1);
  }
  let best: CapacityCause = "calls-failing";
  let bestCount = -1;
  for (const [cause, count] of counts) {
    if (count > bestCount) {
      best = cause;
      bestCount = count;
    }
  }
  return best;
}

function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function providerCopy(name: string, providerId: string, cause: CapacityCause, attempts: number, retryAt: Date | null): FindingCopy {
  const href = providerDetailHref(providerId);
  const failed = `All ${attempts} AI requests sent to ${name} in the last 30 minutes failed.`;
  switch (cause) {
    case "sign-in":
      return {
        title: `Sign in to ${name} again`,
        explanation: `${failed} The provider no longer accepts the saved sign-in, and the platform could not renew it. Sign in again on the provider page to restore it.`,
        actionLabel: "Sign in again",
        href,
      };
    case "no-credentials":
      return {
        title: `${name} has no working sign-in or key`,
        explanation: `${failed} No credential is being presented to it. Add a key or sign in on the provider page, or turn the provider off so work stops being sent to it.`,
        actionLabel: "Fix the sign-in",
        href,
      };
    case "spend-limit":
      return {
        title: `${name} has reached its spending limit`,
        explanation: `${failed} The provider account has hit its spending or credit limit, and it will not recover on its own. Raise the limit or add credit with the provider, then check it on the provider page.`,
        actionLabel: "Review the provider",
        href,
      };
    case "usage-limit":
      return {
        title: `${name} has hit its usage limit`,
        explanation: retryAt
          ? `${failed} Its plan's usage limit is reached and resets at ${formatUtc(retryAt)}. Work goes to other providers until then; open the provider page if you want to change the plan.`
          : `${failed} Its plan's usage limit is reached. Work goes to other providers until it resets; open the provider page to see when, or to change the plan.`,
        actionLabel: "Review the provider",
        href,
      };
    case "local-saturated":
      return {
        title: `The ${name} is overloaded`,
        explanation: `${failed} Requests waited too long for a turn on the local engine and timed out. Connect another provider or reduce local work so requests can run.`,
        actionLabel: "Review AI providers",
        href: AI_PROVIDER_CONNECTIONS_ROUTE,
      };
    default:
      return {
        title: `${name} is failing every request`,
        explanation: `${failed} The platform could not tell why. Open the provider page to check its status and recent errors.`,
        actionLabel: "Review the provider",
        href,
      };
  }
}

const CAUSE_PHRASE: Record<CapacityCause, string> = {
  "sign-in": "needs you to sign in again",
  "no-credentials": "has no working sign-in or key",
  "spend-limit": "has reached its spending limit",
  "usage-limit": "has hit its usage limit",
  "local-saturated": "is overloaded",
  "calls-failing": "is failing every request",
};

function share(attempts: number, served: number): number | null {
  return attempts === 0 ? null : served / attempts;
}

/**
 * Pure assessment over one window of telemetry. Returns the shares, the findings
 * to keep open this cycle, and the previously-open keys to HOLD (not enough
 * traffic this window to call them recovered).
 */
export function assessAiCapacity(input: {
  rows: CapacityTelemetryRow[];
  providers: CapacityProvider[];
  now: Date;
  previouslyOpen: ReadonlySet<string>;
}): { total: CapacityShare; providers: ProviderCapacityShare[]; findings: CapacityFinding[]; held: string[] } {
  const since = input.now.getTime() - AI_CAPACITY_WINDOW_MS;
  const providerById = new Map(input.providers.map((p) => [p.providerId, p]));
  const byProvider = new Map<string, { served: number; failed: CapacityTelemetryRow[] }>();
  for (const row of input.rows) {
    if (row.startedAt.getTime() < since) continue;
    const isServed = SERVED.has(row.status);
    if (!isServed && !FAILED.has(row.status)) continue;
    const bucket = byProvider.get(row.providerId) ?? { served: 0, failed: [] };
    if (isServed) bucket.served++;
    else bucket.failed.push(row);
    byProvider.set(row.providerId, bucket);
  }

  const shares: ProviderCapacityShare[] = [];
  const findings: CapacityFinding[] = [];
  let attempts = 0;
  let served = 0;
  for (const [providerId, bucket] of [...byProvider].sort(([a], [b]) => a.localeCompare(b))) {
    const providerAttempts = bucket.served + bucket.failed.length;
    attempts += providerAttempts;
    served += bucket.served;
    shares.push({ providerId, attempts: providerAttempts, served: bucket.served, share: share(providerAttempts, bucket.served) });

    const provider = providerById.get(providerId);
    if (!provider || provider.status === "inactive") continue;
    if (bucket.served > 0 || providerAttempts < PROVIDER_MIN_ATTEMPTS) continue;
    const rowCause = dominantCause(bucket.failed);
    const cause = rowCause === "calls-failing" ? causeFromCapacity(provider.capacity?.state) ?? rowCause : rowCause;
    const retryAt =
      cause === "usage-limit" && provider.capacity?.retryAt && provider.capacity.retryAt > input.now
        ? provider.capacity.retryAt
        : null;
    findings.push({
      kind: "provider",
      issueKey: aiCapacityProviderKey(providerId),
      providerId,
      name: provider.name,
      cause,
      attempts: providerAttempts,
      retryAtIso: retryAt?.toISOString() ?? null,
      ...providerCopy(provider.name, providerId, cause, providerAttempts, retryAt),
    });
  }

  const total = { attempts, served, share: share(attempts, served) };
  if (attempts >= PLATFORM_MIN_ATTEMPTS && served / attempts < PLATFORM_MIN_SERVED_SHARE) {
    const failing = findings
      .filter((f): f is ProviderCapacityFinding => f.kind === "provider")
      .map(({ providerId, name, cause }) => ({ providerId, name, cause }));
    const pct = Math.round((served / attempts) * 100);
    const named = failing.map((f) => `${f.name} ${CAUSE_PHRASE[f.cause]}`).join("; ");
    findings.push({
      kind: "platform",
      issueKey: AI_CAPACITY_PLATFORM_KEY,
      attempts,
      served,
      share: served / attempts,
      failing,
      title: `Only ${pct}% of AI requests are succeeding`,
      explanation:
        `In the last 30 minutes ${served} of ${attempts} AI requests completed, so coworkers and builds are running on very little AI. ` +
        (named ? `${named}. ` : "") +
        "Open AI providers to restore the ones that are down.",
      actionLabel: "Review AI providers",
      href: AI_PROVIDER_CONNECTIONS_ROUTE,
    });
  }

  const active = new Set(findings.map((f) => f.issueKey));
  const held: string[] = [];
  for (const key of input.previouslyOpen) {
    if (active.has(key)) continue;
    if (key === AI_CAPACITY_PLATFORM_KEY) {
      if (attempts < PLATFORM_MIN_ATTEMPTS) held.push(key);
      continue;
    }
    const providerId = key.slice(aiCapacityProviderKey("").length);
    const provider = providerById.get(providerId);
    if (!provider || provider.status === "inactive") continue;
    if (!byProvider.has(providerId)) held.push(key);
  }

  return { total, providers: shares, findings, held: held.sort() };
}

/** Narrow Prisma surface so tests inject a fake without the full client type. */
export interface AiCapacityWatchDb extends MonitorIssueDb {
  adapterRunTelemetry: { findMany(args: unknown): Promise<CapacityTelemetryRow[]> };
  modelProvider: { findMany(args: unknown): Promise<Array<{ providerId: string; name: string; status: string }>> };
  providerCapacityStatus: {
    findMany(args: unknown): Promise<Array<{ providerId: string | null; state: string; retryAt: Date | null }>>;
  };
  portfolioQualityIssue: MonitorIssueDb["portfolioQualityIssue"] & {
    findMany(args: { where: { issueType: string; status: string }; select: { issueKey: true } }): Promise<Array<{ issueKey: string }>>;
  };
}

export type AiCapacityNotify = (input: {
  itemKey: string;
  title: string;
  body: string;
  deepLink: string;
  riskClass: string;
}) => Promise<void>;

export type AiCapacityWatchResult = {
  attempts: number;
  servedShare: number | null;
  open: number;
  opened: number;
  resolved: number;
};

/**
 * One watch cycle: read the window, open/refresh a row per finding, resolve what
 * recovered, and push a notification only for rows that were not already open.
 */
export async function runAiCapacityWatch(
  db: AiCapacityWatchDb,
  opts: {
    now?: Date;
    notify?: AiCapacityNotify;
    /** Providers the provider-credential attention lane already shows a reconnect
     *  item for. Recorded on the row so Needs-you shows one item per provider. */
    coveredByCredentialLane?: ReadonlySet<string>;
  } = {},
): Promise<AiCapacityWatchResult> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - AI_CAPACITY_WINDOW_MS);
  const [openRows, rows] = await Promise.all([
    db.portfolioQualityIssue.findMany({
      where: { issueType: AI_CAPACITY_ISSUE_TYPE, status: "open" },
      select: { issueKey: true },
    }),
    db.adapterRunTelemetry.findMany({
      where: { startedAt: { gte: since } },
      select: { providerId: true, status: true, errorClass: true, httpStatus: true, refusalReason: true, startedAt: true },
      orderBy: { startedAt: "desc" },
      take: TELEMETRY_READ_CAP,
    }),
  ]);
  const previouslyOpen = new Set(openRows.map((r) => r.issueKey));
  const providerIds = [
    ...new Set([
      ...rows.map((r) => r.providerId),
      ...[...previouslyOpen].filter((k) => k !== AI_CAPACITY_PLATFORM_KEY).map((k) => k.slice(aiCapacityProviderKey("").length)),
    ]),
  ];
  const [providerRows, capacityRows] = await Promise.all([
    db.modelProvider.findMany({ where: { providerId: { in: providerIds } }, select: { providerId: true, name: true, status: true } }),
    db.providerCapacityStatus.findMany({ where: { providerId: { in: providerIds } }, select: { providerId: true, state: true, retryAt: true } }),
  ]);
  const capacityById = new Map(capacityRows.filter((r) => r.providerId).map((r) => [r.providerId as string, r]));
  const providers: CapacityProvider[] = providerRows.map((p) => ({
    ...p,
    capacity: capacityById.get(p.providerId) ?? null,
  }));

  const assessment = assessAiCapacity({ rows, providers, now, previouslyOpen });
  const opened: CapacityFinding[] = [];
  for (const finding of assessment.findings) {
    const { title, ...details } = finding;
    await openMonitorIssue(db, {
      issueKey: finding.issueKey,
      issueType: AI_CAPACITY_ISSUE_TYPE,
      severity: finding.kind === "platform" ? "error" : "warn",
      summary: title,
      details: {
        ...details,
        title,
        windowMinutes: AI_CAPACITY_WINDOW_MS / 60_000,
        credentialLaneCovers: finding.kind === "provider" && (opts.coveredByCredentialLane?.has(finding.providerId) ?? false),
      },
      now: () => now,
    });
    if (!previouslyOpen.has(finding.issueKey)) opened.push(finding);
  }
  const resolved = await resolveMonitorIssuesExcept(db, {
    issueType: AI_CAPACITY_ISSUE_TYPE,
    activeKeys: [...assessment.findings.map((f) => f.issueKey), ...assessment.held],
    now: () => now,
  });

  if (opts.notify) {
    for (const finding of opened) {
      await opts.notify({
        itemKey: finding.issueKey,
        title: finding.title,
        body: finding.explanation,
        deepLink: finding.href,
        riskClass: finding.kind === "platform" ? "high-risk" : "bounded-write",
      });
    }
  }

  return {
    attempts: assessment.total.attempts,
    servedShare: assessment.total.share,
    open: assessment.findings.length + assessment.held.length,
    opened: opened.length,
    resolved,
  };
}
