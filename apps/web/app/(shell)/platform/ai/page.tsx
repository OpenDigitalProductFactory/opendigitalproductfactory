// apps/web/app/(shell)/platform/ai/page.tsx
// EP-26E528F5 (coworker UX carry-through): the AI section's front door is the
// workforce itself — the directory at /platform/ai/overview, where each row
// opens the coworker's record. Health altitudes (Readiness, Operations Map)
// stay one tab away in the same family nav.
import { permanentRedirect } from "next/navigation";

export default async function PlatformAiPage() {
  permanentRedirect("/platform/ai/overview");
}
