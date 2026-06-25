// apps/web/app/(shell)/platform/ai/priority/page.tsx
// EP-GOLDEN-TRIANGLE surface consolidation: the Cost/Quality/Time priority control
// merged into the single "AI Coworker Priority & Models" surface at
// /platform/ai/assignments (everyday priority on top, advanced guardrails below).
// This route now redirects to the canonical URL — mirrors the model-assignment shim.
import { permanentRedirect } from "next/navigation";

export default function GoldenTrianglePriorityRedirect() {
  permanentRedirect("/platform/ai/assignments");
}
