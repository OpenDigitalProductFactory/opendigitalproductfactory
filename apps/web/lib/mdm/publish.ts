/**
 * MDM publishing contract (BI-1ABF6443): the governed read model consumers
 * use instead of raw rows. Every published customer-account view carries a
 * TrustAssessment envelope (spec 2026-05-26 trust vector) scoring uniqueness
 * (open duplicate tasks), freshness (staleness window), and completeness
 * (identity-field coverage) — a duplicated or stale record is never
 * presented as a clean fact. First consumer: the /customer DQ scorecard.
 */
import { prisma } from "@dpf/db";
import { scoreTrustVector } from "@/lib/trust-vector/score";
import type { TrustAssessment } from "@/lib/trust-vector/types";
import { loadMatchConfig } from "./match-config";

export type CustomerMasterDataQuality = {
  accountsTotal: number;
  /** Accounts with website AND industry populated. */
  accountsComplete: number;
  completenessPct: number;
  openDuplicateTasks: number;
  openStaleTasks: number;
  staleAccounts: number;
  sourceSystems: number;
  trust: TrustAssessment;
};

/** Aggregate DQ read model for the customer master-data domain. */
export async function getCustomerMasterDataQuality(): Promise<CustomerMasterDataQuality> {
  const config = await loadMatchConfig("customer-account");
  const cutoff = new Date(Date.now() - config.staleAfterDays * 24 * 60 * 60 * 1000);

  const [accountsTotal, accountsComplete, openDuplicateTasks, openStaleTasks, staleAccounts, sources] =
    await Promise.all([
      prisma.customerAccount.count({ where: { status: { not: "superseded" } } }),
      prisma.customerAccount.count({
        where: { status: { not: "superseded" }, website: { not: null }, industry: { not: null } },
      }),
      prisma.mdmStewardTask.count({ where: { status: "open", kind: "duplicate" } }),
      prisma.mdmStewardTask.count({ where: { status: "open", kind: "stale" } }),
      prisma.customerAccount.count({
        where: { status: { in: ["active", "at_risk", "onboarding"] }, updatedAt: { lt: cutoff } },
      }),
      prisma.masterDataSourceRef.groupBy({
        by: ["sourceSystem"],
        where: { domain: "customer-account", status: "active" },
      }),
    ]);

  const completenessPct = accountsTotal === 0 ? 100 : Math.round((accountsComplete / accountsTotal) * 100);
  const uniquenessScore = accountsTotal === 0 ? 1 : Math.max(0, 1 - openDuplicateTasks / accountsTotal);
  const freshnessScore = accountsTotal === 0 ? 1 : Math.max(0, 1 - staleAccounts / accountsTotal);

  const trust = scoreTrustVector({
    subject: { type: "master-data-domain", id: "customer-account", label: "Customer accounts" },
    asOf: new Date().toISOString(),
    dimensions: [
      {
        key: "uniqueness",
        label: "Uniqueness",
        score: uniquenessScore,
        rationale:
          openDuplicateTasks === 0
            ? "No unresolved duplicate pairs."
            : `${openDuplicateTasks} unresolved duplicate pair(s) in the steward queue.`,
      },
      {
        key: "freshness",
        label: "Freshness",
        score: freshnessScore,
        rationale:
          staleAccounts === 0
            ? `All active accounts touched within ${config.staleAfterDays} days.`
            : `${staleAccounts} active account(s) untouched for over ${config.staleAfterDays} days.`,
      },
      {
        key: "coverageCompleteness",
        label: "Completeness",
        score: completenessPct / 100,
        rationale: `${completenessPct}% of accounts have website + industry populated.`,
      },
    ],
    sourceSummary: `${sources.length || 1} source system(s) via MasterDataSourceRef crosswalk`,
  });

  return {
    accountsTotal,
    accountsComplete,
    completenessPct,
    openDuplicateTasks,
    openStaleTasks,
    staleAccounts,
    sourceSystems: sources.length,
    trust,
  };
}
