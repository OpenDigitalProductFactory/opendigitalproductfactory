import * as crypto from "crypto";

function genId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export const generateScanId = () => genId("SCAN");
export const generateAlertId = () => genId("RALRT");

export const SCAN_STATUSES = ["running", "completed", "failed"] as const;
export const SCAN_TRIGGER_TYPES = ["scheduled", "manual"] as const;

export const ALERT_TYPES = ["change-detected", "new-regulation", "deadline-approaching", "enforcement-action"] as const;
export const ALERT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const ALERT_STATUSES = ["pending", "reviewed", "actioned", "dismissed"] as const;
export const ALERT_RESOLUTIONS = [
  "dismissed", "obligation-created", "regulation-updated", "flagged-for-further-review",
] as const;

export function validateAlertResolution(resolution: string): string | null {
  if (!(ALERT_RESOLUTIONS as readonly string[]).includes(resolution)) {
    return `Resolution must be one of: ${ALERT_RESOLUTIONS.join(", ")}.`;
  }
  return null;
}

export type LLMScanResponse = {
  hasChanged: boolean;
  confidence: "high" | "medium" | "low";
  summary: string;
  severity: "low" | "medium" | "high" | "critical";
  suggestedAction: string;
};

export const REGULATORY_MONITOR_PROMPT = `You are a regulatory compliance monitor. Check whether this regulation has been updated or changed.

Regulation: {name} ({shortName})
Jurisdiction: {jurisdiction}
Last known version: {lastKnownVersion}
Last checked: {sourceCheckDate}
Source URL: {sourceUrl}

Respond in JSON only (no markdown, no explanation):
{
  "hasChanged": boolean,
  "confidence": "high" | "medium" | "low",
  "summary": "brief description of what changed or 'no changes detected'",
  "severity": "low" | "medium" | "high" | "critical",
  "suggestedAction": "what the compliance team should do"
}`;

export function buildScanPrompt(reg: {
  name: string; shortName: string; jurisdiction: string;
  lastKnownVersion?: string | null; sourceCheckDate?: Date | null; sourceUrl?: string | null;
}): string {
  return REGULATORY_MONITOR_PROMPT
    .replace("{name}", reg.name)
    .replace("{shortName}", reg.shortName)
    .replace("{jurisdiction}", reg.jurisdiction)
    .replace("{lastKnownVersion}", reg.lastKnownVersion ?? "unknown")
    .replace("{sourceCheckDate}", reg.sourceCheckDate?.toISOString().split("T")[0] ?? "never")
    .replace("{sourceUrl}", reg.sourceUrl ?? "none provided");
}
