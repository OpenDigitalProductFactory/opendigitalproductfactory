/**
 * Load A2A edges and run collaboration health analysis (BI-3003EE63 slice 1).
 * Notify / ImprovementSignal / AI Ops handoff land in slice 2.
 */
import {
  analyzeCollaborationHealth,
  type AnalyzeCollaborationHealthOptions,
  type CollaborationHealthReport,
} from "./analysis";
import { loadCollaborationEdgeEvents } from "./load-events";

export type RunCollaborationHealthOptions = AnalyzeCollaborationHealthOptions & {
  windowHours?: number;
  limit?: number;
};

export type CollaborationHealthRunResult = {
  report: CollaborationHealthReport;
  /** Slice 2 will increment when PlatformNotification is wired. */
  notified: number;
};

function clampWindowHours(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 24;
  return Math.min(168, Math.max(1, Math.floor(n)));
}

export async function runCollaborationHealthReport(
  opts: RunCollaborationHealthOptions = {},
): Promise<CollaborationHealthRunResult> {
  const windowHours = clampWindowHours(opts.windowHours);
  const events = await loadCollaborationEdgeEvents(windowHours, opts.limit);
  const report = analyzeCollaborationHealth(events, opts);
  return { report, notified: 0 };
}
