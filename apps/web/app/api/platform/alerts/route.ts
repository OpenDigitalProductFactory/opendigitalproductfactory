import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@dpf/db";

// Grafana webhook alert receiver.
// Creates/resolves PortfolioQualityIssue records from Prometheus alerts.

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

  for (const alert of alerts) {
    const alertName = alert.labels?.alertname ?? "unknown";
    const issueKey = `health-alert-${alertName}`;
    const severity = alert.labels?.severity === "critical" ? "error" : "warn";
    const summary = alert.annotations?.summary ?? alertName;
    const description = alert.annotations?.description ?? "";

    if (alert.status === "firing") {
      // Upsert: create if new, update lastDetectedAt if existing
      await prisma.portfolioQualityIssue.upsert({
        where: { issueKey },
        create: {
          issueKey,
          issueType: "health_alert",
          severity,
          summary,
          details: { alertName, description, labels: alert.labels },
          status: "open",
          firstDetectedAt: alert.startsAt ? new Date(alert.startsAt) : new Date(),
          lastDetectedAt: new Date(),
        },
        update: {
          severity,
          summary,
          details: { alertName, description, labels: alert.labels },
          status: "open",
          lastDetectedAt: new Date(),
          resolvedAt: null,
        },
      });
    } else if (alert.status === "resolved") {
      // Auto-resolve
      await prisma.portfolioQualityIssue.updateMany({
        where: { issueKey, status: "open" },
        data: {
          status: "resolved",
          resolvedAt: new Date(),
          lastDetectedAt: new Date(),
        },
      });
    }
  }

  return NextResponse.json({ received: alerts.length });
}
