// apps/web/app/(shell)/compliance/posture/posture-score.ts
//
// Shared (non-client) score→intent mapping so both the server page and the
// client trend table use the same thresholds. Type-only import from the
// report-kit barrel (erased at compile — no client boundary pulled in).

import type { Intent } from "@/components/ui/report-kit";

export function scoreIntent(score: number): Intent {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "danger";
}
