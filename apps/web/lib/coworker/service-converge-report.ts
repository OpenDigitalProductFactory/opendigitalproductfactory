import { isIP } from "node:net";
import { z } from "zod";

export const SAVED_SERVICE_REPORT_COMMAND = "docker compose exec -T portal cat /dpf-state/service-converge-outcome.json";
const service = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const names = z.array(service).max(128);
const changes = z.array(z.object({ service, from: hash, to: hash }).strict().refine(v => v.from !== v.to)).max(128);
const schema = z.object({
  mode: z.literal("shadow"), targetSha: z.string().regex(/^[a-f0-9]{40}$/), at: z.string().datetime(),
  outcome: z.enum(["current", "degraded", "would-recreate"]), wouldRecreate: changes, unchanged: names,
  skippedStopped: names, dataOwnerChanged: changes, unclassified: names, failed: names,
  bindDrift: z.array(z.object({ service, port: z.string().regex(/^[0-9]{1,5}$/).refine(v => Number(v) > 0 && Number(v) <= 65535),
    running: z.string().refine(v => isIP(v) > 0), rendered: z.string().refine(v => isIP(v) > 0) }).strict()).max(128),
}).strict();

export type ServiceConvergeReport = {
  mode: "shadow"; targetSha: string; observedAtIso: string; outcome: "current" | "degraded" | "would-recreate";
  classifications: Record<"wouldRecreate" | "unchanged" | "skippedStopped" | "dataOwnerChanged" | "unclassified" | "failed" | "bindDrift", string[]>;
};

/** The producer truncates at 15,000 characters; that boundary is never proof of a complete report. */
export function parseServiceConvergeReport(output: unknown, executedAt: Date): ServiceConvergeReport | null {
  if (typeof output !== "string" || output.length >= 15000 || !Number.isFinite(executedAt.getTime())) return null;
  let value: unknown;
  try { value = JSON.parse(output); } catch { return null; }
  const parsed = schema.safeParse(value);
  if (!parsed.success || Date.parse(parsed.data.at) > executedAt.getTime()) return null;
  const report = parsed.data;
  const classifications = {
    wouldRecreate: report.wouldRecreate.map(v => v.service), unchanged: report.unchanged,
    skippedStopped: report.skippedStopped, dataOwnerChanged: report.dataOwnerChanged.map(v => v.service),
    unclassified: report.unclassified, failed: report.failed,
    bindDrift: [...new Set(report.bindDrift.map(v => v.service))],
  };
  const all = Object.values(classifications).flat();
  if (new Set(all).size !== all.length
    || new Set(report.bindDrift.map(v => `${v.service}:${v.port}`)).size !== report.bindDrift.length) return null;
  for (const group of Object.values(classifications)) group.sort();
  return { mode: "shadow", targetSha: report.targetSha, observedAtIso: new Date(report.at).toISOString(),
    outcome: report.outcome, classifications };
}
