// apps/web/app/(shell)/platform/ai/page.tsx
// The AI Operations default resolves to readiness, not a second "Overview"
// surface. The coworker directory remains available at /platform/ai/overview.
import { permanentRedirect } from "next/navigation";

export default async function PlatformAiPage() {
  permanentRedirect("/platform/ai/readiness");
}
