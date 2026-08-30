// EP-SOVEREIGN-SOC P4 — SOC console server loader (prisma-backed).
//
// Thin IO shell over the pure computeSocConsoleData: query the Detection /
// SecurityCase / SecurityEvent aggregates and the recent-case list, then compute
// the first-screen view. The page and the /api/platform/security/overview route
// both call loadSocConsole.

import { computeSocConsoleData, type SocConsoleData } from "./console-data";

export interface SocRecentCase {
  caseKey: string;
  title: string;
  severity: string;
  status: string;
  verdict: string;
  openedAt: string; // ISO for the client boundary
}

export interface SocConsole {
  data: SocConsoleData;
  recentCases: SocRecentCase[];
}

export async function loadSocConsole(opts?: { lookbackMinutes?: number }): Promise<SocConsole> {
  const { prisma } = await import("@dpf/db");
  const lookback = opts?.lookbackMinutes ?? 24 * 60;
  const since = new Date(Date.now() - lookback * 60 * 1000);

  const [detections, cases, activeSources, allSources, recent] = await Promise.all([
    prisma.detection.findMany({
      // BI-7D1EC4B9: no time window. "Open detections" is a status count and must be
      // consistent with the all-time "Open cases" shown beside it — windowing detections
      // to 24h hid every open detection older than a day (43 of them, next to 12 open
      // cases). `activeSources` below keeps its 24h window; "active" IS a recency concept.
      select: { severity: true, status: true },
      take: 5000,
    }),
    prisma.securityCase.findMany({
      select: { severity: true, status: true, verdict: true, openedAt: true, resolvedAt: true },
      take: 5000,
    }),
    prisma.securityEvent.findMany({
      where: { time: { gte: since } },
      select: { sourceKind: true },
      distinct: ["sourceKind"],
      take: 100,
    }),
    prisma.securityEvent.findMany({
      select: { sourceKind: true },
      distinct: ["sourceKind"],
      take: 100,
    }),
    prisma.securityCase.findMany({
      orderBy: { openedAt: "desc" },
      take: 50,
      select: { caseKey: true, title: true, severity: true, status: true, verdict: true, openedAt: true },
    }),
  ]);

  const data = computeSocConsoleData({
    detections,
    cases,
    activeSourceKinds: activeSources.map((s) => s.sourceKind),
    allSourceKinds: allSources.map((s) => s.sourceKind),
  });
  const recentCases: SocRecentCase[] = recent.map((c) => ({
    caseKey: c.caseKey,
    title: c.title,
    severity: c.severity,
    status: c.status,
    verdict: c.verdict,
    openedAt: c.openedAt.toISOString(),
  }));
  return { data, recentCases };
}
