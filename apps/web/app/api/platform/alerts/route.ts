import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import {
  upsertHealthAlertIssue,
  resolveHealthAlertIssue,
  healthAlertIssueKey,
} from "@/lib/observability/health-alert-issue";

// Grafana / Alertmanager webhook alert receiver.
// Creates/resolves PortfolioQualityIssue records from pushed alerts. Shares the
// writer (lib/observability/health-alert-issue) with the alert-delivery-bridge
// poll path so push and poll produce identical rows. Note: there is no
// Alertmanager in the default stack today, so the active delivery path is the
// poll bridge — this endpoint remains a valid receiver if one is ever added.

type GrafanaAlert = {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  status: "firing" | "resolved";
  startsAt?: string;
  endsAt?: string;
};

type GrafanaWebhookPayload = {
  alerts?: GrafanaAlert[];
  status?: string;
  commonLabels?: Record<string, string>;
  commonAnnotations?: Record<string, string>;
};

export async function POST(req: NextRequest) {
  let body: GrafanaWebhookPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const alerts = body.alerts ?? [];

  // `prisma as never` at the db-handle boundary matches the established pattern
  // for passing the full client to a narrow injectable handle (see
  // discovery-runner.ts); the writer body stays type-checked against HealthAlertDb.
  for (const alert of alerts) {
    if (alert.status === "firing") {
      await upsertHealthAlertIssue(prisma as never, {
        labels: alert.labels ?? {},
        annotations: alert.annotations ?? {},
        startsAt: alert.startsAt,
      });
    } else if (alert.status === "resolved") {
      await resolveHealthAlertIssue(prisma as never, healthAlertIssueKey(alert.labels ?? {}));
    }
  }

  return NextResponse.json({ received: alerts.length });
}
