import { prisma, Prisma } from "@dpf/db";

import { normalizeHiveResultIntake, resolveHiveDeliveryAttempt } from "./result-intake";
import { GitHubForgeAdapter, parseGitHubRepositoryUrl } from "@/lib/forge/github-adapter";
import { resolveHiveToken } from "@/lib/integrate/identity-privacy";

interface HiveResultRow {
  id: string;
  payloadHash: string | null;
  status?: string;
  deliveryStatus?: string;
  deliveryAttempts?: number;
  deliveryRemoteRef?: string | null;
  resultBundle?: unknown;
}

export interface HiveResultStore {
  hiveContributionLedger: {
    findUnique(args: unknown): Promise<HiveResultRow | null>;
    create(args: unknown): Promise<HiveResultRow>;
    update(args: unknown): Promise<HiveResultRow>;
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function shortText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : fallback;
}

export async function persistHiveResult(
  payload: unknown,
  db: HiveResultStore = prisma as unknown as HiveResultStore,
) {
  const normalized = normalizeHiveResultIntake(payload);
  if (!normalized.ok) return { ok: false as const, violations: normalized.violations };
  const existing = await db.hiveContributionLedger.findUnique({ where: { sourceReceipt: normalized.sourceReceipt } });
  if (existing) {
    if (existing.payloadHash !== normalized.payloadHash) {
      return { ok: false as const, violations: ["sourceReceipt:payload-conflict"] };
    }
    return { ok: true as const, action: "noop" as const, id: existing.id };
  }
  const provenance = record(normalized.projected.provenance);
  const result = record(normalized.projected.result);
  try {
    const created = await db.hiveContributionLedger.create({
      data: {
        contributionType: "result",
        contributor: shortText(provenance.contributor, "anonymous-contributor"),
        summary: shortText(result.summary ?? result.commit, "Result contribution ready for review"),
        payloadHash: normalized.payloadHash,
        status: "submitted",
        redactionStatus: "result-only",
        resultBundle: normalized.projected as Prisma.InputJsonValue,
        sourceReceipt: normalized.sourceReceipt,
        deliveryStatus: "not-requested",
      },
    });
    return { ok: true as const, action: "created" as const, id: created.id };
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
    const raced = await db.hiveContributionLedger.findUnique({ where: { sourceReceipt: normalized.sourceReceipt } });
    if (!raced || raced.payloadHash !== normalized.payloadHash) {
      return { ok: false as const, violations: ["sourceReceipt:payload-conflict"] };
    }
    return { ok: true as const, action: "noop" as const, id: raced.id };
  }
}

export async function deliverHiveResult(
  id: string,
  delivery: (bundle: Record<string, unknown>) => Promise<{ ok: true; remoteRef: string } | { ok: false; error: string }>,
  db: HiveResultStore = prisma as unknown as HiveResultStore,
) {
  const row = await db.hiveContributionLedger.findUnique({ where: { id } });
  if (!row || row.status !== "accepted" || !row.resultBundle) throw new Error("Only an accepted Hive result can be delivered.");
  if (row.deliveryStatus === "delivered" && row.deliveryRemoteRef) {
    return {
      status: "delivered" as const,
      attempts: row.deliveryAttempts ?? 0,
      remoteRef: row.deliveryRemoteRef,
      lastError: null,
      nextAttemptAt: null,
    };
  }
  const outcome = await delivery(record(row.resultBundle));
  const attempt = outcome.ok
    ? resolveHiveDeliveryAttempt({ ok: true, remoteRef: outcome.remoteRef, attempts: row.deliveryAttempts ?? 0 })
    : resolveHiveDeliveryAttempt({ ok: false, error: outcome.error, attempts: row.deliveryAttempts ?? 0 });
  await db.hiveContributionLedger.update({
    where: { id },
    data: {
      deliveryStatus: attempt.status,
      deliveryAttempts: attempt.attempts,
      deliveryRemoteRef: attempt.remoteRef,
      deliveryError: attempt.lastError,
      nextDeliveryAt: attempt.nextAttemptAt,
      deliveredAt: attempt.status === "delivered" ? new Date() : null,
    },
  });
  return attempt;
}

export async function deliverHiveResultToConfiguredForge(id: string) {
  let config: { upstreamRemoteUrl: string | null } | null = null;
  let token: string | null = null;
  try {
    [config, token] = await Promise.all([
      prisma.platformDevConfig.findUnique({ where: { id: "singleton" }, select: { upstreamRemoteUrl: true } }),
      resolveHiveToken(),
    ]);
  } catch (error) {
    return deliverHiveResult(id, async () => ({
      ok: false,
      error: error instanceof Error ? error.message : "Hive forge configuration could not be read.",
    }));
  }
  const repository = parseGitHubRepositoryUrl(config?.upstreamRemoteUrl);
  return deliverHiveResult(id, async (bundle) => {
    if (!repository) return { ok: false, error: "Hive forge repository is not configured." };
    if (!token) return { ok: false, error: "Hive forge credential is not configured." };
    const result = bundle.result && typeof bundle.result === "object" && !Array.isArray(bundle.result)
      ? bundle.result as Record<string, unknown>
      : {};
    const titleSeed = typeof result.summary === "string"
      ? result.summary
      : typeof result.commit === "string"
        ? `Hive result ${result.commit}`
        : "Hive result contribution";
    const adapter = new GitHubForgeAdapter({ token });
    const delivered = await adapter.createIssue({
      repository,
      title: titleSeed.slice(0, 200),
      body: [
        "A result-only contribution was accepted by Founder Hub.",
        "",
        "```json",
        JSON.stringify(bundle, null, 2),
        "```",
      ].join("\n"),
      labels: ["hive-result", "contribution"],
      egressClass: "public-hive",
    });
    return delivered.ok
      ? { ok: true, remoteRef: delivered.remote.url }
      : { ok: false, error: delivered.message };
  });
}
