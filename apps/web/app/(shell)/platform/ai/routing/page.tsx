// apps/web/app/(shell)/platform/ai/routing/page.tsx
// Moved to /platform/audit/routes — redirect to new canonical URL.
import { permanentRedirect } from "next/navigation";

export default function RoutingRedirect() {
  permanentRedirect("/platform/audit/routes");
}
