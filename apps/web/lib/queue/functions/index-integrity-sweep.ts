import pg from "pg";
import { cron } from "@/lib/jobs/triggers";

import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";
import type { CreatePlatformIssueReportInput } from "@/lib/quality/platform-issue-reports";
import { routeToHuman } from "@/lib/govern/authority/route-to-human";
import {
  checkCollationStability,
  checkIndexIntegrity,
} from "../../../../../packages/db/scripts/index-integrity-core.mjs";

type SweepDeps = {
  client?: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };
  connect: () => Promise<void>;
  end: () => Promise<void>;
  checkCollationStability: typeof checkCollationStability;
  checkIndexIntegrity: typeof checkIndexIntegrity;
  createPlatformIssueReport: (input: CreatePlatformIssueReportInput) => Promise<unknown>;
};

async function liveDeps(): Promise<SweepDeps> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const client = new pg.Client({ connectionString });
  const { createPlatformIssueReport } = await import("@/lib/quality/platform-issue-reports");
  return {
    client,
    connect: async () => { await client.connect(); },
    end: () => client.end(),
    checkCollationStability,
    checkIndexIntegrity,
    createPlatformIssueReport,
  };
}

export async function runIndexIntegritySweep(injected?: SweepDeps) {
  const deps = injected ?? await liveDeps();
  const client = deps.client ?? deps;
  await deps.connect();
  try {
    const collation = await deps.checkCollationStability(client);
    const integrity = await deps.checkIndexIntegrity(client, {
      amcheckMode: "provision",
      schema: "public",
      uniqueOnly: false,
    });
    const blocking = collation.findings.filter((finding: { severity: string }) => finding.severity === "error");
    const failed = integrity.corrupted.length > 0 || blocking.length > 0;
    if (failed) {
      // Live data-integrity drift is critical risk: the escalation gate puts it
      // to a person with that reason, and never consults (BI-5E067004).
      await routeToHuman(
        {
          producer: "index-integrity-sweep",
          subject: { kind: "platform", id: "live-database" },
          blockingFacts: ["live database index or collation integrity drift"],
          declarations: { riskTier: "critical" },
          report: {
            type: "index-integrity-drift",
            source: "index-integrity-sweep",
            severity: "critical",
            title: "Live database index integrity drift detected",
            description: JSON.stringify({ corrupted: integrity.corrupted, collationFindings: blocking }),
            routeContext: "/ops",
            triggerKind: "scheduled-integrity-sweep",
            dedupeKey: "index-integrity-sweep:live-database",
          },
        },
        {
          write: {
            createReport: async (input) => {
              const created = await deps.createPlatformIssueReport(input as unknown as CreatePlatformIssueReportInput);
              return { reportId: (created as { reportId?: string } | undefined)?.reportId ?? "" };
            },
            resolveOwner: async () => null,
            notify: async () => {},
          },
        },
      );
    }
    return {
      failed,
      issueRaised: failed,
      indexesChecked: integrity.indexesChecked,
      corrupted: integrity.corrupted.length,
      blockingCollationFindings: blocking.length,
    };
  } finally {
    await deps.end();
  }
}

export const indexIntegritySweep = jobs.createFunction(
  {
    id: "ops/index-integrity-sweep",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("30 5 * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/index-integrity-sweep");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("check-live-index-integrity", () => runIndexIntegritySweep());
  },
);
