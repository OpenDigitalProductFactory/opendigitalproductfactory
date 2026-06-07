/**
 * Integration test (real Postgres + in-process stub relay) for the upstream
 * feedback escalation happy path — the functional proof for BI-6D45BA27 A5.
 *
 * Skipped by default (and in CI). Run explicitly against the ISOLATED dev DB:
 *
 *   RUN_DB_INTEGRATION=1 \
 *   INTEGRATION_DATABASE_URL=postgresql://dpf:dpf_dev@localhost:5433/dpf \
 *   pnpm test lib/actions/feedback-escalation.integration.test.ts
 *
 * Safety: refuses to run unless the URL targets the dev DB (:5433) so it can
 * never mutate the live database on :5432. It exercises the RELAY transport
 * (upstreamRelayUrl set), so it never calls GitHub even on a token-bearing
 * install. All rows it creates are cleaned up and config is restored.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

const RUN = process.env.RUN_DB_INTEGRATION === "1";

type Captured = { headers: Record<string, string | string[] | undefined>; body: string };

describe.skipIf(!RUN)("fileUpstreamFeedback — real DB + stub relay", () => {
  // Dynamically imported after DATABASE_URL is pinned to the dev DB.
  let prisma: typeof import("@dpf/db").prisma;
  let escalateReportUpstream: typeof import("./feedback-escalation").escalateReportUpstream;

  let stub: Server;
  let stubUrl: string;
  let captured: Captured | null = null;

  let reportId: string;
  let priorConfig: {
    upstreamFeedbackOptIn: boolean;
    upstreamRelayUrl: string | null;
    contributionMode: string;
    hiveContributionsPaused: boolean;
  };

  const HOSTNAME = "DESKTOP-ZZZ9QW";

  beforeAll(async () => {
    const url = process.env.INTEGRATION_DATABASE_URL;
    if (!url || !url.includes(":5433")) {
      throw new Error(`Refusing to run: INTEGRATION_DATABASE_URL must target the dev DB on :5433, got ${url ?? "(unset)"}`);
    }
    process.env.DATABASE_URL = url;

    // Stub relay — captures the request, returns a GitHub-shaped success.
    await new Promise<void>((resolve) => {
      stub = createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          captured = { headers: req.headers, body };
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ issueNumber: 4242, url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/4242" }));
        });
      });
      stub.listen(0, "127.0.0.1", resolve);
    });
    stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}/intake`;

    ({ prisma } = await import("@dpf/db"));
    ({ escalateReportUpstream } = await import("./feedback-escalation"));
    const { createPlatformIssueReport } = await import("@/lib/quality/platform-issue-reports");

    const existing = await prisma.platformDevConfig.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { upstreamFeedbackOptIn: true, upstreamRelayUrl: true, contributionMode: true, hiveContributionsPaused: true },
    });
    priorConfig = existing;

    await prisma.platformDevConfig.update({
      where: { id: "singleton" },
      data: {
        upstreamFeedbackOptIn: true,
        upstreamRelayUrl: stubUrl,
        contributionMode: "selective",
        hiveContributionsPaused: false,
      },
    });

    const created = await createPlatformIssueReport({
      type: "user_report",
      title: `Crash on ${HOSTNAME} dashboard`,
      description: `Boom happened on ${HOSTNAME} while loading.`,
      severity: "high",
      routeContext: "/build",
      source: "integration-test",
    });
    reportId = created.reportId;
  });

  afterAll(async () => {
    if (!prisma) return;
    if (reportId) {
      await prisma.platformIssueReport.deleteMany({ where: { reportId } });
      await prisma.hiveContributionLedger.deleteMany({
        where: { contributionType: "feedback", summary: { contains: reportId } },
      });
    }
    if (priorConfig) {
      await prisma.platformDevConfig.update({ where: { id: "singleton" }, data: priorConfig });
    }
    await new Promise<void>((resolve) => stub.close(() => resolve()));
  });

  it("files via the relay, persists the upstream link, ledgers it, and redacts the payload", async () => {
    const result = await escalateReportUpstream({ reportId });

    expect(result).toMatchObject({ ok: true, status: "filed", issueNumber: 4242 });

    // Persisted upstream link on the report row.
    const row = await prisma.platformIssueReport.findUniqueOrThrow({
      where: { reportId },
      select: { upstreamIssueNumber: true, upstreamIssueUrl: true, upstreamSyncedAt: true },
    });
    expect(row.upstreamIssueNumber).toBe(4242);
    expect(row.upstreamIssueUrl).toContain("/issues/4242");
    expect(row.upstreamSyncedAt).toBeInstanceOf(Date);

    // Ledger audit row written.
    const ledger = await prisma.hiveContributionLedger.findFirst({
      where: { contributionType: "feedback", summary: { contains: reportId } },
      select: { contributor: true, status: true, payloadHash: true },
    });
    expect(ledger?.status).toBe("submitted");
    expect(ledger?.contributor).toMatch(/^dpf-agent-/);
    expect(ledger?.payloadHash).toBeTruthy();

    // Relay actually received a redacted, install-authenticated payload.
    expect(captured).not.toBeNull();
    expect(captured!.headers["x-dpf-install-id"]).toMatch(/^dpf-agent-/);
    const sent = JSON.parse(captured!.body) as { title: string; body: string };
    expect(sent.title).not.toContain(HOSTNAME);
    expect(sent.body).not.toContain(HOSTNAME);
    expect(sent.title).toContain("[redacted]");
  });

  it("is idempotent — a second escalation does not re-file", async () => {
    const result = await escalateReportUpstream({ reportId });
    expect(result).toMatchObject({ ok: true, status: "already-filed", issueNumber: 4242 });
  });
});
