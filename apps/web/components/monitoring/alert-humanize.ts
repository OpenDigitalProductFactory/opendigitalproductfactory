// Plain-language translation of health alerts (BI-2F778C13).
//
// The Platform Health surfaces used to render raw Prometheus vocabulary —
// "CRITICAL ContainerDown / Service sandbox is down" — at a business user who
// cannot act on it. This module is the single dictionary that turns an alert
// (alertname + labels) into a human title, a what-this-means line, and a
// context-rich coworker prompt, so every surface (header dropdown, alert
// banner, attention inbox) speaks the same plain language while keeping the
// raw alert name available as small-print diagnostics.
//
// Pure module: no React, no client/server directives — imported by client
// components AND the server-side attention source.

import { JOB_PRESENTATION, type MonitoringAlert } from "./health-summary";

export type HumanizedAlert = {
  /** Plain-language headline, e.g. "Build sandbox is offline". */
  title: string;
  /** What this means for the user — the "so what" line. */
  explanation: string;
  /** Raw alertname kept for diagnostics small-print. */
  alertName: string;
  /** Friendly service name when the alert names one, else null. */
  serviceName: string | null;
};

/** Friendly service name from the alert's job/service/instance labels. */
export function friendlyServiceName(labels: Record<string, string | undefined>): string | null {
  const job = labels.service || labels.job || null;
  if (job && JOB_PRESENTATION[job]) return JOB_PRESENTATION[job].name;
  if (job) return job;
  const instance = labels.instance;
  if (!instance) return null;
  const colon = instance.indexOf(":");
  return colon === -1 ? instance : instance.slice(0, colon);
}

// What breaks when a monitored service is down — keyed by scrape job.
const SERVICE_DOWN_IMPACT: Record<string, string> = {
  portal: "The web portal is not responding — most of the platform is unavailable.",
  sandbox: "Builds and AI coworker development work can't run until it's back.",
  postgres: "The platform database is unreachable — most features will fail.",
  // BET-5 retired Qdrant/Neo4j services — keep keys only so a stale scrape/label
  // never invents a "knowledge graph down" consequence after decommission.
  qdrant: "Legacy vector-DB label (retired) — memory lives in Postgres/pgvector.",
  inngest: "Background jobs and scheduled coworker work are paused.",
  redis: "Work queues and caching are unavailable.",
  neo4j: "Legacy graph-DB label (retired) — graph mirror lives in Postgres.",
  adp: "Document processing is unavailable.",
  "dev-portal": "The contributor preview (a contributor-only surface) is down.",
  prometheus: "Health monitoring itself is down — alert data may be stale.",
};

const GENERIC_DOWN_IMPACT = "Features that depend on this service won't work until it's back.";

type AlertTranslation = {
  title: (serviceName: string | null, labels: Record<string, string | undefined>) => string;
  explanation: (serviceName: string | null, labels: Record<string, string | undefined>) => string;
};

// One entry per alert rule in monitoring/prometheus/alerts.yml and
// monitoring/loki/rules/dpf-log-alerts.yml. Unknown alert names fall back to
// a de-camel-cased title + the rule's own summary annotation.
const ALERT_TRANSLATIONS: Record<string, AlertTranslation> = {
  ContainerDown: {
    title: (s) => `${s ?? "A platform service"} is offline`,
    explanation: (_s, labels) =>
      SERVICE_DOWN_IMPACT[labels.service || labels.job || ""] ?? GENERIC_DOWN_IMPACT,
  },
  ContainerRestarting: {
    title: (s) => `${s ?? "A platform service"} keeps restarting`,
    explanation: () =>
      "The service is crashing and coming back in a loop, so it can't be relied on right now.",
  },
  ContainerHighCPU: {
    title: (s) => `${s ?? "A platform service"} is under heavy load`,
    explanation: () => "The service is using most of its processing power — things may feel slow.",
  },
  ContainerHighMemory: {
    title: (s) => `${s ?? "A platform service"} is running low on memory`,
    explanation: () => "If it runs out, the service may crash and restart.",
  },
  HostHighCPU: {
    title: () => "This computer is under heavy load",
    explanation: () => "The machine running the platform is near its processing limit — everything may feel slow.",
  },
  HostHighMemory: {
    title: () => "This computer is running low on memory",
    explanation: () => "The machine running the platform is near its memory limit — services may become unstable.",
  },
  HostDiskPressure: {
    title: () => "Disk space is getting low",
    explanation: () => "The machine running the platform is filling up — free some space before it becomes a problem.",
  },
  HostDiskCritical: {
    title: () => "Disk space is critically low",
    explanation: () => "The platform can stop working when the disk fills completely — free up space now.",
  },
  HostNetworkInterfaceDown: {
    title: () => "A network connection is down",
    explanation: () => "The machine running the platform lost one of its network links.",
  },
  PostgresDown: {
    title: () => "The platform database is down",
    explanation: () => SERVICE_DOWN_IMPACT.postgres,
  },
  PostgresConnectionSaturation: {
    title: () => "The database is nearly out of connections",
    explanation: () => "If connections run out, pages and coworkers will start failing.",
  },
  // QdrantDown / Neo4jDown retired with BET-5 (BI-31FDC859 / BI-49C4EA5D) —
  // rules removed from alerts.yml; if a stale alert still arrives, do not
  // restate a phantom "knowledge graph" failure as current platform state.
  QdrantDown: {
    title: () => "Stale memory-search alert (Qdrant was retired)",
    explanation: () =>
      "Qdrant is no longer part of the install — memory and vectors live in Postgres. This alert should clear after monitoring reloads.",
  },
  Neo4jDown: {
    title: () => "Stale graph alert (Neo4j was retired)",
    explanation: () =>
      "Neo4j is no longer part of the install — the graph mirror lives in Postgres. This alert should clear after monitoring reloads.",
  },
  ModelRunnerDown: {
    title: () => "Local AI is unavailable",
    explanation: () => "The local AI engine isn't responding — AI features fall back to cloud providers or fail.",
  },
  SttDown: {
    title: () => "Voice input is unavailable",
    explanation: () => "The speech-to-text service isn't responding — dictation won't work.",
  },
  VoiceServiceDown: {
    title: () => "Voice narration is unavailable",
    explanation: () =>
      "Voice narration is turned on, but its speech service isn't running — narration and voice previews won't play.",
  },
  DetectorSelfDistrust: {
    title: (_s, labels) =>
      labels.contradicted_alert === "VoiceServiceDown"
        ? "Monitoring may be wrong about voice narration"
        : "A health monitor may be reporting the wrong thing",
    explanation: (_s, labels) =>
      labels.contradicted_alert === "VoiceServiceDown"
        ? "The monitor says voice narration is down, but narration is not currently enabled. Treat this as a monitoring problem, not a feature outage."
        : "A health rule is firing even though live platform state contradicts it. Check the monitor before treating the feature as broken.",
  },
  ServiceFlapping: {
    title: (s) => `${s ?? "A platform service"} is unstable`,
    explanation: () => "It keeps switching between up and down, so it can't be relied on right now.",
  },
  AIInferenceHighLatency: {
    title: () => "AI responses are slow",
    explanation: () => "The AI engine is taking much longer than normal to answer.",
  },
  SemanticMemoryStoreFailures: {
    title: () => "AI memory is failing to save",
    explanation: () => "New knowledge isn't being stored — coworkers may forget recent context.",
  },
  UnhandledServerErrors: {
    title: () => "The portal is hitting unexpected errors",
    explanation: () => "Some pages or actions are failing with server errors.",
  },
  LogIngestionThrottled: {
    title: () => "Diagnostic logging is falling behind",
    explanation: () => "Log collection is throttled — troubleshooting data may be incomplete.",
  },
  ContainerErrorLogSpike: {
    title: (s) => `${s ?? "A platform service"} is logging repeated errors`,
    explanation: () => "Something inside the service is failing repeatedly — it may still work, but needs a look.",
  },
  ContainerErrorLogStorm: {
    title: (s) => `${s ?? "A platform service"} is flooding with errors`,
    explanation: () => "The service is failing hard and fast — expect broken features until it's fixed.",
  },
  WindowsHostHighCPU: {
    title: () => "This computer is under heavy load",
    explanation: () => "The machine running the platform is near its processing limit — everything may feel slow.",
  },
  WindowsHostHighMemory: {
    title: () => "This computer is running low on memory",
    explanation: () => "The machine running the platform is near its memory limit — services may become unstable.",
  },
  WindowsHostDiskPressure: {
    title: () => "Disk space is getting low",
    explanation: () => "The machine running the platform is filling up — free some space before it becomes a problem.",
  },
  WindowsHostDiskCritical: {
    title: () => "Disk space is critically low",
    explanation: () => "The platform can stop working when the disk fills completely — free up space now.",
  },
};

/** "ContainerDown" → "Container Down" for alert names outside the dictionary. */
function deCamel(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

export function humanizeHealthAlert(alert: {
  labels: Record<string, string | undefined>;
  annotations?: Record<string, string | undefined>;
}): HumanizedAlert {
  const alertName = alert.labels.alertname ?? "Unknown alert";
  const labels = alert.labels as Record<string, string>;
  const serviceName = friendlyServiceName(alert.labels);
  const translation = ALERT_TRANSLATIONS[alertName];
  if (translation) {
    return {
      title: translation.title(serviceName, labels),
      explanation: translation.explanation(serviceName, labels),
      alertName,
      serviceName,
    };
  }
  return {
    title: serviceName ? `${deCamel(alertName)}: ${serviceName}` : deCamel(alertName),
    explanation: alert.annotations?.summary ?? "A platform health rule is firing.",
    alertName,
    serviceName,
  };
}

/**
 * Context-rich prompt for the coworker handoff (the `open-agent-panel`
 * autoMessage). Carries the raw alert facts the coworker needs to diagnose —
 * the human never has to transcribe jargon — and asks for a diagnosis plus a
 * concrete next step, matching the admin-assistant's "check system health"
 * skill surface.
 */
export function buildHealthAlertCoworkerPrompt(alerts: MonitoringAlert[]): string {
  const lines = alerts.map((alert) => {
    const humanized = humanizeHealthAlert(alert);
    const severity = alert.labels.severity ?? "warning";
    const since = alert.activeAt ? ` since ${alert.activeAt}` : "";
    const summary = alert.annotations.summary ? ` — ${alert.annotations.summary}` : "";
    return `- [${severity}] ${humanized.title} (alert: ${humanized.alertName}${
      humanized.serviceName ? `, service: ${humanized.serviceName}` : ""
    }${since})${summary}`;
  });
  return [
    "I'm looking at the Platform Health warning and need help with these firing alerts:",
    ...lines,
    "Please diagnose what's actually wrong (check container status and recent logs where you can), explain the impact in plain language, and either fix it if you have a safe way to do so or give me the exact next step to resolve it.",
  ].join("\n");
}

/** The routeContext for the coworker handoff — the System Admin owns platform health. */
export const HEALTH_COWORKER_ROUTE_CONTEXT = "/admin";
