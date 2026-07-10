"use client";

// EP-FULL-OBS Tier 2 (BI-5FE8656F) — System Health "Log Issues" panel.
//
// Surfaces the log-signature reports the scanner filed from Loki, so an
// operator sees hidden log problems in-portal without opening Docker Desktop.
// Each row deep-links to Grafana → Explore → Loki, filtered to that service.

import { useCallback, useEffect, useState } from "react";
import { TONE_COLOR, type Tone } from "./health-summary";
import { AskCoworkerButton } from "@/components/agent/AskCoworkerButton";
import { getLogSignatureIssues } from "@/lib/actions/quality";

interface LogIssue {
  reportId: string;
  title: string;
  severity: string;
  status: string;
  description: string | null;
  dedupeKey: string | null;
  createdAt: string;
}

const GRAFANA_BASE = "http://localhost:3002";

function severityTone(severity: string): Tone {
  if (severity === "critical" || severity === "error") return "critical";
  if (severity === "high" || severity === "medium" || severity === "warn") return "warning";
  return "success";
}

// dedupeKey is `log-sig:<service>:<sigId>` — pull the service for the drill-down.
function serviceOf(issue: LogIssue): string | null {
  const parts = issue.dedupeKey?.split(":");
  return parts && parts.length >= 3 ? parts[1] : null;
}

// Best-effort Grafana Explore deep link (lands on Explore even if the pane
// param is ignored by a Grafana version mismatch).
function lokiExploreUrl(service: string | null): string {
  const selector = service ? `{compose_project="dpf", service="${service}"}` : `{compose_project="dpf"}`;
  const panes = {
    dpf: {
      datasource: "loki",
      queries: [
        { refId: "A", datasource: { type: "loki" }, expr: `${selector} |~ "(?i)(error|fatal|panic|exception|traceback)"` },
      ],
      range: { from: "now-3h", to: "now" },
    },
  };
  return `${GRAFANA_BASE}/explore?schemaVersion=1&orgId=1&panes=${encodeURIComponent(JSON.stringify(panes))}`;
}

// Handoff prompt carrying the issue's own facts — the alternative was handing
// a business user a raw Loki Explore link as the only "action".
function buildLogIssuePrompt(issue: LogIssue, service: string | null): string {
  return [
    `I'm looking at the System Health "Log issues" panel. This issue needs a diagnosis:`,
    `- [${issue.severity}] ${issue.title}${service ? ` (service: ${service})` : ""}, first seen ${issue.createdAt}${
      issue.description ? ` — ${issue.description}` : ""
    }`,
    "Please check the recent logs for this service, explain what's failing and its impact in plain language, and either fix it if you have a safe way to do so or give me the exact next step.",
  ].join("\n");
}

export function LogIssuesPanel() {
  const [issues, setIssues] = useState<LogIssue[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unauthorized" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const res = await getLogSignatureIssues();
      if (!res.authorized) {
        setState("unauthorized");
        return;
      }
      setIssues(res.items);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (state === "unauthorized") return null;

  return (
    <section>
      <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
        Log Issues
      </h3>

      {state === "loading" && (
        <p className="text-xs text-[var(--dpf-muted)]">Scanning…</p>
      )}

      {state === "error" && (
        <p className="text-xs text-[var(--dpf-muted)]">Log issue data unavailable</p>
      )}

      {state === "ready" && issues.length === 0 && (
        <p className="text-xs text-[var(--dpf-success)]">No open log issues</p>
      )}

      {state === "ready" && issues.length > 0 && (
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
          <table className="w-full text-xs">
            <tbody>
              {issues.map((issue) => {
                const tone = severityTone(issue.severity);
                const service = serviceOf(issue);
                const time = new Date(issue.createdAt).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <tr key={issue.reportId} className="border-t border-[var(--dpf-border)] first:border-t-0 align-top">
                    <td className="px-3 py-1.5 text-[var(--dpf-muted)] w-28 whitespace-nowrap">{time}</td>
                    <td className="px-2 py-1.5 w-16">
                      <span className="text-[10px] font-bold uppercase" style={{ color: TONE_COLOR[tone] }}>
                        {issue.severity.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-[var(--dpf-text)]">{issue.title}</td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      <AskCoworkerButton
                        prompt={buildLogIssuePrompt(issue, service)}
                        routeContext="/admin"
                        className="text-[var(--dpf-accent)] hover:underline mr-3"
                      />
                      <a
                        href={lokiExploreUrl(service)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--dpf-accent)] hover:underline"
                      >
                        Logs ↗
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
