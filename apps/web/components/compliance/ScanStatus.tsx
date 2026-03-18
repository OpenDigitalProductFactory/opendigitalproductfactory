"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { triggerRegulatoryMonitorScan } from "@/lib/actions/regulatory-monitor";

type ScanInfo = {
  scanId: string;
  status: string;
  startedAt: Date;
  regulationsChecked: number;
  alertsGenerated: number;
} | null;

export function ScanStatus({ latestScan }: { latestScan: ScanInfo }) {
  const [scanning, setScanning] = useState(false);
  const router = useRouter();

  async function handleRunScan() {
    setScanning(true);
    await triggerRegulatoryMonitorScan("manual");
    setScanning(false);
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--dpf-border)]">
      <div>
        {latestScan ? (
          <>
            <p className="text-sm text-white">
              Last scan: {new Date(latestScan.startedAt).toLocaleDateString()}
              <span className={`ml-2 text-[9px] px-1.5 py-0.5 rounded-full ${
                latestScan.status === "completed" ? "bg-green-900/30 text-green-400" :
                latestScan.status === "failed" ? "bg-red-900/30 text-red-400" :
                "bg-yellow-900/30 text-yellow-400"
              }`}>{latestScan.status}</span>
            </p>
            <p className="text-xs text-[var(--dpf-muted)]">
              {latestScan.regulationsChecked} checked · {latestScan.alertsGenerated} alerts
            </p>
          </>
        ) : (
          <p className="text-sm text-[var(--dpf-muted)]">No scans yet</p>
        )}
      </div>
      <button onClick={handleRunScan} disabled={scanning}
        className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50">
        {scanning ? "Scanning..." : "Run Scan Now"}
      </button>
    </div>
  );
}
