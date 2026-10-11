"use client";

// Mounted once in the shell layout (BI-BD0B0DCC). Reports Core Web Vitals via
// Next's bundled web-vitals, completes the shell-ready journey on the first
// painted frame after hydration, and flushes queued telemetry when the page
// is hidden. Renders nothing.

import { useEffect } from "react";
import { useReportWebVitals } from "next/web-vitals";
import { beginJourney, completeJourney, flushTelemetry, queueWebVital } from "@/lib/telemetry/journeys";

export function PortalVitals() {
  useReportWebVitals((metric) => queueWebVital(metric, window.location.pathname));

  useEffect(() => {
    // shell-ready is measured from navigation start (performance.timeOrigin).
    beginJourney("shell-ready", undefined, 0);
    completeJourney("shell-ready");
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushTelemetry();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", () => flushTelemetry());
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, []);

  return null;
}
